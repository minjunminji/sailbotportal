import { render, screen } from '@testing-library/react';
import { loadApplicationForTeam } from '@/lib/applications/for-team';
import ApplicationPage from '../page';

jest.mock('@/lib/applications/for-team', () => ({
  loadApplicationForTeam: jest.fn(),
}));

jest.mock('@/components/application/application-detail', () => ({
  ApplicationDetailView: () => <div>Applicant detail</div>,
}));

jest.mock('@/components/application/takeover', () => ({
  Takeover: ({ children, label }: { children: React.ReactNode; label: string }) => (
    <section role="dialog" aria-label={label}>
      {children}
    </section>
  ),
}));

jest.mock('../../../page', () => ({
  __esModule: true,
  default: () => <main>Team board</main>,
}));

it('renders a directly loaded applicant as a modal over the team board', async () => {
  (loadApplicationForTeam as jest.Mock).mockResolvedValue({
    boardHref: '/admin/software',
    detail: { applicantName: 'Ada Lovelace' },
    navigation: { previousHref: null, nextHref: null },
    team: { name: 'Software' },
  });

  render(
    await ApplicationPage({
      params: Promise.resolve({ team: 'software', id: 'application-1' }),
      searchParams: Promise.resolve({}),
    }),
  );

  expect(screen.getByText('Team board')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Application from Ada Lovelace' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Back to the .* board/ })).not.toBeInTheDocument();
});
