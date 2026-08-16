'use client';

import type { Answer } from '@/lib/questions/types';
import { QuestionList } from './question-field';
import { SubteamRanking } from './subteam-ranking';
import { teamFieldId, type ApplyPosting, type TeamState } from './types';
import type { ErrorMap } from './validate';
import { visibleTeamQuestions } from './visibility';

/**
 * One team's branch: the gate, and everything behind it.
 *
 * The gate is a real radio group with an explicit No rather than a checkbox,
 * because "I have not decided yet" and "I do not want to apply" are different
 * answers and the 2025 form asked the question outright. Nothing is submitted
 * for a team whose gate is not Yes.
 */
export function TeamSection({
  posting,
  state,
  onSelect,
  onRank,
  onAnswer,
  errors,
  disabled,
}: {
  posting: ApplyPosting;
  state: TeamState;
  onSelect: (selected: boolean) => void;
  onRank: (next: string[]) => void;
  onAnswer: (questionId: string, value: Answer | undefined) => void;
  errors: ErrorMap;
  disabled?: boolean;
}) {
  const gateId = `team-${posting.slug}`;
  const yesId = `${gateId}-yes`;
  const noId = `${gateId}-no`;
  const descriptionId = `${gateId}-description`;
  const errorId = `${gateId}-error`;
  const error = errors.get(gateId);

  const questions = visibleTeamQuestions(posting, state.rankedSubteams);

  return (
    <section aria-labelledby={`${gateId}-heading`}>
      <h2 id={`${gateId}-heading`} className="text-lg font-semibold">
        {posting.title}
      </h2>

      {posting.description ? (
        <div id={descriptionId} className="mt-3 flex flex-col gap-3">
          {posting.description.split('\n\n').map((paragraph, index) => (
            <p key={index} className="text-base text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}

      <fieldset
        id={gateId}
        className="mt-6 border-0 p-0"
        // On the group itself: `aria-describedby` needs a role to attach to,
        // and the team's description is the thing being decided about.
        aria-describedby={
          [posting.description ? descriptionId : null, error ? errorId : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        aria-invalid={error ? true : undefined}
      >
        <legend className="text-base font-medium">
          Do you want to apply to the {posting.teamName} team?
        </legend>
        <div className="mt-3 flex gap-6">
          <div className="flex items-center gap-2">
            <input
              id={yesId}
              type="radio"
              name={gateId}
              checked={state.selected === true}
              disabled={disabled}
              onChange={() => onSelect(true)}
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
            />
            <label htmlFor={yesId} className="text-base">
              Yes
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              id={noId}
              type="radio"
              name={gateId}
              checked={state.selected === false}
              disabled={disabled}
              onChange={() => onSelect(false)}
              className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
            />
            <label htmlFor={noId} className="text-base">
              No
            </label>
          </div>
        </div>
        {error ? (
          <p id={errorId} className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </fieldset>

      {state.selected ? (
        <div className="mt-8 flex flex-col gap-8 border-l border-border pl-6">
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
            questions={questions}
            fieldIdFor={(questionId) => teamFieldId(posting.slug, questionId)}
            answers={state.answers}
            onAnswer={onAnswer}
            errors={errors}
            disabled={disabled}
            uploadPostingSlug={posting.slug}
          />
        </div>
      ) : null}
    </section>
  );
}
