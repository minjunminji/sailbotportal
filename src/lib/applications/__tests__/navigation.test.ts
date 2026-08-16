import type { BoardCard } from '../queries';
import { boardApplicationIds, navigationHrefs, neighboursOf } from '../navigation';

function card(id: string, status: BoardCard['status']): BoardCard {
  return {
    id,
    applicantName: id,
    yearOfStudy: '2',
    homeDepartment: 'CPEN',
    firstChoiceSubteam: null,
    status,
    statusChangedAt: '2026-08-16T12:00:00.000Z',
    noteCount: 0,
    assignedSubteamId: null,
  };
}

it('orders applicants by board columns and then card order within each column', () => {
  const cards = [
    card('offered-first', 'offered'),
    card('applied-first', 'applied'),
    card('reviewing-first', 'reviewing'),
    card('applied-second', 'applied'),
    card('offered-second', 'offered'),
  ];

  expect(boardApplicationIds(cards)).toEqual([
    'applied-first',
    'applied-second',
    'reviewing-first',
    'offered-first',
    'offered-second',
  ]);
});

it('returns previous and next IDs with disabled endpoints', () => {
  const ids = ['first', 'middle', 'last'];

  expect(neighboursOf(ids, 'first')).toEqual({ previousId: null, nextId: 'middle' });
  expect(neighboursOf(ids, 'middle')).toEqual({ previousId: 'first', nextId: 'last' });
  expect(neighboursOf(ids, 'last')).toEqual({ previousId: 'middle', nextId: null });
  expect(neighboursOf(ids, 'not-filtered')).toEqual({ previousId: null, nextId: null });
});

it('preserves canonical board filters in both arrow links', () => {
  expect(
    navigationHrefs(
      'soft',
      { previousId: 'previous', nextId: 'next' },
      'subteam=sub-path&from=2026-08-01&q=Ada+Bell',
    ),
  ).toEqual({
    previousHref: '/admin/soft/applications/previous?subteam=sub-path&from=2026-08-01&q=Ada+Bell',
    nextHref: '/admin/soft/applications/next?subteam=sub-path&from=2026-08-01&q=Ada+Bell',
  });
});
