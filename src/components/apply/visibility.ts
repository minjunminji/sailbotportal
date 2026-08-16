import { isQuestionVisible } from '@/lib/questions/schema';
import type { Question } from '@/lib/questions/types';
import { rankedSlugs, type ApplyData, type ApplyPosting, type FormState } from './types';

/**
 * Which questions the form shows.
 *
 * `isQuestionVisible` is imported rather than reimplemented, and it is the same
 * function the server calls when it decides whether a question was required.
 * A second reading of `visibleIf` here would mean a form that hides a question
 * and a server that then demands it — an application nobody can submit and
 * nothing on screen to explain why.
 */

/** A posting's own questions, filtered by the applicant's ranking of ITS subteams. */
export function visibleTeamQuestions(
  posting: ApplyPosting,
  rankedSubteamIds: string[],
): Question[] {
  const ranked = rankedSlugs(posting, rankedSubteamIds);
  return posting.questions.filter((question) => isQuestionVisible(question, ranked));
}

/**
 * Core questions are asked once but validated against every selected posting,
 * each with its own ranking. One that is visible for ANY selected team is shown
 * — hiding it would leave a question the server requires with no way to answer
 * it. (No core question carries `visibleIf` today; this keeps the two sides
 * honest if one ever does.)
 */
export function visibleCoreQuestions(data: ApplyData, state: FormState): Question[] {
  const rankings = data.postings
    .filter((posting) => state.teams[posting.slug]?.selected)
    .map((posting) => rankedSlugs(posting, state.teams[posting.slug].rankedSubteams));

  const contexts = rankings.length > 0 ? rankings : [[]];

  return data.coreQuestions.filter((question) =>
    contexts.some((ranked) => isQuestionVisible(question, ranked)),
  );
}
