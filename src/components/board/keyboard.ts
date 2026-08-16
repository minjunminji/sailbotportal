import {
  KeyboardCode,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import type { ApplicationStatus } from '@/lib/applications/queries';
import { BOARD_COLUMNS } from './columns';

/**
 * Moving a card between columns with the keyboard.
 *
 * `dnd-kit`'s stock keyboard sensor nudges the dragged item 25 pixels per arrow
 * press and lets collision detection work out where that landed. On a form that
 * is fine. On a board whose columns are 288 pixels wide and which scrolls
 * sideways past eight of them, reaching `Rejected` from `Applied` is roughly
 * eighty key presses, several of them over columns the card was never meant to
 * visit.
 *
 * So the arrow keys move between COLUMNS, not between pixels: one press, one
 * column, in the order a candidate actually moves. This is the accessibility
 * feature the plan calls expensive to retrofit, and the reason is that it has
 * to be designed into the sensor rather than bolted on afterwards.
 */

/**
 * Which column the dragged card is currently over.
 *
 * `pointerWithin` asks which droppable contains the POINTER, which is the right
 * question for a mouse: a card is nearly as wide as a column, so a rectangle
 * test says a card that has barely left its own column still overlaps it most
 * and never registers the neighbour under the cursor.
 *
 * A KEYBOARD DRAG HAS NO POINTER. `pointerWithin` returns nothing at all, `over`
 * stays null, and the card lifts, announces itself, and drops exactly where it
 * started — which is what it did here until this function existed. Falling back
 * to `closestCenter`, which compares rectangles, gives the keyboard a real
 * answer while leaving the pointer behaviour untouched.
 */
export const boardCollisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

/**
 * The column `direction` places from `current`, or null at either end.
 *
 * Deliberately does not wrap. Wrapping would put `Applied` one press left of
 * `Rejected`, which is the single most destructive move on the board sitting
 * next to the most routine one.
 */
export function nextColumnStatus(
  current: ApplicationStatus,
  direction: -1 | 1,
): ApplicationStatus | null {
  const index = BOARD_COLUMNS.findIndex((column) => column.status === current);
  if (index === -1) return null;

  const target = index + direction;
  if (target < 0 || target >= BOARD_COLUMNS.length) return null;

  return BOARD_COLUMNS[target].status;
}

/**
 * Where the dragged card should jump to for a given arrow press.
 *
 * Returning `undefined` leaves the card where it is, which is what should
 * happen for a key this board does not handle and at either end of the row.
 */
export const boardCoordinateGetter: KeyboardCoordinateGetter = (event, { context }) => {
  const direction =
    event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
  if (direction === 0) return undefined;

  // Or the board scrolls sideways underneath the drag as well as moving it.
  event.preventDefault();

  // `over` once the card has been moved at least once; before that, the column
  // the card started in, which the draggable carries in its data.
  const current = (context.over?.id ?? context.active?.data.current?.status) as
    ApplicationStatus | undefined;
  if (!current) return undefined;

  const target = nextColumnStatus(current, direction);
  if (!target) return undefined;

  const rect = context.droppableContainers?.get(target)?.rect.current;
  if (!rect) return undefined;

  return {
    x: rect.left + rect.width / 2,
    // Near the top of the column rather than its middle: a tall column's centre
    // can sit below the fold, and dnd-kit scrolls to follow the pointer.
    y: rect.top + Math.min(rect.height / 2, 60),
  };
};
