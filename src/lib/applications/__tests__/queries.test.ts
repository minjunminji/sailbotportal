import {
  BOARD_FILTER_PARAMS,
  EMPTY_BOARD_FILTERS,
  parseBoardFilters,
  serialiseBoardFilters,
  type BoardFilters,
} from '../queries';

/**
 * The board page and the detail view's prev/next both build their query from
 * the URL. If they disagree about what the URL means, prev/next walks a
 * different set from the one on screen — the card after "Jane" is someone the
 * board is not showing — so these two functions are the contract that keeps
 * them the same, and this is where that contract is pinned down.
 */

const SUBTEAM = '3f0c6e1a-4b2d-4c8e-9a11-7d5e2f8b6c40';

function params(init: Record<string, string> | string): URLSearchParams {
  return new URLSearchParams(init);
}

describe('parseBoardFilters', () => {
  it('reads every filter from URLSearchParams', () => {
    expect(
      parseBoardFilters(
        params({ subteam: SUBTEAM, from: '2026-01-01', to: '2026-02-28', q: 'jane' }),
      ),
    ).toEqual({
      firstChoiceSubteamId: SUBTEAM,
      submittedFrom: '2026-01-01',
      submittedTo: '2026-02-28',
      search: 'jane',
    });
  });

  it('reads the same filters from a Next searchParams object', () => {
    // Next hands a page a plain object whose values may be arrays. Both shapes
    // have to mean the same thing, or the board and prev/next diverge purely
    // because one was handed the object and the other a URLSearchParams.
    expect(parseBoardFilters({ subteam: SUBTEAM, q: 'jane', from: undefined })).toEqual({
      ...EMPTY_BOARD_FILTERS,
      firstChoiceSubteamId: SUBTEAM,
      search: 'jane',
    });
  });

  it('returns no filters for an empty URL', () => {
    expect(parseBoardFilters(params({}))).toEqual(EMPTY_BOARD_FILTERS);
  });

  it('ignores unknown parameters rather than passing them through', () => {
    const filters = parseBoardFilters(
      params({
        q: 'jane',
        status: 'rejected',
        order: 'applicant_email.desc',
        limit: '1000',
        select: '*',
        posting_id: 'eq.something',
      }),
    );

    expect(filters).toEqual({ ...EMPTY_BOARD_FILTERS, search: 'jane' });

    // And they do not survive a round trip, so a pasted link cannot smuggle a
    // parameter into the next URL the board builds.
    expect([...serialiseBoardFilters(filters).keys()]).toEqual(['q']);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseBoardFilters(params('q=first&q=second')).search).toBe('first');
    expect(parseBoardFilters({ q: ['first', 'second'] }).search).toBe('first');
  });

  it('treats blank and whitespace-only values as absent', () => {
    expect(parseBoardFilters(params({ q: '   ', from: '', subteam: ' ' }))).toEqual(
      EMPTY_BOARD_FILTERS,
    );
  });

  it('trims surrounding whitespace from the search term', () => {
    expect(parseBoardFilters(params({ q: '  jane chen  ' })).search).toBe('jane chen');
  });

  it('caps the search term rather than forwarding an arbitrary payload', () => {
    const long = 'a'.repeat(500);
    expect(parseBoardFilters(params({ q: long })).search).toHaveLength(100);
  });

  it('drops a subteam that is not a uuid', () => {
    // A bad link should render an unfiltered board, not a Postgres type error.
    for (const bad of ['all', '123', `${SUBTEAM}x`, 'eq.null']) {
      expect(parseBoardFilters(params({ subteam: bad })).firstChoiceSubteamId).toBeNull();
    }
  });

  it('drops dates that are not real calendar days', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', 'yesterday', '2026']) {
      expect(parseBoardFilters(params({ from: bad })).submittedFrom).toBeNull();
      expect(parseBoardFilters(params({ to: bad })).submittedTo).toBeNull();
    }
  });

  it('keeps a leap day', () => {
    expect(parseBoardFilters(params({ from: '2028-02-29' })).submittedFrom).toBe('2028-02-29');
  });
});

describe('serialiseBoardFilters', () => {
  it('omits filters that are not set', () => {
    expect(serialiseBoardFilters(EMPTY_BOARD_FILTERS).toString()).toBe('');
  });

  it('writes the documented parameter names', () => {
    const filters: BoardFilters = {
      firstChoiceSubteamId: SUBTEAM,
      submittedFrom: '2026-01-01',
      submittedTo: '2026-02-28',
      search: 'jane chen',
    };

    const serialised = serialiseBoardFilters(filters);
    expect(serialised.get(BOARD_FILTER_PARAMS.firstChoiceSubteamId)).toBe(SUBTEAM);
    expect(serialised.get(BOARD_FILTER_PARAMS.submittedFrom)).toBe('2026-01-01');
    expect(serialised.get(BOARD_FILTER_PARAMS.submittedTo)).toBe('2026-02-28');
    expect(serialised.get(BOARD_FILTER_PARAMS.search)).toBe('jane chen');
  });

  it('orders keys the same way every time', () => {
    // A URL that reshuffles its own parameters between navigations looks broken
    // and makes browser history useless for going back to a filtered board.
    const filters: BoardFilters = {
      search: 'jane',
      submittedTo: '2026-02-28',
      firstChoiceSubteamId: SUBTEAM,
      submittedFrom: '2026-01-01',
    };
    expect(serialiseBoardFilters(filters).toString()).toBe(
      serialiseBoardFilters({ ...filters }).toString(),
    );
    expect([...serialiseBoardFilters(filters).keys()]).toEqual(['subteam', 'from', 'to', 'q']);
  });

  it('round-trips through parse unchanged', () => {
    const filters: BoardFilters = {
      firstChoiceSubteamId: SUBTEAM,
      submittedFrom: '2026-01-01',
      submittedTo: '2026-02-28',
      search: 'a_b + c%',
    };
    expect(parseBoardFilters(serialiseBoardFilters(filters))).toEqual(filters);
  });
});
