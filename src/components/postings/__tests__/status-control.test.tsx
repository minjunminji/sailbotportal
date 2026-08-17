import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PostingStatusControl } from '../status-control';

/**
 * The control that opens and closes recruitment.
 *
 * Assertions are about behaviour a lead can observe, not markup: which state is
 * shown as current, what reaches the server, and what happens when the server
 * refuses. A segmented control could become a dropdown without any of this
 * changing.
 */

const setStatus = jest.fn(async () => ({ ok: true }) as { ok: boolean; error?: string });

function renderControl(status = 'draft') {
  return render(
    <PostingStatusControl
      postingId="posting-1"
      title="Software 2026"
      status={status}
      action={setStatus}
    />,
  );
}

/** The control, found the way a screen reader would. */
function group() {
  return screen.getByRole('radiogroup', { name: /Software 2026/ });
}

beforeEach(() => {
  setStatus.mockClear();
  setStatus.mockResolvedValue({ ok: true });
});

describe('what it shows', () => {
  it('offers all three states at once, so the choice needs no memory', () => {
    renderControl();

    const options = within(group())
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('value'));

    expect(options).toEqual(['draft', 'open', 'closed']);
  });

  it('marks the current state as chosen', () => {
    renderControl('open');

    expect(within(group()).getByRole('radio', { name: 'Open' })).toBeChecked();
    expect(within(group()).getByRole('radio', { name: 'Draft' })).not.toBeChecked();
  });

  it('names the posting in the group, so several on one page stay distinguishable', () => {
    // Three postings sit on this screen. A control labelled only "Status"
    // three times is unusable by keyboard or screen reader.
    renderControl();
    expect(group()).toBeInTheDocument();
  });
});

describe('changing it', () => {
  it('sends the posting and the chosen status', async () => {
    renderControl('draft');

    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));

    expect(setStatus).toHaveBeenCalledWith('posting-1', 'open');
  });

  it('shows the new state immediately rather than after the round trip', async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    setStatus.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    renderControl('draft');
    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));

    expect(within(group()).getByRole('radio', { name: 'Open' })).toBeChecked();

    // Let the pending transition finish inside act, or React reports the
    // resolution as an unwrapped update and the suite's output stops being
    // clean enough to read.
    await act(async () => {
      release({ ok: true });
    });
  });

  it('does not call the server for the state it is already in', async () => {
    // Clicking the current state is a no-op, not a write. Sending it would
    // evict the public cache for nothing.
    renderControl('open');

    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));

    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe('when the server refuses', () => {
  it('says so', async () => {
    setStatus.mockResolvedValue({ ok: false, error: 'That posting is not one you can change.' });

    renderControl('draft');
    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));

    expect(await screen.findByText('That posting is not one you can change.')).toBeInTheDocument();
  });

  it('puts the control back to where it really is', async () => {
    // The failure that matters: a lead who believes applications are closed
    // when they are open will not check again.
    setStatus.mockResolvedValue({ ok: false, error: 'Could not change this posting.' });

    renderControl('draft');
    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));

    await waitFor(() => {
      expect(within(group()).getByRole('radio', { name: 'Draft' })).toBeChecked();
    });
  });

  it('announces the failure rather than only drawing it', async () => {
    setStatus.mockResolvedValue({ ok: false, error: 'Could not change this posting.' });

    renderControl('draft');
    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not change this posting.');
  });

  it('clears a previous failure once a later change succeeds', async () => {
    setStatus.mockResolvedValue({ ok: false, error: 'Could not change this posting.' });
    renderControl('draft');
    await userEvent.click(within(group()).getByRole('radio', { name: 'Open' }));
    await screen.findByRole('alert');

    setStatus.mockResolvedValue({ ok: true });
    await userEvent.click(within(group()).getByRole('radio', { name: 'Closed' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
