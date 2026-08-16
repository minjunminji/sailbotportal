'use client';

import type { RankingQuestion } from '@/lib/questions/types';
import { asStringList } from '../answers';
import { OrderedChoiceList } from '../ordered-choice-list';
import { QuestionShell } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * Orders arbitrary options, capped at `maxChoices`.
 *
 * Not the same thing as subteam preference: that lives on the posting and
 * writes to its own column. This is a question whose answer happens to be an
 * ordered list of strings — the two share only the picker.
 */
export function RankingField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<RankingQuestion>) {
  const selected = asStringList(value);
  const { options, maxChoices } = question.config;

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error} group>
      <OrderedChoiceList
        idPrefix={fieldId}
        itemNoun="option"
        choices={options.map((option) => ({ key: option, title: option }))}
        selected={selected}
        maxChoices={maxChoices}
        disabled={disabled}
        onChange={(next) => onChange(next)}
      />
    </QuestionShell>
  );
}
