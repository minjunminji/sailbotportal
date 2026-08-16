import { render, screen } from '@testing-library/react';
import { createClient } from '@/lib/supabase/server';
import ApplyPage from '../page';

/**
 * The state this page is in for most of the year.
 *
 * All three postings sit at `draft` between recruiting cycles, so "no open
 * postings" is the default and it has to be right before anything else is.
 * Rendering an empty form instead would look broken, and someone would fill it
 * in and wonder why nothing happened.
 */

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
// The page passes the action to the form; the server module itself has no
// business being loaded into a jsdom test.
jest.mock('@/app/actions/submit-application', () => ({ submitApplication: jest.fn() }));

type Rows = Record<string, unknown[]>;

/** A stub that answers each `from(table)` chain with fixed rows. */
function stubSupabase(rows: Rows) {
  const builder = (table: string) => {
    const result = { data: rows[table] ?? [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order']) {
      chain[method] = () => chain;
    }
    // Awaited at the end of any of those chains.
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  };

  (createClient as jest.Mock).mockResolvedValue({ from: builder });
}

it('says recruiting is closed rather than rendering an empty form', async () => {
  stubSupabase({ postings: [] });

  render(await ApplyPage());

  expect(screen.getByText('Recruiting is currently closed')).toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Full name/)).not.toBeInTheDocument();
  // Not one control anywhere: an empty form is worse than no form.
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to open postings' })).toBeInTheDocument();
});

it('renders the form when a posting is open', async () => {
  stubSupabase({
    postings: [
      {
        id: 'p1',
        slug: 'mech-2026',
        title: 'Mechanical Team',
        description: 'We build the boat.',
        team_id: 't1',
        question_schema: [
          {
            id: 'ballast',
            type: 'long_text',
            label: 'What is ballast?',
            required: true,
            config: {},
          },
        ],
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ],
    core_questions: [
      {
        stable_key: 'why_sailbot',
        position: 0,
        definition: {
          type: 'long_text',
          label: 'Why Sailbot?',
          required: true,
          config: {},
        },
      },
    ],
    teams: [{ id: 't1', name: 'Mechanical' }],
    subteams: [],
  });

  render(await ApplyPage());

  expect(screen.queryByText('Recruiting is currently closed')).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Full name/)).toBeInTheDocument();
  expect(screen.getByLabelText(/Why Sailbot/)).toBeInTheDocument();
  // The team's own questions stay behind its gate until it is answered Yes.
  expect(
    screen.getByRole('group', { name: 'Do you want to apply to the Mechanical team?' }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText(/What is ballast/)).not.toBeInTheDocument();
});
