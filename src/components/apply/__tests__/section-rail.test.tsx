import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionRail } from '../section-rail';
import type { FormSection } from '../sections';

/**
 * The rail as someone meets it, including someone who is hearing it rather than
 * seeing it. The counts are the whole point of the component, so they have to
 * reach the accessibility tree as sentences and not as loose digits.
 */

function section(overrides: Partial<FormSection> = {}): FormSection {
  return {
    id: 'about-you',
    label: 'About you',
    answered: 0,
    total: 4,
    invalid: false,
    ...overrides,
  };
}

function renderRail(
  sections: FormSection[],
  props: Partial<Parameters<typeof SectionRail>[0]> = {},
) {
  return render(
    <SectionRail
      sections={sections}
      activeId={null}
      applyingTo={[]}
      onReview={() => {}}
      {...props}
    />,
  );
}

it('is a landmark a screen reader can jump to', () => {
  renderRail([section()]);
  expect(screen.getByRole('navigation', { name: /application sections/i })).toBeInTheDocument();
});

it('links each section to its anchor on the page', () => {
  renderRail([section(), section({ id: 'resume-upload', label: 'Resume', total: 1 })]);

  expect(screen.getByRole('link', { name: /About you/ })).toHaveAttribute('href', '#about-you');
  expect(screen.getByRole('link', { name: /Resume/ })).toHaveAttribute('href', '#resume-upload');
});

it('reads a count as a sentence rather than as loose digits', () => {
  renderRail([section({ label: 'Mechanical', answered: 4, total: 11 })]);

  // Visible as "4/11"; announced as something a person can parse.
  expect(screen.getByRole('link', { name: 'Mechanical, 4 of 11 answered' })).toBeInTheDocument();
  expect(screen.getByText('4/11')).toBeInTheDocument();
});

it('says a finished section is complete instead of counting it again', () => {
  renderRail([section({ label: 'Mechanical', answered: 11, total: 11 })]);

  expect(screen.getByRole('link', { name: 'Mechanical, complete' })).toBeInTheDocument();
  // 11/11 has no work left to do, so the number goes away.
  expect(screen.queryByText('11/11')).not.toBeInTheDocument();
});

it('shows the count from zero, because it prices the section before you start', () => {
  renderRail([section({ label: 'Mechanical', answered: 0, total: 11 })]);
  expect(screen.getByText('0/11')).toBeInTheDocument();
});

it('marks the section being read as current', () => {
  renderRail([section(), section({ id: 'resume-upload', label: 'Resume', total: 1 })], {
    activeId: 'resume-upload',
  });

  expect(screen.getByRole('link', { name: /Resume/ })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('link', { name: /About you/ })).not.toHaveAttribute('aria-current');
});

it('announces a failing section in words, not only in colour', () => {
  renderRail([section({ label: 'Mechanical', answered: 4, total: 11, invalid: true })]);

  expect(
    screen.getByRole('link', { name: 'Mechanical, 4 of 11 answered, needs attention' }),
  ).toBeInTheDocument();
});

it('does not announce trouble before anything has been submitted', () => {
  renderRail([section({ label: 'Mechanical', answered: 0, total: 11 })]);
  expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument();
});

describe('footer', () => {
  it('names the teams the application currently covers', () => {
    renderRail([section()], { applyingTo: ['Mechanical', 'Software'] });
    expect(screen.getByText(/Applying to Mechanical, Software/)).toBeInTheDocument();
  });

  it('says so plainly when no team has been chosen', () => {
    renderRail([section()], { applyingTo: [] });
    expect(screen.getByText(/No teams chosen yet/)).toBeInTheDocument();
  });

  it('offers review from the rail, so it is reachable without scrolling to the end', async () => {
    const onReview = jest.fn();
    renderRail([section()], { onReview });

    await userEvent.click(screen.getByRole('button', { name: /Review your application/ }));
    expect(onReview).toHaveBeenCalledTimes(1);
  });
});
