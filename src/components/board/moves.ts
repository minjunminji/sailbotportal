import type { BoardCard, ApplicationStatus } from '@/lib/applications/queries';
import { BOARD_COLUMNS } from './columns';

/**
 * What a finished drag means, decided away from `dnd-kit`.
 *
 * BOTH SENSORS END HERE. A pointer drag and a keyboard drag differ only in how
 * they arrive at "this card, that column"; from that point there is one code
 * path, which is what makes "the keyboard does the same thing as the mouse"
 * a property of the structure rather than a claim two tests have to keep
 * checking against each other.
 *
 * Returning null means "do nothing", and it covers three cases that all look
 * different on screen and identical to the server: the card was dropped outside
 * any column, it was dropped back where it started, or it names a card the
 * board is no longer showing.
 */
export function resolveMove(
  cards: BoardCard[],
  activeId: string,
  overId: string | null,
): { id: string; status: ApplicationStatus } | null {
  if (overId === null) return null;

  const status = BOARD_COLUMNS.find((column) => column.status === overId)?.status;
  // A droppable that is not one of the eight columns. Nothing renders one
  // today; refusing beats forwarding an arbitrary string to the server.
  if (!status) return null;

  const card = cards.find((entry) => entry.id === activeId);
  // Realistically: realtime removed the card mid-drag, in a later task.
  if (!card) return null;

  // Dropping a card back where it started is not a move. Sending it anyway
  // would write an `application_events` row saying nothing happened.
  if (card.status === status) return null;

  return { id: activeId, status };
}

/**
 * The board's row order, matching the query exactly.
 *
 * `getBoardApplications` orders by `status_changed_at` then `id`, so this has
 * to as well — see below for what happens when the two disagree.
 *
 * Compared as instants rather than as strings: Postgres hands back
 * `2026-08-16T12:00:00.123456+00:00` while `toISOString()` produces
 * `2026-08-16T12:00:00.123Z`, and those two formats do not sort correctly
 * against each other character by character.
 */
function compareCards(a: BoardCard, b: BoardCard): number {
  const left = Date.parse(a.statusChangedAt);
  const right = Date.parse(b.statusChangedAt);
  if (left !== right) return left - right;
  // The same tie-break the query uses. An ordering with ties is not an
  // ordering: without this, tied cards could sit differently here than they
  // will when the server's rows arrive.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The board as it looks the instant a card is dropped.
 *
 * THIS RESORTS, and that is the whole point. Simply changing the card's status
 * left it at whatever index it already held, so it landed wherever it happened
 * to sit among the cards already in the target column. A moment later the
 * server's rows arrived, correctly ordered, and the card jumped again — one
 * drop, two different positions, the second one unexplained.
 *
 * Sorting here by the same rule the query uses means the optimistic board is
 * already the board the server is about to send, so revalidation changes
 * nothing visible.
 *
 * `movedAt` is passed in rather than read from the clock here so this stays a
 * pure function of its arguments — React may run an optimistic reducer more
 * than once, and a reducer that reads the time is a reducer that can produce
 * two different answers for one action.
 */
export function applyOptimisticMove(
  cards: BoardCard[],
  move: { id: string; status: ApplicationStatus },
  movedAt: string,
): BoardCard[] {
  return cards
    .map((card) =>
      card.id === move.id
        ? // `statusChangedAt` moves too, or the card would land in its new
          // column still claiming the eleven days it spent in the old one —
          // and would sort as though it had never been touched.
          { ...card, status: move.status, statusChangedAt: movedAt }
        : card,
    )
    .sort(compareCards);
}
