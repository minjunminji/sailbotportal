'use client';

import type { SelectQuestion } from '@/lib/questions/types';
import { asText } from '../answers';
import {
  describedBy,
  errorId,
  helpId,
  inputId,
  QuestionShell,
  controlClasses,
} from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * One choice from a fixed list.
 *
 * A native `<select>` rather than a styled listbox: it is keyboard-operable and
 * screen-reader-correct without a line of code, and on a phone it opens the
 * platform picker. A designer can restyle it; nobody has to rebuild it.
 *
 * `config.confirm` swaps this for a single checkbox — see `ConfirmField` below.
 */
export function SelectField(props: FieldProps<SelectQuestion>) {
  if (props.question.config.confirm) return <ConfirmField {...props} />;

  const { question, fieldId, value, onChange, error, disabled } = props;
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

/**
 * A statement to agree with, not a choice to make. The question's own label
 * IS the checkbox's label — a fieldset legend repeating the sentence above a
 * lone checkbox would say it twice for no reader's benefit — so this bypasses
 * `QuestionShell`'s label-above-control layout and builds the same
 * id/help/error scaffolding by hand.
 */
function ConfirmField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<SelectQuestion>) {
  const confirmed = question.config.options[0];
  const checked = asText(value) === confirmed;

  return (
    <div id={fieldId}>
      <div className="flex items-start gap-2">
        <input
          id={inputId(fieldId)}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          required={question.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, question, error)}
          onChange={(event) => onChange(event.target.checked ? confirmed : undefined)}
          className="mt-1 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
        />
        <label htmlFor={inputId(fieldId)} className="text-base font-medium">
          {question.label}
        </label>
      </div>
      {question.help ? (
        <p id={helpId(fieldId)} className="mt-2 text-sm text-muted-foreground">
          {question.help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId(fieldId)} className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
