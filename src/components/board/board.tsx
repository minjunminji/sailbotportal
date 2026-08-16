'use client';

import { startTransition, useMemo, useOptimistic, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
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
import { boardCoordinateGetter } from './keyboard';
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
        sensors={sensors}
        // `pointerWithin` rather than the default rectangle intersection: a card
        // is nearly as wide as a column, so with rectangles a drag that has
        // barely left its own column still overlaps it most and never registers
        // the neighbour under the cursor.
        collisionDetection={pointerWithin}
        accessibility={{ announcements }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-auto pb-2">
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

        {/* The card follows the cursor from here rather than moving in place,
            so dragging out of a scrolling column does not fight the scroll. */}
        <DragOverlay>
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
