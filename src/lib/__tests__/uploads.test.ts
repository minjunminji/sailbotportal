/**
 * @jest-environment node
 */
import {
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
  safeFilename,
} from '../uploads';

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // '%PDF'
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // 'PK\x03\x04'
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function withTrailer(magic: Uint8Array, extra = 32): Uint8Array {
  const out = new Uint8Array(magic.length + extra);
  out.set(magic, 0);
  out.fill(0x41, magic.length);
  return out;
}

/** A stream that hands over `chunks` one read at a time. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index++]);
    },
  });
}

describe('detectFileKind reads the bytes, not the name', () => {
  it('recognises a PDF', () => {
    expect(detectFileKind(withTrailer(PDF_MAGIC))).toBe('pdf');
  });

  it('recognises a ZIP', () => {
    expect(detectFileKind(withTrailer(ZIP_MAGIC))).toBe('zip');
  });

  it('rejects a PNG, whatever it might be called', () => {
    expect(detectFileKind(withTrailer(PNG_MAGIC))).toBeNull();
  });

  it('rejects an empty buffer', () => {
    expect(detectFileKind(new Uint8Array(0))).toBeNull();
  });

  it('rejects a truncated signature', () => {
    expect(detectFileKind(PDF_MAGIC.slice(0, 3))).toBeNull();
  });

  it('rejects a signature that is not at offset zero', () => {
    // A polyglot: junk, then '%PDF'. Real readers tolerate this; a check that
    // searched rather than anchored would be trivially defeated by it.
    const shifted = new Uint8Array([0x00, 0x00, ...PDF_MAGIC]);
    expect(detectFileKind(shifted)).toBeNull();
  });

  it('rejects plain text that merely mentions PDF', () => {
    expect(detectFileKind(new TextEncoder().encode('this is a PDF, honest'))).toBeNull();
  });
});

describe('kindsForAccept', () => {
  it('maps extensions to kinds', () => {
    expect(kindsForAccept(['.pdf'])).toEqual(['pdf']);
    expect(kindsForAccept(['.zip'])).toEqual(['zip']);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(kindsForAccept([' .ZIP '])).toEqual(['zip']);
  });

  it('maps MIME entries too', () => {
    expect(kindsForAccept(['application/pdf'])).toEqual(['pdf']);
  });

  it('treats OOXML as ZIP, which is what it is', () => {
    expect(kindsForAccept(['.docx'])).toEqual(['zip']);
  });

  it('drops unknown entries rather than treating them as a wildcard', () => {
    expect(kindsForAccept(['.exe', 'application/octet-stream'])).toEqual([]);
    expect(kindsForAccept(['.exe', '.pdf'])).toEqual(['pdf']);
  });

  it('deduplicates', () => {
    expect(kindsForAccept(['.zip', '.docx', 'application/zip'])).toEqual(['zip']);
  });
});

describe('contentTypeFor', () => {
  it('derives the content type from the detected kind', () => {
    expect(contentTypeFor('pdf')).toBe('application/pdf');
    expect(contentTypeFor('zip')).toBe('application/zip');
  });
});

describe('parseContentLength', () => {
  it('reads a plain integer', () => {
    expect(parseContentLength('1024')).toBe(1024);
  });

  it.each([null, '', 'abc', '-1', '1.5', '1e999'])('returns null for %p', (header) => {
    expect(parseContentLength(header)).toBeNull();
  });
});

describe('readBodyWithLimit', () => {
  it('returns the body when it fits', async () => {
    const body = await readBodyWithLimit(streamOf([PDF_MAGIC, new Uint8Array([1, 2, 3])]), 1000);
    expect(Array.from(body)).toEqual([...PDF_MAGIC, 1, 2, 3]);
  });

  it('accepts a body exactly at the limit', async () => {
    const body = await readBodyWithLimit(streamOf([new Uint8Array(10)]), 10);
    expect(body.byteLength).toBe(10);
  });

  it('rejects a body one byte over the limit', async () => {
    await expect(readBodyWithLimit(streamOf([new Uint8Array(11)]), 10)).rejects.toMatchObject({
      status: 413,
      code: 'too_large',
    });
  });

  it('rejects a null body', async () => {
    await expect(readBodyWithLimit(null, 10)).rejects.toBeInstanceOf(UploadError);
  });

  it('rejects an empty body', async () => {
    await expect(readBodyWithLimit(streamOf([]), 10)).rejects.toMatchObject({
      code: 'empty_body',
    });
  });

  /**
   * The lying `Content-Length` case, which is the whole reason this function
   * exists instead of `await request.arrayBuffer()`.
   *
   * The stream below would produce 500 MB if it were drained. The assertion is
   * not merely that it throws — it is that it stopped reading almost
   * immediately, which is what "does not buffer 500 MB" actually means.
   */
  it('stops reading a body that far exceeds the cap, rather than draining it', async () => {
    const CHUNK = 64 * 1024;
    const TOTAL_CHUNKS = 8000; // ~500 MB if fully read
    const LIMIT = 1024;

    let chunksProduced = 0;
    let cancelled = false;

    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksProduced >= TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        chunksProduced += 1;
        controller.enqueue(new Uint8Array(CHUNK));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBodyWithLimit(endless, LIMIT)).rejects.toMatchObject({ status: 413 });

    // The first chunk already blew the 1 KB cap. A couple more may exist
    // because ReadableStream pulls ahead to keep its queue full, but the
    // remaining ~7997 were never requested and the producer was told to stop.
    // The number that matters: bytes produced, against the 500 MB a draining
    // read would have taken.
    expect(chunksProduced).toBeLessThanOrEqual(3);
    expect(chunksProduced * CHUNK).toBeLessThan(1024 * 1024);
    expect(cancelled).toBe(true);
  });

  it('cancels the stream on rejection so the connection is not left held', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(50));
        controller.enqueue(new Uint8Array(50));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBodyWithLimit(stream, 10)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it('skips zero-length chunks without ending the read', async () => {
    const body = await readBodyWithLimit(
      streamOf([new Uint8Array(0), PDF_MAGIC, new Uint8Array(0)]),
      100,
    );
    expect(Array.from(body)).toEqual([...PDF_MAGIC]);
  });
});

