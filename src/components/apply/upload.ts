import type { FileAnswer } from '@/lib/questions/types';

/**
 * The browser half of `/api/upload`.
 *
 * That route takes a RAW body, not `multipart/form-data`, so it can refuse a
 * file at the cap instead of buffering it first — see the note there. This
 * means the file itself is the request body and the filename travels in a
 * header, percent-encoded because a header is a latin-1 channel and student
 * filenames routinely are not.
 *
 * The response carries a storage path and never a URL, so what comes back here
 * is exactly what a `file` answer holds.
 */

export type UploadTarget =
  { purpose: 'resume' } | { purpose: 'question'; postingSlug: string; questionId: string };

export class UploadFailed extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'UploadFailed';
  }
}

function endpoint(target: UploadTarget): string {
  const params = new URLSearchParams({ purpose: target.purpose });
  if (target.purpose === 'question') {
    params.set('posting', target.postingSlug);
    params.set('question', target.questionId);
  }
  return `/api/upload?${params.toString()}`;
}

export async function uploadFile(file: File, target: UploadTarget): Promise<FileAnswer> {
  let response: Response;
  try {
    response = await fetch(endpoint(target), {
      method: 'POST',
      headers: {
        // Not `multipart/form-data`. The bytes are the body.
        'content-type': 'application/octet-stream',
        'x-upload-filename': encodeURIComponent(file.name),
      },
      body: file,
    });
  } catch {
    throw new UploadFailed(
      'The upload could not reach the server. Check your connection.',
      'network',
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A proxy can return HTML for a 413 or a 502; fall through to the status.
  }

  const payload = (body ?? {}) as {
    path?: unknown;
    filename?: unknown;
    size?: unknown;
    error?: unknown;
    code?: unknown;
  };

  if (!response.ok) {
    throw new UploadFailed(
      typeof payload.error === 'string' ? payload.error : 'The file could not be uploaded.',
      typeof payload.code === 'string' ? payload.code : String(response.status),
    );
  }

  if (
    typeof payload.path !== 'string' ||
    typeof payload.filename !== 'string' ||
    typeof payload.size !== 'number'
  ) {
    throw new UploadFailed('The upload finished but the response was unreadable.', 'bad_response');
  }

  return { path: payload.path, filename: payload.filename, size: payload.size };
}
