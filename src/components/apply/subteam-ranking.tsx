'use client';

import { choiceCountPhrase, OrderedChoiceList } from './ordered-choice-list';
import type { ApplyPosting } from './types';

/**
 * Subteam preference for one posting.
 *
 * Rendered BEFORE that team's questions, because `visibleIf` reads this: a
 * question can be asked only of someone who put a given subteam in their top N.
 * Asking it afterwards would mean questions appearing above answers the
 * applicant has already scrolled past, or disappearing along with what they
 * wrote in them.
 *
 * Each subteam shows its name, code and description. Someone choosing between
 * NET, PATH and SIM is not choosing between three acronyms, and sending them
 * back to the home page to find out what they mean is how a preference gets
 * picked at random.
 */
export function SubteamRanking({
  posting,
  selected,
  onChange,
  error,
  disabled,
}: {
  posting: ApplyPosting;
  selected: string[];
  onChange: (next: string[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const fieldId = `ranking-${posting.slug}`;
  const errorId = `${fieldId}-error`;

  return (
    <fieldset
      id={fieldId}
      className="border-0 p-0"
      // On the group, not on a wrapper `div`: `aria-describedby` is honoured
      // where there is a role to describe, and `fieldset` carries one.
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
    >
      {/*
        The whole instruction, in one line. The legend used to ask which
        subteams and a line beneath it said how many — two sentences for one
        question, and the team name was already in the heading above.
      */}
      <legend className="text-base font-medium">
        Select{' '}
        {choiceCountPhrase(posting.ranking.minChoices, posting.ranking.maxChoices, 'subteam')}{' '}
        you&apos;re interested in
      </legend>
      <div className="mt-3">
        <OrderedChoiceList
          idPrefix={fieldId}
          itemNoun="subteam"
          choices={posting.subteams.map((subteam) => ({
            key: subteam.id,
            title: subteam.name,
            meta: subteam.code,
            description: subteam.description,
          }))}
          selected={selected}
          maxChoices={posting.ranking.maxChoices}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      {error ? (
        <p id={errorId} className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
