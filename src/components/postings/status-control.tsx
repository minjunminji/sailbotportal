'use client';

import { startTransition, useOptimistic, useState } from 'react';
import { POSTING_STATUSES } from '@/lib/postings/statuses';

/**
 * Opens and closes one posting.
 *
 * A SEGMENTED RADIO GROUP, NOT A DROPDOWN. All three states are visible at
 * once, so "is Software still accepting applications?" is answered by looking
 * rather than by opening something. There are three postings on this screen and
 * three states each; a menu would hide two thirds of the page's only real
 * information.
 *
 * Real radio inputs rather than buttons with `aria-checked`: arrow-key
 * navigation, the roving tab stop, and the group semantics all come free and
 * correct, and this is exactly the kind of thing the design doc means by a base
 * a designer cannot retrofit.
 *
 * The action arrives as a prop rather than being imported, matching `ApplyForm`
 * — it keeps the server module out of the client bundle graph for tests and
 * puts the one side effect in the signature.
 */
export function PostingStatusControl({
  postingId,
  title,
  status,
  action,
}: {
  postingId: string;
  /** Named in the group's label: several of these share one screen. */
  title: string;
  status: string;
  action: (postingId: string, status: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [error, setError] = useState<string | null>(null);

  // Derived from the prop, so a failed change reverts on its own the moment the
  // transition ends — the server never revalidated, so `status` still holds the
  // truth. Same mechanism the board uses for a failed card move.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    status,
    (_current: string, next: string) => next,
  );

  function choose(next: string) {
    // Clicking the state it is already in is not a change. Sending it would
    // evict the public postings cache to write the value that is already there.
    if (next === optimisticStatus) return;

    setError(null);

    startTransition(async () => {
      setOptimisticStatus(next);
      const result = await action(postingId, next);
      if (!result.ok) setError(result.error ?? 'Could not change this posting.');
    });
  }

  const groupLabelId = `posting-status-${postingId}`;

  return (
    <div>
      <div
        role="radiogroup"
        aria-labelledby={groupLabelId}
        className="inline-flex rounded-md border border-border"
      >
        {/* Visually hidden: the posting's title is already on screen directly
            above. It is here so the GROUP carries it, which is what makes three
            of these on one page distinguishable to a screen reader. */}
        <span id={groupLabelId} className="sr-only">
          {title} status
        </span>

        {POSTING_STATUSES.map(({ value, label }) => {
          const id = `${groupLabelId}-${value}`;
          const checked = optimisticStatus === value;

          return (
            <label
              key={value}
              htmlFor={id}
              className={`cursor-pointer px-3 py-2 text-sm first:rounded-l-md last:rounded-r-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ${
                checked ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              <input
                id={id}
                type="radio"
                name={groupLabelId}
                value={value}
                checked={checked}
                onChange={() => choose(value)}
                // `sr-only` rather than `hidden`: a hidden input is not
                // focusable, which would cost the keyboard path this control
                // exists to keep.
                className="sr-only"
              />
              {label}
            </label>
          );
        })}
      </div>

      {error ? (
        // A failed change is the dangerous case: a lead who believes
        // applications are closed when they are open will not look again.
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
