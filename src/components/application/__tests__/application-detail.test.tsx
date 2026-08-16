import { render, screen, within } from '@testing-library/react';
import type { ApplicationDetail } from '@/lib/applications/detail';
import { ApplicationDetailView } from '../application-detail';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    replace,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { replace?: boolean }) => (
    <a data-replace={replace ? 'true' : 'false'} {...props} />
  ),
}));

jest.mock('../resume-viewer', () => ({
  ResumeViewer: () => <div>Resume viewer</div>,
}));

const detail: ApplicationDetail = {
  id: 'application-1',
  postingId: 'posting-1',
  postingTitle: 'Software',
  teamSlug: 'software',
  submissionId: 'submission-1',
  applicantName: 'Ada Bell',
  applicantEmail: 'ada@example.com',
  yearOfStudy: '3',
  homeDepartment: 'CPSC',
  resumePath: null,
  status: 'reviewing',
  submittedAt: '2026-08-16T12:00:00.000Z',
  rankedSubteams: [],
  assignedSubteam: null,
  answers: {},
  questions: [],
  notes: [],
  siblings: [],
};

it('places the visible notes trigger in the application detail header', () => {
  render(<ApplicationDetailView detail={detail} />);

  expect(
    within(screen.getByRole('banner')).getByRole('button', { name: 'Notes, 0 notes' }),
  ).toBeVisible();
});

it('renders accessible previous and next links with the board filters', () => {
  render(
    <ApplicationDetailView
      detail={detail}
      navigation={{
        previousHref: '/admin/software/applications/previous?q=Ada+Bell&from=2026-08-01',
        nextHref: '/admin/software/applications/next?q=Ada+Bell&from=2026-08-01',
      }}
    />,
  );

  const previous = screen.getByRole('link', { name: 'Previous applicant' });
  expect(previous).toHaveAttribute(
    'href',
    '/admin/software/applications/previous?q=Ada+Bell&from=2026-08-01',
  );
  expect(previous).toHaveClass('focus-visible:ring-2');
  expect(previous).toHaveAttribute('data-replace', 'true');
  const next = screen.getByRole('link', { name: 'Next applicant' });
  expect(next).toHaveAttribute(
    'href',
    '/admin/software/applications/next?q=Ada+Bell&from=2026-08-01',
  );
  expect(next).toHaveAttribute('data-replace', 'true');
});

it('disables navigation controls at the board endpoints', () => {
  render(
    <ApplicationDetailView detail={detail} navigation={{ previousHref: null, nextHref: null }} />,
  );

  expect(screen.getByRole('button', { name: 'Previous applicant' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next applicant' })).toBeDisabled();
});
