import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubteamRanking } from '../subteam-ranking';
import { addChoice } from '../ordered-choice-list';
import { softwarePosting, subteams } from '@/test/apply-fixtures';

/**
 * Subteam preference: at most `maxChoices`, each subteam once, in order.
 *
 * The server refuses a list that breaks either rule, and the refusal arrives
 * after everything else on a long form has been filled in. It has to be
 * impossible to build a bad list here.
 *
 * ONE LIST. Choices used to move between a "chosen" list and an "available"
 * one, so picking a subteam made two rows re-render somewhere else on the page
 * and everything below shifted. The list is now fixed; only the badge and the
 * row's own control change.
 */

/** The row a subteam occupies, chosen or not. */
function row(title: string): HTMLElement {
  const node = screen.getByText(title).closest('li');
  if (!node) throw new Error(`no row for ${title}`);
  return node as HTMLElement;
}

function titlesInOrder(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-choice-title]')?.textContent ?? '');
}

function setup(maxChoices: number, selected: string[] = [], minChoices = 0) {
  const posting = { ...softwarePosting(), ranking: { enabled: true, minChoices, maxChoices } };
  const onChange = jest.fn();
  const view = render(<SubteamRanking posting={posting} selected={selected} onChange={onChange} />);
  return { onChange, view, posting };
}

describe('how many to choose', () => {
  it('asks for an exact count when the floor meets the ceiling', () => {
    // "up to 2" invites one, and then the submit button refuses it. The
    // instruction has to say what the form will actually accept.
    setup(2, [], 2);
    expect(
      screen.getByRole('group', { name: "Select the top 2 subteams you're interested in" }),
    ).toBeInTheDocument();
  });

  it('asks for a range when the floor is lower than the ceiling', () => {
    setup(3, [], 1);
    expect(
      screen.getByRole('group', { name: "Select up to 3 subteams you're interested in" }),
    ).toBeInTheDocument();
  });

  it('says it once, in the legend', () => {
    // The legend asked which subteams, and a line under it said how many. Two
    // sentences for one instruction, the second of which repeated the first.
    setup(2, [], 2);

    expect(screen.queryByText(/most preferred first/)).not.toBeInTheDocument();
    expect(screen.queryByText(/are you most interested in/)).not.toBeInTheDocument();
  });
});

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

  // The dimmed, inert plus is the whole message. A sentence explaining that
  // the list is full said what the disabled buttons beside it already showed.
  expect(screen.getByRole('button', { name: /Add Boat Simulator/ })).toBeDisabled();
  expect(screen.queryByText(/You have chosen/)).not.toBeInTheDocument();
  // Dropping one has to stay possible, or the choice would be unchangeable.
  expect(screen.getByRole('button', { name: /Remove Pathfinding/ })).toBeEnabled();
});

it('announces the current order in a live region', () => {
  setup(3, [subteams[1].id, subteams[0].id]);

  expect(screen.getByText('1st: Network Systems · 2nd: Pathfinding')).toBeInTheDocument();
});

describe('one list', () => {
  it('keeps every subteam in place whether or not it is chosen', () => {
    setup(3, [subteams[2].id, subteams[0].id]);

    // Choosing the third and first must not float them to the top: a row that
    // moves takes the description someone was reading with it.
    expect(titlesInOrder()).toEqual(subteams.map((subteam) => subteam.name));
  });

  it('numbers a chosen subteam by its place in the order', () => {
    setup(3, [subteams[1].id, subteams[0].id]);

    expect(within(row('Network Systems')).getByText('1')).toBeInTheDocument();
    expect(within(row('Pathfinding')).getByText('2')).toBeInTheDocument();
  });

  it('numbers nothing that is unchosen', () => {
    setup(3, [subteams[0].id]);

    expect(within(row('Boat Simulator')).queryByText('2')).not.toBeInTheDocument();
  });

  it('gives each row exactly one control, chosen or not', () => {
    // One button that toggles, rather than an Add that is replaced by a
    // Remove, so the control never moves or changes size and the row stays put.
    setup(3, [subteams[0].id]);

    expect(within(row('Pathfinding')).getAllByRole('button')).toHaveLength(1);
    expect(within(row('Boat Simulator')).getAllByRole('button')).toHaveLength(1);
  });

  it('makes the numbered badge itself the control', () => {
    // The number and the thing you click are one element. A separate icon
    // button beside the badge meant two places per row saying the same thing,
    // and the badge — the part that looks like the state — was not clickable.
    setup(3, [subteams[1].id, subteams[0].id]);

    const control = within(row('Pathfinding')).getByRole('button', { name: /Remove Pathfinding/ });
    expect(control).toHaveTextContent('2');
  });

  it('offers no way to shuffle the order', () => {
    // Move up and move down were two buttons per row to express something the
    // pick order already says. Reordering is a remove and a re-pick.
    setup(3, [subteams[0].id, subteams[1].id]);

    expect(screen.queryByRole('button', { name: /Move/ })).not.toBeInTheDocument();
  });

  it('drops a subteam from the order without disturbing the rest', async () => {
    const { onChange } = setup(3, [subteams[0].id, subteams[1].id, subteams[2].id]);

    await userEvent.click(screen.getByRole('button', { name: /Remove Pathfinding/ }));

    expect(onChange).toHaveBeenCalledWith([subteams[1].id, subteams[2].id]);
  });
});

describe('the rules themselves', () => {
  it('refuses a duplicate pick', () => {
    expect(addChoice(['a', 'b'], 'a', 3)).toEqual(['a', 'b']);
  });

  it('refuses to go past maxChoices', () => {
    expect(addChoice(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
    expect(addChoice(['a'], 'c', 2)).toEqual(['a', 'c']);
  });
});
