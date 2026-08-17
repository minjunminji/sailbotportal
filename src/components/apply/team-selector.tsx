'use client';

import { SHARED_FIELD_IDS, type ApplyPosting, type TeamState } from './types';
import type { ErrorMap } from './validate';

/**
 * Choosing teams: one multi-select question.
 *
 * This was three separate "Do you want to apply to X?" radio gates, a shape
 * inherited from the Google Form it replaced — Forms needs a question to branch
 * on and cannot branch on a multi-select, so the gate was a workaround for a
 * constraint we do not have. Nothing downstream ever read the explicit No.
 *
 * The section id is `SHARED_FIELD_IDS.teams`, which is also where the server
 * routes its "you selected no teams" error and where the rail's "Choose teams"
 * row points. One id, so the error summary and the rail land together.
 */
export function TeamSelector({
  postings,
  teams,
  errors,
  disabled,
  onSelect,
}: {
  postings: ApplyPosting[];
  teams: Record<string, TeamState>;
  errors: ErrorMap;
  disabled?: boolean;
  onSelect: (postingSlug: string, selected: boolean) => void;
}) {
  const sectionError = errors.get(SHARED_FIELD_IDS.teams);

  return (
    <section id={SHARED_FIELD_IDS.teams} className="scroll-mt-8">
      <fieldset
        className="border-0 p-0"
        aria-describedby={sectionError ? 'team-selection-error' : undefined}
        aria-invalid={sectionError ? true : undefined}
      >
        <legend className="text-lg font-semibold">Select the teams you want to apply to</legend>
        {/*
          Told once, here, rather than three times inside the cards. Every
          posting's description used to open with its own retelling of this,
          because in the Google Form a team's section had to stand alone. It
          lives in the component and not the database because it describes
          Sailbot, not any one posting.
        */}
        <p className="mt-2 text-sm text-muted-foreground">
          Every team works on the same vessel: POLARIS, an autonomous sailboat that collects oceanic
          and atmospheric data in the Pacific. You can choose more than one team, and each one you
          pick adds its own questions below.
        </p>

        {sectionError ? (
          <p id="team-selection-error" className="mt-3 text-sm text-destructive">
            {sectionError}
          </p>
        ) : null}

        {/* Wider than a card list would need: with no borders, the gap is the
            only thing separating one team from the next. */}
        <div className="mt-6 flex flex-col gap-6">
          {postings.map((posting) => (
            <TeamCard
              key={posting.slug}
              posting={posting}
              selected={teams[posting.slug]?.selected ?? false}
              disabled={disabled}
              onSelect={(selected) => onSelect(posting.slug, selected)}
            />
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * PARAGRAPH ONE IS THE CARD FACE. The rest goes behind the fold.
 *
 * Every posting's description opened with the same account of the project,
 * rewritten three times, because in the Google Form each team's section had to
 * stand alone. That paragraph is now told once above the cards, and what
 * survives here is the team-specific part: a summary line to choose by, and the
 * detail for someone who wants it.
 */
function TeamCard({
  posting,
  selected,
  disabled,
  onSelect,
}: {
  posting: ApplyPosting;
  selected: boolean;
  disabled?: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const boxId = `team-${posting.slug}`;
  const nameId = `${boxId}-name`;
  const summaryId = `${boxId}-summary`;

  const [summary, ...rest] = posting.description
    .split('\n\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  // NO CHROME. No border, no fill, nothing that changes when the team is
  // chosen. The checkbox is the only thing that says whether this team is in,
  // which is what a checkbox is for; a container that also lit up would state
  // the answer twice and leave two places for it to be wrong.
  return (
    <div>
      {/*
        The label covers the checkbox, the name and the summary, so the whole
        block selects the team. It deliberately stops short of the disclosure
        below: a label wrapping everything would make the disclosure a second,
        invisible way to tick the box.
      */}
      <label htmlFor={boxId} className="flex cursor-pointer items-start gap-3">
        <input
          id={boxId}
          type="checkbox"
          value={posting.slug}
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.checked)}
          // Named by the team alone. Left to compute its own name from the
          // label's children, it would announce as "Mechanical We build the
          // boat itself." — children joined by spaces, the same trap the
          // section rail's rows hit.
          aria-labelledby={nameId}
          aria-describedby={summary ? summaryId : undefined}
          className="mt-1 shrink-0 disabled:opacity-50"
        />
        <span className="min-w-0">
          <span id={nameId} className="block text-base font-medium">
            {posting.teamName}
          </span>
          {summary ? (
            <span id={summaryId} className="mt-1 block text-sm text-muted-foreground">
              {summary}
            </span>
          ) : null}
        </span>
      </label>

      {rest.length > 0 ? (
        <details className="mt-3 pl-7">
          <summary className="w-fit cursor-pointer text-sm underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            More about {posting.teamName}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {rest.map((paragraph, index) => (
              <p key={index} className="text-sm text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
