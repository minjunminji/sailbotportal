'use client';

import { SHARED_FIELD_IDS, type ApplyPosting, type TeamState } from './types';
import type { ErrorMap } from './validate';

/**
 * Every "do you want to apply to X?" gate, in one place.
 *
 * The gates used to sit at the head of each team's own block. Gathering them
 * here does two things. It gives the section rail a permanent anchor — a team
 * nobody has chosen has no row of its own to link to, so without this there
 * would be no way back to change your mind. And it lets an applicant see the
 * whole shape of what they are committing to before writing the first essay,
 * rather than discovering the third quiz by scrolling into it.
 *
 * The section id is `SHARED_FIELD_IDS.teams`, which is also where the server
 * routes its "you selected no teams" error. One id, so the error summary and
 * the rail land in the same place.
 *
 * Each gate is a radio group with an explicit No rather than a checkbox: "I
 * have not decided yet" and "I do not want to apply" are different answers, and
 * the 2025 form asked outright.
 */
export function TeamGates({
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
    <section
      id={SHARED_FIELD_IDS.teams}
      aria-labelledby="team-selection-heading"
      className="scroll-mt-8"
    >
      <h2 id="team-selection-heading" className="text-lg font-semibold">
        Choose your teams
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        You can apply to more than one. Each team you choose adds its own questions below.
      </p>

      {sectionError ? (
        <p id="team-selection-error" className="mt-3 text-sm text-destructive">
          {sectionError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-8">
        {postings.map((posting) => (
          <Gate
            key={posting.slug}
            posting={posting}
            selected={teams[posting.slug]?.selected ?? null}
            error={errors.get(`team-${posting.slug}`)}
            disabled={disabled}
            onSelect={(selected) => onSelect(posting.slug, selected)}
          />
        ))}
      </div>
    </section>
  );
}

function Gate({
  posting,
  selected,
  error,
  disabled,
  onSelect,
}: {
  posting: ApplyPosting;
  selected: boolean | null;
  error?: string;
  disabled?: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const gateId = `team-${posting.slug}`;
  const yesId = `${gateId}-yes`;
  const noId = `${gateId}-no`;
  const descriptionId = `${gateId}-description`;
  const errorId = `${gateId}-error`;

  return (
    <fieldset
      id={gateId}
      className="border-0 p-0"
      // On the group itself: `aria-describedby` needs a role to attach to, and
      // the team's description is the thing being decided about.
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

      {/*
        The description stays with the gate rather than moving down to the
        questions. This is where the decision is made, so this is where someone
        needs to know what the team does.
      */}
      {posting.description ? (
        <div id={descriptionId} className="mt-2 flex flex-col gap-2">
          {posting.description.split('\n\n').map((paragraph, index) => (
            <p key={index} className="text-sm text-muted-foreground">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex gap-6">
        <Choice
          id={yesId}
          name={gateId}
          label="Yes"
          checked={selected === true}
          disabled={disabled}
          onSelect={() => onSelect(true)}
        />
        <Choice
          id={noId}
          name={gateId}
          label="No"
          checked={selected === false}
          disabled={disabled}
          onSelect={() => onSelect(false)}
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

function Choice({
  id,
  name,
  label,
  checked,
  disabled,
  onSelect,
}: {
  id: string;
  name: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
      />
      <label htmlFor={id} className="text-base">
        {label}
      </label>
    </div>
  );
}
