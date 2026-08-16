'use client';

import { smallButtonClasses } from './question-shell';

/**
 * Pick up to N things, in order.
 *
 * Used twice — for the subteam preference and for a `ranking` question — and
 * the rules are identical in both, so they live here rather than in two places
 * that could drift on what "at most three" means.
 *
 * No drag and drop. Reordering by dragging is unusable with a keyboard, needs a
 * live region to be usable with a screen reader anyway, and buys nothing here:
 * the list is at most six items long. Add, move up, move down, remove — all
 * real buttons.
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

/** Moves `key` by `delta` places, clamped to the ends of the list. */
export function moveChoice(selected: string[], key: string, delta: number): string[] {
  const from = selected.indexOf(key);
  if (from === -1) return selected;
  const to = from + delta;
  if (to < 0 || to >= selected.length) return selected;

  const next = [...selected];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
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
      <p className="text-sm text-muted-foreground">
        Choose up to {maxChoices}, most preferred first.
      </p>

      {/* Present before it has content so additions are announced, not just
          rendered. Reordering with buttons is silent otherwise. */}
      <p id={statusId} aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {selected.length === 0
          ? `No ${itemNoun} chosen yet.`
          : selected
              .map((key, index) => `${ordinal(index + 1)}: ${byKey.get(key)?.title ?? key}`)
              .join(' · ')}
      </p>

      {selected.length > 0 ? (
        <ol className="mt-4 flex flex-col gap-2">
          {selected.map((key, index) => {
            const choice = byKey.get(key);
            if (!choice) return null;
            return (
              <li
                key={key}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground"
              >
                <span className="text-sm font-medium text-muted-foreground">
                  {ordinal(index + 1)} choice
                </span>
                <span className="text-base font-medium">{choice.title}</span>
                {choice.meta ? (
                  <span className="text-sm text-muted-foreground">{choice.meta}</span>
                ) : null}
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    onClick={() => onChange(moveChoice(selected, key, -1))}
                    className={smallButtonClasses}
                  >
                    Move up<span className="sr-only"> {choice.title}</span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === selected.length - 1}
                    onClick={() => onChange(moveChoice(selected, key, 1))}
                    className={smallButtonClasses}
                  >
                    Move down<span className="sr-only"> {choice.title}</span>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(removeChoice(selected, key))}
                    className={smallButtonClasses}
                  >
                    Remove<span className="sr-only"> {choice.title}</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <ul className="mt-4 flex flex-col gap-2">
        {choices.map((choice) => {
          const chosen = selected.includes(choice.key);
          if (chosen) return null;
          return (
            <li
              key={choice.key}
              className="rounded-lg border border-border bg-card p-4 text-card-foreground"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base font-medium">{choice.title}</span>
                {choice.meta ? (
                  <span className="text-sm text-muted-foreground">{choice.meta}</span>
                ) : null}
                <button
                  type="button"
                  disabled={disabled || full}
                  onClick={() => onChange(addChoice(selected, choice.key, maxChoices))}
                  className={`ml-auto ${smallButtonClasses}`}
                >
                  Add<span className="sr-only"> {choice.title} to your choices</span>
                </button>
              </div>
              {choice.description ? (
                <p className="mt-2 text-sm text-muted-foreground">{choice.description}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {full ? (
        <p className="mt-2 text-sm text-muted-foreground">
          You have chosen {maxChoices}. Remove one to choose a different {itemNoun}.
        </p>
      ) : null}
    </div>
  );
}
