import { applyData, softwarePosting, subteams } from '@/test/apply-fixtures';
import { formSections } from '../sections';
import { emptyFormState, type ApplyData, type FormState } from '../types';
import { validateForm } from '../validate';

/**
 * A ranking has a floor as well as a ceiling.
 *
 * It only ever had a ceiling, which left the form saying two different things:
 * the rail counted the ranking as a required item, and nothing — not
 * `validateForm`, not the server — stopped a Software application being sent
 * with no subteams ranked at all. `minChoices` is what makes the rail's count
 * true.
 */

const RANKING_FIELD = 'ranking-soft-2026';

/** Software, ranking `minChoices`..`maxChoices`, with `ranked` already chosen. */
function form(
  { min, max }: { min: number; max: number },
  ranked: string[],
): { data: ApplyData; state: FormState } {
  const posting = {
    ...softwarePosting(),
    ranking: { enabled: true, minChoices: min, maxChoices: max },
  };
  const data = applyData([posting]);
  const state = emptyFormState(data);
  state.teams['soft-2026'] = {
    ...state.teams['soft-2026'],
    selected: true,
    rankedSubteams: ranked,
  };
  return { data, state };
}

function rankingError(data: ApplyData, state: FormState): string | undefined {
  return validateForm(data, state).find((error) => error.fieldId === RANKING_FIELD)?.message;
}

describe('validation', () => {
  it('asks for the missing choices when too few are ranked', () => {
    const { data, state } = form({ min: 2, max: 2 }, [subteams[0].id]);
    expect(rankingError(data, state)).toBe('Choose your top 2 subteams');
  });

  it('asks when none are ranked at all', () => {
    const { data, state } = form({ min: 2, max: 2 }, []);
    expect(rankingError(data, state)).toBe('Choose your top 2 subteams');
  });

  it('is satisfied once the floor is met', () => {
    const { data, state } = form({ min: 2, max: 2 }, [subteams[0].id, subteams[1].id]);
    expect(rankingError(data, state)).toBeUndefined();
  });

  it('says nothing about a team whose ranking is switched off', () => {
    const posting = {
      ...softwarePosting(),
      ranking: { enabled: false, minChoices: 2, maxChoices: 2 },
    };
    const data = applyData([posting]);
    const state = emptyFormState(data);
    state.teams['soft-2026'] = { ...state.teams['soft-2026'], selected: true };

    expect(rankingError(data, state)).toBeUndefined();
  });

  it('says nothing about a team nobody applied to', () => {
    const { data, state } = form({ min: 2, max: 2 }, []);
    state.teams['soft-2026'] = { ...state.teams['soft-2026'], selected: false };

    expect(rankingError(data, state)).toBeUndefined();
  });

  it('phrases a floor of one in the singular', () => {
    const { data, state } = form({ min: 1, max: 2 }, []);
    expect(rankingError(data, state)).toBe('Choose your top subteam');
  });
});

describe('the rail', () => {
  function rankingCount(data: ApplyData, state: FormState) {
    const row = formSections(data, state, []).find((entry) => entry.id === 'answers-soft-2026');
    if (!row) throw new Error('no software row');
    return row;
  }

  it('does not count a half-filled ranking as answered', () => {
    // The rail may not claim progress the submit button would refuse.
    const { data, state } = form({ min: 2, max: 2 }, [subteams[0].id]);
    const full = form({ min: 2, max: 2 }, [subteams[0].id, subteams[1].id]);

    expect(rankingCount(data, state).answered).toBe(
      rankingCount(full.data, full.state).answered - 1,
    );
  });
});
