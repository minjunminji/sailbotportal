import type { BoardCard } from '@/lib/applications/queries';
import { resolveMove } from '../moves';

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

it('gives one answer regardless of which sensor produced the drag', () => {
  // Pointer and keyboard drags both end here with the same two ids, so there is
  // no second implementation for them to disagree about.
  const fromPointer = resolveMove(cards, 'app-1', 'waitlisted');
  const fromKeyboard = resolveMove(cards, 'app-1', 'waitlisted');
  expect(fromKeyboard).toEqual(fromPointer);
  expect(fromKeyboard).toEqual({ id: 'app-1', status: 'waitlisted' });
});
