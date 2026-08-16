'use client';

import { useDroppable } from '@dnd-kit/core';
import type {
  BoardCard as BoardCardData,
  BoardSubteam,
  ApplicationStatus,
} from '@/lib/applications/queries';
import { BoardCard } from './card';

/**
 * One status column.
 *
 * Two things here are load-bearing rather than decorative.
 *
 * THE DROP ZONE IS ALWAYS RENDERED, at a minimum height, whether or not the
 * column holds anything. A column that collapses to nothing when it empties is
 * a column that can never receive its first card — and the columns most likely
 * to be empty (`Offered` on day one, every column on a brand new posting) are
 * exactly the ones that need to be droppable. Task 4 attaches `dnd-kit` to this
 * element; it exists now so there is something to attach to.
 *
 * A COLLAPSED COLUMN IS STILL A COLUMN. It narrows to a labelled strip, keeps
 * its count, and keeps its drop zone. Rejecting someone is the most frequent
 * move on this board, so `Rejected` has to accept a card without being expanded
 * first.
 */
export function BoardColumn({
  status,
  label,
  cards,
  teamSlug,
  now,
  subteamsById,
  collapsed,
  onToggle,
}: {
  status: ApplicationStatus;
  label: string;
  cards: BoardCardData[];
  teamSlug: string;
  now: string;
  subteamsById: Map<string, BoardSubteam>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const count = cards.length;
  const countLabel = `${count} ${count === 1 ? 'applicant' : 'applicants'}`;

  // Unconditional, because hooks are — and because a collapsed column has to
  // stay droppable, so both branches below need this same ref.
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const highlight = isOver ? 'border-ring bg-accent' : 'border-border';

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={`${label} column, ${countLabel}`}
        data-status={status}
        data-collapsed="true"
        data-drop-zone={status}
        className={`flex w-12 shrink-0 flex-col rounded-lg border bg-muted ${highlight}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="flex flex-1 flex-col items-center gap-3 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          {/* The visible strip is decorative twice over: the accessible name on
              the section already says all of it, and reading a rotated label
              through a screen reader is worse than not reading it. */}
          <span aria-hidden="true" className="text-sm font-medium">
            {count}
          </span>
          <span aria-hidden="true" className="text-sm whitespace-nowrap [writing-mode:vertical-rl]">
            {label}
          </span>
          <span className="sr-only">Expand {label} column</span>
        </button>
      </section>
    );
  }

  return (
    <section
      aria-label={`${label} column, ${countLabel}`}
      data-status={status}
      data-collapsed="false"
      className={`flex w-72 shrink-0 flex-col rounded-lg border ${highlight}`}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-lg border-b border-border bg-background px-3 py-2">
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="text-sm text-muted-foreground">{count}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={true}
          className="ml-auto rounded-md border border-border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          Collapse<span className="sr-only"> {label} column</span>
        </button>
      </div>

      <div ref={setNodeRef} data-drop-zone={status} className="min-h-32 flex-1 p-2">
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <BoardCard
              key={card.id}
              card={card}
              teamSlug={teamSlug}
              now={now}
              subteamsById={subteamsById}
            />
          ))}
        </ul>

        {count === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Nothing here
          </p>
        ) : null}
      </div>
    </section>
  );
}
