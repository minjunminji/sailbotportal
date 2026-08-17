'use client';

/**
 * Pick up to N things, in order.
 *
 * Used twice — for the subteam preference and for a `ranking` question — and
 * the rules are identical in both, so they live here rather than in two places
 * that could drift on what "at most three" means.
 *
 * ONE LIST, FIXED ORDER. This was two lists, chosen above and available below,
 * with rows moving between them. Picking a subteam therefore made two rows
 * re-render in different places and pushed everything under them down the page,
 * which is a lot of motion to say "yes, that one". The list is now stable and
 * only the badge and the row's control change.
 *
 * NO MOVE BUTTONS. Two buttons on every chosen row existed to express something
 * the pick order already says. Reordering is removing and re-picking, which for
 * the two-item list this actually renders is one click each way.
 *
 * No drag and drop either: unusable with a keyboard, and it would need a live
 * region to be usable with a screen reader anyway.
 */

export type Choice = {
  key: string;
  title: string;
  /** A short code shown beside the title, e.g. PATH. */
  meta?: string | null;
  description?: string;
};

/** 1st, 2nd, 3rd, 4th — the wording the 2025 form used for these rows. */
export function ordinal(position: number): string {
  const suffix =
    position % 100 >= 11 && position % 100 <= 13
      ? 'th'
      : position % 10 === 1
        ? 'st'
        : position % 10 === 2
          ? 'nd'
          : position % 10 === 3
            ? 'rd'
            : 'th';
  return `${position}${suffix}`;
}

/** Appends `key`, refusing a duplicate and refusing to exceed `max`. */
export function addChoice(selected: string[], key: string, max: number): string[] {
  if (selected.includes(key)) return selected;
  if (selected.length >= max) return selected;
  return [...selected, key];
}

export function removeChoice(selected: string[], key: string): string[] {
  return selected.filter((entry) => entry !== key);
}

/**
 * How many to pick, as one phrase for the caller's own label to carry.
 *
 * "Up to 2" invites one and then the submit button refuses it, so where the
 * floor meets the ceiling this names the exact number the form will accept.
 * It lives here, beside the rules it describes, but the list does not render it
 * — a control that states its own instruction underneath whatever heading the
 * caller already wrote says the same thing twice.
 */
export function choiceCountPhrase(
  minChoices: number,
  maxChoices: number,
  itemNoun: string,
): string {
  const plural = maxChoices === 1 ? itemNoun : `${itemNoun}s`;
  return minChoices >= maxChoices
    ? `the top ${maxChoices} ${plural}`
    : `up to ${maxChoices} ${plural}`;
}

export function OrderedChoiceList({
  choices,
  selected,
  maxChoices,
  onChange,
  idPrefix,
  disabled,
  itemNoun,
}: {
  choices: Choice[];
  selected: string[];
  maxChoices: number;
  onChange: (next: string[]) => void;
  /** Namespaces the generated ids; must be unique on the page. */
  idPrefix: string;
  disabled?: boolean;
  /** What one entry is called, for button text and announcements. */
  itemNoun: string;
}) {
  const byKey = new Map(choices.map((choice) => [choice.key, choice]));
  const full = selected.length >= maxChoices;
  const statusId = `${idPrefix}-status`;

  return (
    <div>
      {/*
        HEARD, NOT SEEN. The numbered badges say this on screen, so printing it
        again as prose was the same answer twice. It stays in the DOM as a live
        region because the badges are the one thing a screen reader gets
        nothing from — they are decorative, and a rank that changed silently
        would leave someone with no idea what their order now is.
      */}
      <p id={statusId} aria-live="polite" className="sr-only">
        {selected.length === 0
          ? `No ${itemNoun} chosen yet.`
          : selected
              .map((key, index) => `${ordinal(index + 1)}: ${byKey.get(key)?.title ?? key}`)
              .join(' · ')}
      </p>

      <ul className="mt-4 flex flex-col gap-4">
        {choices.map((choice) => {
          const rank = selected.indexOf(choice.key);
          const chosen = rank !== -1;

          return (
            <li key={choice.key} className="flex items-start gap-3">
              {/*
                THE BADGE IS THE BUTTON. It shows the state — a number when the
                choice is in the order, an empty ring when it is not — and it is
                also what you press to change that state, so there is one thing
                per row rather than an indicator and a control saying the same
                thing in two places.

                Nothing about it moves or resizes between states, so picking a
                subteam does not shift the row it is on.
              */}
              <button
                type="button"
                disabled={disabled || (!chosen && full)}
                onClick={() =>
                  onChange(
                    chosen
                      ? removeChoice(selected, choice.key)
                      : addChoice(selected, choice.key, maxChoices),
                  )
                }
                className={[
                  'mt-px flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  'disabled:opacity-40',
                  chosen
                    ? 'bg-foreground text-background'
                    : 'border border-border text-transparent enabled:hover:border-foreground',
                ].join(' ')}
              >
                {/* Hidden from the name, which the label below spells out in
                    full; otherwise it would announce as "2 Remove Pathfinding". */}
                <span aria-hidden="true">{chosen ? rank + 1 : null}</span>
                <span className="sr-only">
                  {chosen ? `Remove ${choice.title}` : `Add ${choice.title} to your choices`}
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span data-choice-title className="text-base font-medium">
                    {choice.title}
                  </span>
                  {choice.meta ? (
                    <span className="text-sm text-muted-foreground">{choice.meta}</span>
                  ) : null}
                </div>
                {choice.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{choice.description}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
