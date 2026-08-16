'use client';

import { startTransition, useMemo, useOptimistic, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type {
  BoardCard as BoardCardData,
  BoardSubteam,
  ApplicationStatus,
} from '@/lib/applications/queries';
import { moveApplication } from '@/app/actions/move-application';
import { BOARD_COLUMNS, DEFAULT_COLLAPSED, groupByStatus } from './columns';
import { BoardColumn } from './column';
import { BoardCard } from './card';
import { boardCollisionDetection, boardCoordinateGetter } from './keyboard';
import { resolveMove } from './moves';

/**
 * The board itself: eight columns side by side, scrolling horizontally.
 *
 * MOVES ARE OPTIMISTIC. A lead working a board moves a card every few seconds,
 * and waiting for a round trip before the card lands makes the whole surface
 * feel broken. `useOptimistic` also gives the rollback for free: the optimistic
 * value is derived from the `cards` prop, so when a move fails and the server
 * never revalidates, the card returns to its column the moment the transition
 * ends. There is no second copy of the truth to get out of step.
 *
 * `now` comes from the server render rather than from `Date.now()` here, so the
 * days-in-column figures are identical on both sides of hydration. See
 * `daysInColumn`.
 */
export function Board({
  cards,
  teamSlug,
  now,
  subteams,
}: {
  cards: BoardCardData[];
  teamSlug: string;
  now: string;
  /** Every subteam on this team, for resolving assignments to a name. */
  subteams: BoardSubteam[];
}) {
  const [collapsed, setCollapsed] = useState<Set<ApplicationStatus>>(
    // Lazy, or every render would build a Set and throw it away.
    () => new Set(DEFAULT_COLLAPSED),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [optimisticCards, applyMove] = useOptimistic(
    cards,
    (state: BoardCardData[], move: { id: string; status: ApplicationStatus }) =>
      state.map((card) =>
        card.id === move.id
          ? // `statusChangedAt` is reset too, or the card would land in its new
            // column still claiming the eleven days it spent in the old one.
            { ...card, status: move.status, statusChangedAt: now }
          : card,
      ),
  );

  const grouped = useMemo(() => groupByStatus(optimisticCards), [optimisticCards]);
  const subteamsById = useMemo(
    () => new Map(subteams.map((subteam) => [subteam.id, subteam])),
    [subteams],
  );
  const cardsById = useMemo(
    () => new Map(optimisticCards.map((card) => [card.id, card])),
    [optimisticCards],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Without a small threshold every click on a card's name would begin a
      // drag, and the link would never fire.
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: boardCoordinateGetter }),
  );

  function toggle(status: ApplicationStatus) {
    setCollapsed((current) => {
      // A new Set, not a mutated one: React compares by identity and would
      // skip the render entirely.
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  }

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);

    const move = resolveMove(
      optimisticCards,
      String(event.active.id),
      event.over ? String(event.over.id) : null,
    );
    if (!move) return;

    setError(null);

    startTransition(async () => {
      applyMove(move);
      const result = await moveApplication(move.id, move.status, teamSlug);
      // On failure nothing is revalidated, so the `cards` prop never changes
      // and the optimistic value falls back to it when the transition ends —
      // the card returns to its old column on its own.
      if (!result.ok) setError(result.error);
    });
  }

  const activeCard = draggingId ? cardsById.get(draggingId) : undefined;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${cardsById.get(String(active.id))?.applicantName}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${cardsById.get(String(active.id))?.applicantName} is over ${labelOf(over.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${cardsById.get(String(active.id))?.applicantName} moved to ${labelOf(over.id)}.`
        : `${cardsById.get(String(active.id))?.applicantName} was not moved.`,
    onDragCancel: ({ active }) =>
      `Move cancelled. ${cardsById.get(String(active.id))?.applicantName} stayed where it was.`,
  };

  return (
    <>
      {/* Present before it has content, so a failed move is announced rather
          than silently appearing. A move that fails must say so: the card
          returning to its old column on its own looks like a bug otherwise. */}
      <div aria-live="assertive" className="empty:hidden">
        {error ? (
          <p className="flex items-center gap-3 rounded-md border border-destructive px-3 py-2 text-sm text-destructive">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-auto rounded-md border border-border px-2 py-1 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            >
              Dismiss
            </button>
          </p>
        ) : null}
      </div>

      <DndContext
        // An explicit id, or dnd-kit names its accessibility description from
        // an internal counter that starts fresh on the server and continues
        // from wherever the client happens to be — producing
        // `aria-describedby="DndDescribedBy-0"` in the HTML and
        // `DndDescribedBy-11` after hydration, which React reports as a
        // mismatch and refuses to patch. A stable id makes both sides agree.
        id="board"
        sensors={sensors}
        // Pointer-first, rectangles for the keyboard. See the note on
        // `boardCollisionDetection` — plain `pointerWithin` silently made every
        // keyboard drag a no-op.
        collisionDetection={boardCollisionDetection}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        {/* `relative` is load-bearing, not cosmetic. `overflow` does NOT clip an
            absolutely positioned descendant whose containing block lies outside
            the scroll container — and Tailwind's `sr-only` is
            `position: absolute`. With no positioned ancestor here, all 38 of
            the board's screen-reader spans resolved against the initial
            containing block, escaped this clip, and extended the DOCUMENT to
            the full width of eight columns. The result was a page that scrolled
            sideways into blank space with nothing visible out there.
            Making this the containing block clips them along with everything
            else. Any scroll pane holding `sr-only` text needs the same. */}
        {/* One scroller for the whole board, both directions.
            `relative` is load-bearing: see the note on `sr-only` below. */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-auto pb-2">
          {/* The row is sized to its TALLEST column (`h-max`) rather than to
              the visible area, so every column's border runs the full height of
              the content instead of stopping partway down while its cards
              carry on past it. `align-items: stretch` — the default — then
              gives every column that same height, so short columns match the
              longest one. `min-h-full` keeps them filling the board when no
              column is tall enough to need scrolling at all. */}
          <div className="flex h-max min-h-full gap-3">
            {BOARD_COLUMNS.map((column) => (
              <BoardColumn
                key={column.status}
                status={column.status}
                label={column.label}
                cards={grouped[column.status]}
                teamSlug={teamSlug}
                now={now}
                subteamsById={subteamsById}
                collapsed={collapsed.has(column.status)}
                onToggle={() => toggle(column.status)}
              />
            ))}
          </div>
        </div>

        {/* The card follows the cursor from here rather than moving in place,
            so dragging out of a scrolling column does not fight the scroll.

            `dropAnimation={null}` because the default flies the overlay back to
            the card's slot over ~250ms. The move itself is optimistic and
            lands immediately, so that animation is time spent watching a card
            catch up with a decision already made — and it reads as lag when
            moving several cards in a row. */}
        <DragOverlay dropAnimation={null}>
          {activeCard ? (
            <ul>
              <BoardCard
                card={activeCard}
                teamSlug={teamSlug}
                now={now}
                subteamsById={subteamsById}
                overlay
              />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function labelOf(status: string | number): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.label ?? String(status);
}
