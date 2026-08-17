import { z } from 'zod';
import type { SubmissionIssue } from '@/app/actions/submit-application';
import { buildAnswerSchema } from '@/lib/questions/schema';
import type { AnswerMap, Question } from '@/lib/questions/types';
import {
  APPLIED_SCIENCE,
  FACULTY_OPTIONS,
  SHARED_FIELD_IDS,
  YEAR_OF_STUDY_OPTIONS,
  coreFieldId,
  rankedSlugs,
  teamFieldId,
  type ApplyData,
  type ApplyPosting,
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
 * The five identity fields are the exception. Their schema lives inside a
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
const FACULTY_VALUES = new Set(FACULTY_OPTIONS);

/**
 * Exported so the section rail can count the same five fields by the same
 * rules. A second notion of "this field is filled in" would let the rail call a
 * section complete that the summary then refuses.
 */
export function identityErrors(state: FormState): FieldError[] {
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

  if (!FACULTY_VALUES.has(state.faculty)) {
    errors.push({
      fieldId: SHARED_FIELD_IDS.faculty,
      label: 'Faculty',
      message: 'Choose your faculty',
    });
  }

  if (state.homeDepartment.trim() === '') {
    errors.push({
      fieldId: SHARED_FIELD_IDS.homeDepartment,
      label: 'Program or major',
      // Applied Science picks from a list; every other faculty types it.
      message:
        state.faculty === APPLIED_SCIENCE ? 'Choose your program' : 'Enter your program or major',
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
 * One posting's answers, checked against core questions plus its own — the same
 * array `resolveQuestions` produces server-side, in the same order.
 */
function answerErrors(
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
 * Every error on the form, in the order the fields appear, so the summary reads
 * top to bottom and its first entry is the field that gets focus.
 */
/**
 * The ranking's floor, or nothing.
 *
 * Only the floor is checked here. The ceiling cannot be exceeded through the
 * UI — `OrderedChoiceList` stops offering choices once the list is full — so an
 * over-long list means a hand-made payload, which is the server's business
 * rather than something to explain to the person in front of us.
 */
function rankingErrorFor(posting: ApplyPosting, ranked: string[]): FieldError | null {
  const { enabled, minChoices } = posting.ranking;
  if (!enabled || posting.subteams.length === 0) return null;

  const floor = Math.min(minChoices, posting.subteams.length);
  if (ranked.length >= floor) return null;

  return {
    fieldId: `ranking-${posting.slug}`,
    label: `${posting.teamName} subteams`,
    message: floor === 1 ? 'Choose your top subteam' : `Choose your top ${floor} subteams`,
  };
}

export function validateForm(data: ApplyData, state: FormState): FieldError[] {
  const errors: FieldError[] = [...identityErrors(state)];

  const selected = data.postings.filter((posting) => state.teams[posting.slug]?.selected);
  const coreIds = new Set(data.coreQuestions.map((question) => question.id));

  if (selected.length === 0) {
    // Nothing to merge into, but a blank required core question should still be
    // reported rather than waiting for a team to be chosen.
    errors.push(...answerErrors(data.coreQuestions, state.coreAnswers, [], coreFieldId));
  }

  for (const posting of selected) {
    const team = state.teams[posting.slug];

    // Before the questions, because the ranking renders above them and the
    // summary reads top to bottom. It also decides which questions exist.
    const rankingError = rankingErrorFor(posting, team.rankedSubteams);
    if (rankingError) errors.push(rankingError);

    // Core questions are asked once and submitted with every team, so they are
    // checked in the same merged array the server builds — including their
    // visibility, which depends on this posting's ranking.
    errors.push(
      ...answerErrors(
        [...data.coreQuestions, ...posting.questions],
        { ...state.coreAnswers, ...team.answers },
        rankedSlugs(posting, team.rankedSubteams),
        (id) => (coreIds.has(id) ? coreFieldId(id) : teamFieldId(posting.slug, id)),
      ),
    );
  }

  // The resume is required by the form even though the column is nullable: the
  // 2025 form required it, leads read it before every interview, and an
  // application without one is a conversation over email later.
  if (!state.resume) {
    errors.push({
      fieldId: SHARED_FIELD_IDS.resumePath,
      label: 'Resume',
      message: 'Upload your resume',
    });
  }

  // Last, because it is about the form as a whole rather than a field: every
  // question answered and no team chosen is the one genuinely ambiguous end
  // state of a form built from optional branches.
  if (selected.length === 0) {
    errors.push({
      fieldId: SHARED_FIELD_IDS.teams,
      label: 'Teams',
      message: 'Choose at least one team to apply to',
    });
  }

  // A core question checked against three postings reports the same problem
  // three times; the summary should say it once.
  return dedupe(errors);
}

function dedupe(errors: FieldError[]): FieldError[] {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = `${error.fieldId} ${error.message}`;
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
  const coreIds = new Set(data.coreQuestions.map((question) => question.id));
  const labels = new Map<string, string>();
  for (const question of data.coreQuestions) labels.set(question.id, question.label);
  for (const posting of data.postings) {
    for (const question of posting.questions) labels.set(question.id, question.label);
  }
  const postingTitles = new Map(data.postings.map((posting) => [posting.slug, posting.title]));

  return issues.map((issue) => {
    const field = issue.field ?? '';
    // Paths are dotted; the question is the first segment.
    const questionId = field.split('.')[0] ?? '';

    if (issue.posting === null) {
      const fieldId = SHARED_FIELD_IDS[questionId] ?? SHARED_FIELD_IDS.teams;
      return { fieldId, label: labelForShared(questionId), message: issue.message };
    }

    if (questionId === 'rankedSubteams') {
      return {
        fieldId: `ranking-${issue.posting}`,
        label: `${postingTitles.get(issue.posting) ?? issue.posting} subteam preference`,
        message: issue.message,
      };
    }

    if (questionId === '') {
      return {
        fieldId: `team-${issue.posting}`,
        label: postingTitles.get(issue.posting) ?? issue.posting,
        message: issue.message,
      };
    }

    // A core question is answered once, so its error belongs on the shared
    // field even though the server reported it under a posting.
    const fieldId = coreIds.has(questionId)
      ? coreFieldId(questionId)
      : teamFieldId(issue.posting, questionId);

    return { fieldId, label: labels.get(questionId) ?? questionId, message: issue.message };
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
    case 'faculty':
      return 'Faculty';
    case 'homeDepartment':
      return 'Program or major';
    case 'resumePath':
      return 'Resume';
    default:
      return 'Your application';
  }
}
