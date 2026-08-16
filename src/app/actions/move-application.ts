'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { APPLICATION_STATUSES } from '@/lib/applications/queries';

/**
 * Moves one application to one status.
 *
 * THIS RUNS AS THE CALLER, NOT AS THE SERVICE ROLE. That is the whole
 * authorisation story: the RLS policy "leads update own team applications"
 * decides which rows exist to be updated, so a lead who names an application on
 * another team's board updates nothing. Compare `submitApplication`, which
 * holds the service role precisely because applicants are anonymous and so has
 * to re-implement every check itself.
 *
 * A server action is a public HTTP endpoint regardless of which component calls
 * it, so the arguments are treated as hostile — but "hostile" here means a
 * signed-in lead, and the only thing they could gain is a row RLS will not give
 * them.
 *
 * The `application_events` row is NOT written here. A trigger on `applications`
 * writes it, so the audit row survives a direct PostgREST PATCH that never
 * reaches this file. See the status-change-audit migration.
 */

export type MoveResult = { ok: true } | { ok: false; error: string };

const VALID_STATUSES: readonly string[] = APPLICATION_STATUSES;

export async function moveApplication(
  applicationId: string,
  toStatus: string,
  /** The board to refresh. Comes from the route, not from the caller's claim. */
  teamSlug: string,
): Promise<MoveResult> {
  if (!VALID_STATUSES.includes(toStatus)) {
    // The check constraint would refuse this anyway, but a constraint violation
    // surfaces as a Postgres error string and this is a plain sentence.
    return { ok: false, error: 'That is not a status a card can be moved to.' };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Your session has expired. Sign in again.' };

  // `select()` after the update is what makes this authorisation-aware. An
  // UPDATE that RLS filters down to nothing is NOT an error in Postgres — it
  // reports success having changed zero rows. Without reading the rows back,
  // moving another team's applicant would look exactly like moving your own,
  // and the card would sit in its new column until the page was reloaded.
  const { data, error } = await supabase
    .from('applications')
    .update({ status: toStatus })
    .eq('id', applicationId)
    .select('id');

  if (error) {
    console.error('[board] status move failed', { applicationId, message: error.message });
    return { ok: false, error: 'Could not move this application. Try again.' };
  }

  if (!data || data.length === 0) {
    // Deliberately does not distinguish "no such application" from "not yours".
    // Both are the same answer to the person asking, and separating them would
    // confirm that an id exists to someone who cannot see it.
    return { ok: false, error: 'That application is not on this board any more.' };
  }

  revalidatePath(`/admin/${teamSlug}`);
  return { ok: true };
}
