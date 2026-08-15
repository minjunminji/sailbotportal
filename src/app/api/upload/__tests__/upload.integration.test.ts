/**
 * @jest-environment node
 */
import { adminClient } from '@/test/supabase-helpers';
import { POST } from '../route';

/**
 * The upload route against the real private bucket.
 *
 * Mocking storage here would test the mock. The things worth proving — that a
 * renamed PNG is refused, that the stored object key contains nothing from the
 * applicant's filename, that the original name survives as metadata — are all
 * properties of what actually lands in the bucket.
 *
 * Fixtures are `test-` namespaced and cleared on the way in and the way out,
 * per the convention in rls.integration.test.ts. The uploaded objects are
 * removed too: they are in the same bucket real resumes will use.
 */

const admin = adminClient();

const BUCKET = 'resumes';
const FIXTURE_TEAM_SLUG = 'test-upload';
const FIXTURE_POSTING_SLUGS = ['test-upload-2026', 'test-upload-draft-2026'];

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // '%PDF'
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // 'PK\x03\x04'
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const QUESTION_MAX_BYTES = 1024 * 1024;

/** A believable file of `size` bytes beginning with `magic`. */
function fileOf(magic: number[], size = 256): Uint8Array {
  const out = new Uint8Array(Math.max(size, magic.length));
  out.set(magic, 0);
  out.fill(0x41, magic.length);
  return out;
}

let uploadedPaths: string[] = [];
let openPostingSlug: string;
let draftPostingSlug: string;

