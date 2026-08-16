import type { BoardCard } from '@/lib/applications/queries';
import { applyOptimisticMove, resolveMove } from '../moves';

/**
 * What a finished drag means.
 *
 * Every one of the "do nothing" cases below is a real drag a lead performs by
 * accident several times a day — releasing over the gap between columns,
 * thinking better of a move halfway through, dropping a card back where it
 * came from. Each one that leaked through would write an audit row recording a
 * move that did not happen.
 */

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'app-1',
    applicantName: 'Ada Bell',
    yearOfStudy: '2',
    homeDepartment: 'CPEN',
    firstChoiceSubteam: null,
    status: 'applied',
    statusChangedAt: '2026-08-05T12:00:00.000Z',
    noteCount: 0,
    assignedSubteamId: null,
    ...overrides,
  };
}

const cards = [card(), card({ id: 'app-2', status: 'offered' })];

it('moves a card to the column it was dropped on', () => {
  expect(resolveMove(cards, 'app-1', 'reviewing')).toEqual({ id: 'app-1', status: 'reviewing' });
});

it('moves a card to a terminal column like any other', () => {
  expect(resolveMove(cards, 'app-2', 'rejected')).toEqual({ id: 'app-2', status: 'rejected' });
});

it('does nothing when the card is dropped outside every column', () => {
  expect(resolveMove(cards, 'app-1', null)).toBeNull();
});

it('does nothing when the card is dropped back where it started', () => {
  // Otherwise the audit trail fills with moves from applied to applied.
  expect(resolveMove(cards, 'app-1', 'applied')).toBeNull();
});

it('does nothing for a card the board is no longer showing', () => {
  expect(resolveMove(cards, 'app-gone', 'reviewing')).toBeNull();
});

it('refuses a drop target that is not one of the eight columns', () => {
  // Nothing renders such a droppable today. Forwarding an arbitrary id to the
  // server because it happened to be registered is how that stops being true.
  expect(resolveMove(cards, 'app-1', 'trash')).toBeNull();
  expect(resolveMove(cards, 'app-1', '')).toBeNull();
});

/**
 * The optimistic board has to BE the board the server is about to send. When it
 * was not, a drop looked like two separate events: the card landed, then a
 * moment later the column reshuffled as the real rows arrived.
 */
describe('applyOptimisticMove', () => {
  const board: BoardCard[] = [
    card({ id: 'a', status: 'applied', statusChangedAt: '2026-08-01T00:00:00.000Z' }),
    card({ id: 'b', status: 'reviewing', statusChangedAt: '2026-08-02T00:00:00.000Z' }),
    card({ id: 'c', status: 'reviewing', statusChangedAt: '2026-08-03T00:00:00.000Z' }),
  ];
  const MOVED_AT = '2026-08-16T12:00:00.000Z';

  function idsIn(cards: BoardCard[], status: string) {
    return cards.filter((entry) => entry.status === status).map((entry) => entry.id);
  }

  it('puts the moved card at the end of its new column, where the query will', () => {
    // `a` moves into Reviewing. It is now the most recently touched card there,
    // so it belongs after `b` and `c` — not at the front, where it sat before.
    const next = applyOptimisticMove(board, { id: 'a', status: 'reviewing' }, MOVED_AT);
    expect(idsIn(next, 'reviewing')).toEqual(['b', 'c', 'a']);
  });

  it('gives the moved card the new status and timestamp', () => {
    const next = applyOptimisticMove(board, { id: 'a', status: 'reviewing' }, MOVED_AT);
    const moved = next.find((entry) => entry.id === 'a')!;
    expect(moved.status).toBe('reviewing');
    // Days-in-column restarts, and the card sorts as freshly touched.
    expect(moved.statusChangedAt).toBe(MOVED_AT);
  });

  it('leaves every other card untouched', () => {
    const next = applyOptimisticMove(board, { id: 'a', status: 'reviewing' }, MOVED_AT);
    expect(next.find((entry) => entry.id === 'b')).toEqual(board[1]);
    expect(next.find((entry) => entry.id === 'c')).toEqual(board[2]);
  });

  it('does not mutate the board it was given', () => {
    // The array comes from a prop. Sorting it in place would edit React's copy
    // of the server's data.
    const snapshot = board.map((entry) => ({ ...entry }));
    applyOptimisticMove(board, { id: 'a', status: 'reviewing' }, MOVED_AT);
    expect(board).toEqual(snapshot);
  });

  it('sorts Postgres timestamps against a browser one correctly', () => {
    // Postgres sends `+00:00` and toISOString gives `Z`. Compared as strings
    // rather than instants these sort wrongly, and the card lands in the wrong
    // place for exactly one revalidation.
    const mixed: BoardCard[] = [
      card({ id: 'pg', status: 'reviewing', statusChangedAt: '2026-08-16T12:00:00.123456+00:00' }),
      card({ id: 'x', status: 'applied', statusChangedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const next = applyOptimisticMove(
      mixed,
      { id: 'x', status: 'reviewing' },
      '2026-08-16T13:00:00.000Z',
    );
    expect(idsIn(next, 'reviewing')).toEqual(['pg', 'x']);
  });

  it('breaks a tie on id, the same way the query does', () => {
    const tied: BoardCard[] = [
      card({ id: 'z', status: 'reviewing', statusChangedAt: MOVED_AT }),
      card({ id: 'm', status: 'applied', statusChangedAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const next = applyOptimisticMove(tied, { id: 'm', status: 'reviewing' }, MOVED_AT);
    expect(idsIn(next, 'reviewing')).toEqual(['m', 'z']);
  });
});

it('gives one answer regardless of which sensor produced the drag', () => {
  // Pointer and keyboard drags both end here with the same two ids, so there is
  // no second implementation for them to disagree about.
  const fromPointer = resolveMove(cards, 'app-1', 'waitlisted');
  const fromKeyboard = resolveMove(cards, 'app-1', 'waitlisted');
  expect(fromKeyboard).toEqual(fromPointer);
  expect(fromKeyboard).toEqual({ id: 'app-1', status: 'waitlisted' });
});
