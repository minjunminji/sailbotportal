'use client';

import {
  assertNeverQuestion,
  isFile,
  isLongText,
  isMatrix,
  isMultiSelect,
  isRanking,
  isScale,
  isSelect,
  isShortText,
  type Answer,
  type Question,
} from '@/lib/questions/types';
import { FileField } from './fields/file-field';
import { LongTextField } from './fields/long-text-field';
import { MatrixField } from './fields/matrix-field';
import { MultiSelectField } from './fields/multi-select-field';
import { RankingField } from './fields/ranking-field';
import { ScaleField } from './fields/scale-field';
import { SelectField } from './fields/select-field';
import { ShortTextField } from './fields/short-text-field';

/**
 * Chooses the component for a question's type. The only place that knows the
 * mapping.
 *
 * Written as a guard chain rather than a `switch` in the page, so that the
 * value falling out of the bottom is `never` and `assertNeverQuestion` refuses
 * to compile the day a ninth type joins the union. A page-level switch on a
 * string would happily render nothing for the new type instead, and nobody
 * would find out until an applicant met a question that was not there.
 */
export function QuestionField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
  /** Which posting a `file` question uploads against. */
  uploadPostingSlug,
}: {
  question: Question;
  fieldId: string;
  value: Answer | undefined;
  onChange: (value: Answer | undefined) => void;
  error?: string;
  disabled?: boolean;
  uploadPostingSlug: string;
}) {
  const shared = { fieldId, value, onChange, error, disabled };

  if (isShortText(question)) return <ShortTextField question={question} {...shared} />;
  if (isLongText(question)) return <LongTextField question={question} {...shared} />;
  if (isSelect(question)) return <SelectField question={question} {...shared} />;
  if (isMultiSelect(question)) return <MultiSelectField question={question} {...shared} />;
  if (isScale(question)) return <ScaleField question={question} {...shared} />;
  if (isMatrix(question)) return <MatrixField question={question} {...shared} />;
  if (isRanking(question)) return <RankingField question={question} {...shared} />;
  if (isFile(question)) {
    return <FileField question={question} postingSlug={uploadPostingSlug} {...shared} />;
  }

  return assertNeverQuestion(question);
}

/** A list of questions, hidden ones already filtered out by the caller. */
export function QuestionList({
  questions,
  fieldIdFor,
  answers,
  onAnswer,
  errors,
  disabled,
  uploadPostingSlug,
}: {
  questions: Question[];
  fieldIdFor: (questionId: string) => string;
  answers: Record<string, Answer | undefined>;
  onAnswer: (questionId: string, value: Answer | undefined) => void;
  errors: Map<string, string>;
  disabled?: boolean;
  uploadPostingSlug: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      {questions.map((question) => {
        const fieldId = fieldIdFor(question.id);
        return (
          <QuestionField
            key={question.id}
            question={question}
            fieldId={fieldId}
            value={answers[question.id]}
            onChange={(value) => onAnswer(question.id, value)}
            error={errors.get(fieldId)}
            disabled={disabled}
            uploadPostingSlug={uploadPostingSlug}
          />
        );
      })}
    </div>
  );
}
