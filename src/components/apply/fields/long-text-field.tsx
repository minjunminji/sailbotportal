'use client';

import type { LongTextQuestion } from '@/lib/questions/types';
import { asText, countWords } from '../answers';
import { QuestionShell, controlClasses, describedBy, inputId } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * An essay answer. Most of this form is these.
 *
 * The counter reports whichever limit the question actually carries, using the
 * same word count the schema uses, so "write at least 50 words" and the number
 * on screen never disagree.
 */
export function LongTextField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<LongTextQuestion>) {
  const text = asText(value);
  const { maxLength, minWords, maxWords } = question.config;
  const words = countWords(text);

  const parts: string[] = [];
  if (minWords !== undefined) parts.push(`${words} of at least ${minWords} words`);
  if (maxWords !== undefined) parts.push(`${words} of ${maxWords} words`);
  // Only when no word limit is stated. Where a question is expressed in words,
  // a character count beside it is a second limit to track and the one nobody
  // was asked to respect.
  if (maxLength !== undefined && minWords === undefined && maxWords === undefined) {
    parts.push(`${text.length} of ${maxLength} characters`);
  }

  const short = minWords !== undefined && text !== '' && words < minWords;
  const long =
    (maxLength !== undefined && text.length > maxLength) ||
    (maxWords !== undefined && words > maxWords);
  const countId = parts.length > 0 ? `${fieldId}-count` : undefined;

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error}>
      <textarea
        id={inputId(fieldId)}
        rows={6}
        value={text}
        disabled={disabled}
        aria-required={question.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, question, error, countId)}
        onChange={(event) => onChange(event.target.value)}
        className={controlClasses}
      />
      {countId ? (
        <p
          id={countId}
          // Announced politely: a live count read on every keystroke is worse
          // than no count at all for a screen reader user.
          aria-live="off"
          className={
            short || long ? 'mt-2 text-sm text-destructive' : 'mt-2 text-sm text-muted-foreground'
          }
        >
          {parts.join(' · ')}
        </p>
      ) : null}
    </QuestionShell>
  );
}
