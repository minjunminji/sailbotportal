'use client';

import { useRef, useState } from 'react';
import type { FileAnswer } from '@/lib/questions/types';
import { formatBytes } from './answers';
import { controlClasses, smallButtonClasses } from './question-shell';
import { SHARED_FIELD_IDS } from './types';
import { UploadFailed, uploadFile } from './upload';

/**
 * The resume, uploaded once and attached to every application this submission
 * creates — one file, however many teams.
 *
 * Deliberately required by the form even though `applications.resume_path` is
 * nullable: the 2025 form required it, and leads read it before every
 * interview. The failure message names the team inboxes for the same reason the
 * 2025 form did, because someone whose upload will not go through needs
 * somewhere to go that is not this page.
 *
 * Rendered inside `IdentitySection`'s "About you" section rather than under a
 * heading of its own: it is one more fact about the applicant, asked before
 * anything team-specific, and a whole section for one file input gave it more
 * ceremony than a single upload button needs.
 */
export function ResumeUpload({
  resume,
  onChange,
  error,
  disabled,
}: {
  resume: FileAnswer | null;
  onChange: (resume: FileAnswer | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const fieldId = SHARED_FIELD_IDS.resumePath;
  const inputId = `${fieldId}-input`;
  const helpId = `${fieldId}-help`;
  const statusId = `${fieldId}-status`;
  const errorId = `${fieldId}-error`;

  // Nothing to say before a file exists — 'No file uploaded yet' told the
  // applicant only what the empty control beside it already showed.
  const status = uploading
    ? 'Uploading…'
    : resume
      ? `Uploaded ${resume.filename} (${formatBytes(resume.size)})`
      : null;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFailure(null);
    setUploading(true);
    try {
      onChange(await uploadFile(file, { purpose: 'resume' }));
    } catch (caught) {
      setFailure(
        caught instanceof UploadFailed ? caught.message : 'The file could not be uploaded.',
      );
      onChange(null);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div id={fieldId}>
      <label htmlFor={inputId} className="block text-base font-medium">
        Resume
      </label>
      <input
        id={inputId}
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled || uploading}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={[helpId, status ? statusId : null, error ? errorId : null]
          .filter(Boolean)
          .join(' ')}
        onChange={(event) => void handleFile(event.target.files?.[0])}
        className={`mt-3 ${controlClasses}`}
      />

      <p id={helpId} className="mt-2 text-sm text-muted-foreground">
        PDF only, up to 5 MB.
      </p>

      {status ? (
        <p id={statusId} aria-live="polite" className="mt-2 text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}

      {failure ? (
        <p className="mt-2 text-sm text-destructive">
          {failure} If this keeps happening, email mech@ubcsailbot.org, electrical@ubcsailbot.org,
          or software@ubcsailbot.org.
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {resume ? (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => {
            setFailure(null);
            onChange(null);
          }}
          className={`mt-3 ${smallButtonClasses}`}
        >
          Remove resume
        </button>
      ) : null}
    </div>
  );
}
