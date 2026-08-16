import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardCard, BoardSubteam } from '@/lib/applications/queries';
import { Board } from '../board';

/**
 * The board as a lead meets it.
 *
 * The assertions are about structure rather than appearance: which columns
 * exist, what a card says, and what stays reachable when a column is folded.
 * None of that changes when a designer arrives and restyles everything, which
 * is the point — these tests should survive the visual pass.
 */

const NOW = '2026-08-16T12:00:00.000Z';

const PATH: BoardSubteam = { id: 'sub-path', name: 'Pathfinding', code: 'PATH' };
const NET: BoardSubteam = { id: 'sub-net', name: 'Networking', code: 'NET' };
/** Mechanical's subteams have no code, so the card must fall back to the name. */
const HULL: BoardSubteam = { id: 'sub-hull', name: 'Hull', code: null };

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: 'app-1',
    applicantName: 'Ada Bell',
    yearOfStudy: '2',
    homeDepartment: 'CPEN',
    firstChoiceSubteam: PATH,
    status: 'applied',
    statusChangedAt: '2026-08-05T12:00:00.000Z',
    noteCount: 0,
    assignedSubteamId: null,
    ...overrides,
  };
}

function renderBoard(cards: BoardCard[] = [card()]) {
  return render(<Board cards={cards} teamSlug="soft" now={NOW} subteams={[PATH, NET, HULL]} />);
}

/** A column by its label, whether it is expanded or folded. */
function column(label: string) {
  return screen.getByRole('region', { name: new RegExp(`^${label} column`) });
}

describe('columns', () => {
  it('renders all eight, in the order a candidate moves through them', () => {
    renderBoard();

    const labels = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label')?.replace(/ column.*/, ''));

    expect(labels).toEqual([
      'Applied',
      'Reviewing',
      'Interview: email sent',
      'Interview: scheduled',
      'Interview: completed',
      'Waitlisted',
      'Offered',
      'Rejected',
    ]);
  });

  it('renders an empty column as a drop target rather than hiding it', () => {
    // A column that disappeared when empty could never receive its first card.
    renderBoard([]);

    const offered = column('Offered');
    expect(offered).toBeInTheDocument();
    expect(offered.querySelector('[data-drop-zone="offered"]')).not.toBeNull();
    expect(within(offered).getByText('Nothing here')).toBeInTheDocument();
  });

  it('counts the cards in each column', () => {
    renderBoard([
      card({ id: 'a', status: 'applied' }),
      card({ id: 'b', status: 'applied' }),
      card({ id: 'c', status: 'reviewing' }),
    ]);

    expect(column('Applied')).toHaveAccessibleName('Applied column, 2 applicants');
    expect(column('Reviewing')).toHaveAccessibleName('Reviewing column, 1 applicant');
    expect(column('Offered')).toHaveAccessibleName('Offered column, 0 applicants');
  });

  it('starts with Waitlisted and Rejected folded, and nothing else', () => {
    renderBoard();

    for (const label of ['Waitlisted', 'Rejected']) {
      expect(column(label)).toHaveAttribute('data-collapsed', 'true');
    }
    for (const label of ['Applied', 'Reviewing', 'Offered']) {
      expect(column(label)).toHaveAttribute('data-collapsed', 'false');
    }
  });

  it('keeps a folded column droppable and counted', () => {
    // Rejecting someone is the most common move on this board. Needing to
    // expand a column first would make the common case the slow one.
    renderBoard([card({ id: 'r', status: 'rejected' })]);

    const rejected = column('Rejected');
    expect(rejected).toHaveAttribute('data-collapsed', 'true');
    expect(rejected).toHaveAccessibleName('Rejected column, 1 applicant');
  });

  it('expands a folded column and folds it again', async () => {
    renderBoard();

    await userEvent.click(screen.getByRole('button', { name: /Expand Rejected column/ }));
    expect(column('Rejected')).toHaveAttribute('data-collapsed', 'false');

    await userEvent.click(screen.getByRole('button', { name: /Collapse Rejected column/ }));
    expect(column('Rejected')).toHaveAttribute('data-collapsed', 'true');
  });

  it('folds a column that started open', async () => {
    renderBoard();

    await userEvent.click(screen.getByRole('button', { name: /Collapse Applied column/ }));

    expect(column('Applied')).toHaveAttribute('data-collapsed', 'true');
    // Folding one column must not disturb the others.
    expect(column('Reviewing')).toHaveAttribute('data-collapsed', 'false');
  });
});

describe('the card', () => {
  it('shows the five things a card is for and links to the application', () => {
    renderBoard([card({ noteCount: 3 })]);

    const link = screen.getByRole('link', { name: 'Ada Bell' });
    expect(link).toHaveAttribute('href', '/admin/soft/applications/app-1');

    const applied = column('Applied');
    expect(within(applied).getByText('2nd yr · CPEN')).toBeInTheDocument();
    expect(within(applied).getByText('PATH')).toBeInTheDocument();
    expect(within(applied).getByText('11 days')).toBeInTheDocument();
    expect(within(applied).getByText('3 notes')).toBeInTheDocument();
  });

  it('says nothing about notes when there are none', () => {
    renderBoard([card({ noteCount: 0 })]);
    expect(screen.queryByText(/note/)).not.toBeInTheDocument();
  });

  it('reads "1 note", not "1 notes"', () => {
    renderBoard([card({ noteCount: 1 })]);
    expect(screen.getByText('1 note')).toBeInTheDocument();
  });

  it('says Today on the day of the move', () => {
    renderBoard([card({ statusChangedAt: '2026-08-16T09:00:00.000Z' })]);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('replaces the first choice with the subteam the applicant was placed in', () => {
    // Once a lead has placed someone, where they went is the fact that matters;
    // what they asked for has been answered.
    renderBoard([card({ firstChoiceSubteam: PATH, assignedSubteamId: NET.id })]);

    expect(screen.getByText('NET')).toBeInTheDocument();
    expect(screen.queryByText('PATH')).not.toBeInTheDocument();
  });

  it('distinguishes an assignment from a preference for a screen reader', () => {
    renderBoard([card({ firstChoiceSubteam: PATH })]);
    expect(screen.getByText(/first choice subteam/)).toBeInTheDocument();

    screen.getByRole('link', { name: 'Ada Bell' });
  });

  it('falls back to the subteam name when it has no code', () => {
    renderBoard([card({ firstChoiceSubteam: HULL })]);
    expect(screen.getByText('Hull')).toBeInTheDocument();
  });

  it('shows no subteam line for a team that does not rank', () => {
    // Mechanical and Electrical collect no preference, so there is nothing to
    // show until placement — an empty badge would be worse than no badge.
    renderBoard([card({ firstChoiceSubteam: null, assignedSubteamId: null })]);

    expect(screen.queryByText(/choice subteam/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ada Bell' })).toBeInTheDocument();
  });

  it('does not put the answers or the resume on the card', () => {
    // The card is a scan target. Everything else lives one click away.
    renderBoard([card()]);
    const applied = column('Applied');
    expect(within(applied).queryByText(/resume/i)).not.toBeInTheDocument();
    expect(applied.textContent).not.toContain('ada_bell@');
  });
});
