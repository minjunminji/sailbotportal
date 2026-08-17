import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mechanicalPosting, softwarePosting } from '@/test/apply-fixtures';
import { TeamSelector } from '../team-selector';
import { emptyTeamState, type ApplyPosting } from '../types';

/**
 * Choosing teams is one multi-select question, not three yes/no questions.
 *
 * The form used to ask "Do you want to apply to X?" separately per team, with an
 * explicit No — a shape inherited from Google Forms, which needs something to
 * branch on and cannot branch on a multi-select. Nothing downstream ever read
 * the difference between "No" and "not yet decided": every consumer filters on
 * `selected` being truthy, and `buildSubmission` sends only chosen teams. So the
 * third state was recorded and never asked about, and six controls did the work
 * of three.
 */

const noErrors = new Map<string, string>();

/** Two paragraphs: the first is the card face, the rest is behind the fold. */
function mech(): ApplyPosting {
  return {
    ...mechanicalPosting(),
    description: 'We build the boat itself.\n\nThe hull, keel, rudder and sail.',
  };
}

function soft(): ApplyPosting {
  return {
    ...softwarePosting(),
    description: 'We build the autonomy stack.\n\nPathfinding, controls and simulation.',
  };
}

function selector(props: Partial<Parameters<typeof TeamSelector>[0]> = {}) {
  return render(
    <TeamSelector
      postings={[mech(), soft()]}
      teams={{ 'mech-2026': emptyTeamState(), 'soft-2026': emptyTeamState() }}
      errors={noErrors}
      onSelect={() => {}}
      {...props}
    />,
  );
}

describe('the control', () => {
  it('asks once, with a checkbox per team', () => {
    const { container } = selector();

    const section = container.querySelector('#team-selection');
    expect(section).toBeInTheDocument();
    expect(section!.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    // The yes/no pairs are gone, not merely restyled.
    expect(section!.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  it('names each checkbox by its team and nothing else', () => {
    selector();
    // The summary sits inside the label for the click target's sake. Left to
    // compute its own name, the checkbox would announce as "Mechanical We build
    // the boat itself." — the same children-joined-by-spaces trap the rail hit.
    expect(screen.getByRole('checkbox', { name: 'Mechanical' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Software' })).toBeInTheDocument();
  });

  it('reads the summary out as the checkbox description', () => {
    selector();
    expect(screen.getByRole('checkbox', { name: 'Mechanical' })).toHaveAccessibleDescription(
      'We build the boat itself.',
    );
  });

  it('reports a team being chosen', async () => {
    const onSelect = jest.fn();
    selector({ onSelect });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Software' }));
    expect(onSelect).toHaveBeenCalledWith('soft-2026', true);
  });

  it('reports a team being dropped', async () => {
    const onSelect = jest.fn();
    selector({
      onSelect,
      teams: {
        'mech-2026': emptyTeamState(),
        'soft-2026': { ...emptyTeamState(), selected: true },
      },
    });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Software' }));
    expect(onSelect).toHaveBeenCalledWith('soft-2026', false);
  });

  it('lists teams in posting order', () => {
    selector();
    const names = screen.getAllByRole('checkbox').map((box) => box.getAttribute('value'));
    expect(names).toEqual(['mech-2026', 'soft-2026']);
  });
});

describe('the description', () => {
  it('shows the first paragraph on the card face', () => {
    selector();
    expect(screen.getByText('We build the boat itself.')).toBeVisible();
  });

  it('keeps the rest folded away until it is asked for', async () => {
    selector();

    // `details` without `open` hides its content, which is the whole point:
    // three teams' worth of prose should not be the first thing between an
    // applicant and the decision.
    const detail = screen.getByText('The hull, keel, rudder and sail.');
    expect(detail.closest('details')).not.toHaveAttribute('open');

    await userEvent.click(screen.getByText('More about Mechanical'));
    expect(detail.closest('details')).toHaveAttribute('open');
  });

  it('does not select the team when the disclosure is opened', async () => {
    const onSelect = jest.fn();
    selector({ onSelect });

    // The trap this layout exists to avoid: a label wrapping the whole card
    // makes the disclosure a second, invisible way to tick the box.
    await userEvent.click(screen.getByText('More about Mechanical'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers no disclosure when there is nothing behind it', () => {
    selector({ postings: [{ ...mech(), description: 'One line only.' }] });
    expect(screen.queryByText(/More about/)).not.toBeInTheDocument();
  });
});

describe('errors', () => {
  it('shows the one error the form can raise here', () => {
    selector({ errors: new Map([['team-selection', 'Choose at least one team to apply to']]) });
    expect(screen.getByText('Choose at least one team to apply to')).toBeInTheDocument();
  });
});
