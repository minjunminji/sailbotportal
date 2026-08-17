import { act, render, screen } from '@testing-library/react';
import { ApplyHeader } from '../apply-header';

/**
 * The collapse hides the wordmark; it must never remove it.
 *
 * The whole point of clipping rather than unmounting is that the document keeps
 * its `<h1>` at every scroll position — outline, screen readers, and the tab
 * title's relationship to the page all depend on the text still being there
 * when it is off screen.
 */

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

beforeEach(() => {
  scrollTo(0);
});

it('keeps the heading text in the document at every scroll position', () => {
  render(<ApplyHeader />);

  const heading = screen.getByRole('heading', { level: 1 });
  expect(heading).toHaveTextContent('UBC Sailbot Application');

  scrollTo(400);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('UBC Sailbot Application');
});

it('collapses the wordmark past the threshold and restores it above', () => {
  render(<ApplyHeader />);
  const wordmark = screen.getByText('UBC Sailbot Application');
  // The clipper is what holds the width; the text itself only slides.
  const clipper = wordmark.parentElement as HTMLElement;

  expect(clipper).toHaveClass('max-w-[17rem]');
  expect(wordmark).toHaveClass('translate-x-0');

  scrollTo(400);
  expect(clipper).toHaveClass('max-w-0');
  expect(wordmark).toHaveClass('-translate-x-full');

  scrollTo(0);
  expect(clipper).toHaveClass('max-w-[17rem]');
  expect(wordmark).toHaveClass('translate-x-0');
});

it('reads the scroll position on mount, not only on the next scroll event', () => {
  // A reload or a back-navigation restores scroll offset without ever firing a
  // scroll event. Without the mount read, the wordmark would sit expanded over
  // the middle of the form until the applicant happened to scroll.
  Object.defineProperty(window, 'scrollY', { value: 400, writable: true, configurable: true });

  render(<ApplyHeader />);

  expect(screen.getByText('UBC Sailbot Application').parentElement).toHaveClass('max-w-0');
});

it('keeps an accessible name on the link once its text is clipped away', () => {
  render(<ApplyHeader />);
  scrollTo(400);

  expect(screen.getByRole('link', { name: 'UBC Sailbot' })).toHaveAttribute('href', '/');
});
