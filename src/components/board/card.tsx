'use client';

import Link from 'next/link';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { BoardCard as BoardCardData, BoardSubteam } from '@/lib/applications/queries';
import { daysInColumn, daysInColumnLabel, shortYearLabel } from './columns';

/**
 * One applicant, as seen from across the board.
 *
 * FIVE THINGS AND NO MORE: name, year and home department, subteam, how long
 * they have sat in this column, and how many notes they have. A card is scanned
 * in about a second while looking for someone to act on, and every field added
 * makes the other four slower to find. Everything else about the applicant —
 * their answers, their resume, the full ranking — is one click away in the
 * detail view, which is where reading actually happens.
 *
 * THE DRAG HANDLE IS A SEPARATE BUTTON, and the name is a separate link. Making
 * the whole card draggable would mean every click on the name began a drag that
 * had to be told apart from a tap, and making the whole card a link would mean
 * every drag that ended a pixel short of a column navigated away instead. Two
 * small explicit targets avoid both, and give the keyboard two distinct stops:
 * Enter on the name opens the application, Space on the handle picks the card
 * up.
 */
export function BoardCard({
  card,
  teamSlug,
  now,
  subteamsById,
  overlay = false,
}: {
  card: BoardCardData;
  teamSlug: string;
  /** One clock reading for the whole page. See `daysInColumn`. */
  now: string;
  /** Resolves `assignedSubteamId`, which arrives as a bare uuid. */
  subteamsById: Map<string, BoardSubteam>;
  /**
   * True for the copy rendered inside `DragOverlay`, which follows the cursor
   * and must not register a second draggable under the same id.
   */
  overlay?: boolean;
}) {
  const days = daysInColumn(card.statusChangedAt, now);

  // Once a lead places someone, where they were PLACED is the fact that
  // matters; what they asked for on the form has been answered and stops being
  // worth a line. Mechanical and Electrical rank nothing, so they show neither
  // until placement, which is correct — the line is about a decision, not a
  // field that happens to be null.
  const assigned = card.assignedSubteamId ? subteamsById.get(card.assignedSubteamId) : undefined;
  const subteam = assigned ?? card.firstChoiceSubteam;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    // The column the card starts in, so the keyboard sensor knows which way is
    // "next" before the card has been moved at all.
    data: { status: card.status },
    disabled: overlay,
  });

  return (
    <li
      ref={overlay ? undefined : setNodeRef}
      style={overlay ? undefined : { transform: CSS.Translate.toString(transform) }}
      // The WHOLE CARD is the drag target. `attributes` also makes it a
      // keyboard stop that Space picks up, so removing the handle did not
      // remove the ability to move a card without a pointer.
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      data-card={card.id}
      className={`rounded-lg border border-border bg-card p-3 text-card-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        overlay ? 'shadow-lg' : 'cursor-grab active:cursor-grabbing'
      } ${
        // Left in place at reduced opacity rather than removed: taking the card
        // out of the column would make the column reflow under the cursor
        // mid-drag, moving the drop target away from where it was aimed.
        isDragging ? 'opacity-40' : ''
      }`}
    >
      {/* The name is the way in to the application. It stays a real link — so
          it can be opened in a new tab, copied, and reached by Tab — and the
          pointer sensor's 5px threshold is what keeps a plain click on it from
          being read as the start of a drag. */}
      <Link
        href={`/admin/${teamSlug}/applications/${card.id}`}
        className="rounded-sm text-base font-medium hover:underline hover:underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {card.applicantName}
      </Link>

      <p className="mt-1 text-sm text-muted-foreground">
        {shortYearLabel(card.yearOfStudy)} · {card.homeDepartment}
      </p>

      {subteam ? (
        <p className="mt-2 text-sm">
          <span className="rounded-md border border-border px-2 py-0.5 text-sm">
            {subteam.code ?? subteam.name}
          </span>
          <span className="sr-only">
            {assigned ? ' assigned subteam' : ' first choice subteam'}
          </span>
        </p>
      ) : null}

      <p className="mt-2 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
        {/* `title` spells out what the bare duration means; the visible text
            stays short because it repeats on every card in the column. */}
        <span title="Time in this column">{daysInColumnLabel(days)}</span>
        {card.noteCount > 0 ? (
          <span>
            {card.noteCount} {card.noteCount === 1 ? 'note' : 'notes'}
          </span>
        ) : null}
      </p>
    </li>
  );
}
