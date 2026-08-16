import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * Serves one application's resume to a lead who is allowed to see it.
 *
 * TWO IDENTITIES, IN ONE ORDER, AND THE ORDER IS THE SECURITY.
 *
 * 1. The CALLER'S client reads the application. The `resumes` bucket has no
 *    storage policies at all, so RLS on `applications` is the only thing that
 *    can answer "may this person see this resume?" — and it answers it by
 *    whether the row comes back.
 * 2. Only then does the SERVICE ROLE sign the object, because with no storage
 *    policies nothing else can. It signs the path that step 1 just returned and
 *    no other, so the elevation is scoped to the decision already made.
 *
 * Reversing those, or skipping the first, turns this into an endpoint that
 * hands any signed-in lead any applicant's resume from any team.
 *
 * A REDIRECT RATHER THAN A URL IN THE PAGE. The signed URL never appears in the
 * HTML: `<embed src="/api/resume/<id>">` follows the redirect, so authorisation
 * is re-checked on every request rather than baked into a page that might sit
 * open on a shared screen for an afternoon. It also means a stale tab fails
 * closed — the redirect 404s once the session ends — instead of holding a
 * working link.
 */

export const runtime = 'nodejs';
/** Signs a fresh URL per request; there is nothing here to cache. */
export const dynamic = 'force-dynamic';

const BUCKET = 'resumes';

/**
 * Ten minutes. Long enough to read a resume and to reload the page a few times,
 * short enough that a URL copied out of devtools is worthless by the time it is
 * pasted anywhere.
 */
const SIGNED_URL_SECONDS = 600;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return notFound();

  // RLS decides. A lead naming another team's application gets no row, and so
  // gets the same answer as for an id that does not exist.
  const { data, error } = await supabase
    .from('applications')
    .select('resume_path, applicant_name')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[resume] lookup failed', { id, message: error.message });
    return new Response('Could not load this resume.', { status: 500 });
  }
  if (!data?.resume_path) return notFound();

  // `?download` asks the browser to save rather than display, for the fallback
  // when an embedded PDF will not render.
  const wantsDownload = new URL(request.url).searchParams.has('download');

  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(data.resume_path, SIGNED_URL_SECONDS, {
      // A filename the lead recognises, rather than the random UUID the upload
      // route chose for storage.
      download: wantsDownload ? `${data.applicant_name} resume.pdf` : undefined,
    });

  if (signError || !signed) {
    console.error('[resume] signing failed', { id, message: signError?.message });
    return new Response('Could not load this resume.', { status: 500 });
  }

  return Response.redirect(signed.signedUrl, 307);
}

/**
 * Deliberately does not distinguish "no such application", "not yours" and "no
 * resume attached". All three are the same answer to the person asking, and
 * separating them would confirm an id exists to someone who cannot see it.
 */
function notFound() {
  return new Response('Not found', { status: 404 });
}
