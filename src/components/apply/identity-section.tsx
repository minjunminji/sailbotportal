'use client';

import { DEPARTMENT_SUGGESTIONS, SHARED_FIELD_IDS, YEAR_OF_STUDY_OPTIONS } from './types';
import { controlClasses } from './question-shell';
import type { ErrorMap } from './validate';

/**
 * Step 1: who is applying.
 *
 * These four are columns on `applications` rather than questions, so they are
 * hand-written rather than rendered by the question dispatcher.
 */
export function IdentitySection({
  name,
  email,
  yearOfStudy,
  homeDepartment,
  onChange,
  errors,
  disabled,
}: {
  name: string;
  email: string;
  yearOfStudy: string;
  homeDepartment: string;
  onChange: (field: 'name' | 'email' | 'yearOfStudy' | 'homeDepartment', value: string) => void;
  errors: ErrorMap;
  disabled?: boolean;
}) {
  return (
    <section aria-labelledby="about-you-heading">
      <h2 id="about-you-heading" className="text-lg font-semibold">
        About you
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Asked once. Every team you apply to sees the same answers.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <Field
          id={SHARED_FIELD_IDS.name}
          label="Full name"
          error={errors.get(SHARED_FIELD_IDS.name)}
        >
          {(inputId, describedBy, invalid) => (
            <input
              id={inputId}
              type="text"
              // The browser fills these correctly only if it is told what they
              // are, and an applicant filling this on a phone will notice.
              autoComplete="name"
              value={name}
              disabled={disabled}
              required
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => onChange('name', event.target.value)}
              className={controlClasses}
            />
          )}
        </Field>

        <Field
          id={SHARED_FIELD_IDS.email}
          label="Email"
          help="We reply to this address, and it is what identifies your application."
          error={errors.get(SHARED_FIELD_IDS.email)}
        >
          {(inputId, describedBy, invalid) => (
            <input
              id={inputId}
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              disabled={disabled}
              required
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => onChange('email', event.target.value)}
              className={controlClasses}
            />
          )}
        </Field>

        <Field
          id={SHARED_FIELD_IDS.yearOfStudy}
          label="Year of study"
          error={errors.get(SHARED_FIELD_IDS.yearOfStudy)}
        >
          {(inputId, describedBy, invalid) => (
            <select
              id={inputId}
              value={yearOfStudy}
              disabled={disabled}
              required
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => onChange('yearOfStudy', event.target.value)}
              className={controlClasses}
            >
              <option value="">Choose your year</option>
              {YEAR_OF_STUDY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id={SHARED_FIELD_IDS.homeDepartment}
          label="Home department"
          help="Choose a suggestion, or type your own if it is not listed."
          error={errors.get(SHARED_FIELD_IDS.homeDepartment)}
        >
          {(inputId, describedBy, invalid) => (
            <>
              {/*
                A native combobox: suggestions when there is a match, free text
                when there is not. Free text alone fragments into 'CPEN', 'comp
                eng' and 'Computer Engineering' inside one recruiting cycle,
                which is what breaks grouping in the export; a closed list turns
                away every department nobody thought of.
              */}
              <input
                id={inputId}
                type="text"
                list="home-department-options"
                autoComplete="off"
                value={homeDepartment}
                disabled={disabled}
                required
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => onChange('homeDepartment', event.target.value)}
                className={controlClasses}
              />
              <datalist id="home-department-options">
                {DEPARTMENT_SUGGESTIONS.map((department) => (
                  <option key={department} value={department} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </div>
    </section>
  );
}

/** The label/help/error wrapper the four identity fields share. */
function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: (
    inputId: string,
    describedBy: string | undefined,
    invalid: true | undefined,
  ) => React.ReactNode;
}) {
  const inputId = `${id}-input`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div id={id}>
      <label htmlFor={inputId} className="block text-base font-medium">
        {label}
        <span aria-hidden="true" className="ml-1 text-destructive">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </label>
      {help ? (
        <p id={helpId} className="mt-2 text-sm text-muted-foreground">
          {help}
        </p>
      ) : null}
      <div className="mt-3">{children(inputId, describedBy, error ? true : undefined)}</div>
      {error ? (
        <p id={errorId} className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