describe('randomStoragePath', () => {
  it('is a prefix, a UUID and an extension from the kind', () => {
    const path = randomStoragePath('resume', 'pdf');
    expect(path).toMatch(
      /^resume\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );
  });

  it('uses the kind for the extension, not any caller-supplied name', () => {
    expect(randomStoragePath('question', 'zip')).toMatch(/\.zip$/);
  });

  it('never repeats', () => {
    const paths = new Set(Array.from({ length: 500 }, () => randomStoragePath('resume', 'pdf')));
    expect(paths.size).toBe(500);
  });
});

describe('safeFilename', () => {
  it('keeps an ordinary name', () => {
    expect(safeFilename('Jane Doe Resume.pdf')).toBe('Jane Doe Resume.pdf');
  });

  it('strips directory traversal', () => {
    expect(safeFilename('../../etc/passwd')).not.toContain('/');
    expect(safeFilename('..\\..\\windows\\system32')).not.toContain('\\');
  });

  it('strips NUL and control characters', () => {
    expect(safeFilename('resume\u0000.pdf\u001b[31m')).toBe('resume.pdf[31m');
  });

  it('caps the length', () => {
    expect(safeFilename('a'.repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFilename('')).toBe('upload');
    expect(safeFilename('   ')).toBe('upload');
    expect(safeFilename('\u0000\u0001\u007f')).toBe('upload');
    expect(safeFilename(null)).toBe('upload');
    expect(safeFilename(undefined)).toBe('upload');
  });

  it('does not pre-escape HTML, which the renderer would double-escape', () => {
    expect(safeFilename('<script>.pdf')).toBe('<script>.pdf');
  });
});

describe('decodeFilenameHeader', () => {
  it('percent-decodes a UTF-8 name', () => {
    expect(decodeFilenameHeader(encodeURIComponent('résumé señor.pdf'))).toBe('résumé señor.pdf');
  });

  it('falls back on a malformed encoding rather than throwing', () => {
    expect(decodeFilenameHeader('%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('sanitises what it decodes', () => {
    expect(decodeFilenameHeader(encodeURIComponent('../../evil.pdf'))).not.toContain('/');
  });

  it('defaults when the header is absent', () => {
    expect(decodeFilenameHeader(null)).toBe('upload');
  });
});

describe('RateLimiter', () => {
  it('allows up to the limit and refuses beyond it', () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.check('1.2.3.4', 0)).toBe(true);
    expect(limiter.check('1.2.3.4', 0)).toBe(true);
    expect(limiter.check('1.2.3.4', 0)).toBe(true);
    expect(limiter.check('1.2.3.4', 0)).toBe(false);
  });

  it('counts each IP separately', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check('1.1.1.1', 0)).toBe(true);
    expect(limiter.check('2.2.2.2', 0)).toBe(true);
    expect(limiter.check('1.1.1.1', 0)).toBe(false);
  });

  it('lets the window expire', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check('1.1.1.1', 0)).toBe(true);
    expect(limiter.check('1.1.1.1', 500)).toBe(false);
    expect(limiter.check('1.1.1.1', 1001)).toBe(true);
  });

  it('reports how long until a retry succeeds', () => {
    const limiter = new RateLimiter(1, 10_000);
    limiter.check('1.1.1.1', 0);
    expect(limiter.retryAfterSeconds('1.1.1.1', 0)).toBe(10);
    expect(limiter.retryAfterSeconds('1.1.1.1', 5000)).toBe(5);
    expect(limiter.retryAfterSeconds('unseen', 0)).toBe(0);
  });

  it('prunes expired keys so a flood of distinct IPs cannot grow it forever', () => {
    const limiter = new RateLimiter(1, 100);
    for (let i = 0; i < 1000; i += 1) limiter.check(`10.0.0.${i}`, 0);
    // One later call prunes every expired entry.
    limiter.check('10.0.1.1', 5000);
    expect(limiter.check('10.0.0.1', 5000)).toBe(true);
  });
});

describe('clientIp', () => {
  it('takes the first entry of x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18' });
    expect(clientIp(headers)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('returns a shared bucket when nothing identifies the caller', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
