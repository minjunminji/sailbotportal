import { createAdminClient } from '@/lib/supabase/admin';
import { resolveQuestions } from '@/lib/questions/snapshot';
import { validateQuestion } from '@/lib/questions/validate';
import { isFile, type FileQuestion } from '@/lib/questions/types';
import {
  ABSOLUTE_MAX_BYTES,
  RESUME_MAX_BYTES,
  RateLimiter,
  UploadError,
  clientIp,
  contentTypeFor,
  decodeFilenameHeader,
  detectFileKind,
  kindsForAccept,
  parseContentLength,
  randomStoragePath,
  readBodyWithLimit,
  type FileKind,
} from '@/lib/uploads';

/**
 * The applicant file upload endpoint: resumes, and answers to `file` questions.
 *
 * THE MAIN UNTRUSTED-INPUT SURFACE IN THE APP. Uploads are anonymous by design
 * — an applicant has no account — so there is no session to lean on. The
 * `resumes` bucket is private with no anon storage policy, which means this
 * route holds the service role and every check RLS would otherwise perform is
 * this file's responsibility.
 *
 * What is trusted, and what is not:
 *
 * - The BYTES decide the file type. `Content-Type` and the extension are both
 *   client-controlled and are never consulted.
 * - The QUESTION decides what is allowed. `accept` and `maxBytes` are read from
 *   the posting in the database, never from the request.
 * - The SERVER decides the storage path. It is a random UUID; the client's
 *   filename survives only as object metadata for the admin UI to display.
 * - The response carries a path and nothing else. No URL, signed or otherwise:
 *   a lead fetches a signed URL through an authenticated route later.
 *
 * ## Why a raw body rather than multipart/form-data
 *
 * `request.formData()` parses and buffers the entire body before returning, so
 * the size cap could only be applied to something already in memory. Reading
 * `request.body` as a stream is what makes "refuse at the cap" mean anything.
 * The filename travels in a header instead of a form part.
 *
 * ## Request
 *
 *   POST /api/upload?purpose=resume
 *   POST /api/upload?purpose=question&posting=<slug>&question=<id>
 *   x-upload-filename: percent-encoded original filename
 *   body: the raw file bytes
 *
 * ## Response
 *
 *   200 { path, filename, size }   — `path` is what goes into the answer
 *   400 { error, code }            — malformed request, or bytes of the wrong type
 *   413 { error, code }            — over the cap
 *   429 { error, code }            — rate limited
 */

export const runtime = 'nodejs';
/** Uploads write to storage; there is nothing here to cache or prerender. */
export const dynamic = 'force-dynamic';

const BUCKET = 'resumes';

/**
 * Ten uploads per ten minutes per IP. Generous for a real applicant — a resume
 * plus a quiz ZIP, with retries — and tight enough to make bulk abuse tedious.
 *
 * PER INSTANCE: the counter is module state, so N instances allow N times this,
 * and a deploy resets it. That is a deliberate trade at this scale (a few
 * hundred applicants a year); see the note on `RateLimiter`. If the portal ever
 * needs a real limit, it belongs in a shared store or at the edge, not here.
 */
const limiter = new RateLimiter(10, 10 * 60 * 1000);

type UploadTarget = {
  /** Folder within the bucket. Server-chosen, never from the request. */
  prefix: string;
  /** What the bytes are allowed to be. */
  allowedKinds: FileKind[];
  /** The cap for this particular upload, already clamped to the absolute max. */
  maxBytes: number;
};

function failure(error: UploadError): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  return Response.json(
    { error: error.message, code: error.code },
    { status: error.status, headers },
  );
}

/** Resumes are PDFs. Nothing about this depends on the request. */
function resumeTarget(): UploadTarget {
  return {
    prefix: 'resume',
    allowedKinds: ['pdf'],
    maxBytes: Math.min(RESUME_MAX_BYTES, ABSOLUTE_MAX_BYTES),
  };
}

/**
 * Resolves what a `file` question permits, from the database.
 *
 * The posting must be OPEN. Accepting uploads against a draft or closed posting
 * would let anyone write into the bucket for a form that cannot be submitted,
 * and it is the same rule the submission action enforces.
 */
