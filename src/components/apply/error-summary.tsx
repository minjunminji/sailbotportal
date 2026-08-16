'use client';

import type { Ref } from 'react';
import type { FieldError } from './validate';

/**
 * Everything wrong with the form, in one place, linking to each field.
 *
 * This form is long enough that an error thirty questions down is invisible
 * without it. The links are real anchors to the field's id, so they work with a
 * keyboard, with a screen reader, and with the back button.
 *
 * `role="alert"` rather than a polite region: a submission that was refused is
 * exactly the case where interrupting is right.
 */
export function ErrorSummary({
  errors,
  message,
  headingRef,
  children,
}: {
  errors: FieldError[];
  /** The overall failure, when the server sent one. */
  message?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Extra detail, such as which teams already have an application. */
  children?: React.ReactNode;
}) {
  if (errors.length === 0 && !message && !children) return null;

  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive bg-card p-6 text-card-foreground"
    >
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-destructive">
        {message ?? 'Your application could not be sent yet'}
      </h2>

      {errors.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {errors.map((error) => (
            <li key={`${error.fieldId}:${error.message}`} className="text-sm">
              <a
                href={`#${error.fieldId}`}
                className="rounded-md underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              >
                {error.label}: {error.message}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {children ? <div className="mt-4 text-sm">{children}</div> : null}
    </div>
  );
}
