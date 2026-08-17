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
  /** One of `FACULTY_OPTIONS`, matching `applications.faculty`. */
  faculty: string;
  /** Program or major, matching `applications.home_department`. */
  homeDepartment: string;
  coreAnswers: AnswerMap;
  /** Keyed by posting slug. Every open posting has an entry from the start. */
  teams: Record<string, TeamState>;
  /** Never persisted: it names an object the server may not still have. */
  resume: FileAnswer | null;
};

/**
 * The ordinals `applications.year_of_study` holds, with labels a student
 * recognises. The stored value is the ordinal, so '4th' can be reworded without
 * rewriting a column.
 *
 * Written as ordinals rather than as 'Fourth year': the field is one of three
 * sharing a row, and the label above it already says what the number counts.
 */
export const YEAR_OF_STUDY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1st' },
  { value: '2', label: '2nd' },
  { value: '3', label: '3rd' },
  { value: '4', label: '4th' },
  { value: '5', label: '5th or beyond' },
  { value: 'masters', label: "Master's" },
  { value: 'phd', label: 'PhD' },
];

/**
 * The faculties an applicant may choose, most likely first rather than
 * alphabetically: nearly every applicant is in the first two.
 *
 * A closed list, and the server enforces the same one. Unlike a program, a
 * faculty is a short fixed set that does not change between recruiting cycles,
 * so free text here would only ever produce 'APSC', 'Engineering' and 'applied
 * sci' meaning one thing.
 */
export const FACULTY_OPTIONS: string[] = [
  'Applied Science',
  'Science',
  'Arts',
  'Business',
  'Law',
  'Forestry',
];

/** The one faculty whose programs are asked as a closed list. */
export const APPLIED_SCIENCE = 'Applied Science';

/**
 * Engineering programs, by code, alphabetically.
 *
 * The stored value is the CODE alone, which is what the board card and every
 * export group on. Applied Science is the only faculty that gets a closed list,
 * because it is the only one where four-letter codes are what students call
 * their program — a Science student says 'Biology', not 'BIOL'.
 *
 * 'APSC' is first-year and undeclared engineering, which is a large share of
 * applicants and has no program code of its own yet.
 */
export const APPLIED_SCIENCE_PROGRAMS: { code: string; name: string }[] = [
  { code: 'APSC', name: 'First year / undeclared' },
  { code: 'BMEG', name: 'Biomedical Engineering' },
  { code: 'CHBE', name: 'Chemical and Biological Engineering' },
  { code: 'CIVL', name: 'Civil Engineering' },
  { code: 'CPEN', name: 'Computer Engineering' },
  { code: 'ELEC', name: 'Electrical Engineering' },
  { code: 'ENPH', name: 'Engineering Physics' },
  { code: 'ENVE', name: 'Environmental Engineering' },
  { code: 'GEOL', name: 'Geological Engineering' },
  { code: 'IGEN', name: 'Integrated Engineering' },
  { code: 'MECH', name: 'Mechanical Engineering' },
  { code: 'MINE', name: 'Mining Engineering' },
  { code: 'MTRL', name: 'Materials Engineering' },
];

/**
 * Whether a program typed under one faculty still means anything under another.
 *
 * It does not when the switch crosses Applied Science in either direction: the
 * field changes between a code list and free text, so 'MECH' would sit in a box
 * that now expects 'Biology', or 'Biology' would sit in a dropdown that cannot
 * show it. Within the free-text faculties the answer is kept — someone
 * correcting Arts to Science has not changed what they study.
 */
export function programSurvivesFacultyChange(previous: string, next: string): boolean {
  return (previous === APPLIED_SCIENCE) === (next === APPLIED_SCIENCE);
}

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
    faculty: '',
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
  faculty: 'applicant-faculty',
  homeDepartment: 'applicant-department',
  resumePath: 'resume-upload',
  teams: 'team-selection',
};

/** The subteam slugs a posting's answers are validated against, in rank order. */
export function rankedSlugs(posting: ApplyPosting, rankedSubteamIds: string[]): string[] {
  const byId = new Map(posting.subteams.map((subteam) => [subteam.id, subteam.slug]));
  return rankedSubteamIds.map((id) => byId.get(id)).filter((slug): slug is string => Boolean(slug));
}
