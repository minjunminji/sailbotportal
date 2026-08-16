import { KeyboardCode } from '@dnd-kit/core';
import { boardCoordinateGetter, nextColumnStatus } from '../keyboard';
import { BOARD_COLUMNS } from '../columns';

/**
 * Keyboard movement between columns.
 *
 * This is the rule the whole accessibility story rests on, and it is pure, so
 * it is tested here rather than through a simulated drag. What a real key press
 * does on a real board is the sensor's job; what "one column to the right"
 * means is this file's.
 */

describe('nextColumnStatus', () => {
  it('moves one column at a time, in board order', () => {
    expect(nextColumnStatus('applied', 1)).toBe('reviewing');
    expect(nextColumnStatus('reviewing', 1)).toBe('interview_email_sent');
    expect(nextColumnStatus('reviewing', -1)).toBe('applied');
  });

  it('walks the whole board left to right and back', () => {
    const forwards: string[] = ['applied'];
    let cursor = nextColumnStatus('applied', 1);
    while (cursor) {
      forwards.push(cursor);
      cursor = nextColumnStatus(cursor, 1);
    }

    expect(forwards).toEqual(BOARD_COLUMNS.map((column) => column.status));
  });

  it('stops at both ends rather than wrapping', () => {
    // Wrapping would put Applied one press to the left of Rejected — the most
    // destructive move on the board next to the most routine one.
    expect(nextColumnStatus('applied', -1)).toBeNull();
    expect(nextColumnStatus('rejected', 1)).toBeNull();
  });

  it('returns null for a status with no column', () => {
    expect(nextColumnStatus('withdrawn' as never, 1)).toBeNull();
  });
});

/** A droppable container map shaped like the one dnd-kit passes in. */
function contextWith(over: string | null, activeStatus?: string) {
  const rects: Record<string, DOMRect> = {};
  BOARD_COLUMNS.forEach((column, index) => {
    rects[column.status] = {
      left: index * 300,
      top: 100,
      width: 288,
      height: 400,
    } as DOMRect;
  });

  return {
    active: activeStatus ? { data: { current: { status: activeStatus } } } : null,
    over: over ? { id: over } : null,
    droppableContainers: {
      get: (id: string) => (rects[id] ? { rect: { current: rects[id] } } : undefined),
    },
  };
}

function press(code: string, context: ReturnType<typeof contextWith>) {
  const event = { code, preventDefault: jest.fn() } as unknown as KeyboardEvent;
  // The sensor's own arguments; only `context` is read by this getter.
  const result = boardCoordinateGetter(event, {
    context,
    currentCoordinates: { x: 0, y: 0 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { result, event };
}

describe('boardCoordinateGetter', () => {
  it('aims at the centre of the next column', () => {
    const { result } = press(KeyboardCode.Right, contextWith('applied'));
    // Reviewing sits at left 300, width 288.
    expect(result).toEqual({ x: 300 + 144, y: 100 + 60 });
  });

  it('aims at the previous column going left', () => {
    const { result } = press(KeyboardCode.Left, contextWith('reviewing'));
    expect(result).toEqual({ x: 144, y: 160 });
  });

  it('uses the card’s own column before it has been moved at all', () => {
    // At drag start there is no `over` yet. Without the fallback the first key
    // press would do nothing and the card would appear stuck.
    const { result } = press(KeyboardCode.Right, contextWith(null, 'applied'));
    expect(result).toEqual({ x: 444, y: 160 });
  });

  it('stays put at the ends of the board', () => {
    expect(press(KeyboardCode.Left, contextWith('applied')).result).toBeUndefined();
    expect(press(KeyboardCode.Right, contextWith('rejected')).result).toBeUndefined();
  });

  it('ignores keys that are not left or right', () => {
    for (const code of [KeyboardCode.Up, KeyboardCode.Down, KeyboardCode.Space]) {
      const { result, event } = press(code, contextWith('applied'));
      expect(result).toBeUndefined();
      // Space and Enter must reach the sensor, or a card could never be picked
      // up or dropped.
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });

  it('stops the board scrolling sideways under the drag', () => {
    const { event } = press(KeyboardCode.Right, contextWith('applied'));
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('does nothing when the target column is not rendered', () => {
    const context = contextWith('applied');
    context.droppableContainers.get = () => undefined;
    expect(press(KeyboardCode.Right, context).result).toBeUndefined();
  });
});
