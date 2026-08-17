import { buildAnswerSchema } from '@/lib/questions/schema';
import type { AnswerMap, Question } from '@/lib/questions/types';
import {
  SHARED_FIELD_IDS,
  coreFieldId,
  rankedSlugs,
  teamFieldId,
  type ApplyData,
  type ApplyPosting,
  type FormState,
} from './types';
import { identityErrors, type FieldError } from './validate';
import { visibleCoreQuestions, visibleTeamQuestions } from './visibility';

/**
 * The rail's model, and the only place that decides what "done" means.
 *
 * The rail and the form are generated from this one array so they cannot
 * disagree — a section the rail lists but the page does not render is a link to
 * nowhere, and the reverse is a stretch of form nothing accounts for.
 *
 * NOTHING HERE RESTATES A RULE ABOUT A QUESTION. Whether an answer counts is
 * decided by `buildAnswerSchema`, the same builder the form validates with and
 * the server submits against; whether a question is on screen at all is decided
 * by `./visibility`, which the form already uses to render. If those disagreed
 * with this file, the rail would call a section complete and the submit button
 * would then refuse it, with nothing on screen to explain the contradiction.
 */

export type FormSection = {
  /** DOM id of the `<section>`, and the anchor the rail links to. */
  id: string;
  label: string;
  /** Required items answered. */
  answered: number;
  /** Required items in this section. Optional questions are never counted. */
  total: number;
  /** Carries an error from the last attempted submit. */
  invalid: boolean;
};

/** The section id for one posting's questions. */
export function teamSectionId(postingSlug: string): string {
  return `answers-${postingSlug}`;
}

/**
 * How many of a question set's REQUIRED questions are satisfied.
 *
 * Satisfied means the schema accepts it, not merely that something was typed.
 * Half of a fifty-word minimum is not progress: the count promises what is left
 * before submitting, and a section that reads complete while the submit button
 * rejects it is worse than no count at all.
 */
function questionProgress(
  questions: Question[],
  answers: AnswerMap,
  ranked: string[],
): { answered: number; total: number } {
  const required = questions.filter((question) => question.required);
  if (required.length === 0) return { answered: 0, total: 0 };

  const result = buildAnswerSchema(questions, { rankedSubteams: ranked }).safeParse(answers);
  const failed = new Set(
    result.success ? [] : result.error.issues.map((issue) => String(issue.path[0] ?? '')),
  );

  return {
    answered: required.filter((question) => !failed.has(question.id)).length,
    total: required.length,
  };
}

/** Whether this posting puts a subteam ranking on screen. */
/**
 * How many subteams this posting insists on, or zero.
 *
 * Zero means the ranking is offered but not required, so it stays out of the
 * count entirely — the same rule as an optional question. The count promises
 * what is left before submitting, and nothing that cannot block a submit
 * belongs in it.
 */
function rankingFloor(posting: ApplyPosting): number {
  if (!posting.ranking.enabled || posting.subteams.length === 0) return 0;
  return Math.min(posting.ranking.minChoices, posting.subteams.length);
}

/**
 * Which section each field id belongs to, built from the form's own data rather
 * than by matching on prefixes. `team-selection` and a posting whose slug were
 * `selection` would produce the same string; an explicit map cannot collide.
 */
function sectionByFieldId(data: ApplyData): Map<string, string> {
  const map = new Map<string, string>();

  for (const field of ['name', 'email', 'yearOfStudy', 'faculty', 'homeDepartment', 'resumePath']) {
    map.set(SHARED_FIELD_IDS[field], 'about-you');
  }
  map.set(SHARED_FIELD_IDS.teams, 'team-selection');

  for (const question of data.coreQuestions) {
    map.set(coreFieldId(question.id), 'shared-questions');
  }

  for (const posting of data.postings) {
    // The gate belongs to the section it is rendered in, which is the one
    // holding every gate — not to the team's own questions below.
    map.set(`team-${posting.slug}`, 'team-selection');
    map.set(`ranking-${posting.slug}`, teamSectionId(posting.slug));
    for (const question of posting.questions) {
      map.set(teamFieldId(posting.slug, question.id), teamSectionId(posting.slug));
    }
  }

  return map;
}

/**
 * The sections of the form, in the order they appear on the page.
 *
 * `errors` is what the last submit attempt produced. It is a parameter rather
 * than something recomputed here so the rail cannot accuse anyone of anything
 * before they have tried to submit: an empty array means a clean rail, however
 * little has been filled in.
 */
export function formSections(
  data: ApplyData,
  state: FormState,
  errors: FieldError[],
): FormSection[] {
  const invalidSections = new Set<string>();
  const byFieldId = sectionByFieldId(data);
  for (const error of errors) {
    const sectionId = byFieldId.get(error.fieldId);
    if (sectionId) invalidSections.add(sectionId);
  }

  const sections: Omit<FormSection, 'invalid'>[] = [];

  sections.push({
    id: 'about-you',
    label: 'About you',
    // The resume counts alongside the five identity fields: it is a fact about
    // the applicant, asked in the same section, not a step of its own.
    answered: 5 - identityErrors(state).length + (state.resume ? 1 : 0),
    total: 6,
  });

  // Asked once for the whole form. Omitted entirely when the org asks none,
  // matching the page, which does not render an empty heading either.
  const core = visibleCoreQuestions(data, state);
  if (core.length > 0) {
    sections.push({
      id: 'shared-questions',
      label: 'Why Sailbot',
      ...questionProgress(core, state.coreAnswers, []),
    });
  }

  const selected = data.postings.filter((posting) => state.teams[posting.slug]?.selected);

  sections.push({
    id: 'team-selection',
    label: 'Choose teams',
    answered: selected.length > 0 ? 1 : 0,
    total: 1,
  });

  // Selected teams only, in posting order. A team nobody has chosen has no row:
  // the rail describes the application being written, not the one that was
  // possible. `team-selection` above is the permanent way back.
  for (const posting of selected) {
    const team = state.teams[posting.slug];
    const ranked = rankedSlugs(posting, team.rankedSubteams);
    const progress = questionProgress(
      visibleTeamQuestions(posting, team.rankedSubteams),
      team.answers,
      ranked,
    );

    const floor = rankingFloor(posting);

    sections.push({
      id: teamSectionId(posting.slug),
      label: posting.teamName,
      // A part-filled ranking does not count. The rail may not report progress
      // the submit button would refuse, and the floor is what submit checks.
      answered: progress.answered + (floor > 0 && team.rankedSubteams.length >= floor ? 1 : 0),
      total: progress.total + (floor > 0 ? 1 : 0),
    });
  }

  return sections.map((section) => ({
    ...section,
    invalid: invalidSections.has(section.id),
  }));
}
