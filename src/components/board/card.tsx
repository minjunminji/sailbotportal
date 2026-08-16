import Link from 'next/link';
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
 * The name is the link rather than the whole card. A card wrapped in an anchor
 * is a card that navigates when a drag ends a pixel short of a drop, and Task 4
 * puts a drag handle on this same element; a small explicit target is both
 * safer and a better keyboard stop.
 */
export function BoardCard({
  card,
  teamSlug,
  now,
  subteamsById,
}: {
  card: BoardCardData;
  teamSlug: string;
  /** One clock reading for the whole page. See `daysInColumn`. */
  now: string;
  /** Resolves `assignedSubteamId`, which arrives as a bare uuid. */
  subteamsById: Map<string, BoardSubteam>;
}) {
  const days = daysInColumn(card.statusChangedAt, now);

  // Once a lead places someone, where they were PLACED is the fact that
  // matters; what they asked for on the form has been answered and stops being
  // worth a line. Mechanical and Electrical rank nothing, so they show neither
  // until placement, which is correct — the line is about a decision, not a
  // field that happens to be null.
  const assigned = card.assignedSubteamId ? subteamsById.get(card.assignedSubteamId) : undefined;
  const subteam = assigned ?? card.firstChoiceSubteam;

  return (
    <li className="rounded-lg border border-border bg-card p-3 text-card-foreground">
      <Link
        href={`/admin/${teamSlug}/applications/${card.id}`}
        className="rounded-sm text-base font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
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
