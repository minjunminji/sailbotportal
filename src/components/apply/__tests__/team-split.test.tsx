import { render, screen } from '@testing-library/react';
import { FIRST_SUBTEAM_TOKEN } from '@/lib/questions/labels';
import { softwarePosting, subteams } from '@/test/apply-fixtures';
import { teamSectionId } from '../sections';
import { TeamQuestions } from '../team-questions';
import { emptyTeamState, type TeamState } from '../types';

/**
 * Choosing a team and answering its questions were one component. They are two
 * because the rail needs a permanent anchor for choosing teams — a team that has
 * not been chosen has no row of its own to point at.
 *
 * The selector's own behaviour lives in `team-selector.test.tsx`.
 */

const noErrors = new Map<string, string>();

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

describe('a question that names the first choice', () => {
  /** A posting whose only question asks about the applicant's own top pick. */
  function askingAboutFirstChoice(ranked: string[]) {
    const posting = softwarePosting([
      {
        id: 'first_choice_reason',
        type: 'long_text',
        label: `Why is ${FIRST_SUBTEAM_TOKEN} your first choice?`,
        required: true,
        config: { maxWords: 30 },
      },
    ]);
    return render(
      <TeamQuestions
        posting={posting}
        state={{ ...emptyTeamState(), rankedSubteams: ranked }}
        errors={noErrors}
        onRank={() => {}}
        onAnswer={() => {}}
      />,
    );
  }

  it('uses the code of whichever subteam is ranked first', () => {
    askingAboutFirstChoice([subteams[1].id, subteams[0].id]);
    expect(screen.getByText(/Why is NET your first choice\?/)).toBeInTheDocument();
  });

  it('reads as a sentence before anything is ranked', () => {
    askingAboutFirstChoice([]);
    expect(screen.getByText(/Why is that subteam your first choice\?/)).toBeInTheDocument();
  });

  it('never shows the placeholder itself', () => {
    askingAboutFirstChoice([subteams[0].id]);
    expect(screen.queryByText(/firstSubteam/)).not.toBeInTheDocument();
  });
});

describe("a team's questions", () => {
  it('lives under the id the rail links to', () => {
    const { container } = questions();
    expect(container.querySelector(`#${teamSectionId('soft-2026')}`)).toBeInTheDocument();
  });

  it('does not reuse the gate id, which would break both sets of anchor links', () => {
    const { container } = questions();
    // `team-soft-2026` is the checkbox over in TeamSelector.
    expect(container.querySelector('#team-soft-2026')).not.toBeInTheDocument();
  });

  it('puts the subteam ranking before the questions it decides the existence of', () => {
    const { container } = questions();

    const ranking = screen.getByText(/subteams you're interested in/i);
    const firstQuestion = screen.getByText(/Tell us about a project/);
    expect(
      ranking.compareDocumentPosition(firstQuestion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container).toBeInTheDocument();
  });
});
