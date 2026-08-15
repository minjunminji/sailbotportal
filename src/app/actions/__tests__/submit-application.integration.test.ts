/**
 * @jest-environment node
 */

/**
 * The submission action against the real database.
 *
 * Every assertion that something was REJECTED is followed by a check that
 * nothing was written, because "returned an error" and "wrote nothing" are
 * different claims and only the second one matters to an applicant. The
 * service role is used for those checks so RLS cannot make an empty result look
 * like a clean rejection.
 *
 * Fixtures are `test-` namespaced and cleared on the way in and the way out,
 * per the convention in rls.integration.test.ts. Uploaded objects go into the
 * same private bucket real resumes use, so they are removed too.
 */

// The action reads the caller's IP through next/headers for rate limiting,
// which has no request to read outside Next. Each call gets its own IP, which
// also keeps the suite independent of test order: the limiter is module state
// in the action and narrower than the number of submissions made here.
let mockIpCounter = 0;
jest.mock('next/headers', () => ({
  headers: async () => {
    mockIpCounter += 1;
    return new Headers({ 'x-forwarded-for': `198.51.100.${mockIpCounter % 250}` });
  },
}));

import { adminClient } from '@/test/supabase-helpers';
import {
  submitApplication,
  type SubmissionInput,
  type SubmitFailure,
  type SubmitSuccess,
} from '../submit-application';

const admin = adminClient();

const BUCKET = 'resumes';

const TEAM_SLUGS = ['test-submit-soft', 'test-submit-mech'];
const POSTING_SLUGS = ['test-submit-soft-2026', 'test-submit-mech-2026', 'test-submit-draft-2026'];

const SOFT = 'test-submit-soft-2026';
const MECH = 'test-submit-mech-2026';
const DRAFT = 'test-submit-draft-2026';

/** Long enough to satisfy the real core question, which every posting inherits. */
const WHY = 'I want to build autonomous boats and this team is where that actually happens.';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechPostingId: string;
let draftPostingId: string;
let alphaId: string;
let betaId: string;
let gammaId: string;
let inactiveId: string;
let hullId: string;

/** A resume path that really exists in the bucket, shared by most tests. */
let resumePath: string;
/** A `question` upload that really exists, for the soft posting's file question. */
let quizPath: string;
let quizSize: number;

const uploadedPaths: string[] = [];

const MECH_QUESTIONS = [
  {
    id: 'mech_only',
    type: 'long_text',
    label: 'What is ballast?',
    required: true,
    config: { maxLength: 500 },
  },
];

const SOFT_QUESTIONS = [
  {
    id: 'soft_only',
    type: 'select',
    label: 'Are you available on Saturdays?',
    required: true,
    config: { options: ['Yes', 'No'] },
  },
  {
    id: 'soft_file',
    type: 'file',
    label: 'Technical quiz',
    required: false,
    config: { accept: ['.zip'], maxBytes: 10485760 },
  },
];

const DRAFT_QUESTIONS = [
  {
    id: 'draft_only',
    type: 'short_text',
    label: 'Anything else?',
    required: false,
    config: { maxLength: 100 },
  },
];

function fileOf(magic: number[], size = 256): Uint8Array {
  const out = new Uint8Array(Math.max(size, magic.length));
  out.set(magic, 0);
  out.fill(0x41, magic.length);
  return out;
}

/** Writes an object the way the upload route does: a server-chosen UUID path. */
async function seedUpload(prefix: 'resume' | 'question', ext: 'pdf' | 'zip', bytes: Uint8Array) {
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: ext === 'pdf' ? 'application/pdf' : 'application/zip',
    upsert: false,
  });
  if (error) throw error;
  uploadedPaths.push(path);
  return path;
}

async function clearFixtures() {
  // postings cascade to applications; subteams cascade from teams.
  const { error: postingsError } = await admin.from('postings').delete().in('slug', POSTING_SLUGS);
  if (postingsError) throw postingsError;

  const { error: teamsError } = await admin.from('teams').delete().in('slug', TEAM_SLUGS);
  if (teamsError) throw teamsError;
}

