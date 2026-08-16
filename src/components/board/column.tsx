'use client';

import { useDroppable } from '@dnd-kit/core';
import type {
  BoardCard as BoardCardData,
  BoardSubteam,
  ApplicationStatus,
} from '@/lib/applications/queries';
import { BoardCard } from './card';
import { FoldIcon, UnfoldIcon } from './icons';

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
        // Same surface as an expanded column — folding a column changes its
        // width, not what it is. The drag-over highlight still applies, so a
        // folded column lights up on hover exactly like an open one.
        className={`flex w-12 shrink-0 flex-col rounded-lg border ${highlight}`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          className="group flex flex-1 flex-col items-center gap-3 rounded-lg p-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {/* The count cross-fades into the unfold icon on hover — the strip is
              too narrow for both, and the count is what you want while
              scanning, the icon once you have decided to act. Keyboard focus
              does the same, or the affordance would exist only for a mouse.

              BOTH SIT IN ONE FIXED-SIZE BOX, stacked. Swapping them with
              `hidden` meant a 20px count giving way to a 16px icon, which
              moved the rotated label below it every time the pointer crossed
              the strip. A box that never changes size cannot shift anything. */}
          <span aria-hidden="true" className="relative block h-5 w-5">
            <span className="absolute inset-0 flex items-center justify-center text-sm font-medium transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none">
              {count}
            </span>
            <UnfoldIcon className="absolute inset-0 m-auto opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none" />
          </span>
          {/* `font-medium` to match the expanded column's heading, which this
              stands in for — it was rendering at 400 against the heading's 500,
              which is what made it look like a different face. Vertical writing
              mode keeps the label sized to its own text and sitting directly
              under the count; rotating a positioned box instead centred it in
              the whole strip. */}
          <span
            aria-hidden="true"
            className="text-sm font-medium whitespace-nowrap [writing-mode:vertical-rl]"
          >
            {label}
          </span>
          <span className="sr-only">Expand {label} column</span>
        </button>
      </section>
    );
  }

  return (
    <section
      // The droppable is the WHOLE column, not just the card area, so a drop
      // aimed at the header still lands.
      ref={setNodeRef}
      aria-label={`${label} column, ${countLabel}`}
      data-status={status}
      data-collapsed="false"
      className={`flex w-72 shrink-0 flex-col rounded-lg border ${highlight}`}
    >
      {/* No bottom rule. The gap between the header and the first card already
          separates them, and a line here reads as the top edge of a second box
          inside the column. */}
      <div className="flex items-center gap-2 px-3 py-2">
        <h2 className="text-sm font-medium">{label}</h2>
        <span className="text-sm text-muted-foreground">{count}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={true}
          className="ml-auto rounded-md p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <FoldIcon />
          {/* The button is now wordless, so its whole name lives here. */}
          <span className="sr-only">Collapse {label} column</span>
        </button>
      </div>

      {/* `flex-1` so an empty column still fills its full height and stays a
          drop target. `relative` gives the cards' `sr-only` spans a containing
          block inside the board — without one they resolve against the initial
          containing block and stretch the whole document sideways. */}
      <div data-drop-zone={status} className="relative flex-1 p-2">
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
