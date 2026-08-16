'use client';

import { useRef, useState } from 'react';
import type { FileQuestion } from '@/lib/questions/types';
import { asFileAnswer, formatBytes } from '../answers';
import {
  QuestionShell,
  controlClasses,
  describedBy,
  inputId,
  smallButtonClasses,
} from '../question-shell';
import { UploadFailed, uploadFile } from '../upload';
import type { FieldProps } from './field-props';

/**
 * A file answer — the software technical quiz ZIP, today.
 *
 * The upload happens on selection rather than at submit, because the answer
 * stored on the application is the storage path the server hands back, not the
 * bytes. `accept` is a hint to the file picker only: the route reads the magic
 * bytes and is the only thing that decides what a file actually is.
 */
export function FileField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
  postingSlug,
}: FieldProps<FileQuestion> & { postingSlug: string }) {
  const answer = asFileAnswer(value);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const statusId = `${fieldId}-status`;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setFailure(null);
    setUploading(true);
    try {
      const uploaded = await uploadFile(file, {
        purpose: 'question',
        postingSlug,
        questionId: question.id,
      });
      onChange(uploaded);
    } catch (caught) {
      setFailure(
        caught instanceof UploadFailed ? caught.message : 'The file could not be uploaded.',
      );
      onChange(undefined);
    } finally {
      setUploading(false);
      // Cleared so choosing the same file again still fires a change event.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error}>
      <input
        id={inputId(fieldId)}
        ref={input}
        type="file"
        accept={question.config.accept.join(',')}
        disabled={disabled || uploading}
        aria-required={question.required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, question, error, statusId)}
        onChange={(event) => void handleFile(event.target.files?.[0])}
        className={controlClasses}
      />

      <p id={statusId} aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {uploading
          ? 'Uploading…'
          : answer
            ? `Uploaded ${answer.filename} (${formatBytes(answer.size)})`
            : `${question.config.accept.join(' or ')}, up to ${formatBytes(question.config.maxBytes)}`}
      </p>

      {failure ? <p className="mt-2 text-sm text-destructive">{failure}</p> : null}

      {answer ? (
        <button
          type="button"
          disabled={disabled || uploading}
          onClick={() => {
            setFailure(null);
            onChange(undefined);
          }}
          className={`mt-2 ${smallButtonClasses}`}
        >
          Remove file
        </button>
      ) : null}
    </QuestionShell>
  );
}