async function clearUploads() {
  if (uploadedPaths.length === 0) return;
  const { error } = await admin.storage.from(BUCKET).remove(uploadedPaths);
  if (error) throw error;
  uploadedPaths.length = 0;
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Submit Software', slug: 'test-submit-soft' },
      { name: 'Test Submit Mechanical', slug: 'test-submit-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((t) => t.slug === 'test-submit-soft')!.id;
  mechTeamId = teams!.find((t) => t.slug === 'test-submit-mech')!.id;

  const { data: subteams, error: subteamsError } = await admin
    .from('subteams')
    .insert([
      // `active` is spelled out on every row: a bulk insert where only some
      // rows carry a key sends null for the rest rather than the column default.
      { team_id: softTeamId, name: 'Alpha', slug: 'test-alpha', position: 0, active: true },
      { team_id: softTeamId, name: 'Beta', slug: 'test-beta', position: 1, active: true },
      { team_id: softTeamId, name: 'Gamma', slug: 'test-gamma', position: 2, active: true },
      { team_id: softTeamId, name: 'Retired', slug: 'test-retired', position: 3, active: false },
      { team_id: mechTeamId, name: 'Hull', slug: 'test-hull', position: 0, active: true },
    ])
    .select();
  if (subteamsError) throw subteamsError;
  alphaId = subteams!.find((s) => s.slug === 'test-alpha')!.id;
  betaId = subteams!.find((s) => s.slug === 'test-beta')!.id;
  gammaId = subteams!.find((s) => s.slug === 'test-gamma')!.id;
  inactiveId = subteams!.find((s) => s.slug === 'test-retired')!.id;
  hullId = subteams!.find((s) => s.slug === 'test-hull')!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Software',
        slug: SOFT,
        status: 'open',
        question_schema: SOFT_QUESTIONS,
        subteam_ranking: { enabled: true, maxChoices: 2 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Mechanical',
        slug: MECH,
        status: 'open',
        question_schema: MECH_QUESTIONS,
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
      {
        team_id: softTeamId,
        title: 'Test Draft',
        slug: DRAFT,
        status: 'draft',
        question_schema: DRAFT_QUESTIONS,
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((p) => p.slug === SOFT)!.id;
  mechPostingId = postings!.find((p) => p.slug === MECH)!.id;
  draftPostingId = postings!.find((p) => p.slug === DRAFT)!.id;

  resumePath = await seedUpload('resume', 'pdf', fileOf(PDF_MAGIC));
  const quizBytes = fileOf(ZIP_MAGIC, 512);
  quizSize = quizBytes.byteLength;
  quizPath = await seedUpload('question', 'zip', quizBytes);
});

afterAll(async () => {
  await clearUploads();
  await clearFixtures();
});

// --- helpers ---------------------------------------------------------------

let emailCounter = 0;
function testEmail(tag: string): string {
  emailCounter += 1;
  // The underscore is deliberate: the duplicate check matches case-insensitively
  // with `ilike`, where an unescaped `_` is a wildcard.
  return `test_${tag}_${Date.now()}_${emailCounter}@student.ubc.ca`;
}

function mechAnswers(extra: Record<string, unknown> = {}) {
  return { why_sailbot: WHY, mech_only: 'Weight low in the hull that resists heeling.', ...extra };
}

function softAnswers(extra: Record<string, unknown> = {}) {
  return { why_sailbot: WHY, soft_only: 'Yes', ...extra };
}

function baseInput(email: string, overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    name: 'Test Applicant',
    email,
    yearOfStudy: '3',
    homeDepartment: 'CPSC',
    resumePath,
    teams: [],
    ...overrides,
  };
}

async function rowsFor(email: string) {
  const { data, error } = await admin
    .from('applications')
    .select('*')
    .in('posting_id', [softPostingId, mechPostingId, draftPostingId])
    .eq('applicant_email', email.trim().toLowerCase());
  if (error) throw error;
  return data!;
}

function asFailure(result: Awaited<ReturnType<typeof submitApplication>>): SubmitFailure {
  expect(result.ok).toBe(false);
  return result as SubmitFailure;
}

function asSuccess(result: Awaited<ReturnType<typeof submitApplication>>): SubmitSuccess {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
}

// --- tests -----------------------------------------------------------------

describe('a submission covering two teams', () => {
  it('writes one row per team, sharing a submission and a resume', async () => {
    const email = testEmail('two-teams');

    const result = asSuccess(
      await submitApplication(
        baseInput(email, {
          teams: [
            { postingSlug: MECH, answers: mechAnswers() },
            {
              postingSlug: SOFT,
              answers: softAnswers(),
              rankedSubteams: [betaId, alphaId],
            },
          ],
        }),
      ),
    );

    expect(result.teams.map((t) => t.postingSlug).sort()).toEqual([MECH, SOFT]);
    expect(result.teams.map((t) => t.teamName).sort()).toEqual([
      'Test Submit Mechanical',
      'Test Submit Software',
    ]);

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.submission_id))).toEqual(new Set([result.submissionId]));
    expect(new Set(rows.map((r) => r.resume_path))).toEqual(new Set([resumePath]));

    const mechRow = rows.find((r) => r.posting_id === mechPostingId)!;
    const softRow = rows.find((r) => r.posting_id === softPostingId)!;

    // The snapshots are per row, not per submission. This is the invariant that
    // lets one team reword its posting without rewriting the other's history.
    const mechIds = (mechRow.question_schema_snapshot as { id: string }[]).map((q) => q.id);
    const softIds = (softRow.question_schema_snapshot as { id: string }[]).map((q) => q.id);

    expect(mechIds).toContain('mech_only');
    expect(mechIds).not.toContain('soft_only');
    expect(softIds).toContain('soft_only');
    expect(softIds).not.toContain('mech_only');
    // The core question is resolved into both, from the database.
    expect(mechIds).toContain('why_sailbot');
    expect(softIds).toContain('why_sailbot');

    // Ranking is stored only where the posting asked for it, in preference order.
    expect(softRow.ranked_subteams).toEqual([betaId, alphaId]);
    expect(mechRow.ranked_subteams).toEqual([]);

    expect(mechRow.applicant_email).toBe(email.toLowerCase());
    expect(mechRow.year_of_study).toBe('3');
    expect(mechRow.status).toBe('applied');
  });

  it('normalises the email before storing it', async () => {
    const email = testEmail('normalise');
    const result = asSuccess(
      await submitApplication(
        baseInput(`  ${email.toUpperCase()}  `, {
          teams: [{ postingSlug: MECH, answers: mechAnswers() }],
        }),
      ),
    );

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].applicant_email).toBe(email.toLowerCase());
    expect(rows[0].submission_id).toBe(result.submissionId);
  });
});