async function questionTarget(postingSlug: string, questionId: string): Promise<UploadTarget> {
  const admin = createAdminClient();

  const { data: posting, error } = await admin
    .from('postings')
    .select('id, status, question_schema')
    .eq('slug', postingSlug)
    .maybeSingle();

  if (error) {
    throw new UploadError(500, 'lookup_failed', 'Could not load the posting');
  }
  if (!posting || posting.status !== 'open') {
    // One message for "no such posting" and "not open", so this cannot be used
    // to enumerate which drafts exist.
    throw new UploadError(400, 'posting_unavailable', 'That posting is not accepting uploads');
  }

  // Core questions are included because a `file` question could in principle be
  // org-wide; today none are, and this costs one indexed read.
  const { data: core, error: coreError } = await admin
    .from('core_questions')
    .select('stable_key, position, definition')
    .order('position');
  if (coreError) {
    throw new UploadError(500, 'lookup_failed', 'Could not load the questions');
  }

  let question;
  try {
    const resolved = resolveQuestions(core ?? [], posting);
    question = resolved.find((candidate) => candidate.id === questionId);
  } catch {
    throw new UploadError(500, 'invalid_posting', 'That posting is not configured correctly');
  }

  if (!question || !isFile(question)) {
    throw new UploadError(400, 'unknown_question', 'That question does not accept a file');
  }

  // The seeded configs are checked by test, but a lead editing `question_schema`
  // in Studio is not, and an `accept` of `[]` or a `maxBytes` of 0 would
  // otherwise fail in confusing ways further down.
  let checked: FileQuestion;
  try {
    checked = validateQuestion(question) as FileQuestion;
  } catch {
    throw new UploadError(500, 'invalid_question', 'That question is not configured correctly');
  }

  const allowedKinds = kindsForAccept(checked.config.accept);
  if (allowedKinds.length === 0) {
    throw new UploadError(500, 'invalid_question', 'That question is not configured correctly');
  }

  return {
    prefix: 'question',
    allowedKinds,
    maxBytes: Math.min(checked.config.maxBytes, ABSOLUTE_MAX_BYTES),
  };
}

async function resolveTarget(url: URL): Promise<UploadTarget> {
  const purpose = url.searchParams.get('purpose');

  if (purpose === 'resume') return resumeTarget();

  if (purpose === 'question') {
    const postingSlug = url.searchParams.get('posting');
    const questionId = url.searchParams.get('question');
    if (!postingSlug || !questionId) {
      throw new UploadError(400, 'bad_request', 'A question upload needs a posting and a question');
    }
    return questionTarget(postingSlug, questionId);
  }

  throw new UploadError(400, 'bad_request', "purpose must be 'resume' or 'question'");
}

export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request.headers);
  if (!limiter.check(ip)) {
    return Response.json(
      { error: 'Too many uploads. Try again shortly.', code: 'rate_limited' },
      {
        status: 429,
        headers: {
          'cache-control': 'no-store',
          'retry-after': String(limiter.retryAfterSeconds(ip)),
        },
      },
    );
  }

  let target: UploadTarget;
  try {
    target = await resolveTarget(new URL(request.url));
  } catch (error) {
    if (error instanceof UploadError) return failure(error);
    throw error;
  }

  // Cheap refusal first: a declared length over the cap needs no bytes read.
  // A missing or dishonest header changes nothing, because the bounded read
  // below enforces the same number against what actually arrives.
  const declared = parseContentLength(request.headers.get('content-length'));
  if (declared !== null && declared > target.maxBytes) {
    return failure(
      new UploadError(413, 'too_large', `Keep the file under ${target.maxBytes} bytes`),
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithLimit(request.body, target.maxBytes);
  } catch (error) {
    if (error instanceof UploadError) return failure(error);
    return failure(new UploadError(400, 'unreadable_body', 'Could not read the uploaded file'));
  }

  // The only thing that decides what this file is.
  const kind = detectFileKind(bytes);
  if (!kind || !target.allowedKinds.includes(kind)) {
    // The filename is NOT echoed. It is attacker-controlled text that would
    // otherwise land in a toast, an error log, and possibly an admin screen.
    return failure(
      new UploadError(
        400,
        'unsupported_type',
        `That file is not one of: ${target.allowedKinds.join(', ')}`,
      ),
    );
  }

  const filename = decodeFilenameHeader(request.headers.get('x-upload-filename'));
  const path = randomStoragePath(target.prefix, kind);

  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentTypeFor(kind),
    // Never overwrite. The path is a fresh UUID, so a collision means something
    // is badly wrong and silently replacing an applicant's file would be worse.
    upsert: false,
    // The original name, kept out of the path but available to the admin UI.
    metadata: { originalFilename: filename, size: bytes.byteLength },
  });

  if (error) {
    // Storage failures are logged server-side; the applicant gets a generic
    // message, since the detail can name bucket internals.
    console.error('[upload] storage write failed', { path, message: error.message });
    return failure(new UploadError(500, 'storage_failed', 'Could not store the file'));
  }

  // Path only. Handing back a URL — even a signed one — would make every
  // uploaded resume readable by anyone who kept the link.
  return Response.json(
    { path, filename, size: bytes.byteLength },
    { headers: { 'cache-control': 'no-store' } },
  );
}
