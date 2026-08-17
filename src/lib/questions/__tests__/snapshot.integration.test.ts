/**
 * @jest-environment node
 */
import { adminClient } from '@/test/supabase-helpers';
import { resolveQuestions } from '../snapshot';
import type { Question } from '../types';

/**
 * The snapshot invariant, against the real database.
 *
 * A lead rewording a posting in October must not change how an application
 * submitted in September renders or exports. The failure mode this guards is a
 * future developer reading the live posting instead of the frozen snapshot, and
 * only a real round-trip through Postgres catches that — a mocked test would
 * hold whatever object the code handed it, which is exactly the bug.
 */

const admin = adminClient();

/**
 * Namespaced, for the same reason as the RLS test: a blanket delete would take
 * the reference data with it and the tests would still pass.
 */
const FIXTURE_TEAM_SLUGS = ['test-snapshot'];
const FIXTURE_POSTING_SLUGS = ['test-snapshot-2026', 'test-snapshot-deep-2026'];

const QUESTION_A: Question = {
  id: 'ballast',
  type: 'long_text',
  label: 'Why is ballast needed on a sailboat?',
  required: true,
  config: { maxLength: 600 },
};

const QUESTION_B: Question = {
  id: 'tack-gybe',
  type: 'long_text',
  label: 'What is the difference between a tack and a gybe?',
  required: true,
  config: { maxLength: 600 },
};

const QUESTION_C: Question = {
  id: 'points-of-sail',
  type: 'long_text',
  label: 'Name the points of sail.',
  required: true,
  config: { maxLength: 600 },
};

let teamId: string;
let postingId: string;
let deepCopyPostingId: string;

async function clearFixtures() {
  // postings.team_id is ON DELETE RESTRICT, so postings go before teams; the
  // applications written by these tests cascade from their posting.
  const { error: postingsError } = await admin
    .from('postings')
    .delete()
    .in('slug', FIXTURE_POSTING_SLUGS);
  if (postingsError) throw postingsError;

  const { error } = await admin.from('teams').delete().in('slug', FIXTURE_TEAM_SLUGS);
  if (error) throw error;
}

beforeAll(async () => {
  await clearFixtures();

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: 'Test Snapshot', slug: 'test-snapshot' })
    .select()
    .single();
  if (teamError) throw teamError;
  teamId = team!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: teamId,
        title: 'Snapshot Fixture',
        slug: 'test-snapshot-2026',
        status: 'open',
        question_schema: [QUESTION_A, QUESTION_B],
      },
      {
        team_id: teamId,
        title: 'Deep Copy Fixture',
        slug: 'test-snapshot-deep-2026',
        status: 'open',
        question_schema: [QUESTION_A],
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  postingId = postings!.find((p) => p.slug === 'test-snapshot-2026')!.id;
  deepCopyPostingId = postings!.find((p) => p.slug === 'test-snapshot-deep-2026')!.id;
});

// Cleared on the way out as well as the way in: the fixture team's open posting
// would otherwise show up on the developer's own home page as a phantom entry.
afterAll(clearFixtures);

async function loadCoreQuestions() {
  const { data, error } = await admin
    .from('core_questions')
    .select('stable_key, position, definition')
    .order('position');
  if (error) throw error;
  return data!;
}

async function loadPosting(id: string) {
  const { data, error } = await admin
    .from('postings')
    .select('question_schema')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data!;
}

