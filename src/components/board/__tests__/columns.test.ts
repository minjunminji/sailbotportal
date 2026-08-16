import { APPLICATION_STATUSES, type BoardCard } from '@/lib/applications/queries';
import {
  BOARD_COLUMNS,
  DEFAULT_COLLAPSED,
  KNOWN_YEAR_ORDINALS,
  daysInColumn,
  daysInColumnLabel,
  groupByStatus,
  shortYearLabel,
} from '../columns';

/**
 * The board's arithmetic and its configuration, away from any React.
 *
 * These are the parts that go wrong silently: a status that has no column is
 * invisible rather than broken, and a days-in-column that is off by one is
 * indistinguishable from a correct one until someone is left unreviewed.
 */

function card(overrides: Partial<BoardCard>): BoardCard {
  return {
    id: 'id',
    applicantName: 'Ada Bell',
    yearOfStudy: '2',
    homeDepartment: 'CPEN',
    firstChoiceSubteam: null,
    status: 'applied',
    statusChangedAt: '2026-08-01T00:00:00.000Z',
    noteCount: 0,
    assignedSubteamId: null,
    ...overrides,
  };
}

describe('column configuration', () => {
  it('gives every status exactly one column', () => {
    // The failure this prevents: a ninth status is added to the query layer and
    // its applicants stop appearing anywhere, with nothing to see in the UI.
    expect(BOARD_COLUMNS.map((column) => column.status)).toEqual([...APPLICATION_STATUSES]);
  });

  it('puts Rejected last, where it is read least', () => {
    expect(BOARD_COLUMNS[BOARD_COLUMNS.length - 1].status).toBe('rejected');
  });

  it('starts with the two terminal columns folded and no others', () => {
    expect([...DEFAULT_COLLAPSED].sort()).toEqual(['rejected', 'waitlisted']);
  });

  it('collapses only statuses that have a column', () => {
    for (const status of DEFAULT_COLLAPSED) {
      expect(BOARD_COLUMNS.some((column) => column.status === status)).toBe(true);
    }
  });
});

describe('year labels', () => {
  it('has a short label for every year the form offers', () => {
    // Keeps this file in step with YEAR_OF_STUDY_OPTIONS. Without it, adding a
    // year to the form leaves the board rendering a bare 'phd'.
    for (const ordinal of KNOWN_YEAR_ORDINALS) {
      expect(shortYearLabel(ordinal)).not.toBe(ordinal);
    }
  });

  it('shortens the ones a card has no room for', () => {
    expect(shortYearLabel('1')).toBe('1st yr');
    expect(shortYearLabel('5')).toBe('5th yr+');
    expect(shortYearLabel('phd')).toBe('PhD');
  });

  it('falls back to the stored value rather than rendering nothing', () => {
    expect(shortYearLabel('exchange')).toBe('exchange');
  });
});

describe('days in column', () => {
  it('counts whole days elapsed', () => {
    expect(daysInColumn('2026-08-01T00:00:00.000Z', '2026-08-12T00:00:00.000Z')).toBe(11);
  });

  it('is zero on the day of the move', () => {
    expect(daysInColumn('2026-08-12T01:00:00.000Z', '2026-08-12T23:00:00.000Z')).toBe(0);
  });

  it('does not round a partial day up', () => {
    // 23 hours is not a day. Rounding here would report a candidate as
    // untouched for longer than they have been.
    expect(daysInColumn('2026-08-11T02:00:00.000Z', '2026-08-12T01:00:00.000Z')).toBe(0);
  });

  it('clamps a future timestamp to zero', () => {
    // Clock skew between Postgres and the web server is real, and '-1 days' on
    // a card reads as a bug in the app.
    expect(daysInColumn('2026-08-13T00:00:00.000Z', '2026-08-12T00:00:00.000Z')).toBe(0);
  });

  it('survives an unparseable timestamp', () => {
    expect(daysInColumn('not a date', '2026-08-12T00:00:00.000Z')).toBe(0);
  });

  it('reads as a duration', () => {
    expect(daysInColumnLabel(0)).toBe('Today');
    expect(daysInColumnLabel(1)).toBe('1 day');
    expect(daysInColumnLabel(11)).toBe('11 days');
  });
});

describe('grouping', () => {
  it('keeps an entry for every column, including the empty ones', () => {
    // The empty arrays are what make an empty column render, and an empty
    // column is the only way a status ever receives its first card.
    const grouped = groupByStatus([]);
    expect(Object.keys(grouped).sort()).toEqual([...APPLICATION_STATUSES].sort());
    for (const status of APPLICATION_STATUSES) {
      expect(grouped[status]).toEqual([]);
    }
  });

  it('puts each card in its own status', () => {
    const grouped = groupByStatus([
      card({ id: 'a', status: 'applied' }),
      card({ id: 'b', status: 'offered' }),
      card({ id: 'c', status: 'applied' }),
    ]);

    expect(grouped.applied.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(grouped.offered.map((entry) => entry.id)).toEqual(['b']);
    expect(grouped.rejected).toEqual([]);
  });

  it('preserves the order the query returned', () => {
    // The query sorts oldest-in-column first, which is the whole point of the
    // ordering. Grouping must not quietly reshuffle it.
    const grouped = groupByStatus([
      card({ id: 'first', status: 'reviewing' }),
      card({ id: 'second', status: 'reviewing' }),
      card({ id: 'third', status: 'reviewing' }),
    ]);

    expect(grouped.reviewing.map((entry) => entry.id)).toEqual(['first', 'second', 'third']);
  });

  it('drops a status that has no column rather than inventing one', () => {
    const grouped = groupByStatus([card({ id: 'x', status: 'withdrawn' as never })]);
    expect(Object.keys(grouped).sort()).toEqual([...APPLICATION_STATUSES].sort());
    expect(Object.values(grouped).flat()).toEqual([]);
  });
});
