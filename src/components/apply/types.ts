import type { AnswerMap, FileAnswer, Question } from '@/lib/questions/types';

/**
 * The shape the server component hands the form, and the shape the form's own
 * state takes. Both are plain data so they cross the server/client boundary as
 * themselves, and so a saved draft can be checked against them on restore.
 */

/** A subteam an applicant may rank. `slug` is what `visibleIf` matches on. */
export type ApplySubteam = {
  id: string;
  slug: string;
  name: string;
  code: string | null;
  description: string;
};

/**
 * `minChoices` is the floor, `maxChoices` the ceiling; equal values mean an
 * exact count. The floor exists because the rail always counted the ranking as
 * a required item while nothing enforced it, so a Software application could be
 * sent having ranked nothing at all.
 */
export type SubteamRanking = {
  enabled: boolean;
  minChoices: number;
  maxChoices: number;
};

/**
 * One open posting, with its own questions only — core questions are asked once
 * for the whole form and merged back per team at submission time, exactly as
 * `resolveQuestions` orders them.
 */
export type ApplyPosting = {
  slug: string;
  title: string;
  teamName: string;
  description: string;
  questions: Question[];
  ranking: SubteamRanking;
  /** Empty unless `ranking.enabled`. Active subteams of this posting's team. */
  subteams: ApplySubteam[];
};

export type ApplyData = {
  coreQuestions: Question[];
  postings: ApplyPosting[];
};

/**
 * One team's branch of the form. `rankedSubteams` holds subteam ids, in order.
 *
 * `selected` is a plain boolean. It was once `boolean | null`, to keep "I do not
 * want to apply" apart from "I have not decided" while each team had its own
 * yes/no gate — but nothing ever read the difference. Every consumer filters on
 * it being truthy, and `buildSubmission` sends only chosen teams, so an explicit
 * No reached the database nowhere. A third state nobody asks about is a third
 * state that only has room to disagree with the other two.
 */
export type TeamState = {
  selected: boolean;
  answers: AnswerMap;
  rankedSubteams: string[];
};

export type FormState = {
  name: string;
  email: string;
  /** Ordinal, matching `applications.year_of_study`. */
  yearOfStudy: string;
  homeDepartment: string;
  coreAnswers: AnswerMap;
  /** Keyed by posting slug. Every open posting has an entry from the start. */
  teams: Record<string, TeamState>;
  /** Never persisted: it names an object the server may not still have. */
  resume: FileAnswer | null;
};

/**
 * The ordinals `applications.year_of_study` holds, with labels a student
 * recognises. The stored value is the ordinal, so 'Fourth year' can be reworded
 * without rewriting a column.
 */
export const YEAR_OF_STUDY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'First year' },
  { value: '2', label: 'Second year' },
  { value: '3', label: 'Third year' },
  { value: '4', label: 'Fourth year' },
  { value: '5', label: 'Fifth year or beyond' },
  { value: 'masters', label: "Master's" },
  { value: 'phd', label: 'PhD' },
];

/**
 * Suggestions, not a closed list.
 *
 * Free text alone fragments into 'CPEN', 'comp eng' and 'Computer Engineering'
 * within one recruiting cycle, which breaks grouping in the export; a closed
 * list would turn away every department nobody thought of. The combobox offers
 * these and accepts anything.
 */
export const DEPARTMENT_SUGGESTIONS: string[] = [
  'APSC — General/Undeclared Engineering',
  'BMEG — Biomedical Engineering',
  'CHBE — Chemical and Biological Engineering',
  'CIVL — Civil Engineering',
  'CPEN — Computer Engineering',
  'CPSC — Computer Science',
  'ELEC — Electrical Engineering',
  'ENPH — Engineering Physics',
  'ENVE — Environmental Engineering',
  'GEOE — Geological Engineering',
  'IGEN — Integrated Engineering',
  'MANU — Manufacturing Engineering',
  'MATH — Mathematics',
  'MECH — Mechanical Engineering',
  'MINE — Mining Engineering',
  'MTRL — Materials Engineering',
  'PHYS — Physics',
  'COMM — Commerce',
  'STAT — Statistics',
];

/** Every question in the form, in the order the server would resolve them. */
export function allQuestions(data: ApplyData): Question[] {
  return [...data.coreQuestions, ...data.postings.flatMap((posting) => posting.questions)];
}

export function emptyTeamState(): TeamState {
  return { selected: false, answers: {}, rankedSubteams: [] };
}

export function emptyFormState(data: ApplyData): FormState {
  return {
    name: '',
    email: '',
    yearOfStudy: '',
    homeDepartment: '',
    coreAnswers: {},
    teams: Object.fromEntries(data.postings.map((posting) => [posting.slug, emptyTeamState()])),
    resume: null,
  };
}

/** DOM id for a question's field, and the anchor the error summary links to. */
export function coreFieldId(questionId: string): string {
  return `q-core-${questionId}`;
}

export function teamFieldId(postingSlug: string, questionId: string): string {
  return `q-${postingSlug}-${questionId}`;
}

/** Shared fields carry a fixed id so server-side issues can be routed to them. */
export const SHARED_FIELD_IDS: Record<string, string> = {
  name: 'applicant-name',
  email: 'applicant-email',
  yearOfStudy: 'applicant-year',
  homeDepartment: 'applicant-department',
  resumePath: 'resume-upload',
  teams: 'team-selection',
};

/** The subteam slugs a posting's answers are validated against, in rank order. */
export function rankedSlugs(posting: ApplyPosting, rankedSubteamIds: string[]): string[] {
  const byId = new Map(posting.subteams.map((subteam) => [subteam.id, subteam.slug]));
  return rankedSubteamIds.map((id) => byId.get(id)).filter((slug): slug is string => Boolean(slug));
}
