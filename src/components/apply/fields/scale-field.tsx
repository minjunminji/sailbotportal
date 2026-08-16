'use client';

import type { ScaleQuestion } from '@/lib/questions/types';
import { asNumber } from '../answers';
import { QuestionShell } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * A row of radios between `min` and `max`.
 *
 * Radios rather than a slider: a slider has no accessible name per stop, is
 * awkward on a phone, and hides the fact that the scale is discrete. The end
 * labels are attached to the group, not to individual radios, so "Not at all"
 * is read once rather than as part of the option's name.
 */
export function ScaleField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<ScaleQuestion>) {
  const { min, max, minLabel, maxLabel } = question.config;
  const selected = asNumber(value);
  const points = Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
  const endsId = minLabel || maxLabel ? `${fieldId}-ends` : undefined;

  return (
    <QuestionShell
      question={question}
      fieldId={fieldId}
      error={error}
      group
      extraDescribedBy={endsId}
    >
      {endsId ? (
        <p id={endsId} className="mb-3 text-sm text-muted-foreground">
          {minLabel ? `${min} = ${minLabel}` : null}
          {minLabel && maxLabel ? ' · ' : null}
          {maxLabel ? `${max} = ${maxLabel}` : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-4">
        {points.map((point) => {
          const pointId = `${fieldId}-point-${point}`;
          return (
            <div key={point} className="flex items-center gap-2">
              <input
                id={pointId}
                type="radio"
                name={fieldId}
                value={point}
                checked={selected === point}
                disabled={disabled}
                onChange={() => onChange(point)}
                className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
              />
              <label htmlFor={pointId} className="text-base">
                {point}
              </label>
            </div>
          );
        })}
      </div>
    </QuestionShell>
  );
}
