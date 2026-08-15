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
  await admin
    .from('profiles')
    .update({ role: opts.role, team_id: opts.teamId ?? null })
    .eq('id', created.user!.id);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: opts.email,
    password,
  });
  if (signInError) throw signInError;

  return client;
}
