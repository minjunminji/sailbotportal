'use client';

import type { FileAnswer } from '@/lib/questions/types';
import {
  APPLIED_SCIENCE,
  APPLIED_SCIENCE_PROGRAMS,
  FACULTY_OPTIONS,
  SHARED_FIELD_IDS,
  YEAR_OF_STUDY_OPTIONS,
} from './types';
import { controlClasses } from './question-shell';
import { ResumeUpload } from './resume-upload';
import type { ErrorMap } from './validate';

/**
 * Step 1: who is applying — plus the resume, which is a fact about the
 * applicant rather than about any one team.
 *
 * The five identity fields are columns on `applications` rather than
 * questions, so they are hand-written rather than rendered by the question
 * dispatcher. The resume is its own component, uploaded through a route the
 * rest of this section knows nothing about, but it is rendered here rather
 * than under a heading of its own further down the page: it is the same kind
 * of fact as a name or an email, asked once before anything team-specific, and
 * a whole section for one file input gave it more ceremony than it needs.
 *
 * The identity fields are laid out in two rows — name and email, then the
 * three school fields — rather than as full-width inputs. Every one of them is
 * a few characters wide, so a column each costs nothing in legibility and
 * saves the applicant most of a screen of scrolling before they reach the
 * first real question. The rows collapse to one column below `sm`, where three
 * side by side would be three boxes too narrow to read what is in them.
 */
export function IdentitySection({
  name,
  email,
  yearOfStudy,
  faculty,
  homeDepartment,
  resume,
  onChange,
  onResumeChange,
  errors,
  disabled,
}: {
  name: string;
  email: string;
  yearOfStudy: string;
  faculty: string;
  homeDepartment: string;
  resume: FileAnswer | null;
  onChange: (
    field: 'name' | 'email' | 'yearOfStudy' | 'faculty' | 'homeDepartment',
    value: string,
  ) => void;
  onResumeChange: (resume: FileAnswer | null) => void;
  errors: ErrorMap;
  disabled?: boolean;
}) {
  return (
    <section id="about-you" aria-labelledby="about-you-heading" className="scroll-mt-8">
      <h2 id="about-you-heading" className="text-lg font-semibold">
        About you
      </h2>

      <div className="mt-6 flex flex-col gap-6">
        <div className="grid gap-6 sm:grid-cols-2">
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
        </div>

        <div className="grid gap-6 sm:grid-cols-3">
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
            id={SHARED_FIELD_IDS.faculty}
            label="Faculty"
            error={errors.get(SHARED_FIELD_IDS.faculty)}
          >
            {(inputId, describedBy, invalid) => (
              <select
                id={inputId}
                value={faculty}
                disabled={disabled}
                required
                aria-invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => onChange('faculty', event.target.value)}
                className={controlClasses}
              >
                <option value="">Choose your faculty</option>
                {FACULTY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            id={SHARED_FIELD_IDS.homeDepartment}
            label="Program or major"
            error={errors.get(SHARED_FIELD_IDS.homeDepartment)}
          >
            {(inputId, describedBy, invalid) =>
              /*
                A closed list for Applied Science, free text for everyone else.

                Free text alone fragments into 'CPEN', 'comp eng' and 'Computer
                Engineering' inside one recruiting cycle, which is what breaks
                grouping in the export — and engineering is where that happens,
                because it is the faculty whose programs have codes people type
                from memory. Outside it there is no shared vocabulary to enforce
                and no list anyone could finish writing, so the box takes what
                the applicant says they study.
              */
              faculty === APPLIED_SCIENCE ? (
                <select
                  id={inputId}
                  value={homeDepartment}
                  disabled={disabled}
                  required
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange('homeDepartment', event.target.value)}
                  className={controlClasses}
                >
                  <option value="">Choose your program</option>
                  {APPLIED_SCIENCE_PROGRAMS.map((program) => (
                    <option key={program.code} value={program.code}>
                      {program.code} — {program.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  type="text"
                  autoComplete="off"
                  placeholder="e.g. Biology"
                  value={homeDepartment}
                  disabled={disabled}
                  required
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => onChange('homeDepartment', event.target.value)}
                  className={controlClasses}
                />
              )
            }
          </Field>
        </div>

        <ResumeUpload
          resume={resume}
          onChange={onResumeChange}
          error={errors.get(SHARED_FIELD_IDS.resumePath)}
          disabled={disabled}
        />
      </div>
    </section>
  );
}

/**
 * The label/help/error wrapper the five identity fields share.
 *
 * Help text sits BELOW the control rather than above it. These fields are laid
 * out in rows now, and help above the input would push one field's box lower
 * than its neighbours' for no reason the applicant can see.
 */
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
      {/* No required marker: all five are, and `required` on the control is
          what announces that. See `OptionalMark`. */}
      <label htmlFor={inputId} className="block text-base font-medium">
        {label}
      </label>
      <div className="mt-3">{children(inputId, describedBy, error ? true : undefined)}</div>
      {help ? (
        <p id={helpId} className="mt-2 text-sm text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
