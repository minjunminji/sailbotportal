'use client';

import type { SelectQuestion } from '@/lib/questions/types';
import { asText } from '../answers';
import { QuestionShell, controlClasses, describedBy, inputId } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * One choice from a fixed list.
 *
 * A native `<select>` rather than a styled listbox: it is keyboard-operable and
 * screen-reader-correct without a line of code, and on a phone it opens the
 * platform picker. A designer can restyle it; nobody has to rebuild it.
 */
export function SelectField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<SelectQuestion>) {
  const selected = asText(value);

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error}>
      <select
        id={inputId(fieldId)}
        value={selected}
        disabled={disabled}
        aria-required={question.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, question, error)}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
        className={controlClasses}
      >
        <option value="">Choose an option</option>
        {question.config.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </QuestionShell>
  );
}
