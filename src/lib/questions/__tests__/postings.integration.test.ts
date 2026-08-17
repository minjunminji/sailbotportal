/**
 * @jest-environment node
 */
import { POSTING_STATUS_VALUES } from '@/lib/postings/statuses';
import { adminClient } from '@/test/supabase-helpers';
import { resolveQuestions } from '../snapshot';
import { validateQuestion, validateQuestions } from '../validate';
import { isFile, isShortText, isSkills, type Question } from '../types';

/**
 * The seeded 2025 question sets, checked against the database they were written
 * into.
 *
 * The team_postings migration is several hundred lines of hand-transcribed
 * JSON. Nothing in the write path would notice `maxChoises`, a `matrix` that
 * lost a row to a stray comma, or a `select` whose options ended up nested one
 * level too deep — `question_schema` is `jsonb`, so Postgres accepts any valid
 * JSON, and `resolveQuestions` only checks ids and types. This suite is the
 * check that the eyeball pass is not.
 *
 * Read-only, so there are no fixtures to namespace or clean up. It reads the
 * REAL reference rows deliberately: a version of this that seeded its own
 * copies would prove the copies were fine and say nothing about the migration.
 */

const admin = adminClient();

const REAL_POSTING_SLUGS = ['mech-2026', 'elec-2026', 'soft-2026'] as const;
type RealSlug = (typeof REAL_POSTING_SLUGS)[number];

type PostingRow = {
  slug: string;
  title: string;
  status: string;
  description: string;
  position: number;
  question_schema: unknown;
  subteam_ranking: unknown;
  teams: { slug: string } | null;
};

const postings = new Map<string, PostingRow>();

beforeAll(async () => {
  const { data, error } = await admin
    .from('postings')
    .select(
      'slug, title, status, description, position, question_schema, subteam_ranking, teams(slug)',
    )
    .in('slug', REAL_POSTING_SLUGS as unknown as string[]);
  if (error) throw error;

  for (const row of (data ?? []) as unknown as PostingRow[]) {
    postings.set(row.slug, row);
  }
});

function posting(slug: RealSlug): PostingRow {
  const row = postings.get(slug);
  if (!row) {
    throw new Error(
      `Posting '${slug}' is missing. The team_postings migration has not been applied to this database — run \`supabase db reset\`.`,
    );
  }
  return row;
}

function questionsOf(slug: RealSlug): Question[] {
  return validateQuestions(posting(slug).question_schema);
}

describe('the three real postings exist', () => {
  it.each(REAL_POSTING_SLUGS)('%s is present', (slug) => {
    expect(posting(slug).slug).toBe(slug);
  });

  it('each belongs to its own team, in position order', () => {
    expect(REAL_POSTING_SLUGS.map((slug) => posting(slug).teams?.slug)).toEqual([
      'mech',
      'elec',
      'soft',
    ]);
    expect(REAL_POSTING_SLUGS.map((slug) => posting(slug).position)).toEqual([0, 1, 2]);
  });

  it('each carries a status the app recognises', () => {
    // This used to assert all three were `draft`, which was a fact about the
    // migration for as long as nothing could change it. The postings screen can
    // now open and close them, so the current value is runtime state a lead
    // owns — and asserting it here made an unrelated suite about transcribed
    // JSON fail the moment anyone opened a posting locally.
    //
    // What is still worth checking is that the migration wrote a status the
    // application can act on: a typo like 'opened' would sit in the column
    // unnoticed, since it is plain text with a check constraint that a later
    // migration could relax.
    for (const slug of REAL_POSTING_SLUGS) {
      expect(POSTING_STATUS_VALUES).toContain(posting(slug).status);
    }
  });

  it('each opens with a paragraph about its own team, not about the project', () => {
    for (const slug of REAL_POSTING_SLUGS) {
      expect(posting(slug).description.length).toBeGreaterThan(100);
    }

    // The first paragraph is the card face in the team selector, and all three
    // used to open with the same account of the project rewritten. What each
    // one says first has to be the thing that tells it apart from the others.
    const opening = (slug: RealSlug) => posting(slug).description.split('\n\n')[0];
    expect(opening('mech-2026')).toContain('mechanical team');
    expect(opening('elec-2026')).toContain('electrical team');
    expect(opening('soft-2026')).toContain('software team');

    // The project is still described, once, further down Mechanical's.
    expect(posting('mech-2026').description).toContain('POLARIS');
  });
});

