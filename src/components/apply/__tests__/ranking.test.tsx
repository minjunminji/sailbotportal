import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubteamRanking } from '../subteam-ranking';
import { addChoice, moveChoice } from '../ordered-choice-list';
import { softwarePosting, subteams } from '@/test/apply-fixtures';

/**
 * Subteam preference: at most `maxChoices`, each subteam once, in order.
 *
 * The server refuses a list that breaks either rule, and the refusal arrives
 * after everything else on a long form has been filled in. It has to be
 * impossible to build a bad list here.
 */

function setup(maxChoices: number, selected: string[] = []) {
  const posting = { ...softwarePosting(), ranking: { enabled: true, maxChoices } };
  const onChange = jest.fn();
  const view = render(<SubteamRanking posting={posting} selected={selected} onChange={onChange} />);
  return { onChange, view, posting };
}

it('shows each subteam by name, code and description while choosing', () => {
  setup(3);

  expect(screen.getByText('Pathfinding')).toBeInTheDocument();
  expect(screen.getByText('PATH')).toBeInTheDocument();
  expect(
    screen.getByText('Works out an efficient route from start to finish.'),
  ).toBeInTheDocument();
});

it('adds a subteam in the order it was chosen', async () => {
  const { onChange } = setup(3, [subteams[1].id]);

  await userEvent.click(screen.getByRole('button', { name: /Add Pathfinding/ }));

  expect(onChange).toHaveBeenCalledWith([subteams[1].id, subteams[0].id]);
});

it('stops offering a subteam that is already chosen', () => {
  setup(3, [subteams[0].id]);

  expect(screen.queryByRole('button', { name: /Add Pathfinding/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Remove Pathfinding/ })).toBeInTheDocument();
});

it('disables the remaining choices at maxChoices', () => {
  setup(2, [subteams[0].id, subteams[1].id]);

  expect(screen.getByRole('button', { name: /Add Boat Simulator/ })).toBeDisabled();
  expect(screen.getByText(/You have chosen 2/)).toBeInTheDocument();
});

it('reorders with buttons rather than dragging', async () => {
  const { onChange } = setup(3, [subteams[0].id, subteams[1].id]);

  await userEvent.click(screen.getByRole('button', { name: /Move up Network Systems/ }));

  expect(onChange).toHaveBeenCalledWith([subteams[1].id, subteams[0].id]);
});

it('announces the current order in a live region', () => {
  setup(3, [subteams[1].id, subteams[0].id]);

  expect(screen.getByText('1st: Network Systems · 2nd: Pathfinding')).toBeInTheDocument();
});

describe('the rules themselves', () => {
  it('refuses a duplicate pick', () => {
    expect(addChoice(['a', 'b'], 'a', 3)).toEqual(['a', 'b']);
  });

  it('refuses to go past maxChoices', () => {
    expect(addChoice(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(addChoice(['a'], 'c', 2)).toEqual(['a', 'c']);
  });

  it('will not move an entry off either end', () => {
    expect(moveChoice(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(moveChoice(['a', 'b'], 'b', 1)).toEqual(['a', 'b']);
    expect(moveChoice(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  });
});
