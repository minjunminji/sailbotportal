import { render, screen } from '@testing-library/react';
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
  return render(<SectionRail sections={sections} activeId={null} {...props} />);
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

it('reads a count as a sentence, even though nothing shows it on screen', () => {
  renderRail([section({ label: 'Mechanical', answered: 4, total: 11 })]);

  // Announced for anyone hearing it; not shown for anyone seeing it.
  expect(screen.getByRole('link', { name: 'Mechanical, 4 of 11 answered' })).toBeInTheDocument();
  expect(screen.queryByText('4/11')).not.toBeInTheDocument();
});

it('marks a finished section with a checkmark and says it is complete', () => {
  renderRail([section({ label: 'Mechanical', answered: 11, total: 11 })]);

  expect(screen.getByRole('link', { name: 'Mechanical, complete' })).toBeInTheDocument();
  expect(screen.getByText('✓')).toBeInTheDocument();
});

it('shows nothing for a section that has not been started', () => {
  renderRail([section({ label: 'Mechanical', answered: 0, total: 11 })]);
  expect(screen.queryByText('✓')).not.toBeInTheDocument();
  expect(screen.queryByText('0/11')).not.toBeInTheDocument();
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

it('holds no action of its own — the rail navigates and nothing else', () => {
  renderRail([section()]);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

// The rows ARE the rail. A footer naming the chosen teams said what the rows
// already say, and the form's submit line says it again beside the button.
it('carries nothing below the rows', () => {
  renderRail([section(), section({ id: 'resume-upload', label: 'Resume', total: 1 })]);
  const rail = screen.getByRole('navigation', { name: 'Application sections' });
  expect(rail.children).toHaveLength(1);
  expect(rail.firstElementChild?.tagName).toBe('UL');
});