describe('rejections', () => {
  it('refuses a submission selecting zero teams', async () => {
    const email = testEmail('no-teams');
    const failed = asFailure(await submitApplication(baseInput(email, { teams: [] })));

    expect(failed.code).toBe('no_teams');
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses a draft posting even though the client sent it', async () => {
    const email = testEmail('draft');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [
            { postingSlug: MECH, answers: mechAnswers() },
            { postingSlug: DRAFT, answers: { why_sailbot: WHY } },
          ],
        }),
      ),
    );

    expect(failed.code).toBe('posting_unavailable');
    expect(failed.issues.map((i) => i.posting)).toEqual([DRAFT]);

    // Not even the open half of the submission was written.
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses a posting slug that does not exist', async () => {
    const email = testEmail('unknown-posting');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [{ postingSlug: 'test-submit-nonexistent', answers: mechAnswers() }],
        }),
      ),
    );

    expect(failed.code).toBe('posting_unavailable');
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses answers that fail the posting schema', async () => {
    const email = testEmail('bad-answers');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          // `mech_only` is required and missing; `soft_only` is not an option.
          teams: [
            { postingSlug: MECH, answers: { why_sailbot: WHY } },
            {
              postingSlug: SOFT,
              answers: softAnswers({ soft_only: 'Maybe' }),
              rankedSubteams: [alphaId],
            },
          ],
        }),
      ),
    );

    expect(failed.code).toBe('invalid_answers');
    expect(failed.issues.map((i) => `${i.posting}:${i.field}`).sort()).toEqual([
      `${MECH}:mech_only`,
      `${SOFT}:soft_only`,
    ]);
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses a ranked subteam belonging to another team', async () => {
    const email = testEmail('cross-team-subteam');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [{ postingSlug: SOFT, answers: softAnswers(), rankedSubteams: [alphaId, hullId] }],
        }),
      ),
    );

    expect(failed.code).toBe('invalid_subteams');
    expect(failed.issues[0].posting).toBe(SOFT);
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses a ranked subteam that is inactive, and one that does not exist', async () => {
    const inactive = testEmail('inactive-subteam');
    expect(
      asFailure(
        await submitApplication(
          baseInput(inactive, {
            teams: [{ postingSlug: SOFT, answers: softAnswers(), rankedSubteams: [inactiveId] }],
          }),
        ),
      ).code,
    ).toBe('invalid_subteams');
    expect(await rowsFor(inactive)).toHaveLength(0);

    const unknown = testEmail('unknown-subteam');
    expect(
      asFailure(
        await submitApplication(
          baseInput(unknown, {
            teams: [
              { postingSlug: SOFT, answers: softAnswers(), rankedSubteams: [crypto.randomUUID()] },
            ],
          }),
        ),
      ).code,
    ).toBe('invalid_subteams');
    expect(await rowsFor(unknown)).toHaveLength(0);
  });

  it('refuses ranked subteams when the posting does not rank subteams', async () => {
    const email = testEmail('ranking-disabled');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [{ postingSlug: MECH, answers: mechAnswers(), rankedSubteams: [hullId] }],
        }),
      ),
    );

    expect(failed.code).toBe('invalid_subteams');
    expect(failed.issues[0].posting).toBe(MECH);
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses more ranked subteams than the posting allows', async () => {
    const email = testEmail('too-many-subteams');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [
            {
              postingSlug: SOFT,
              answers: softAnswers(),
              rankedSubteams: [alphaId, betaId, gammaId],
            },
          ],
        }),
      ),
    );

    expect(failed.code).toBe('invalid_subteams');
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses a resume path this app never issued', async () => {
    const invented = testEmail('invented-resume');
    expect(
      asFailure(
        await submitApplication(
          baseInput(invented, {
            // Correctly shaped, and no such object exists.
            resumePath: `resume/${crypto.randomUUID()}.pdf`,
            teams: [{ postingSlug: MECH, answers: mechAnswers() }],
          }),
        ),
      ).code,
    ).toBe('invalid_file');
    expect(await rowsFor(invented)).toHaveLength(0);

    const arbitrary = testEmail('arbitrary-resume');
    expect(
      asFailure(
        await submitApplication(
          baseInput(arbitrary, {
            resumePath: '../../../etc/passwd',
            teams: [{ postingSlug: MECH, answers: mechAnswers() }],
          }),
        ),
      ).code,
    ).toBe('invalid_file');
    expect(await rowsFor(arbitrary)).toHaveLength(0);
  });

  it('refuses a file answer pointing at an object that does not exist', async () => {
    const email = testEmail('invented-file');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [
            {
              postingSlug: SOFT,
              answers: softAnswers({
                soft_file: {
                  path: `question/${crypto.randomUUID()}.zip`,
                  filename: 'quiz.zip',
                  size: 512,
                },
              }),
              rankedSubteams: [alphaId],
            },
          ],
        }),
      ),
    );

    expect(failed.code).toBe('invalid_file');
    expect(failed.issues.map((i) => i.field)).toEqual(['soft_file']);
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses a submission whose honeypot was filled', async () => {
    const email = testEmail('honeypot');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          honeypot: 'https://spam.example',
          teams: [{ postingSlug: MECH, answers: mechAnswers() }],
        }),
      ),
    );

    expect(failed.code).toBe('rejected');
    expect(await rowsFor(email)).toHaveLength(0);
  });

  it('refuses malformed shared fields', async () => {
    const failed = asFailure(
      await submitApplication({
        name: '   ',
        email: 'not-an-email',
        yearOfStudy: '7th',
        homeDepartment: '',
        teams: [{ postingSlug: MECH, answers: mechAnswers() }],
      }),
    );

    expect(failed.code).toBe('invalid_input');
    expect(failed.issues.map((i) => i.field).sort()).toEqual([
      'email',
      'homeDepartment',
      'name',
      'yearOfStudy',
    ]);
  });

  it('refuses the same team twice in one submission', async () => {
    const email = testEmail('same-team-twice');
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [
            { postingSlug: MECH, answers: mechAnswers() },
            { postingSlug: MECH, answers: mechAnswers() },
          ],
        }),
      ),
    );

    expect(failed.code).toBe('invalid_input');
    expect(await rowsFor(email)).toHaveLength(0);
  });
});