/**
 * The rate limiter is module state in the route and 10 requests wide, and this
 * suite makes more than that. Every request therefore carries its own IP, which
 * is also what keeps the tests independent of their order. The limiter itself
 * is covered by unit tests.
 */
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter % 250}`;
}

type UploadInit = {
  purpose: 'resume' | 'question';
  body: Uint8Array | ReadableStream<Uint8Array> | null;
  filename?: string;
  posting?: string;
  question?: string;
  contentType?: string;
  contentLength?: string;
  ip?: string;
};

function uploadRequest(init: UploadInit): Request {
  const url = new URL('http://localhost/api/upload');
  url.searchParams.set('purpose', init.purpose);
  if (init.posting) url.searchParams.set('posting', init.posting);
  if (init.question) url.searchParams.set('question', init.question);

  const headers = new Headers({
    'x-forwarded-for': init.ip ?? nextIp(),
    'content-type': init.contentType ?? 'application/octet-stream',
  });
  if (init.filename !== undefined) {
    headers.set('x-upload-filename', encodeURIComponent(init.filename));
  }
  if (init.contentLength !== undefined) {
    headers.set('content-length', init.contentLength);
  }

  return new Request(url, {
    method: 'POST',
    headers,
    body: init.body as BodyInit,
    // Required by undici whenever the body is a stream.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function upload(init: UploadInit) {
  const response = await POST(uploadRequest(init));
  const json = (await response.json()) as {
    path?: string;
    filename?: string;
    size?: number;
    error?: string;
    code?: string;
  };
  if (json.path) uploadedPaths.push(json.path);
  return { status: response.status, json, response };
}

async function clearFixtures() {
  const { error: postingsError } = await admin
    .from('postings')
    .delete()
    .in('slug', FIXTURE_POSTING_SLUGS);
  if (postingsError) throw postingsError;

  const { error } = await admin.from('teams').delete().eq('slug', FIXTURE_TEAM_SLUG);
  if (error) throw error;
}

/** Objects written into the shared private bucket by this suite. */
async function clearUploads() {
  if (uploadedPaths.length === 0) return;
  const { error } = await admin.storage.from(BUCKET).remove(uploadedPaths);
  if (error) throw error;
  uploadedPaths = [];
}

beforeAll(async () => {
  await clearFixtures();

  const { data: team, error: teamError } = await admin
    .from('teams')
    .insert({ name: 'Test Upload', slug: FIXTURE_TEAM_SLUG })
    .select()
    .single();
  if (teamError) throw teamError;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: team!.id,
        title: 'Upload Fixture',
        slug: 'test-upload-2026',
        status: 'open',
        question_schema: [
          {
            id: 'quiz_zip',
            type: 'file',
            label: 'Upload your technical quiz',
            required: false,
            config: { accept: ['.zip'], maxBytes: QUESTION_MAX_BYTES },
          },
          {
            id: 'quiz_pdf',
            type: 'file',
            label: 'Upload a PDF writeup',
            required: false,
            config: { accept: ['.pdf'], maxBytes: QUESTION_MAX_BYTES },
          },
          {
            id: 'anything_else',
            type: 'long_text',
            label: 'Anything else?',
            required: false,
            config: {},
          },
        ],
      },
      {
        team_id: team!.id,
        title: 'Upload Draft Fixture',
        slug: 'test-upload-draft-2026',
        status: 'draft',
        question_schema: [
          {
            id: 'quiz_zip',
            type: 'file',
            label: 'Upload your technical quiz',
            required: false,
            config: { accept: ['.zip'], maxBytes: QUESTION_MAX_BYTES },
          },
        ],
      },
    ])
    .select();
  if (postingsError) throw postingsError;

  openPostingSlug = postings!.find((p) => p.slug === 'test-upload-2026')!.slug;
  draftPostingSlug = postings!.find((p) => p.slug === 'test-upload-draft-2026')!.slug;
});

afterAll(async () => {
  await clearUploads();
  await clearFixtures();
});

describe('the bytes decide, not the extension or the Content-Type', () => {
  /**
   * THE test for this route. Deleting the magic-byte check in `route.ts` must
   * make this fail: everything the client controls here says "PDF", and only
   * the first four bytes disagree.
   */
  it('rejects a PNG sent as resume.pdf with Content-Type: application/pdf', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: fileOf(PNG_MAGIC),
      filename: 'resume.pdf',
      contentType: 'application/pdf',
    });

    expect(status).toBe(400);
    expect(json.code).toBe('unsupported_type');
    expect(json.path).toBeUndefined();
  });

  it('rejects a ZIP sent as a resume, where only PDF is allowed', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: fileOf(ZIP_MAGIC),
      filename: 'resume.pdf',
    });
    expect(status).toBe(400);
    expect(json.code).toBe('unsupported_type');
  });

  it('rejects a PDF for a question that accepts only ZIP', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: openPostingSlug,
      question: 'quiz_zip',
      body: fileOf(PDF_MAGIC),
      filename: 'quiz.zip',
    });
    expect(status).toBe(400);
    expect(json.code).toBe('unsupported_type');
  });

  it('rejects arbitrary text', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: new TextEncoder().encode('Dear hiring team, please find my resume attached.'),
      filename: 'resume.pdf',
    });
    expect(status).toBe(400);
    expect(json.code).toBe('unsupported_type');
  });

  it('never echoes the filename back in an error', async () => {
    const hostile = '<img src=x onerror=alert(1)>.pdf';
    const { json } = await upload({
      purpose: 'resume',
      body: fileOf(PNG_MAGIC),
      filename: hostile,
    });

    const body = JSON.stringify(json);
    expect(body).not.toContain('onerror');
    expect(body).not.toContain('<img');
  });
});

describe('a valid file is stored', () => {
  it('accepts a real PDF resume and returns a path', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC, 2048),
      filename: 'Jane Doe Resume.pdf',
    });

    expect(status).toBe(200);
    expect(json.code).toBeUndefined();
    expect(json.path).toMatch(
      /^resume\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );
    expect(json.size).toBe(2048);

    // The object is really in the bucket, at that path.
    const { data, error } = await admin.storage.from(BUCKET).download(json.path!);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((await data!.arrayBuffer()).byteLength).toBe(2048);
  });

  it('accepts a ZIP when the question allows it', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: openPostingSlug,
      question: 'quiz_zip',
      body: fileOf(ZIP_MAGIC, 4096),
      filename: 'technical-quiz.zip',
    });

    expect(status).toBe(200);
    expect(json.path).toMatch(/^question\/[0-9a-f-]{36}\.zip$/);
    expect(json.size).toBe(4096);

    const { error } = await admin.storage.from(BUCKET).download(json.path!);
    expect(error).toBeNull();
  });

  it('accepts a PDF for a question that accepts PDF', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: openPostingSlug,
      question: 'quiz_pdf',
      body: fileOf(PDF_MAGIC),
      filename: 'writeup.pdf',
    });
    expect(status).toBe(200);
    expect(json.path).toMatch(/\.pdf$/);
  });

  it('returns a path and never a URL', async () => {
    const { json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: 'resume.pdf',
    });

    const body = JSON.stringify(json);
    expect(body).not.toContain('http://');
    expect(body).not.toContain('https://');
    expect(body).not.toContain('token');
    expect(Object.keys(json).sort()).toEqual(['filename', 'path', 'size']);
  });

  it('keeps the original filename as object metadata, not in the path', async () => {
    const original = 'Jane Doe — Résumé (final).pdf';
    const { json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: original,
    });

    expect(json.filename).toBe(original);

    // `info()` rather than `list()`: list returns the object's SYSTEM metadata
    // (mimetype, size, etag). User metadata lives in a separate column and only
    // info() surfaces it.
    const { data, error } = await admin.storage.from(BUCKET).info(json.path!);
    expect(error).toBeNull();
    expect((data!.metadata as Record<string, unknown> | undefined)?.originalFilename).toBe(
      original,
    );

    // The content type is derived from the bytes, not from the request header.
    expect(data!.contentType).toBe('application/pdf');
  });
});

describe('the stored path borrows nothing from the client', () => {
  it('contains no part of the filename', async () => {
    const filename = 'SupErSecretApplicantName-2026-confidential.pdf';
    const { json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename,
    });

    const path = json.path!;
    expect(path).not.toContain('SupErSecret');
    expect(path).not.toContain('ApplicantName');
    expect(path).not.toContain('confidential');
    expect(path.toLowerCase()).not.toContain('2026');

    // Nothing survives, not even a fragment: every alphabetic run of four or
    // more characters in the filename must be absent from the path.
    for (const fragment of filename.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      if (fragment === 'resume' || fragment === 'pdf') continue; // folder and extension
      expect(path.toLowerCase()).not.toContain(fragment);
    }
  });

  it('refuses to let a traversal filename escape the prefix', async () => {
    const { json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: '../../../etc/passwd.pdf',
    });

    expect(json.path!.startsWith('resume/')).toBe(true);
    expect(json.path).not.toContain('..');
    expect(json.path!.split('/')).toHaveLength(2);
  });

  it('gives two uploads of the same filename two different paths', async () => {
    const first = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: 'resume.pdf',
    });
    const second = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: 'resume.pdf',
    });

    expect(first.json.path).not.toBe(second.json.path);
    // Both survive; neither overwrote the other.
    expect((await admin.storage.from(BUCKET).download(first.json.path!)).error).toBeNull();
    expect((await admin.storage.from(BUCKET).download(second.json.path!)).error).toBeNull();
  });
});

describe('size limits', () => {
  it('rejects a body over the resume cap', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC, 6 * 1024 * 1024),
      filename: 'huge.pdf',
    });

    expect(status).toBe(413);
    expect(json.code).toBe('too_large');
    expect(json.path).toBeUndefined();
  });

  /**
   * The body here is a perfectly good 256-byte PDF: read it and the upload
   * succeeds. Only the declared `Content-Length` is oversized. A 413 therefore
   * proves the header was consulted *before* the body was, which is the cheap
   * refusal the cap is supposed to get for free.
   *
   * (Asserting "the stream was never pulled" would not work: undici pulls a
   * stream body during its own setup, whatever the handler does with it.)
   */
  it('refuses on an oversized Content-Length before looking at the body', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: 'huge.pdf',
      contentLength: String(50 * 1024 * 1024),
    });

    expect(status).toBe(413);
    expect(json.code).toBe('too_large');
    expect(json.path).toBeUndefined();
  });

  /**
   * A `Content-Length` that understates the body must not become a way to
   * bypass the cap. The header says 1 KB; the stream would supply ~64 MB. The
   * assertion that matters is `bytesProduced`, not the status: a route that
   * trusted the header would drain all of it before noticing.
   */
  it('does not read an unbounded body just because Content-Length lied', async () => {
    const CHUNK = 64 * 1024;
    const CHUNKS = 1024; // 64 MB if drained
    let produced = 0;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= CHUNKS) {
          controller.close();
          return;
        }
        produced += 1;
        controller.enqueue(produced === 1 ? fileOf(PDF_MAGIC, CHUNK) : new Uint8Array(CHUNK));
      },
    });

    const { status, json } = await upload({
      purpose: 'resume',
      body,
      filename: 'liar.pdf',
      contentLength: '1024',
    });

    expect(status).toBe(413);
    expect(json.code).toBe('too_large');
    expect(json.path).toBeUndefined();

    // Read stopped near the 5 MB cap rather than continuing to 64 MB.
    expect(produced * CHUNK).toBeLessThan(6 * 1024 * 1024);
  });

  it('honours the per-question cap from the database', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: openPostingSlug,
      question: 'quiz_zip',
      body: fileOf(ZIP_MAGIC, QUESTION_MAX_BYTES + 1),
      filename: 'quiz.zip',
    });

    expect(status).toBe(413);
    // The message quotes the question's own limit, not the global one.
    expect(json.error).toContain(String(QUESTION_MAX_BYTES));
  });

  it('rejects an empty body', async () => {
    const { status, json } = await upload({
      purpose: 'resume',
      body: new Uint8Array(0),
      filename: 'empty.pdf',
    });
    expect(status).toBe(400);
    expect(json.code).toBe('empty_body');
  });
});

describe('what an upload is allowed to target', () => {
  it('rejects a missing purpose', async () => {
    const url = new URL('http://localhost/api/upload');
    const response = await POST(
      new Request(url, {
        method: 'POST',
        headers: { 'x-forwarded-for': nextIp() },
        body: fileOf(PDF_MAGIC) as unknown as BodyInit,
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('bad_request');
  });

  it('rejects an unknown purpose', async () => {
    const url = new URL('http://localhost/api/upload?purpose=malware');
    const response = await POST(
      new Request(url, {
        method: 'POST',
        headers: { 'x-forwarded-for': nextIp() },
        body: fileOf(PDF_MAGIC) as unknown as BodyInit,
      }),
    );
    expect(response.status).toBe(400);
  });

  it('rejects a question upload with no posting or question', async () => {
    const { status, json } = await upload({ purpose: 'question', body: fileOf(ZIP_MAGIC) });
    expect(status).toBe(400);
    expect(json.code).toBe('bad_request');
  });

  it('rejects an unknown question id', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: openPostingSlug,
      question: 'no_such_question',
      body: fileOf(ZIP_MAGIC),
    });
    expect(status).toBe(400);
    expect(json.code).toBe('unknown_question');
  });

  it('rejects a question that is not a file question', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: openPostingSlug,
      question: 'anything_else',
      body: fileOf(ZIP_MAGIC),
    });
    expect(status).toBe(400);
    expect(json.code).toBe('unknown_question');
  });

  it('rejects an upload against a draft posting', async () => {
    const { status, json } = await upload({
      purpose: 'question',
      posting: draftPostingSlug,
      question: 'quiz_zip',
      body: fileOf(ZIP_MAGIC),
    });
    expect(status).toBe(400);
    expect(json.code).toBe('posting_unavailable');
  });

  it('gives the same answer for a posting that does not exist, so drafts cannot be enumerated', async () => {
    const missing = await upload({
      purpose: 'question',
      posting: 'test-upload-no-such-posting',
      question: 'quiz_zip',
      body: fileOf(ZIP_MAGIC),
    });
    expect(missing.json.code).toBe('posting_unavailable');
  });
});

describe('rate limiting', () => {
  it('refuses an IP that exceeds the window', async () => {
    const ip = '198.51.100.7';
    const results: number[] = [];

    // The limiter is 10 wide; the eleventh from one IP must be refused.
    for (let i = 0; i < 11; i += 1) {
      const { status } = await upload({
        purpose: 'resume',
        body: fileOf(PDF_MAGIC),
        filename: 'resume.pdf',
        ip,
      });
      results.push(status);
    }

    expect(results.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(results[10]).toBe(429);
  });

  it('sets Retry-After when it refuses', async () => {
    const ip = '198.51.100.8';
    for (let i = 0; i < 10; i += 1) {
      await upload({ purpose: 'resume', body: fileOf(PDF_MAGIC), filename: 'r.pdf', ip });
    }
    const { response, status } = await upload({
      purpose: 'resume',
      body: fileOf(PDF_MAGIC),
      filename: 'r.pdf',
      ip,
    });
    expect(status).toBe(429);
    expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
