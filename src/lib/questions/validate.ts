import { z } from 'zod';
import { QUESTION_TYPES, type Question } from './types';

/**
 * Runtime validation of question *definitions* — the authoring side, not the
 * answering side.
 *
 * `resolveQuestions` deliberately checks only what a snapshot cannot do
 * without: an id and one of the nine known types. That is the right bar for
 * the hot path, but it leaves every `config` unchecked, and a config is where a
 * hand-written question goes wrong: `maxChoices` larger than the option list, a
 * `scale` whose `min` exceeds its `max`, a `matrix` with no rows. None of those
 * throw. They render a broken form, and `buildAnswerSchema` derives a validator
 * that either accepts everything or rejects everything.
 *
 * Question definitions are hand-transcribed into SQL migrations and — until the
 * posting builder exists — edited by leads in Supabase Studio, so this runs
 * over the seeded postings in a test rather than trusting a careful read.
 *
 * The object schemas are STRICT. An unknown key is a typo — `halp` for `help`,
 * `option` for `options` — and stripping it silently is exactly the failure
 * this module exists to catch.
 */

const questionId = z
  .string()
  .min(1, 'id must not be empty')
  // The id becomes an answer key, an export column header, and a form field
  // name that ends up in URLs and `aria-describedby` references.
  .regex(/^[A-Za-z0-9_-]+$/, 'id must be URL-safe: letters, digits, hyphen, underscore');

const nonEmptyLabel = z.string().trim().min(1, 'label must not be empty');

/** Options, rows, and columns are all "a non-empty list of distinct labels". */
function labelList(what: string) {
  return z
    .array(z.string().trim().min(1, `${what} must not contain an empty entry`))
    .min(1, `${what} must not be empty`)
    .refine((values) => new Set(values).size === values.length, {
      message: `${what} must not contain duplicates`,
    });
}

const positiveInt = z.number().int().positive();

const visibleIf = z.strictObject({
  subteam: z.string().min(1, 'visibleIf.subteam must not be empty'),
  topN: positiveInt,
});

const base = {
  id: questionId,
  label: nonEmptyLabel,
  help: z.string().min(1).optional(),
  required: z.boolean(),
  visibleIf: visibleIf.optional(),
  stableKey: z.string().min(1).optional(),
};

const shortText = z.strictObject({
  ...base,
  type: z.literal('short_text'),
  config: z.strictObject({
    maxLength: positiveInt.optional(),
    format: z.enum(['url', 'email']).optional(),
  }),
});

const longText = z.strictObject({
  ...base,
  type: z.literal('long_text'),
  config: z
    .strictObject({
      maxLength: positiveInt.optional(),
      minWords: positiveInt.optional(),
      maxWords: positiveInt.optional(),
    })
    // A floor above the ceiling is a question nobody can answer.
    .refine(
      (config) =>
        config.minWords === undefined ||
        config.maxWords === undefined ||
        config.minWords <= config.maxWords,
      { message: 'minWords must not exceed maxWords', path: ['maxWords'] },
    ),
});

const select = z.strictObject({
  ...base,
  type: z.literal('select'),
  config: z.strictObject({ options: labelList('options') }),
});

const multiSelect = z.strictObject({
  ...base,
  type: z.literal('multi_select'),
  config: z
    .strictObject({ options: labelList('options'), max: positiveInt.optional() })
    // A cap above the option count is unreachable, which usually means the
    // option list was trimmed and the cap was not.
    .refine((config) => config.max === undefined || config.max <= config.options.length, {
      message: 'max must not exceed the number of options',
      path: ['max'],
    }),
});

const scale = z.strictObject({
  ...base,
  type: z.literal('scale'),
  config: z
    .strictObject({
      min: z.number().int(),
      max: z.number().int(),
      minLabel: z.string().min(1).optional(),
      maxLabel: z.string().min(1).optional(),
    })
    .refine((config) => config.min < config.max, {
      message: 'min must be less than max',
      path: ['min'],
    }),
});

const matrix = z.strictObject({
  ...base,
  type: z.literal('matrix'),
  config: z.strictObject({
    rows: labelList('rows'),
    columns: labelList('columns'),
    mode: z.enum(['single', 'multi']),
  }),
});

const skills = z.strictObject({
  ...base,
  type: z.literal('skills'),
  config: z.strictObject({
    skills: labelList('skills'),
    // The bottom of the scale is fixed at 1, so a top of 1 would be a scale
    // with one point — a control that cannot express anything.
    maxLevel: z.number().int().min(2),
    minLabel: z.string().min(1),
    maxLabel: z.string().min(1),
  }),
});

const ranking = z.strictObject({
  ...base,
  type: z.literal('ranking'),
  config: z
    .strictObject({ options: labelList('options'), maxChoices: positiveInt })
    .refine((config) => config.maxChoices <= config.options.length, {
      message: 'maxChoices must not exceed the number of options',
      path: ['maxChoices'],
    }),
});

const file = z.strictObject({
  ...base,
  type: z.literal('file'),
  config: z.strictObject({
    // Entries are extensions (`.zip`) or MIME types. The upload route reads
    // magic bytes and is the only place that can truly tell them apart.
    accept: labelList('accept'),
    maxBytes: positiveInt,
  }),
});

const questionSchema = z.discriminatedUnion('type', [
  shortText,
  longText,
  select,
  multiSelect,
  scale,
  matrix,
  skills,
  ranking,
  file,
]);

/**
 * Names the offending question in an error without trusting its contents: an
 * id that is not a string, or is absurdly long, still has to print safely.
 */
function describe(value: unknown): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim() !== '') {
      return `question '${id.slice(0, 60)}'`;
    }
  }
  return 'question (no usable id)';
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Parses one question definition, checking its config against its type.
 *
 * Throws rather than returning a result: every caller — migrations verified by
 * test, the posting builder when it lands — wants the whole operation to stop,
 * and a thrown error carries the reason into the test output for free.
 */
export function validateQuestion(value: unknown): Question {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid question: expected an object');
  }

  // Checked before the union so an unknown type reports itself, rather than
  // producing nine parallel "expected literal" failures.
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string' || !(QUESTION_TYPES as readonly string[]).includes(type)) {
    throw new Error(
      `Invalid ${describe(value)}: unknown question type ${JSON.stringify(type)}; ` +
        `expected one of ${QUESTION_TYPES.join(', ')}`,
    );
  }

  const result = questionSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${describe(value)}: ${formatIssues(result.error)}`);
  }

  return result.data as Question;
}

/**
 * Parses a whole question set and enforces that ids are unique across it.
 *
 * Uniqueness is a property of the set, not of any one question, so it cannot
 * live in `validateQuestion`. A duplicate id silently drops a question from the
 * rendered form and overwrites its answer — `resolveQuestions` refuses the same
 * thing for the same reason.
 */
export function validateQuestions(value: unknown): Question[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid question set: expected an array of questions');
  }

  const questions = value.map((entry) => validateQuestion(entry));

  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) {
      throw new Error(`Invalid question set: duplicate question id '${question.id}'`);
    }
    seen.add(question.id);
  }

  return questions;
}
