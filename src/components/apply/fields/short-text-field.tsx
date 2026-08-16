'use client';

import type { ShortTextQuestion } from '@/lib/questions/types';
import { asText } from '../answers';
import { QuestionShell, controlClasses, describedBy, inputId } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * One line of text.
 *
 * `maxLength` is shown as a count rather than enforced by the attribute: the
 * attribute silently swallows the end of a pasted answer, and the schema
 * already reports the same limit as a message the applicant can act on.
 */
export function ShortTextField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<ShortTextQuestion>) {
  const text = asText(value);
  const { maxLength, format } = question.config;
  const overLimit = maxLength !== undefined && text.length > maxLength;
  const countId = maxLength !== undefined ? `${fieldId}-count` : undefined;

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error}>
      <input
        id={inputId(fieldId)}
        type={format === 'email' ? 'email' : format === 'url' ? 'url' : 'text'}
        inputMode={format === 'url' ? 'url' : undefined}
        value={text}
        disabled={disabled}
        aria-required={question.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, question, error, countId)}
        onChange={(event) => onChange(event.target.value)}
        className={controlClasses}
      />
      {maxLength !== undefined ? (
        <p
          id={countId}
          className={
            overLimit ? 'mt-2 text-sm text-destructive' : 'mt-2 text-sm text-muted-foreground'
          }
        >
          {text.length} of {maxLength} characters
        </p>
      ) : null}
    </QuestionShell>
  );
}
