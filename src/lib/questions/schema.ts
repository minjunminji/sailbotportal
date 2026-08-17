import { z } from 'zod';
import {
  assertNeverQuestion,
  type FileQuestion,
  type LongTextQuestion,
  type MatrixQuestion,
  type MultiSelectQuestion,
  type Question,
  type RankingQuestion,
  type ScaleQuestion,
  type SelectQuestion,
  type ShortTextQuestion,
} from './types';

/**
 * Derives a Zod schema from a question array, so the rules a lead authored in
 * `question_schema` are the rules the server enforces.
 *
 * These answers arrive from an anonymous browser through a server action that
 * holds the service role, which means RLS protects nothing at that point and
 * this schema is the only thing standing between a crafted payload and the
 * `answers` column. Two consequences shape everything below:
 *
 * - Unknown keys are STRIPPED. `z.object` does that by default; the point is
 *   that nothing here may weaken it to a passthrough, or a submission can
 *   write arbitrary JSON into a row.
 * - Values are checked against the *config*, never against what the client
 *   claims it rendered. A `select` answer outside `options` is a rejection.
 */

export type AnswerSchemaContext = {
  /** The applicant's subteam preference, most preferred first. Drives `visibleIf`. */
  rankedSubteams: string[];
};

/**
 * `visibleIf` means "the applicant ranked this subteam within their top N".
 * A question with no clause is always visible.
 */
export function isQuestionVisible(question: Question, rankedSubteams: string[]): boolean {
  const rule = question.visibleIf;
  if (!rule) return true;
  if (rule.topN <= 0) return false;
  return rankedSubteams.slice(0, rule.topN).includes(rule.subteam);
}

/**
 * Builds an object schema keyed by question id.
 *
 * A question is enforced as required only when it is both `required` and
 * visible — an applicant cannot answer a question the form never showed them.
 * A hidden question that was answered anyway still has its value validated,
 * because the value lands in the same column either way.
 */
export function buildAnswerSchema(
  questions: Question[],
  ctx: AnswerSchemaContext,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const question of questions) {
    const required = question.required && isQuestionVisible(question, ctx.rankedSubteams);
    shape[question.id] = fieldSchema(question, required);
  }

  return z.object(shape) as unknown as z.ZodType<Record<string, unknown>>;
}

function fieldSchema(question: Question, required: boolean): z.ZodTypeAny {
  switch (question.type) {
    case 'short_text':
      return textField(question, required);
    case 'long_text':
      return textField(question, required);
    case 'select':
      return selectField(question, required);
    case 'multi_select':
      return multiSelectField(question, required);
    case 'scale':
      return scaleField(question, required);
    case 'matrix':
      return matrixField(question, required);
    case 'ranking':
      return rankingField(question, required);
    case 'file':
      return fileField(question, required);
    default:
      return assertNeverQuestion(question);
  }
}

