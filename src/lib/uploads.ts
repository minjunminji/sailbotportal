/**
 * The pure half of file upload: signature detection, bounded reads, path
 * generation, filename hygiene, and rate limiting.
 *
 * Deliberately free of Supabase, `server-only`, and Next imports so it can be
 * unit-tested directly. The route in `src/app/api/upload/route.ts` supplies the
 * service role and the storage write; everything a hostile client can influence
 * is decided here.
 */

/** File shapes the portal accepts. Extend only alongside a signature. */
export type FileKind = 'pdf' | 'zip';

/**
 * Leading bytes that identify a file, checked instead of `Content-Type` and
 * instead of the extension. A client picks both of those freely, so a PNG
 * arrives as `resume.pdf` with `Content-Type: application/pdf` for the cost of
 * renaming it.
 *
 * `zip` is the honest name for what this detects. OOXML documents — `.docx`,
 * `.xlsx`, `.pptx` — are ZIP archives and are indistinguishable here without
 * parsing the central directory. That is acceptable: the check exists to stop
 * executables and images masquerading as documents, not to police which
 * document format arrived inside a ZIP container.
 */
const SIGNATURES: Record<FileKind, readonly number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46], // '%PDF'
  zip: [0x50, 0x4b, 0x03, 0x04], // 'PK\x03\x04'
};

/** Extension used in storage, chosen from the detected kind rather than the name. */
const EXTENSION: Record<FileKind, string> = { pdf: 'pdf', zip: 'zip' };

/** Content type recorded on the object, again from the bytes, not the request. */
const CONTENT_TYPE: Record<FileKind, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
};

/**
 * Question `accept` entries mapped to the kind their bytes would present as.
 * OOXML formats map to `zip` because that is genuinely what they are.
 */
const ACCEPT_TO_KIND: Record<string, FileKind> = {
  '.pdf': 'pdf',
  'application/pdf': 'pdf',
  '.zip': 'zip',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  '.docx': 'zip',
  '.xlsx': 'zip',
  '.pptx': 'zip',
};

/** Nothing may exceed this, whatever a question's `maxBytes` claims. */
export const ABSOLUTE_MAX_BYTES = 10 * 1024 * 1024;

/** Resumes are PDFs and a PDF resume is small. */
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;

/** A rejection carrying the HTTP status and a stable code the client can branch on. */
export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Reads the first bytes of `data` and reports what it actually is.
 *
 * The signature must be at offset 0. Some PDFs in the wild carry junk before
 * `%PDF` and readers tolerate it; this does not, because "search the first N
 * bytes for a marker" is how a polyglot file passes a check.
 */
export function detectFileKind(data: Uint8Array): FileKind | null {
  for (const [kind, signature] of Object.entries(SIGNATURES) as [FileKind, number[]][]) {
    if (data.length < signature.length) continue;
    if (signature.every((byte, index) => data[index] === byte)) return kind;
  }
  return null;
}

/**
 * The kinds a question's `accept` list permits.
 *
 * Unknown entries are dropped rather than treated as a wildcard: an `accept`
 * naming a format with no signature must accept nothing, not everything.
 */
export function kindsForAccept(accept: readonly string[]): FileKind[] {
  const kinds = new Set<FileKind>();
  for (const entry of accept) {
    const kind = ACCEPT_TO_KIND[entry.trim().toLowerCase()];
    if (kind) kinds.add(kind);
  }
  return [...kinds];
}

export function contentTypeFor(kind: FileKind): string {
  return CONTENT_TYPE[kind];
}

/**
 * `Content-Length`, or null when absent or unusable.
 *
 * A present, oversized value lets the request be refused without reading a
 * byte. A missing or lying one changes nothing, because `readBodyWithLimit`
 * enforces the same cap against the bytes that actually arrive — the header is
 * an optimisation, never the check.
 */
