'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Keeps one team's board current while other leads are working it.
 *
 * THE EVENT IS A DOORBELL, NOT A DELIVERY. Nothing here reads the changed row.
 * It calls `router.refresh()` and lets the server component refetch through
 * `getBoardApplications`, for two reasons that both come down to the payload
 * being the wrong shape. A card is not an `applications` row: it carries a note
 * count that comes from an aggregate over another table, and a first-choice
 * subteam resolved to a name from a third. Building one from the event would
 * mean reimplementing the query in the browser and getting a different answer.
 * And a refetch runs as the lead through RLS, so a row they may not read cannot
 * arrive by this path even if Realtime ever delivered one.
 *
 * Refreshing rather than patching local state is also what keeps this
 * compatible with the optimistic move. `useOptimistic` derives from the `cards`
 * prop, so a refresh mid-move replaces the base and React reapplies the pending
 * move on top of it — an echo of your own change cannot fight your own pending
 * update, because there is only ever one copy of the truth and one overlay.
 *
 * @param postingId which board. Also the channel name, so two boards open in
 *                  two tabs do not share a subscription.
 * @param paused    true while a card is mid-drag. See below.
 */
export function useBoardRealtime({ postingId, paused }: { postingId: string; paused: boolean }) {
  const router = useRouter();

  /** A change arrived that no refresh has covered yet. */
  const pending = useRef(false);
  /** Read inside the subscription callback, which is registered once. */
  const pausedRef = useRef(paused);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Refetch, but not more than once per window.
   *
   * A single move already produces two events for the lead who made it — the
   * action's own `revalidatePath` and the echo of their write coming back
   * through Realtime — and a lead clearing a column produces a burst. Every one
   * of those refetches rebuilds the same board, so they are collapsed into one
   * trailing refresh. The delay is short enough to read as immediate and long
   * enough to catch a burst.
   */
  const scheduleRefresh = useCallback(() => {
    pending.current = true;
    if (timer.current !== null) return;

    timer.current = setTimeout(() => {
      timer.current = null;
      // Re-checked rather than assumed: a drag may have started during the
      // window, and this is the point where the refresh would land on it.
      if (pausedRef.current) return;
      pending.current = false;
      router.refresh();
    }, COALESCE_MS);
  }, [router]);

  /**
   * NOTHING REFRESHES MID-DRAG. Columns are ordered by time-in-status, so a
   * refresh while a card is in the air can resort the column under the cursor
   * and move the drop target away from where the lead is aiming. A drag lasts
   * about a second; the update waits for it and lands on the next line.
   */
  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pending.current) scheduleRefresh();
  }, [paused, scheduleRefresh]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`board:${postingId}`)
      .on(
        'postgres_changes',
        {
          // Inserts and deletes as well as updates: a new application has to
          // appear in Applied on its own, and that is this same stream rather
          // than a second feature.
          event: '*',
          schema: 'public',
          table: 'applications',
          // One team's board must not be woken by another's. RLS would refuse
          // to deliver those rows anyway — this saves the round trip.
          filter: `posting_id=eq.${postingId}`,
        },
        () => {
          if (pausedRef.current) {
            // Recorded, not dropped. The drag-end effect above picks it up.
            pending.current = true;
            return;
          }
          scheduleRefresh();
        },
      )
      .subscribe();

    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // A channel that outlives its board goes on refreshing a route the lead
      // has already left.
      void supabase.removeChannel(channel);
    };
  }, [postingId, scheduleRefresh]);
}

/**
 * Long enough to swallow the echo of your own move arriving just after its
 * revalidation, short enough that a colleague's change still feels immediate.
 */
const COALESCE_MS = 150;
