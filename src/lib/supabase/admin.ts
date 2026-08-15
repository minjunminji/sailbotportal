import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Bypasses RLS entirely. Use ONLY for applicant-facing writes, which are
 * anonymous by design, and always after Zod validation plus an explicit
 * check that the target posting is open.
 *
 * Never import this into a Client Component. The `server-only` package
 * turns that into a build error rather than a leaked key.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