describe('answers are stored exactly as the posting defines them', () => {
  it('strips keys the posting never asked for', async () => {
    const email = testEmail('unknown-keys');
    await submitApplication(
      baseInput(email, {
        teams: [
          {
            postingSlug: MECH,
            answers: mechAnswers({
              not_a_question: 'should never be stored',
              status: 'offered',
            }),
          },
        ],
      }),
    );

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    const answers = rows[0].answers as Record<string, unknown>;
    expect(Object.keys(answers).sort()).toEqual(['mech_only', 'why_sailbot']);
    expect(answers.not_a_question).toBeUndefined();
    // The stray `status` key went nowhere near the column of the same name.
    expect(rows[0].status).toBe('applied');
  });

  it('stores a file answer once its object is known to exist', async () => {
    const email = testEmail('file-answer');
    await submitApplication(
      baseInput(email, {
        teams: [
          {
            postingSlug: SOFT,
            answers: softAnswers({
              soft_file: { path: quizPath, filename: 'quiz.zip', size: quizSize },
            }),
            rankedSubteams: [gammaId],
          },
        ],
      }),
    );

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    const answers = rows[0].answers as Record<string, { path: string }>;
    expect(answers.soft_file.path).toBe(quizPath);
  });
});

describe('an email that already applied', () => {
  it('names the team that already holds the application, and writes nothing', async () => {
    const email = testEmail('duplicate');

    const first = asSuccess(
      await submitApplication(
        baseInput(email, { teams: [{ postingSlug: MECH, answers: mechAnswers() }] }),
      ),
    );
    const before = await rowsFor(email);
    expect(before).toHaveLength(1);

    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          name: 'Changed Name',
          teams: [{ postingSlug: MECH, answers: mechAnswers({ mech_only: 'A new answer.' }) }],
        }),
      ),
    );

    expect(failed.code).toBe('duplicate');
    expect(failed.duplicateTeams).toEqual([
      { teamSlug: 'test-submit-mech', teamName: 'Test Submit Mechanical', postingSlug: MECH },
    ]);
    expect(failed.message).toContain('Test Submit Mechanical');

    // The row already on file is untouched: same submission, same answers, same name.
    const after = await rowsFor(email);
    expect(after).toHaveLength(1);
    expect(after[0].submission_id).toBe(first.submissionId);
    expect(after[0].applicant_name).toBe('Test Applicant');
    expect(after[0].answers).toEqual(before[0].answers);
  });

  it('does not mistake a similar address for the same one', async () => {
    // `ilike` treats an unescaped underscore as a wildcard, and every fixture
    // address here has several. A false duplicate would reject a stranger.
    const first = testEmail('similar');
    const second = first.replace('test_similar', 'testXsimilar');

    asSuccess(
      await submitApplication(
        baseInput(first, { teams: [{ postingSlug: MECH, answers: mechAnswers() }] }),
      ),
    );
    asSuccess(
      await submitApplication(
        baseInput(second, { teams: [{ postingSlug: MECH, answers: mechAnswers() }] }),
      ),
    );

    expect(await rowsFor(first)).toHaveLength(1);
    expect(await rowsFor(second)).toHaveLength(1);
  });

  it('writes NOTHING when only the second team conflicts', async () => {
    const email = testEmail('partial');

    // Already applied to software only.
    asSuccess(
      await submitApplication(
        baseInput(email, {
          teams: [{ postingSlug: SOFT, answers: softAnswers(), rankedSubteams: [alphaId] }],
        }),
      ),
    );

    // Now mechanical + software. Mechanical would succeed on its own.
    const failed = asFailure(
      await submitApplication(
        baseInput(email, {
          teams: [
            { postingSlug: MECH, answers: mechAnswers() },
            { postingSlug: SOFT, answers: softAnswers(), rankedSubteams: [alphaId] },
          ],
        }),
      ),
    );

    expect(failed.code).toBe('duplicate');
    expect(failed.duplicateTeams!.map((t) => t.postingSlug)).toEqual([SOFT]);

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].posting_id).toBe(softPostingId);
    // The mechanical half was not written, so a retry is still possible.
    expect(rows.filter((r) => r.posting_id === mechPostingId)).toHaveLength(0);
  });
});

