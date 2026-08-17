import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mechanicalPosting, softwarePosting } from '@/test/apply-fixtures';
import { teamSectionId } from '../sections';
import { TeamGates } from '../team-gates';
import { TeamQuestions } from '../team-questions';
import { emptyTeamState, type TeamState } from '../types';

/**
 * Gates and questions were one component. They are two because the rail needs a
 * permanent anchor for choosing teams — a team that has not been chosen has no
 * row of its own to point at.
 */

const noErrors = new Map<string, string>();

function gates(props: Partial<Parameters<typeof TeamGates>[0]> = {}) {
  return render(
    <TeamGates
      postings={[mechanicalPosting(), softwarePosting()]}
      teams={{ 'mech-2026': emptyTeamState(), 'soft-2026': emptyTeamState() }}
      errors={noErrors}
      onSelect={() => {}}
      {...props}
    />,
  );
}

function questions(state: TeamState = emptyTeamState()) {
  return render(
    <TeamQuestions
      posting={softwarePosting()}
      state={state}
      errors={noErrors}
      onRank={() => {}}
      onAnswer={() => {}}
    />,
  );
}

describe('the gates', () => {
  it('gathers every gate into the one section the rail anchors to', () => {
    const { container } = gates();

    const section = container.querySelector('#team-selection');
    expect(section).toBeInTheDocument();
    // Both gates live inside it, so "Choose teams" is a single place rather
    // than three scattered decisions.
    expect(section!.querySelectorAll('input[type="radio"]')).toHaveLength(4);
  });

  it('keeps each team description beside its own gate, where the decision is made', () => {
    gates();
    expect(screen.getByText('We build the boat.')).toBeInTheDocument();
    expect(screen.getByText('We build the autonomy stack.')).toBeInTheDocument();
  });

  it('reports which team was chosen', async () => {
    const onSelect = jest.fn();
    gates({ onSelect });

    await userEvent.click(screen.getAllByLabelText('Yes')[1]);
    expect(onSelect).toHaveBeenCalledWith('soft-2026', true);
  });

  it('offers gates in posting order, not in the order teams were added', () => {
    gates();
    const legends = screen.getAllByText(/Do you want to apply/).map((node) => node.textContent);
    expect(legends[0]).toMatch(/Mechanical/);
    expect(legends[1]).toMatch(/Software/);
  });
});

describe("a team's questions", () => {
  it('lives under the id the rail links to', () => {
    const { container } = questions();
    expect(container.querySelector(`#${teamSectionId('soft-2026')}`)).toBeInTheDocument();
  });

  it('does not reuse the gate id, which would break both sets of anchor links', () => {
    const { container } = questions();
    // `team-soft-2026` belongs to the gate fieldset over in TeamGates.
    expect(container.querySelector('#team-soft-2026')).not.toBeInTheDocument();
  });

  it('puts the subteam ranking before the questions it decides the existence of', () => {
    const { container } = questions();

    const ranking = screen.getByText(/subteams are you most interested in/i);
    const firstQuestion = screen.getByText(/Tell us about a project/);
    expect(
      ranking.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeInTheDocument();
  });
});