describe('every seeded question is well-formed', () => {
  it.each(REAL_POSTING_SLUGS)('%s: every question passes validateQuestion', (slug) => {
    const schema = posting(slug).question_schema;
    expect(Array.isArray(schema)).toBe(true);

    // Individually as well as via the set, so a failure names one question.
    for (const question of schema as unknown[]) {
      expect(() => validateQuestion(question)).not.toThrow();
    }

    // And as a set, which is the only thing that checks id uniqueness.
    expect(() => validateQuestions(schema)).not.toThrow();
  });

  it.each(REAL_POSTING_SLUGS)('%s: question ids are unique within the posting', (slug) => {
    const ids = questionsOf(slug).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(REAL_POSTING_SLUGS)(
    '%s: resolves against the core questions without an id collision',
    async (slug) => {
      const { data: core, error } = await admin
        .from('core_questions')
        .select('stable_key, position, definition')
        .order('position');
      if (error) throw error;
      expect(core!.length).toBeGreaterThan(0);

      // Catches a posting question shadowing a core question's stable key,
      // which would silently drop the core answer from that team's export.
      const resolved = resolveQuestions(core!, posting(slug));
      expect(() => validateQuestions(resolved)).not.toThrow();
      expect(resolved.length).toBe(core!.length + questionsOf(slug).length);
    },
  );
});

describe('subteam ranking is on for software only', () => {
  it('software asks for exactly two subteams', () => {
    // Floor and ceiling both 2. The floor is what makes the rail's count of the
    // ranking true; before it existed, an application could be sent having
    // ranked nothing while the rail insisted it was one item short.
    expect(posting('soft-2026').subteam_ranking).toEqual({
      enabled: true,
      minChoices: 2,
      maxChoices: 2,
    });
  });

  it.each(['mech-2026', 'elec-2026'] as const)('%s does not rank subteams', (slug) => {
    expect(posting(slug).subteam_ranking).toMatchObject({ enabled: false });
  });
});

describe('mechanical', () => {
  it('asks eleven required long_text questions', () => {
    const questions = questionsOf('mech-2026');
    expect(questions).toHaveLength(11);
    expect(questions.every((q) => q.type === 'long_text')).toBe(true);
    expect(questions.every((q) => q.required)).toBe(true);
  });

  it('carries the quiz preamble as help on every question', () => {
    for (const question of questionsOf('mech-2026')) {
      expect(question.help).toContain('2-5 sentences should be sufficient');
      expect(question.help).toContain('please include your sources');
    }
  });

  it('keeps the 2025 wording verbatim', () => {
    const byId = new Map(questionsOf('mech-2026').map((q) => [q.id, q.label]));
    expect(byId.get('ballast')).toBe('What is ballast and what is its function on a boat?');
    expect(byId.get('tack_vs_gybe')).toBe(
      'What is the difference between a tack and a gybe in the context of sailing?',
    );
    expect(byId.get('autonomous_challenges')).toBe(
      'Can you list 2-3 challenges of autonomous sailing operation (versus a crewed sailboat)?',
    );
  });

  it('has no file or ranking questions', () => {
    const types = new Set(questionsOf('mech-2026').map((q) => q.type));
    expect(types).toEqual(new Set(['long_text']));
  });
});

describe('electrical', () => {
  it('opens with the Saturday availability confirmation', () => {
    const [first] = questionsOf('elec-2026');
    expect(first.id).toBe('saturday_availability');
    expect(first.type).toBe('select');
    expect(first.required).toBe(true);
    expect(first.label).toBe('I confirm that I am available to meet in-person every Saturday.');
    if (first.type !== 'select') throw new Error('expected a select');
    expect(first.config.options).toEqual(['Yes', 'No']);
  });

  it('asks for the project the applicant is proudest of, with the three-part prompt', () => {
    const question = questionsOf('elec-2026').find((q) => q.id === 'proud_project');
    expect(question).toBeDefined();
    expect(question!.type).toBe('long_text');
    expect(question!.required).toBe(true);
    expect(question!.label).toBe("Describe a project you've worked on that you're most proud of.");
    expect(question!.help).toContain('first year engineering student');
  });

  it('asks all eight 2025 questions in order', () => {
    expect(questionsOf('elec-2026').map((q) => q.id)).toEqual([
      'saturday_availability',
      'proud_project',
      'multimeter_current',
      'batteries_series_parallel',
      'two_sensors_one_mcu',
      'i2c_compass_zeros',
      'reducing_noise',
      'harsh_environment_reliability',
    ]);
  });

  /**
   * Wording is the thing that rots silently. Leads recognise their own
   * questions, so a paraphrase reads as a bug rather than a nicety — these spot
   * checks pin the phrases most likely to be "tidied up" by a future editor.
   * docs/2025-application-form.md is the source of truth.
   */
  it('preserves the exact 2025 wording', () => {
    const byId = new Map(questionsOf('elec-2026').map((q) => [q.id, q]));

    expect(byId.get('multimeter_current')!.label).toContain(
      'probe between the positive and negative terminal',
    );
    expect(byId.get('i2c_compass_zeros')!.label).toContain('always receiving 0s');
    expect(byId.get('harsh_environment_reliability')!.label).toContain('harsh remote environment');
  });

  it('makes every technical question required', () => {
    const technical = questionsOf('elec-2026').filter(
      (q) => q.id !== 'saturday_availability' && q.id !== 'proud_project',
    );
    expect(technical).toHaveLength(6);
    expect(technical.every((q) => q.required)).toBe(true);
  });
});

describe('software', () => {
  it('asks the 2025 questions in order, behind the first-choice reason', () => {
    // `first_choice_reason` is not from the 2025 form. It sits first so it
    // renders directly beneath the subteam ranking it refers to.
    expect(questionsOf('soft-2026').map((q) => q.id)).toEqual([
      'first_choice_reason',
      'saturday_availability',
      'technical_skills',
      'software_project',
      'github_url',
      'quiz_zip',
      'quiz_language',
      'anything_else',
    ]);
  });

  it('rates fifteen skills on a five-point scale', () => {
    const question = questionsOf('soft-2026').find((q) => q.id === 'technical_skills');
    expect(question).toBeDefined();
    expect(isSkills(question!)).toBe(true);
    if (!isSkills(question!)) throw new Error('expected a skills question');

    expect(question.config.skills).toHaveLength(15);
    expect(question.config.maxLevel).toBe(5);
    // The bottom of the scale is the slider's resting position, so it has to
    // say "nothing here" rather than read as a claim of level 1.
    expect(question.config.minLabel).toBe('No experience');
    // The two ends of the list, so a truncated or reordered transcription shows.
    expect(question.config.skills[0]).toBe('Python');
    expect(question.config.skills[14]).toBe('Sailing');
    expect(question.required).toBe(false);
  });

  it('requires a project answer of at least fifty words', () => {
    const question = questionsOf('soft-2026').find((q) => q.id === 'software_project');
    expect(question!.required).toBe(true);
    expect(question!.type).toBe('long_text');
    if (question!.type !== 'long_text') throw new Error('expected a long_text');
    expect(question!.config.minWords).toBe(50);
    expect(question!.config.maxLength).toBeGreaterThan(1000);
  });

  it('offers the GitHub URL and the ZIP upload as two optional routes', () => {
    const questions = questionsOf('soft-2026');

    const url = questions.find((q) => q.id === 'github_url')!;
    expect(isShortText(url)).toBe(true);
    if (!isShortText(url)) throw new Error('expected a short_text');
    expect(url.config.format).toBe('url');
    expect(url.required).toBe(false);

    const zip = questions.find((q) => q.id === 'quiz_zip')!;
    expect(isFile(zip)).toBe(true);
    if (!isFile(zip)) throw new Error('expected a file question');
    expect(zip.config.accept).toEqual(['.zip']);
    expect(zip.config.maxBytes).toBeGreaterThan(0);
    expect(zip.required).toBe(false);

    // Neither is required on its own; the language question is what records
    // which route the applicant actually took.
    const language = questions.find((q) => q.id === 'quiz_language')!;
    expect(language.required).toBe(true);
    if (language.type !== 'select') throw new Error('expected a select');
    expect(language.config.options).toEqual([
      'Python',
      'C++',
      'I opted to answer the projects question',
    ]);
  });

  it('ends with an optional free-form question', () => {
    const question = questionsOf('soft-2026').find((q) => q.id === 'anything_else')!;
    expect(question.required).toBe(false);
    expect(question.label).toBe('Is there anything else we should know about your application?');
  });
});
