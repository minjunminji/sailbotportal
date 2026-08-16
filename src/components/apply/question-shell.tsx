import type { ReactNode } from 'react';
import type { Question } from '@/lib/questions/types';

/**
 * The wrapper every question shares: its label, its help text, and its error.
 *
 * Extracted because all eight field components need exactly this and getting it
 * wrong is invisible — an input whose label is a `<div>` is fine to look at and
 * unusable with a screen reader. The `id` on the outer element is also the
 * anchor the error summary links to, so it is the one place that decides how a
 * question is addressed.
 *
 * `group` chooses between the two correct markup patterns: one control takes a
 * real `<label for>`; several controls answering one question take a
 * `<fieldset>` with a `<legend>`, because a label may name only one input.
 */

export function inputId(fieldId: string): string {
  return `${fieldId}-input`;
}

export function helpId(fieldId: string): string {
  return `${fieldId}-help`;
}

export function errorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/** `aria-describedby` for a question's control, naming only the parts present. */
export function describedBy(
  fieldId: string,
  question: Question,
  error: string | undefined,
  extra?: string,
): string | undefined {
  const ids = [
    question.help ? helpId(fieldId) : null,
    error ? errorId(fieldId) : null,
    extra ?? null,
  ].filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function RequiredMark({ required }: { required: boolean }) {
  if (!required) return <span className="ml-2 text-sm text-muted-foreground">(optional)</span>;
  return (
    <>
      <span aria-hidden="true" className="ml-1 text-destructive">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

export function QuestionShell({
  question,
  fieldId,
  error,
  group = false,
  extraDescribedBy,
  children,
}: {
  question: Question;
  fieldId: string;
  error?: string;
  /** True when several controls answer one question. */
  group?: boolean;
  /**
   * Id of a further description — an option cap, the ends of a scale. Group
   * questions pass it here rather than putting `aria-describedby` on a wrapper
   * `div`, where it describes nothing: the attribute is only honoured on an
   * element with a role, and the `fieldset`'s group role is that element.
   */
  extraDescribedBy?: string;
  children: ReactNode;
}) {
  const label = (
    <>
      {question.label}
      <RequiredMark required={question.required} />
    </>
  );

  const help = question.help ? (
    <p id={helpId(fieldId)} className="mt-2 text-sm text-muted-foreground">
      {question.help}
    </p>
  ) : null;

  const errorMessage = error ? (
    <p id={errorId(fieldId)} className="mt-2 text-sm text-destructive">
      {error}
    </p>
  ) : null;

  if (group) {
    return (
      <fieldset
        id={fieldId}
        className="border-0 p-0"
        aria-describedby={describedBy(fieldId, question, error, extraDescribedBy)}
        aria-invalid={error ? true : undefined}
      >
        <legend className="text-base font-medium">{label}</legend>
        {help}
        <div className="mt-3">{children}</div>
        {errorMessage}
      </fieldset>
    );
  }

  return (
    <div id={fieldId}>
      <label htmlFor={inputId(fieldId)} className="block text-base font-medium">
        {label}
      </label>
      {help}
      <div className="mt-3">{children}</div>
      {errorMessage}
    </div>
  );
}

/** Shared input chrome. Colours resolve through tokens, never a literal. */
export const controlClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-base ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ' +
  'disabled:opacity-50';

/** A small secondary action: move up, remove, clear a row. */
export const smallButtonClasses =
  'rounded-md border border-border px-3 py-2 text-sm font-medium ' +
  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ' +
  'disabled:opacity-50';
