import { z } from 'zod';
import type { SubmissionIssue } from '@/app/actions/submit-application';
import { buildAnswerSchema } from '@/lib/questions/schema';
import type { AnswerMap, Question } from '@/lib/questions/types';
import {
  SHARED_FIELD_IDS,
  YEAR_OF_STUDY_OPTIONS,
  coreFieldId,
  type ApplyData,
  type FormState,
} from './types';

/**
 * Client-side checking, run before the form is sent.
 *
 * Answers are checked by `buildAnswerSchema` — the SAME builder the server
 * action runs, over the same question definitions — so the form cannot come to
 * a different conclusion than the submission will. Nothing here re-states a
 * rule about a question; if a rule needs changing it changes in
 * `@/lib/questions/schema` and both sides move together.
 *
 * The four identity fields are the exception. Their schema lives inside a
 * `'use server'` module, which may export only async functions, so it cannot be
 * imported here. The checks below are deliberately the weakest ones that give
 * useful feedback — presence, and an email that looks like one — and the server
 * remains the authority: whatever it rejects is mapped back onto the same
 * fields by `mapServerIssues`.
 */

export type FieldError = {
  /** DOM id of the field, so the summary can link to it. */
  fieldId: string;
  /** What to call the field in the summary. */
  label: string;
  message: string;
};

/** Field errors keyed by DOM id, for rendering one message under one field. */
export type ErrorMap = Map<string, string>;

export function errorMap(errors: FieldError[]): ErrorMap {
  const map: ErrorMap = new Map();
  for (const error of errors) {
    if (!map.has(error.fieldId)) map.set(error.fieldId, error.message);
  }
  return map;
}

const YEAR_VALUES = new Set(YEAR_OF_STUDY_OPTIONS.map((option) => option.value));

function identityErrors(state: FormState): FieldError[] {
  const errors: FieldError[] = [];

  if (state.name.trim() === '') {
    errors.push({ fieldId: SHARED_FIELD_IDS.name, label: 'Full name', message: 'Enter your name' });
  }

  const email = state.email.trim();
  if (email === '') {
    errors.push({
      fieldId: SHARED_FIELD_IDS.email,
      label: 'Email',
      message: 'Enter your email address',
    });
  } else if (!z.email().safeParse(email).success) {
    errors.push({
      fieldId: SHARED_FIELD_IDS.email,
      label: 'Email',
      message: 'Enter a valid email address',
    });
  }

  if (!YEAR_VALUES.has(state.yearOfStudy)) {
    errors.push({
      fieldId: SHARED_FIELD_IDS.yearOfStudy,
      label: 'Year of study',
      message: 'Choose your year of study',
    });
  }

  if (state.homeDepartment.trim() === '') {
    errors.push({
      fieldId: SHARED_FIELD_IDS.homeDepartment,
      label: 'Home department',
      message: 'Enter your home department',
    });
  }

  return errors;
}

/**
 * Zod reports a missing required `scale` or `file` answer as a type error,
 * because the field schema only sees `undefined`. "Expected number, received
 * undefined" is not a sentence to show a student, and every other type already
 * words this the same way.
 */
function messageFor(
  issue: { message: string },
  question: Question | undefined,
  answered: boolean,
): string {
  if (!answered && question?.required) return 'This question is required';
  return issue.message;
}

/**
 * A set of answers, checked against the questions they belong to and the
 * ranking that decides which of those are visible.
 */
export function answerErrors(
  questions: Question[],
  answers: AnswerMap,
  ranked: string[],
  fieldIdFor: (questionId: string) => string,
): FieldError[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const result = buildAnswerSchema(questions, { rankedSubteams: ranked }).safeParse(answers);
  if (result.success) return [];

  return result.error.issues.map((issue) => {
    // Nested paths (a matrix row, a file's size) still belong to the question
    // at the root of the path; that is the field the summary links to.
    const questionId = String(issue.path[0] ?? '');
    const question = byId.get(questionId);
    return {
      fieldId: fieldIdFor(questionId),
      label: question?.label ?? questionId,
      message: messageFor(issue, question, answers[questionId] !== undefined),
    };
  });
}

/**
 * Every error on the shared steps, in the order the fields appear, so the
 * summary reads top to bottom and its first entry is the field that gets focus.
 */
export function validateForm(data: ApplyData, state: FormState): FieldError[] {
  return dedupe([
    ...identityErrors(state),
    ...answerErrors(data.coreQuestions, state.coreAnswers, [], coreFieldId),
  ]);
}

/** The same problem reported twice should be said once. */
export function dedupe(errors: FieldError[]): FieldError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.fieldId} ${error.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Routes the server's issues back onto the fields that produced them.
 *
 * The server re-resolves the questions from the database, so it can reject
 * something this form accepted — a posting closed mid-application, a question
 * edited in Studio. Rendering those as one generic failure would leave the
 * applicant with nothing to fix.
 */
export function mapServerIssues(data: ApplyData, issues: SubmissionIssue[]): FieldError[] {
  const labels = new Map<string, string>();
  for (const question of data.coreQuestions) labels.set(question.id, question.label);

  return issues.map((issue) => {
    const field = issue.field ?? '';
    // Paths are dotted; the question is the first segment.
    const questionId = field.split('.')[0] ?? '';

    if (issue.posting === null && SHARED_FIELD_IDS[questionId]) {
      return {
        fieldId: SHARED_FIELD_IDS[questionId],
        label: labelForShared(questionId),
        message: issue.message,
      };
    }

    return {
      fieldId: coreFieldId(questionId),
      label: labels.get(questionId) ?? 'Your application',
      message: issue.message,
    };
  });
}

function labelForShared(field: string): string {
  switch (field) {
    case 'name':
      return 'Full name';
    case 'email':
      return 'Email';
    case 'yearOfStudy':
      return 'Year of study';
    case 'homeDepartment':
      return 'Home department';
    case 'resumePath':
      return 'Resume';
    default:
      return 'Your application';
  }
}
