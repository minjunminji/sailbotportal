'use client';

import type { ReactNode } from 'react';
import { resolveLabel } from '@/lib/questions/labels';
import {
  isFile,
  isMatrix,
  isMultiSelect,
  isRanking,
  isScale,
  type Answer,
  type Question,
} from '@/lib/questions/types';
import { asFileAnswer, asMatrixAnswer, asNumber, asStringList, asText, isBlank } from './answers';
import { ordinal } from './ordered-choice-list';
import { YEAR_OF_STUDY_OPTIONS, type ApplyData, type FormState } from './types';
import { visibleCoreQuestions, visibleTeamQuestions } from './visibility';

/**
 * The last screen before submitting: everything the applicant is about to send.
 *
 * Read-only on purpose. This form branches, hides questions behind a ranking,
 * and can be filled over several sittings from a saved draft — "what did I
 * actually answer for electrical?" is a real question, and scrolling back
 * through forty inputs is not an answer to it.
 */
export function ReviewSection({
  data,
  state,
  onEdit,
}: {
  data: ApplyData;
  state: FormState;
  onEdit: () => void;
}) {
  const selected = data.postings.filter((posting) => state.teams[posting.slug]?.selected);
  const yearLabel =
    YEAR_OF_STUDY_OPTIONS.find((option) => option.value === state.yearOfStudy)?.label ??
    state.yearOfStudy;

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading" className="text-lg font-semibold">
        Review your application
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Nothing has been sent yet. Check it over, then submit.
      </p>

      <div className="mt-6 flex flex-col gap-8">
        <ReviewGroup title="About you">
          <ReviewItem label="Full name" value={state.name} />
          <ReviewItem label="Email" value={state.email} />
          <ReviewItem label="Year of study" value={yearLabel} />
          <ReviewItem label="Home department" value={state.homeDepartment} />
          <ReviewItem label="Resume" value={state.resume?.filename ?? ''} />
        </ReviewGroup>

        {visibleCoreQuestions(data, state).length > 0 ? (
          <ReviewGroup title="Shared questions">
            {visibleCoreQuestions(data, state).map((question) => (
              <ReviewItem
                key={question.id}
                label={question.label}
                value={formatAnswer(question, state.coreAnswers[question.id])}
              />
            ))}
          </ReviewGroup>
        ) : null}

        {selected.map((posting) => {
          const team = state.teams[posting.slug];
          const ranked = team.rankedSubteams
            .map((id) => posting.subteams.find((subteam) => subteam.id === id))
            .filter((subteam) => subteam !== undefined);

          return (
            <ReviewGroup key={posting.slug} title={posting.title}>
              {posting.ranking.enabled ? (
                <ReviewItem
                  label="Subteam preference"
                  value={
                    ranked.length === 0
                      ? ''
                      : ranked
                          .map(
                            (subteam, index) =>
                              `${ordinal(index + 1)}: ${subteam.name}${subteam.code ? ` (${subteam.code})` : ''}`,
                          )
                          .join(' · ')
                  }
                />
              ) : null}
              {visibleTeamQuestions(posting, team.rankedSubteams).map((question) => (
                <ReviewItem
                  key={question.id}
                  // The same substitution the form made. Review exists to show
                  // what is about to be sent, so it must not quietly restate a
                  // question differently from where it was answered.
                  label={resolveLabel(question.label, ranked[0]?.code || ranked[0]?.name)}
                  value={formatAnswer(question, team.answers[question.id])}
                />
              ))}
            </ReviewGroup>
          );
        })}

        {selected.length === 0 ? (
          <p className="text-base text-muted-foreground">
            You have not chosen a team yet. Go back and choose at least one.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="mt-8 rounded-md border border-border px-4 py-2 text-base font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Back to the form
      </button>
    </section>
  );
}

function ReviewGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
      <h3 className="text-base font-semibold">{title}</h3>
      <dl className="mt-4 flex flex-col gap-4">{children}</dl>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === '' || value === null || value === undefined;
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={empty ? 'mt-1 text-base text-muted-foreground italic' : 'mt-1 text-base'}>
        {empty ? 'Not answered' : value}
      </dd>
    </div>
  );
}

/** One answer, rendered the way its type reads best. */
export function formatAnswer(question: Question, value: Answer | undefined): ReactNode {
  if (isBlank(value)) return '';

  if (isFile(question)) {
    const file = asFileAnswer(value);
    return file ? file.filename : '';
  }

  if (isMatrix(question)) {
    const answer = asMatrixAnswer(value);
    const rows = Object.entries(answer).filter(([, selected]) => selected.length > 0);
    if (rows.length === 0) return '';
    return (
      <ul className="flex flex-col gap-1">
        {rows.map(([row, selected]) => (
          <li key={row}>
            {row}: {selected.join(', ')}
          </li>
        ))}
      </ul>
    );
  }

  if (isRanking(question)) {
    const selected = asStringList(value);
    return selected.map((entry, index) => `${ordinal(index + 1)}: ${entry}`).join(' · ');
  }

  if (isMultiSelect(question)) {
    return asStringList(value).join(', ');
  }

  if (isScale(question)) {
    const number = asNumber(value);
    return number === undefined ? '' : String(number);
  }

  // short_text, long_text and select are all a string; whitespace is preserved
  // so a paragraphed essay reads back the way it was written.
  return <span className="whitespace-pre-wrap">{asText(value)}</span>;
}
