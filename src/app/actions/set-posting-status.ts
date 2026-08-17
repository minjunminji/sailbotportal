'use server';

import { revalidatePath } from 'next/cache';
import { cacheKeys, invalidate } from '@/lib/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Opens, closes, or drafts one posting.
 *
 * THIS IS THE SWITCH THAT DECIDES WHETHER THE PORTAL IS ACCEPTING APPLICATIONS,
 * and it exists as a screen rather than a migration for one reason: recruiting
 * opens and closes on a date, and the alternative puts a deploy on the critical
 * path at the exact moment the person who can run one is writing exams. See the
 * design doc §3 — there is deliberately no posting builder around it, because
 * question sets change once a year and this changes twice a term.
 *
 * RUNS AS THE CALLER, NOT AS THE SERVICE ROLE. The "leads write own team
 * postings" policy is the whole authorisation story: a lead naming another
 * team's posting updates nothing. Same shape as `moveApplication`, for the same
 * reason.
 */

export type SetPostingStatusResult = { ok: true } | { ok: false; error: string };

/**
 * A posting's own vocabulary, which has nothing to do with an application's.
 * Kept here rather than imported from the board so that `rejected` — a real
 * status for a candidate and nonsense for a posting — cannot leak across.
 */
export const POSTING_STATUSES = ['draft', 'open', 'closed'] as const;

export type PostingStatus = (typeof POSTING_STATUSES)[number];

const VALID_STATUSES: readonly string[] = POSTING_STATUSES;

export async function setPostingStatus(
  postingId: string,
  status: string,
): Promise<SetPostingStatusResult> {
  if (!VALID_STATUSES.includes(status)) {
    // The check constraint would refuse this too, but it would surface as a
    // Postgres error string and this is a sentence.
    return { ok: false, error: 'That is not a status a posting can have.' };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };

  // `select()` after the update is what makes this authorisation-aware. An
  // UPDATE that RLS filters to nothing is not an error in Postgres — it reports
  // success having changed no rows. Without reading the rows back, a lead
  // closing another team's posting would look exactly like closing their own,
  // and they would believe applications were shut when they were still open.
  const { data, error } = await supabase
    .from('postings')
    .update({ status })
    .eq('id', postingId)
    .select('id, slug');

  if (error) {
    console.error('[postings] status change failed', { postingId, message: error.message });
    return { ok: false, error: 'Could not change this posting. Try again.' };
  }

  if (!data || data.length === 0) {
    // Deliberately does not distinguish "no such posting" from "not yours".
    // Separating them would confirm an id exists to someone who cannot see it.
    return { ok: false, error: 'That posting is not one you can change.' };
  }

  // THE CACHE IS THE POINT OF THIS BLOCK. The landing page reads the open
  // postings list through FredDB with a 60s TTL, so without eviction a lead can
  // close applications and watch the site go on advertising them — and
  // `/apply` go on offering that team's branch — for a minute afterwards. On
  // the day applications close, a minute is long enough to take submissions
  // nobody meant to accept.
  //
  // Best-effort by construction: `invalidate` swallows its own errors, and a
  // cache that cannot be reached must not fail a write that already committed.
  await invalidate(cacheKeys.openPostings());
  for (const posting of data) {
    await invalidate(cacheKeys.posting(posting.slug));
  }

  revalidatePath('/');
  revalidatePath('/apply');
  revalidatePath('/admin/postings');
  return { ok: true };
}
