'use client';

import { resolveLabel } from '@/lib/questions/labels';
import type { Answer, Question } from '@/lib/questions/types';
import { QuestionList } from './question-field';
import { teamSectionId } from './sections';
import { SubteamRanking } from './subteam-ranking';
import { teamFieldId, type ApplyPosting, type TeamState } from './types';
import type { ErrorMap } from './validate';
import { visibleTeamQuestions } from './visibility';

/**
 * One chosen team's questions.
 *
 * Rendered only for a team whose gate is Yes — the caller decides, because the
 * same condition decides whether the rail carries a row for it.
 *
 * THE ID IS `answers-{slug}`, NOT `team-{slug}`. The gate fieldset over in
 * `TeamSelector` already holds `team-{slug}`, and a duplicate id would silently
 * break both the error summary's links and the rail's: `getElementById` returns
 * the first match, so half the anchors would quietly point at the wrong half of
 * the form.
 */
/**
 * Fills the `{firstSubteam}` placeholder from this team's ranking.
 *
 * The code is preferred over the name — PATH rather than Pathfinding — because
 * it is what the ranking beside it shows, and a question that used the long
 * name would look like it was asking about something else.
 */
function namedForFirstChoice(
  questions: Question[],
  posting: ApplyPosting,
  rankedSubteamIds: string[],
): Question[] {
  const first = posting.subteams.find((subteam) => subteam.id === rankedSubteamIds[0]);
  const name = first?.code || first?.name || null;
  return questions.map((question) => {
    const label = resolveLabel(question.label, name);
    return label === question.label ? question : { ...question, label };
  });
}

export function TeamQuestions({
  posting,
  state,
  errors,
  disabled,
  onRank,
  onAnswer,
}: {
  posting: ApplyPosting;
  state: TeamState;
  errors: ErrorMap;
  disabled?: boolean;
  onRank: (next: string[]) => void;
  onAnswer: (questionId: string, value: Answer | undefined) => void;
}) {
  const headingId = `${teamSectionId(posting.slug)}-heading`;

  return (
    <section id={teamSectionId(posting.slug)} aria-labelledby={headingId} className="scroll-mt-8">
      <h2 id={headingId} className="text-lg font-semibold">
        {posting.title}
      </h2>

      <div className="mt-6 flex flex-col gap-8">
        {/* Ranking first: it decides which questions below exist at all. */}
        {posting.ranking.enabled && posting.subteams.length > 0 ? (
          <SubteamRanking
            posting={posting}
            selected={state.rankedSubteams}
            onChange={onRank}
            error={errors.get(`ranking-${posting.slug}`)}
            disabled={disabled}
          />
        ) : null}

        <QuestionList
          questions={namedForFirstChoice(
            visibleTeamQuestions(posting, state.rankedSubteams),
            posting,
            state.rankedSubteams,
          )}
          fieldIdFor={(questionId) => teamFieldId(posting.slug, questionId)}
          answers={state.answers}
          onAnswer={onAnswer}
          errors={errors}
          disabled={disabled}
          uploadPostingSlug={posting.slug}
        />
      </div>
    </section>
  );
}
