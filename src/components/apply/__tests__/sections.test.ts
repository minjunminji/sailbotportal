import {
  applyData,
  mechanicalPosting,
  pathOnlyQuestion,
  softwarePosting,
  subteams,
} from '@/test/apply-fixtures';
import { formSections } from '../sections';
import { emptyFormState, type ApplyData, type FormState } from '../types';
import { validateForm } from '../validate';

/**
 * The rail's model. Every rule the rail states about progress lives here, so
 * this is where they are pinned down — the components on top only render what
 * this returns.
 */

/** The fixture form: Mechanical (1 required), then Software (2 required + ranking). */
function twoTeams(): ApplyData {
  return applyData([mechanicalPosting(), softwarePosting()]);
}

function withTeam(data: ApplyData, slug: string, selected: boolean): FormState {
  const state = emptyFormState(data);
  state.teams[slug] = { ...state.teams[slug], selected };
  return state;
}

function ids(data: ApplyData, state: FormState) {
  return formSections(data, state, []).map((section) => section.id);
}

function section(
  data: ApplyData,
  state: FormState,
  id: string,
  errors = validateForm(data, state),
) {
  const found = formSections(data, state, errors).find((entry) => entry.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
}

describe('which rows exist', () => {
  it('lists the fixed sections in form order when no team is chosen', () => {
    const data = twoTeams();
    expect(ids(data, emptyFormState(data))).toEqual([
      'about-you',
      'shared-questions',
      'team-selection',
    ]);
  });

  it("adds a team's row once its gate is Yes", () => {
    const data = twoTeams();
    expect(ids(data, withTeam(data, 'mech-2026', true))).toEqual([
      'about-you',
      'shared-questions',
      'team-selection',
      'answers-mech-2026',
    ]);
  });

  it('removes the row again when the gate goes back to No', () => {
    const data = twoTeams();
    expect(ids(data, withTeam(data, 'mech-2026', false))).not.toContain('answers-mech-2026');
  });

  it('orders team rows by the posting order, not by the order they were chosen', () => {
    const data = twoTeams();
    const state = withTeam(data, 'soft-2026', true);
    state.teams['mech-2026'] = { ...state.teams['mech-2026'], selected: true };

    expect(ids(data, state)).toEqual([
      'about-you',
      'shared-questions',
      'team-selection',
      'answers-mech-2026',
      'answers-soft-2026',
    ]);
  });

  it('omits the shared questions row when the form asks none', () => {
    const data: ApplyData = { coreQuestions: [], postings: [mechanicalPosting()] };
    expect(ids(data, emptyFormState(data))).not.toContain('shared-questions');
  });
});

describe('what the count counts', () => {
  it('counts the five identity fields plus the resume in About you', () => {
    const data = twoTeams();
    expect(section(data, emptyFormState(data), 'about-you')).toMatchObject({
      answered: 0,
      total: 6,
    });
  });

  it('counts only required questions, so optional ones cannot hold a section short', () => {
    // The Software fixture carries eight questions, six of them optional.
    const data = twoTeams();
    const state = withTeam(data, 'soft-2026', true);

    // Two required questions, plus the subteam ranking.
    expect(section(data, state, 'answers-soft-2026').total).toBe(3);
  });

  it('counts the subteam ranking as an item, but only where the posting enables it', () => {
    const data = twoTeams();
    const mech = section(data, withTeam(data, 'mech-2026', true), 'answers-mech-2026');

    // Mechanical asks one required question and does not rank subteams.
    expect(mech.total).toBe(1);
  });

  it('leaves a question the ranking has hidden out of the denominator', () => {
    const data = applyData([softwarePosting([pathOnlyQuestion])]);
    const state = withTeam(data, 'soft-2026', true);

    // `pathOnlyQuestion` is asked only of someone ranking pathfinding in their
    // top two. Nothing is ranked yet, so it is not on screen — and a count that
    // demanded it would ask for an answer the form gives no way to give.
    expect(section(data, state, 'answers-soft-2026').total).toBe(1); // the ranking alone

    state.teams['soft-2026'] = {
      ...state.teams['soft-2026'],
      rankedSubteams: [subteams[0].id],
    };
    expect(section(data, state, 'answers-soft-2026').total).toBe(2);
  });
});

describe('what counts as answered', () => {
  it('counts an identity field once it is filled', () => {
    const data = twoTeams();
    const state = emptyFormState(data);
    state.name = 'Sam Rivers';
    state.email = 'sam@student.ubc.ca';

    expect(section(data, state, 'about-you').answered).toBe(2);
  });

  it('does not count an answer its own question would reject', () => {
    // `project` requires at least three words. Something typed but too short is
    // not progress: the count promises what is left before submitting, and this
    // would still block a submit.
    const data = twoTeams();
    const state = withTeam(data, 'soft-2026', true);
    state.teams['soft-2026'].answers = { project: 'Boats.' };

    expect(section(data, state, 'answers-soft-2026').answered).toBe(0);

    state.teams['soft-2026'].answers = { project: 'I built a boat once' };
    expect(section(data, state, 'answers-soft-2026').answered).toBe(1);
  });

  it('treats choosing at least one team as answering Choose teams', () => {
    const data = twoTeams();
    expect(section(data, emptyFormState(data), 'team-selection').answered).toBe(0);
    expect(section(data, withTeam(data, 'mech-2026', true), 'team-selection').answered).toBe(1);
  });

  it('counts an uploaded resume as one more answer in About you', () => {
    const data = twoTeams();
    const state = emptyFormState(data);
    expect(section(data, state, 'about-you').answered).toBe(0);

    state.resume = { path: 'resume/x.pdf', filename: 'cv.pdf', size: 10 };
    expect(section(data, state, 'about-you').answered).toBe(1);
  });
});

describe('errors', () => {
  it('marks the section holding a failed question, and only that one', () => {
    const data = twoTeams();
    const state = withTeam(data, 'soft-2026', true);
    state.teams['mech-2026'] = { ...state.teams['mech-2026'], selected: true };

    // Everything blank, so every section has something to report except the one
    // that is already satisfied by choosing teams at all.
    const errors = validateForm(data, state);

    expect(section(data, state, 'answers-soft-2026', errors).invalid).toBe(true);
    expect(section(data, state, 'answers-mech-2026', errors).invalid).toBe(true);
    expect(section(data, state, 'team-selection', errors).invalid).toBe(false);
  });

  it('is clean before anything has been submitted', () => {
    const data = twoTeams();
    const state = withTeam(data, 'mech-2026', true);

    // No errors passed in — the rail must not accuse anyone of anything until
    // they have actually tried to submit.
    expect(formSections(data, state, []).every((entry) => !entry.invalid)).toBe(true);
  });

  it('routes a ranking error to its team rather than to Choose teams', () => {
    const data = twoTeams();
    const state = withTeam(data, 'soft-2026', true);
    const errors = [
      { fieldId: 'ranking-soft-2026', label: 'Subteams', message: 'Rank at least one' },
    ];

    expect(section(data, state, 'answers-soft-2026', errors).invalid).toBe(true);
    expect(section(data, state, 'team-selection', errors).invalid).toBe(false);
  });

  it("routes a team's own gate error to Choose teams", () => {
    const data = twoTeams();
    const state = emptyFormState(data);
    const errors = [{ fieldId: 'team-selection', label: 'Teams', message: 'Choose at least one' }];

    expect(section(data, state, 'team-selection', errors).invalid).toBe(true);
  });
});