async function insertApplication(opts: { postingId: string; email: string; snapshot: Question[] }) {
  const { data, error } = await admin
    .from('applications')
    .insert({
      posting_id: opts.postingId,
      submission_id: crypto.randomUUID(),
      applicant_name: 'Snapshot Applicant',
      applicant_email: opts.email,
      year_of_study: '2',
      faculty: 'Applied Science',
      home_department: 'MECH',
      answers: { ballast: 'It keeps the boat upright.' },
      question_schema_snapshot: opts.snapshot,
    })
    .select()
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function loadSnapshot(applicationId: string): Promise<Question[]> {
  const { data, error } = await admin
    .from('applications')
    .select('question_schema_snapshot')
    .eq('id', applicationId)
    .single();
  if (error) throw error;
  return data!.question_schema_snapshot as Question[];
}

describe('the snapshot survives the posting being edited', () => {
  it('still holds the original wording of A, still holds B, and never gains C', async () => {
    const core = await loadCoreQuestions();
    const posting = await loadPosting(postingId);

    const resolved = resolveQuestions(core, posting);
    expect(resolved.map((q) => q.id)).toEqual([
      ...core.map((c) => c.stable_key),
      'ballast',
      'tack-gybe',
    ]);

    const applicationId = await insertApplication({
      postingId,
      email: 'snapshot-applicant@student.ubc.ca',
      snapshot: resolved,
    });

    // The October edit: A reworded, B deleted, C added.
    const rewordedA = { ...QUESTION_A, label: 'REWORDED: why does a sailboat need ballast?' };
    const { error: updateError } = await admin
      .from('postings')
      .update({ question_schema: [rewordedA, QUESTION_C] })
      .eq('id', postingId);
    if (updateError) throw updateError;

    // The edit really landed — otherwise the assertions below would pass for
    // the wrong reason.
    const livePosting = (await loadPosting(postingId)).question_schema as Question[];
    expect(livePosting.map((q) => q.id)).toEqual(['ballast', 'points-of-sail']);
    expect(livePosting[0].label).toBe(rewordedA.label);

    const stored = await loadSnapshot(applicationId);
    const storedById = new Map(stored.map((q) => [q.id, q]));

    expect(storedById.get('ballast')!.label).toBe(QUESTION_A.label);
    expect(storedById.get('ballast')!.label).not.toBe(rewordedA.label);
    expect(storedById.get('tack-gybe')!.label).toBe(QUESTION_B.label);
    expect(storedById.has('points-of-sail')).toBe(false);
    expect(stored.map((q) => q.id)).toEqual(resolved.map((q) => q.id));
  });

  it('keeps the core questions it was answered against, stable keys included', async () => {
    const core = await loadCoreQuestions();
    // The reference migration installs at least why_sailbot; if that ever
    // becomes an empty table this test would silently check nothing.
    expect(core.length).toBeGreaterThan(0);

    const resolved = resolveQuestions(core, await loadPosting(postingId));
    const applicationId = await insertApplication({
      postingId,
      email: 'snapshot-core@student.ubc.ca',
      snapshot: resolved,
    });

    const stored = await loadSnapshot(applicationId);
    for (const coreQuestion of core) {
      const frozen = stored.find((q) => q.stableKey === coreQuestion.stable_key);
      expect(frozen).toBeDefined();
      expect(frozen!.id).toBe(coreQuestion.stable_key);
      expect(frozen!.label).toBe((coreQuestion.definition as { label: string }).label);
    }
  });
});

describe('the stored snapshot is a deep copy', () => {
  it('ignores a mutation made to the source between resolution and insert', async () => {
    const core = await loadCoreQuestions();
    const posting = await loadPosting(deepCopyPostingId);
    const sourceQuestions = posting.question_schema as Question[];

    const resolved = resolveQuestions(core, posting);

    // A shared reference would let this reach into the row about to be written.
    sourceQuestions[0].label = 'MUTATED after resolution';
    (sourceQuestions[0].config as { maxLength: number }).maxLength = 1;
    sourceQuestions.push(QUESTION_C);

    const applicationId = await insertApplication({
      postingId: deepCopyPostingId,
      email: 'snapshot-deepcopy@student.ubc.ca',
      snapshot: resolved,
    });

    const stored = await loadSnapshot(applicationId);
    const ballast = stored.find((q) => q.id === 'ballast')!;
    expect(ballast.label).toBe(QUESTION_A.label);
    expect(ballast.config).toEqual({ maxLength: 600 });
    expect(stored.some((q) => q.id === 'points-of-sail')).toBe(false);
  });

  it('is unaffected by mutating the resolved array after the row is written', async () => {
    const core = await loadCoreQuestions();
    const resolved = resolveQuestions(core, await loadPosting(deepCopyPostingId));

    const applicationId = await insertApplication({
      postingId: deepCopyPostingId,
      email: 'snapshot-deepcopy-2@student.ubc.ca',
      snapshot: resolved,
    });

    resolved[0].label = 'MUTATED after insert';
    resolved.length = 1;

    const stored = await loadSnapshot(applicationId);
    expect(stored).toHaveLength(core.length + 1);
    expect(stored[0].label).not.toBe('MUTATED after insert');
  });
});
