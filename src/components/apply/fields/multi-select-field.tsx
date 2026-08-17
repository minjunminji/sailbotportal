'use client';

import type { MultiSelectQuestion } from '@/lib/questions/types';
import { asStringList } from '../answers';
import { QuestionShell } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * Any number of choices, capped by `max`.
 *
 * At the cap the unchosen boxes are disabled rather than silently ignoring a
 * click, and the remaining count is stated — a checkbox that does nothing when
 * clicked reads as a broken form.
 */
export function MultiSelectField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<MultiSelectQuestion>) {
  const selected = asStringList(value);
  const { options, max } = question.config;
  const atCap = max !== undefined && selected.length >= max;
  const capId = max !== undefined ? `${fieldId}-cap` : undefined;

  function toggle(option: string, checked: boolean) {
    if (!checked) {
      onChange(selected.filter((entry) => entry !== option));
      return;
    }
    if (selected.includes(option)) return;
    onChange([...selected, option]);
  }

  return (
    <QuestionShell
      question={question}
      fieldId={fieldId}
      error={error}
      group
      extraDescribedBy={capId}
    >
      {max !== undefined ? (
        <p id={capId} className="mb-3 text-sm text-muted-foreground">
          Choose up to {max}. {selected.length} chosen.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {options.map((option, index) => {
          const optionId = `${fieldId}-option-${index}`;
          const checked = selected.includes(option);
          return (
            <div key={option} className="flex items-start gap-2">
              <input
                id={optionId}
                type="checkbox"
                checked={checked}
                disabled={disabled || (atCap && !checked)}
                onChange={(event) => toggle(option, event.target.checked)}
                className="mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
              />
              <label htmlFor={optionId} className="text-base">
                {option}
              </label>
            </div>
          );
        })}
      </div>
    </QuestionShell>
  );
}
