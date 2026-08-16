'use client';

import { useMemo, useState } from 'react';
import type { BoardCard, BoardSubteam, ApplicationStatus } from '@/lib/applications/queries';
import { BOARD_COLUMNS, DEFAULT_COLLAPSED, groupByStatus } from './columns';
import { BoardColumn } from './column';

/**
 * The board itself: eight columns side by side, scrolling horizontally.
 *
 * Client-side because collapsing a column is interactive and because Task 4
 * hangs `dnd-kit` off this element. Everything it renders is passed in — no
 * fetching happens here, so the server can render the whole board on the first
 * response and this only takes over the parts that move.
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
  cards: BoardCard[];
  teamSlug: string;
  now: string;
  /** Every subteam on this team, for resolving assignments to a name. */
  subteams: BoardSubteam[];
}) {
  const [collapsed, setCollapsed] = useState<Set<ApplicationStatus>>(
    // Lazy, or every render would build a Set and throw it away.
    () => new Set(DEFAULT_COLLAPSED),
  );

  const grouped = useMemo(() => groupByStatus(cards), [cards]);
  const subteamsById = useMemo(
    () => new Map(subteams.map((subteam) => [subteam.id, subteam])),
    [subteams],
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

  return (
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
  );
}
