import type { Answer, FileAnswer, MatrixAnswer, SkillsAnswer } from '@/lib/questions/types';

/**
 * Readers that turn a stored answer into the shape one field component expects.
 *
 * An answer arrives either from a field that just wrote it or from a draft in
 * `localStorage`, which is user-editable text and survives across deploys that
 * change a question's type. These never throw and never trust the input: a
 * value of the wrong shape reads as "unanswered" rather than crashing the form
 * on mount, which for a restored draft would be unrecoverable without clearing
 * site data.
 *
 * They are deliberately NOT validation. The schema in `@/lib/questions/schema`
 * decides whether an answer is acceptable; this only decides what to render.
 */

export function asText(value: Answer | undefined): string {
  return typeof value === 'string' ? value : '';
}

export function asStringList(value: Answer | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export function asNumber(value: Answer | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asMatrixAnswer(value: Answer | undefined): MatrixAnswer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const out: MatrixAnswer = {};
  for (const [row, selected] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(selected)) continue;
    out[row] = selected.filter((entry): entry is string => typeof entry === 'string');
  }
  return out;
}

/**
 * A restored draft or a stored answer, coerced into something renderable.
 *
 * Entries missing either half are dropped rather than half-filled: a level with
 * no flag, or a flag with no level, is a shape this form never produced.
 */
export function asSkillsAnswer(value: Answer | undefined): SkillsAnswer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const out: SkillsAnswer = {};
  for (const [skill, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { level, wantsToLearn } = entry as { level?: unknown; wantsToLearn?: unknown };
    if (typeof level !== 'number' || !Number.isInteger(level)) continue;
    if (typeof wantsToLearn !== 'boolean') continue;
    out[skill] = { level, wantsToLearn };
  }
  return out;
}

export function asFileAnswer(value: Answer | undefined): FileAnswer | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<FileAnswer>;
  if (typeof candidate.path !== 'string' || candidate.path === '') return null;
  if (typeof candidate.filename !== 'string') return null;
  if (typeof candidate.size !== 'number') return null;
  return { path: candidate.path, filename: candidate.filename, size: candidate.size };
}

/** True when nothing was entered — what the review step calls "not answered". */
export function isBlank(value: Answer | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(
      (entry) => Array.isArray(entry) && entry.length === 0,
    );
  }
  return false;
}

/** Words as the long_text schema counts them, so a live counter agrees with it. */
export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** Human-readable size for an uploaded file, in the units a student thinks in. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
