import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

/** Creates a confirmed user, sets their profile row, returns a client signed in as them. */
export async function signedInAs(opts: {
  email: string;
  role: 'admin' | 'lead';
  teamId?: string;
}): Promise<SupabaseClient> {
  const admin = adminClient();
  const password = 'test-password-123';

  const { data: created, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  // The signup trigger already inserted the profile row; update it.
  //
  // The result is CHECKED, and the updated row is read back. Every RLS policy
  // in the app resolves through `profiles.role` and `profiles.team_id`, so a
  // silent miss here produces a client that is signed in and authorised for
  // nothing — and the test that then fails is whichever one happened to read a
  // row first, reporting an empty result rather than a broken fixture. That is
  // an afternoon of debugging in exchange for two lines.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .update({ role: opts.role, team_id: opts.teamId ?? null })
    .eq('id', created.user!.id)
    .select('id, role, team_id');
  if (profileError) throw profileError;
  if (!profile || profile.length !== 1) {
    throw new Error(
      `signedInAs(${opts.email}): expected to update exactly one profile row, updated ${profile?.length ?? 0}. ` +
        'The on_auth_user_created trigger should have inserted it.',
    );
  }
  if (profile[0].role !== opts.role || profile[0].team_id !== (opts.teamId ?? null)) {
    throw new Error(
      `signedInAs(${opts.email}): profile did not take the requested role/team ` +
        `(got role=${profile[0].role}, team_id=${profile[0].team_id}).`,
    );
  }

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: opts.email,
    password,
  });
  if (signInError) throw signInError;

  return client;
}