describe('the write itself is one transaction', () => {
  it('rolls the whole submission back when any row fails', async () => {
    // Straight at the RPC, past the action's own duplicate check, because this
    // is the claim that the *database* write is atomic. A loop of separate
    // inserts would leave the mechanical row behind.
    const email = testEmail('atomic');
    const submissionId = crypto.randomUUID();

    asSuccess(
      await submitApplication(
        baseInput(email, {
          teams: [{ postingSlug: SOFT, answers: softAnswers(), rankedSubteams: [alphaId] }],
        }),
      ),
    );

    const row = (postingId: string) => ({
      posting_id: postingId,
      submission_id: submissionId,
      applicant_name: 'Race Condition',
      applicant_email: email.toLowerCase(),
      year_of_study: '3',
      home_department: 'CPSC',
      resume_path: resumePath,
      ranked_subteams: [],
      answers: {},
      question_schema_snapshot: [],
    });

    const { error } = await admin.rpc('submit_application', {
      // Mechanical first — it would insert cleanly — then software, which
      // collides with the row written above.
      p_rows: [row(mechPostingId), row(softPostingId)],
    });

    // Asserted before the error itself: "nothing was written" is the claim, and
    // an implementation that swallowed the conflict and reported success would
    // otherwise be caught by the wrong assertion.
    const { data: written } = await admin
      .from('applications')
      .select('id')
      .eq('submission_id', submissionId);
    expect(written).toHaveLength(0);

    // And specifically: the row that would have succeeded is not there.
    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0].posting_id).toBe(softPostingId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('23505');
  });

  it('refuses to be called with no rows at all', async () => {
    const { error } = await admin.rpc('submit_application', { p_rows: [] });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('22023');
  });

  it('is not callable by an anonymous client', async () => {
    // The function lives in `public`, which PostgREST exposes, and Postgres
    // grants EXECUTE to PUBLIC by default. Without the revoke in the migration
    // this is an open write endpoint that skips every check above.
    const { anonClient } = await import('@/test/supabase-helpers');
    const { error } = await anonClient().rpc('submit_application', { p_rows: [] });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});
