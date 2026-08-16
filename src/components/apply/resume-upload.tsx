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
    <section id={fieldId} aria-labelledby="resume-heading">
      <h2 id="resume-heading" className="text-lg font-semibold">
        Your resume
      </h2>
      <p id={helpId} className="mt-2 text-sm text-muted-foreground">
        PDF only, up to 5 MB. The same file goes to every team you apply to.
      </p>

      <div className="mt-6">
        <label htmlFor={inputId} className="block text-base font-medium">
          Resume
          <span aria-hidden="true" className="ml-1 text-destructive">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </label>
        <input
          id={inputId}
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          disabled={disabled || uploading}
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={[helpId, statusId, error ? errorId : null].filter(Boolean).join(' ')}
          onChange={(event) => void handleFile(event.target.files?.[0])}
          className={`mt-3 ${controlClasses}`}
        />

        <p id={statusId} aria-live="polite" className="mt-2 text-sm text-muted-foreground">
          {uploading
            ? 'Uploading…'
            : resume
              ? `Uploaded ${resume.filename} (${formatBytes(resume.size)})`
              : 'No file uploaded yet.'}
        </p>

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
    </section>
  );
}
