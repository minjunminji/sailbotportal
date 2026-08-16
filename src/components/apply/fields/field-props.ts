import type { Answer, Question } from '@/lib/questions/types';

/**
 * What every field component takes.
 *
 * `value` stays the union rather than the narrowed answer type: it may have
 * come from a restored draft, so each component reads it through the coercers
 * in `../answers` and treats anything unexpected as unanswered.
 */
export type FieldProps<Q extends Question> = {
  question: Q;
  /** DOM id of the wrapper, and the anchor the error summary links to. */
  fieldId: string;
  value: Answer | undefined;
  onChange: (value: Answer | undefined) => void;
  error?: string;
  disabled?: boolean;
};
