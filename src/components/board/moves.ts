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
