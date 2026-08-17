/**
 * The question type system.
 *
 * Questions are data, not code: a posting's questions live as JSON in
 * `postings.question_schema` and org-wide ones in `core_questions.definition`.
 * These types are the contract that JSON is written against, that the Zod
 * derivation in `./schema` reads, and that the frozen
 * `applications.question_schema_snapshot` conforms to.
 *
 * The set of types is deliberately CLOSED. Adding a member here means teaching
 * the schema builder, the renderer, and the export about it, so the union is
 * the one place that decides what a lead may author.
 */

/** Every question type, in a stable order. Also the runtime source of truth. */
export const QUESTION_TYPES = [
  'short_text',
  'long_text',
  'select',
  'multi_select',
  'scale',
  'matrix',
  'ranking',
  'file',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Conditional visibility. The question renders only when `subteam` appears
 * within the first `topN` entries of the applicant's ranked subteams — so
 * `{ subteam: 'pathfinding', topN: 2 }` shows for someone who put pathfinding
 * first or second, and hides for someone who put it third.
 */
export type VisibleIf = {
  subteam: string;
  topN: number;
};

/** Fields every question carries regardless of type. */
type QuestionBase = {
  id: string;
  label: string;
  help?: string;
  required: boolean;
  visibleIf?: VisibleIf;
  /**
   * Present only on core questions. Exports key core answers by this so the
   * columns line up across teams even after the wording is revised.
   */
  stableKey?: string;
};

// --- Per-type config shapes -------------------------------------------------

export type ShortTextConfig = {
  maxLength?: number;
  /** `url` accepts http(s) only; anything else — `javascript:` above all — is rejected. */
  format?: 'url' | 'email';
};

export type LongTextConfig = {
  maxLength?: number;
  /** A floor on words, not characters. */
  minWords?: number;
  /**
   * A ceiling on words. Prefer this to `maxLength` where the instruction is
   * about length as a person experiences it — "one sentence" is a handful of
   * words, and nobody can picture 300 characters.
   */
  maxWords?: number;
};

export type SelectConfig = {
  options: string[];
};

export type MultiSelectConfig = {
  options: string[];
  /** Cap on how many options may be chosen. Unbounded when omitted. */
  max?: number;
};

export type ScaleConfig = {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
};

export type MatrixConfig = {
  rows: string[];
  columns: string[];
  /**
   * `single` allows at most one column per row; `multi` allows any combination,
   * which is what the software skills grid needs ("I have this skill" and
   * "I want to learn or improve this skill" are not mutually exclusive).
   */
  mode: 'single' | 'multi';
};

export type RankingConfig = {
  options: string[];
  /**
   * How many of the options may be ranked.
   *
   * Note this is NOT subteam preference — that lives in
   * `postings.subteam_ranking` and writes to `applications.ranked_subteams`,
   * because the board filters and the waitlist workflow query that column.
   * A `ranking` question orders arbitrary strings.
   */
  maxChoices: number;
};

export type FileConfig = {
  /** Accepted extensions or MIME types, e.g. `['.zip']`. */
  accept: string[];
  maxBytes: number;
};

// --- The discriminated union ------------------------------------------------

export type ShortTextQuestion = QuestionBase & { type: 'short_text'; config: ShortTextConfig };
export type LongTextQuestion = QuestionBase & { type: 'long_text'; config: LongTextConfig };
export type SelectQuestion = QuestionBase & { type: 'select'; config: SelectConfig };
export type MultiSelectQuestion = QuestionBase & {
  type: 'multi_select';
  config: MultiSelectConfig;
};
export type ScaleQuestion = QuestionBase & { type: 'scale'; config: ScaleConfig };
export type MatrixQuestion = QuestionBase & { type: 'matrix'; config: MatrixConfig };
export type RankingQuestion = QuestionBase & { type: 'ranking'; config: RankingConfig };
export type FileQuestion = QuestionBase & { type: 'file'; config: FileConfig };

/** Discriminated on `type`, so narrowing a question narrows its `config` too. */
export type Question =
  | ShortTextQuestion
  | LongTextQuestion
  | SelectQuestion
  | MultiSelectQuestion
  | ScaleQuestion
  | MatrixQuestion
  | RankingQuestion
  | FileQuestion;

/** The question variant for a given type name. */
export type QuestionOfType<T extends QuestionType> = Extract<Question, { type: T }>;

/** The config shape for a given type name. */
export type ConfigOfType<T extends QuestionType> = QuestionOfType<T>['config'];

// --- Answer shapes ----------------------------------------------------------

/** What an upload leaves behind. The client never sees a URL, only this path. */
export type FileAnswer = {
  path: string;
  filename: string;
  size: number;
};

/**
 * Row label -> selected column labels. `mode: 'single'` still uses an array,
 * holding at most one entry, so rendering and export treat both modes alike.
 */
export type MatrixAnswer = Record<string, string[]>;

/** The answer each question type produces. */
export type AnswerByType = {
  short_text: string;
  long_text: string;
  select: string;
  multi_select: string[];
  scale: number;
  matrix: MatrixAnswer;
  ranking: string[];
  file: FileAnswer;
};

export type AnswerOfType<T extends QuestionType> = AnswerByType[T];

/** The answer for a particular question, narrowed through its `type`. */
export type AnswerFor<Q extends Question> = AnswerByType[Q['type']];

export type Answer = AnswerByType[QuestionType];

/** Answers as stored in `applications.answers`: keyed by question id. */
export type AnswerMap = Record<string, Answer | undefined>;

// --- Type guards ------------------------------------------------------------

/** True when `value` names one of the eight known types. */
export function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value);
}

/** Generic guard, for call sites that hold the type name in a variable. */
export function isQuestionOfType<T extends QuestionType>(
  question: Question,
  type: T,
): question is QuestionOfType<T> {
  return question.type === type;
}

export function isShortText(question: Question): question is ShortTextQuestion {
  return question.type === 'short_text';
}

export function isLongText(question: Question): question is LongTextQuestion {
  return question.type === 'long_text';
}

export function isSelect(question: Question): question is SelectQuestion {
  return question.type === 'select';
}

export function isMultiSelect(question: Question): question is MultiSelectQuestion {
  return question.type === 'multi_select';
}

export function isScale(question: Question): question is ScaleQuestion {
  return question.type === 'scale';
}

export function isMatrix(question: Question): question is MatrixQuestion {
  return question.type === 'matrix';
}

export function isRanking(question: Question): question is RankingQuestion {
  return question.type === 'ranking';
}

export function isFile(question: Question): question is FileQuestion {
  return question.type === 'file';
}

/**
 * Exhaustiveness guard. A `switch` over `question.type` that calls this in its
 * default branch stops compiling the moment a ninth type joins the union.
 */
export function assertNeverQuestion(question: never): never {
  throw new Error(
    `Unhandled question type: ${JSON.stringify((question as { type?: unknown }).type)}`,
  );
}