/** Applies `.optional()` last, so a missing key is fine for an optional question. */
function withPresence(schema: z.ZodTypeAny, required: boolean): z.ZodTypeAny {
  return required ? schema : schema.optional();
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** http(s) only. `javascript:`, `data:` and `file:` are the reason this exists. */
function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function isEmail(value: string): boolean {
  return z.email().safeParse(value.trim()).success;
}

/**
 * short_text and long_text. A blank answer is the required check and nothing
 * else — running `maxLength` or a format check over '' would report a second,
 * confusing issue for the same empty box.
 */
function textField(
  question: ShortTextQuestion | LongTextQuestion,
  required: boolean,
): z.ZodTypeAny {
  const schema = z.string().superRefine((value, ctx) => {
    if (value.trim() === '') {
      if (required) ctx.addIssue({ code: 'custom', message: 'This question is required' });
      return;
    }

    const { config } = question;

    if (config.maxLength !== undefined && value.length > config.maxLength) {
      ctx.addIssue({
        code: 'custom',
        message: `Keep this under ${config.maxLength} characters`,
      });
      return;
    }

    if (question.type === 'long_text') {
      const { minWords, maxWords } = question.config;
      const words = countWords(value);
      if (minWords !== undefined && words < minWords) {
        ctx.addIssue({ code: 'custom', message: `Write at least ${minWords} words` });
      }
      if (maxWords !== undefined && words > maxWords) {
        ctx.addIssue({ code: 'custom', message: `Keep this to ${maxWords} words` });
      }
      return;
    }

    if (question.config.format === 'url' && !isHttpUrl(value)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a link starting with http:// or https://' });
    }

    if (question.config.format === 'email' && !isEmail(value)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' });
    }
  });

  return withPresence(schema, required);
}

function selectField(question: SelectQuestion, required: boolean): z.ZodTypeAny {
  const options = new Set(question.config.options);

  const schema = z.string().superRefine((value, ctx) => {
    if (options.has(value)) return;

    // An empty string is the browser's "no choice made", not a bad choice.
    if (value.trim() === '') {
      if (required) ctx.addIssue({ code: 'custom', message: 'This question is required' });
      return;
    }

    ctx.addIssue({ code: 'custom', message: 'Choose one of the offered options' });
  });

  return withPresence(schema, required);
}

/**
 * An element schema that reports the offending index, so the form can highlight
 * one chip rather than the whole question.
 */
function optionElement(options: string[]): z.ZodTypeAny {
  if (options.length === 0) return z.never();
  return z.enum(options as [string, ...string[]]);
}

function multiSelectField(question: MultiSelectQuestion, required: boolean): z.ZodTypeAny {
  const { options, max } = question.config;

  const schema = z.array(optionElement(options)).superRefine((value, ctx) => {
    if (value.length === 0) {
      if (required) ctx.addIssue({ code: 'custom', message: 'Choose at least one option' });
      return;
    }
    if (new Set(value).size !== value.length) {
      ctx.addIssue({ code: 'custom', message: 'Each option may be chosen once' });
      return;
    }
    if (max !== undefined && value.length > max) {
      ctx.addIssue({ code: 'custom', message: `Choose at most ${max} options` });
    }
  });

  return withPresence(schema, required);
}

function scaleField(question: ScaleQuestion, required: boolean): z.ZodTypeAny {
  const { min, max } = question.config;

  const schema = z.number().superRefine((value, ctx) => {
    if (!Number.isInteger(value)) {
      ctx.addIssue({ code: 'custom', message: 'Choose one of the points on the scale' });
      return;
    }
    if (value < min || value > max) {
      ctx.addIssue({ code: 'custom', message: `Choose a value between ${min} and ${max}` });
    }
  });

  return withPresence(schema, required);
}

/**
 * `Record<row, selected columns>`. Rows may be absent or empty — the software
 * skills grid explicitly allows a row with neither box ticked — so `required`
 * means at least one selection somewhere, not one per row.
 */
function matrixField(question: MatrixQuestion, required: boolean): z.ZodTypeAny {
  const { rows, columns, mode } = question.config;
  const knownRows = new Set(rows);
  const knownColumns = new Set(columns);

  const schema = z.record(z.string(), z.array(z.string())).superRefine((value, ctx) => {
    let selections = 0;

    for (const [row, selected] of Object.entries(value)) {
      if (!knownRows.has(row)) {
        ctx.addIssue({
          code: 'custom',
          path: [row],
          message: 'This row is not part of the question',
        });
        continue;
      }

      let unknownColumn = false;
      selected.forEach((column, index) => {
        if (!knownColumns.has(column)) {
          unknownColumn = true;
          ctx.addIssue({
            code: 'custom',
            path: [row, index],
            message: 'This column is not part of the question',
          });
        }
      });
      if (unknownColumn) continue;

      if (new Set(selected).size !== selected.length) {
        ctx.addIssue({ code: 'custom', path: [row], message: 'Each column may be chosen once' });
        continue;
      }

      if (mode === 'single' && selected.length > 1) {
        ctx.addIssue({ code: 'custom', path: [row], message: 'Choose one column in this row' });
        continue;
      }

      selections += selected.length;
    }

    if (required && selections === 0) {
      ctx.addIssue({ code: 'custom', message: 'Make at least one selection' });
    }
  });

  return withPresence(schema, required);
}

function rankingField(question: RankingQuestion, required: boolean): z.ZodTypeAny {
  const { options, maxChoices } = question.config;

  const schema = z.array(optionElement(options)).superRefine((value, ctx) => {
    if (value.length === 0) {
      if (required) ctx.addIssue({ code: 'custom', message: 'Rank at least one option' });
      return;
    }
    if (new Set(value).size !== value.length) {
      ctx.addIssue({ code: 'custom', message: 'Each option may appear once' });
      return;
    }
    if (value.length > maxChoices) {
      ctx.addIssue({ code: 'custom', message: `Rank at most ${maxChoices} options` });
    }
  });

  return withPresence(schema, required);
}

/**
 * The answer to a `file` question is what the upload route returned, never the
 * bytes. `accept` is checked by extension; MIME entries are left to the upload
 * route, which reads the magic bytes and is the only place that can tell.
 */
function fileField(question: FileQuestion, required: boolean): z.ZodTypeAny {
  const { accept, maxBytes } = question.config;
  const extensions = accept
    .filter((entry) => entry.startsWith('.'))
    .map((entry) => entry.toLowerCase());

  const schema = z
    .object({
      path: z.string().min(1),
      filename: z.string().min(1),
      size: z.number().int().nonnegative(),
    })
    .superRefine((value, ctx) => {
      if (value.size > maxBytes) {
        ctx.addIssue({
          code: 'custom',
          path: ['size'],
          message: `Keep the file under ${maxBytes} bytes`,
        });
      }

      const filename = value.filename.toLowerCase();
      if (extensions.length > 0 && !extensions.some((ext) => filename.endsWith(ext))) {
        ctx.addIssue({
          code: 'custom',
          path: ['filename'],
          message: `Upload one of: ${accept.join(', ')}`,
        });
      }
    });

  return withPresence(schema, required);
}
