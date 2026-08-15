import { isQuestionType, type Question } from './types';

/**
 * Resolves the questions an application is answered against, and produces the
 * array that gets frozen onto the row in `question_schema_snapshot`.
 *
 * The snapshot is the single most important invariant in this codebase. A lead
 * rewording a posting in October must not change how an application submitted
 * in September renders or exports, so the resolved array shares nothing with
 * the posting it came from — no element references, no nested config objects.
 * Detail views and exports read the snapshot, never the live posting.
 */

/** A row from `core_questions`. `definition` is `Json` as far as Postgres knows. */
export type CoreQuestionRow = {
  stable_key: string;
  position: number;
  definition: unknown;
};

/** Just the part of a posting this needs; `question_schema` arrives as `Json`. */
export type PostingQuestions = {
  question_schema?: unknown;
};

/**
 * Core questions ordered by `position` first, then the posting's own questions
 * in the order the lead authored them.
 *
 * Core questions are referenced rather than copied into each posting, so their
 * identity is their `stable_key`: that becomes the answer key and the export
 * column, and it stays put even when the wording is later revised.
 *
 * Throws if any id repeats. Shadowing would drop a question from the snapshot
 * silently — and if the shadowed one were a core question, the export column
 * keyed by its stable key would quietly go empty for that team.
 */
export function resolveQuestions(
  coreQuestions: CoreQuestionRow[],
  posting: PostingQuestions,
): Question[] {
  // `sort` is stable in modern V8, but the tie-break is spelled out rather than
  // assumed: two core questions sharing a position keep their query order.
  const core = coreQuestions
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.position - b.row.position || a.index - b.index)
    .map(({ row }) =>
      toQuestion(
        { ...asObject(row.definition, `core question '${row.stable_key}'`) },
        `core question '${row.stable_key}'`,
        { id: row.stable_key, stableKey: row.stable_key },
      ),
    );

  const own = toQuestionArray(posting.question_schema).map((question, index) =>
    toQuestion(question, `posting question at index ${index}`),
  );

  const resolved = [...core, ...own];
  assertUniqueIds(resolved);

  // One clone at the end covers both halves. JSON round-tripping is not a
  // shortcut here: the array is about to be stored as jsonb, so anything that
  // would not survive this would not survive the column either.
  return JSON.parse(JSON.stringify(resolved)) as Question[];
}

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not a question object`);
  }
  return value as Record<string, unknown>;
}

function toQuestionArray(schema: unknown): unknown[] {
  // A posting with no questions of its own is normal — the core set stands alone.
  if (schema === null || schema === undefined) return [];
  if (!Array.isArray(schema)) {
    throw new Error('question_schema is not an array of questions');
  }
  return schema;
}

/**
 * Checks only what the snapshot cannot do without: a usable id and one of the
 * eight known types. Configs are the schema builder's business.
 */
function toQuestion(
  value: unknown,
  where: string,
  overrides: { id: string; stableKey: string } | undefined = undefined,
): Question {
  const question: Record<string, unknown> = { ...asObject(value, where), ...overrides };

  if (typeof question.id !== 'string' || question.id.trim() === '') {
    throw new Error(`${where} has no id`);
  }
  if (!isQuestionType(question.type)) {
    throw new Error(`${where} has an unknown question type: ${JSON.stringify(question.type)}`);
  }

  return question as unknown as Question;
}

function assertUniqueIds(questions: Question[]): void {
  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) {
      throw new Error(
        `Duplicate question id '${question.id}': a posting question cannot reuse an id, ` +
          'and cannot shadow a core question',
      );
    }
    seen.add(question.id);
  }
}
