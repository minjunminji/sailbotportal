import { act, render } from '@testing-library/react';
import { useBoardRealtime } from '../use-board-realtime';

/**
 * The board's live connection, tested through what it does rather than what it
 * subscribes to.
 *
 * Every one of these is a rule about TIMING, which is the only hard part here.
 * Delivering an event is a two-line subscription; deciding when a refresh is
 * safe to run, and what to do with one that is not, is the whole task.
 */

const refresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: (...args: unknown[]) => refresh(...args) }),
}));

/**
 * A stand-in for the realtime channel that records how it was configured and
 * hands back the handler, so a test can deliver an event without a websocket.
 */
type Subscription = { config: Record<string, unknown>; fire: () => void };

const subscriptions: Subscription[] = [];
const removed: string[] = [];
const channelNames: string[] = [];

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel(name: string) {
      channelNames.push(name);
      const channel = {
        name,
        on(_event: string, config: Record<string, unknown>, handler: () => void) {
          subscriptions.push({ config, fire: handler });
          return channel;
        },
        subscribe() {
          return channel;
        },
      };
      return channel;
    },
    removeChannel(channel: { name: string }) {
      removed.push(channel.name);
    },
  }),
}));

function Probe({ postingId, paused }: { postingId: string; paused: boolean }) {
  useBoardRealtime({ postingId, paused });
  return null;
}

/** Deliver one change from the server. */
function emit() {
  act(() => {
    for (const subscription of subscriptions) subscription.fire();
  });
}

/** Run out the coalescing window. */
function settle() {
  act(() => {
    jest.advanceTimersByTime(500);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  refresh.mockClear();
  subscriptions.length = 0;
  removed.length = 0;
  channelNames.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('subscribing', () => {
  it('listens to this posting only', () => {
    // Every team's board is the same table. Without the filter, Mechanical
    // moves would refresh Software's board all season.
    render(<Probe postingId="posting-1" paused={false} />);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].config).toMatchObject({
      schema: 'public',
      table: 'applications',
      filter: 'posting_id=eq.posting-1',
    });
  });

  it('names the channel after the posting, so two boards do not share one', () => {
    render(<Probe postingId="posting-1" paused={false} />);
    expect(channelNames).toEqual(['board:posting-1']);
  });

  it('listens for inserts and deletes too, not only status moves', () => {
    // A new application has to appear in Applied without a manual reload;
    // that is the same event stream, not a second feature.
    render(<Probe postingId="posting-1" paused={false} />);
    expect(subscriptions[0].config).toMatchObject({ event: '*' });
  });

  it('closes the channel when the board goes away', () => {
    // A leaked subscription outlives its board and keeps refreshing a route
    // the lead has already navigated away from.
    const { unmount } = render(<Probe postingId="posting-1" paused={false} />);
    unmount();

    expect(removed).toEqual(['board:posting-1']);
  });

  it('moves to a new channel when the board does', () => {
    const { rerender } = render(<Probe postingId="posting-1" paused={false} />);
    rerender(<Probe postingId="posting-2" paused={false} />);

    expect(removed).toEqual(['board:posting-1']);
    expect(channelNames).toEqual(['board:posting-1', 'board:posting-2']);
  });
});

describe('refreshing', () => {
  it('refetches the board when something changes', () => {
    render(<Probe postingId="posting-1" paused={false} />);

    emit();
    settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh before anything has happened', () => {
    render(<Probe postingId="posting-1" paused={false} />);
    settle();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('collapses a burst of changes into one refetch', () => {
    // A lead clearing out ten cards, or a seeded batch, is one board to
    // rebuild — not ten identical round trips racing each other.
    render(<Probe postingId="posting-1" paused={false} />);

    emit();
    emit();
    emit();
    settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps refreshing after the window closes', () => {
    // Coalescing must not turn into swallowing: the second change is a real
    // one that arrived later, not a duplicate of the first.
    render(<Probe postingId="posting-1" paused={false} />);

    emit();
    settle();
    emit();
    settle();

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe('while a card is being dragged', () => {
  it('holds the refresh rather than reordering the board under the pointer', () => {
    // The columns are sorted by time-in-status, so a refresh mid-drag can move
    // the drop target out from under the cursor. The lead is mid-gesture; the
    // update can wait the second it takes to finish.
    render(<Probe postingId="posting-1" paused />);

    emit();
    settle();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('applies the held change once the card lands', () => {
    const { rerender } = render(<Probe postingId="posting-1" paused />);

    emit();
    settle();
    expect(refresh).not.toHaveBeenCalled();

    rerender(<Probe postingId="posting-1" paused={false} />);
    settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("applies a whole drag's worth of changes exactly once", () => {
    const { rerender } = render(<Probe postingId="posting-1" paused />);

    emit();
    emit();
    emit();
    rerender(<Probe postingId="posting-1" paused={false} />);
    settle();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on drag end when nothing arrived during the drag', () => {
    // Otherwise every drag would end in a redundant refetch, on top of the one
    // the move's own revalidation already causes.
    const { rerender } = render(<Probe postingId="posting-1" paused />);

    rerender(<Probe postingId="posting-1" paused={false} />);
    settle();

    expect(refresh).not.toHaveBeenCalled();
  });
});
