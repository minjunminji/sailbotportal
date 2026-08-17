import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DraftNotice } from '../draft-notice';

/**
 * The notice explains why a form someone has never typed into is already full.
 *
 * Two things matter and neither is visual: it has to stay put until it is
 * dismissed, because a message that answers "why is this filled in?" is useless
 * if it has already gone by the time the question occurs to someone; and both of
 * its actions have to be reachable and nameable without sight.
 */

function renderNotice(props: Partial<Parameters<typeof DraftNotice>[0]> = {}) {
  const onStartOver = jest.fn();
  const onDismiss = jest.fn();
  render(<DraftNotice onStartOver={onStartOver} onDismiss={onDismiss} {...props} />);
  return { onStartOver, onDismiss };
}

it('says what happened', () => {
  renderNotice();
  expect(screen.getByText(/We restored what you had already written/)).toBeInTheDocument();
});

it('is a status region rather than an alert', () => {
  // It is on screen from the first render and describes state, not a problem.
  // `alert` would interrupt a screen reader mid-sentence to say so.
  renderNotice();
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('offers to start over', async () => {
  const user = userEvent.setup();
  const { onStartOver } = renderNotice();

  await user.click(screen.getByRole('button', { name: 'Start over' }));

  expect(onStartOver).toHaveBeenCalledTimes(1);
});

it('has a dismiss control with a name, not a bare glyph', async () => {
  const user = userEvent.setup();
  const { onDismiss, onStartOver } = renderNotice();

  // An X on its own reaches a screen reader as nothing at all.
  await user.click(screen.getByRole('button', { name: 'Dismiss' }));

  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onStartOver).not.toHaveBeenCalled();
});

it('never dismisses itself', () => {
  jest.useFakeTimers();
  try {
    const { onDismiss } = renderNotice();
    jest.advanceTimersByTime(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});