export function parseContentLength(header: string | null): number | null {
  if (header === null) return null;

  // Decimal digits only, matched before conversion. `Number()` alone would read
  // '' as 0 (a declared-empty body that is not empty), '0x10' as 16, and
  // ' 12 ' as 12 — all of which make the header say something it did not.
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Buffers a request body, refusing once more than `limit` bytes have arrived.
 *
 * The guard is inside the read loop rather than after it. `await
 * request.arrayBuffer()` or `request.formData()` would materialise the whole
 * body first and check its length second, which is no defence at all: a caller
 * declaring `Content-Length: 1024` and then sending 500 MB would be 500 MB into
 * memory before anything noticed.
 *
 * Accumulated chunks are dropped at the moment the cap is passed, so the peak
 * cost of a hostile body is the cap plus one chunk — the transport decides the
 * chunk size, typically tens of kilobytes.
 */
export async function readBodyWithLimit(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array> {
  if (!body) {
    throw new UploadError(400, 'empty_body', 'The request had no body');
  }

  const reader = body.getReader();
  let chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > limit) {
        chunks = [];
        await reader.cancel();
        throw new UploadError(413, 'too_large', `Keep the file under ${limit} bytes`);
      }

      chunks.push(value);
    }
  } finally {
    // Safe after cancel(); the lock is released either way so the stream can be
    // torn down rather than left held by a rejected request.
    try {
      reader.releaseLock();
    } catch {
      // Already released by cancel() on some runtimes.
    }
  }

  if (total === 0) {
    throw new UploadError(400, 'empty_body', 'The request had no body');
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * The name shown to a lead in the admin UI, and nothing more.
 *
 * It never reaches a storage path, so this is about what is safe to store and
 * later render: directory traversal, NUL and control characters, and unbounded
 * length are all removed. Escaping for HTML is the renderer's job — storing
 * pre-escaped text would double-escape the moment React renders it normally.
 */
export function safeFilename(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return 'upload';

  const cleaned = raw
    // Path separators first, so `..\evil` cannot survive as `..evil`.
    .replace(/[\\/]+/g, ' ')
    // C0 controls and DEL: the characters that break a log line or a header,
    // rather than merely looking odd in a filename.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();

  return cleaned === '' ? 'upload' : cleaned;
}

/**
 * Percent-decodes the `x-upload-filename` header, tolerating a malformed one.
 *
 * The header carries a UTF-8 filename through a latin-1 channel. A client that
 * encodes it wrongly gets a fallback name, not a 500.
 */
export function decodeFilenameHeader(raw: string | null): string {
  if (raw === null) return 'upload';
  try {
    return safeFilename(decodeURIComponent(raw));
  } catch {
    return safeFilename(raw);
  }
}

/**
 * `<prefix>/<uuid>.<ext>` — no part of the client's filename appears.
 *
 * A client-derived path is a directory traversal waiting to happen, leaks the
 * applicant's name into an object key, and lets one upload overwrite another by
 * reusing a name. The original name lives in the object's metadata instead.
 */
export function randomStoragePath(prefix: string, kind: FileKind): string {
  return `${prefix}/${crypto.randomUUID()}.${EXTENSION[kind]}`;
}

/**
 * Fixed-window request counter, keyed by IP.
 *
 * PER INSTANCE, and deliberately so. Uploads are anonymous, the portal runs a
 * handful of instances for a few hundred applicants a year, and the failure it
 * guards against is one script hammering one instance. A shared counter would
 * mean Redis for a problem this size. It also resets on deploy, which is a real
 * limitation and an acceptable one here.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True when the request may proceed. Counts the request either way. */
  check(key: string, now: number = Date.now()): boolean {
    this.prune(now);

    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count += 1;
    return entry.count <= this.limit;
  }

  /** Seconds until `key` may retry, for the `Retry-After` header. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  /** Drops expired keys, so a stream of distinct IPs cannot grow the map forever. */
  private prune(now: number): void {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }

  /** Test seam. Never called by the route. */
  reset(): void {
    this.hits.clear();
  }
}

/**
 * The caller's IP, as best the proxy reports it.
 *
 * Spoofable when the app is reachable without a trusted proxy in front, which
 * is why the rate limiter is a courtesy control and the size cap, the signature
 * check, and the private bucket are the real ones.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
