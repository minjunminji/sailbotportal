'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type {
  DuplicateTeam,
  SubmissionInput,
  SubmitResult,
  SubmittedTeam,
} from '@/app/actions/submit-application';
import { isQuestionVisible } from '@/lib/questions/schema';
import type { Answer, AnswerMap, Question } from '@/lib/questions/types';
import { Confirmation } from './confirmation';
import { ErrorSummary } from './error-summary';
import { IdentitySection } from './identity-section';
import { QuestionList } from './question-field';
import { ResumeUpload } from './resume-upload';
import { ReviewSection } from './review-section';
import { SectionRail } from './section-rail';
import { formSections } from './sections';
import { clearDraft, loadDraft, saveDraft } from './storage';
import { TeamGates } from './team-gates';
import { TeamQuestions } from './team-questions';
import { useActiveSection } from './use-active-section';
import {
  coreFieldId,
  emptyFormState,
  rankedSlugs,
  type ApplyData,
  type ApplyPosting,
  type FormState,
} from './types';
import { errorMap, mapServerIssues, validateForm, type FieldError } from './validate';
import { visibleCoreQuestions } from './visibility';

/**
 * The whole applicant-facing form: one form covering every open team.
 *
 * State lives here rather than in a store or in the URL. It is one screen, it
 * is thrown away on success, and the only thing that has to outlive a refresh
 * is the draft — which `./storage` handles on its own.
 *
 * The submit action arrives as a prop rather than being imported. That keeps
 * the server module out of the client bundle graph for tests, and makes the one
 * side effect this component has visible in its signature.
 */
export function ApplyForm({
  data,
  submit,
}: {
  data: ApplyData;
  submit: (input: SubmissionInput) => Promise<SubmitResult>;
}) {
  const initial = useMemo(() => emptyFormState(data), [data]);

  /**
   * The saved draft, read through `useSyncExternalStore` rather than in an
   * effect.
   *
   * `localStorage` does not exist while the page is being rendered on the
   * server, and reading it during the hydration render would make the client
   * disagree with the HTML it is hydrating. This hook exists for exactly that:
   * it returns the server snapshot (nothing) while hydrating and swaps to the
   * real one immediately afterwards, with no state written from an effect.
   *
   * Cached per mount, so the draft is the one that existed when the page
   * loaded. Re-reading it on every render would fight the autosave below —
   * every keystroke writes, and a snapshot that changed on every write would
   * loop.
   */
  const draftCache = useRef<{ value: FormState | null } | null>(null);
  const readDraft = useCallback(() => {
    draftCache.current ??= { value: loadDraft(data) };
    return draftCache.current.value;
  }, [data]);
  const draft = useSyncExternalStore(subscribeNever, readDraft, noDraft);

  /** Null until something is typed; the draft (or an empty form) shows through. */
  const [edited, setEdited] = useState<FormState | null>(null);
  const [startedOver, setStartedOver] = useState(false);
  const state = edited ?? draft ?? initial;
  const hadDraft = draft !== null && !startedOver;

  const [phase, setPhase] = useState<'form' | 'review'>('form');
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [failure, setFailure] = useState<{
    message: string;
    duplicateTeams?: DuplicateTeam[];
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ teams: SubmittedTeam[]; email: string } | null>(
    null,
  );

  // Bots fill every input they can see. This one is hidden from people and from
  // assistive technology, so anything in it is not a person.
  const [honeypot, setHoneypot] = useState('');

  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  /** Field to move focus to after the next render, once errors are on screen. */
  const focusTarget = useRef<string | null>(null);

  // The first run is the state as it was rendered, which is either empty or the
  // draft itself — writing it back would, in the hydration case, overwrite the
  // saved draft with an empty form in the instant before it is swapped in.
  const savedOnce = useRef(false);
  useEffect(() => {
    if (!savedOnce.current) {
      savedOnce.current = true;
      return;
    }
    saveDraft(data, state);
  }, [data, state]);

  useEffect(() => {
    const fieldId = focusTarget.current;
    if (!fieldId) return;
    focusTarget.current = null;
    focusField(fieldId);
  });

  const fieldErrors = errorMap(errors);
  const selectedPostings = data.postings.filter((posting) => state.teams[posting.slug]?.selected);

  // The rail and the page below are generated from this one array, so a row
  // cannot exist without the section it links to, or the reverse.
  const sections = formSections(data, state, errors);
  const { activeId, onNavigate } = useActiveSection(sections.map((section) => section.id));

  function update(change: (previous: FormState) => FormState) {
    setEdited((previous) => change(previous ?? draft ?? initial));
  }

  function check(): FieldError[] {
    const found = validateForm(data, state);
    setErrors(found);
    if (found.length > 0) {
      setFailure(null);
      // The summary is rendered above the form; focus goes to the first field
      // that needs work, which is what someone can act on immediately.
      focusTarget.current = found[0].fieldId;
    }
    return found;
  }

  function handleReview() {
    if (check().length > 0) return;
    setPhase('review');
    window.scrollTo?.({ top: 0 });
  }

  async function handleSubmit() {
    if (submitting) return;
    if (check().length > 0) {
      setPhase('form');
      return;
    }

    setSubmitting(true);
    setFailure(null);
    try {
      const result = await submit(buildSubmission(data, state, honeypot));

      if (result.ok) {
        clearDraft();
        setSubmitted({ teams: result.teams, email: state.email.trim() });
        return;
      }

      const mapped = mapServerIssues(data, result.issues);
      setErrors(mapped);
      setFailure({ message: result.message, duplicateTeams: result.duplicateTeams });
      setPhase('form');
      if (mapped.length > 0) focusTarget.current = mapped[0].fieldId;
      else summaryHeading.current?.focus();
    } catch {
      // A server action can fail before it returns anything — a dropped
      // connection, a deploy mid-request. The draft is still saved, so retrying
      // costs nothing.
      setErrors([]);
      setFailure({ message: 'Your application could not be sent. Try again in a moment.' });
      setPhase('form');
      summaryHeading.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (submitted) confirmationRef.current?.querySelector('h1')?.focus();
  }, [submitted]);

  if (submitted) {
    return (
      <div ref={confirmationRef}>
        <Confirmation teams={submitted.teams} email={submitted.email} />
      </div>
    );
  }

  return (
    <form
      // The browser's own validation bubbles would compete with the summary and
      // stop at the first field; this form reports every problem at once.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      {/* In the DOM before it has content, so filling it is announced. */}
      <div aria-live="assertive" className="empty:hidden">
        <ErrorSummary errors={errors} message={failure?.message} headingRef={summaryHeading}>
          {failure?.duplicateTeams && failure.duplicateTeams.length > 0 ? (
            <>
              <p>
                An application already exists for {state.email.trim()} on{' '}
                {failure.duplicateTeams.length === 1 ? 'this team' : 'these teams'}:
              </p>
              <ul className="mt-2 list-disc pl-6">
                {failure.duplicateTeams.map((team) => (
                  <li key={team.postingSlug}>{team.teamName || team.postingSlug}</li>
                ))}
              </ul>
              <p className="mt-2">
                Answer No for {failure.duplicateTeams.length === 1 ? 'that team' : 'those teams'}{' '}
                and submit again, or email the team if you need to change an application you already
                sent.
              </p>
            </>
          ) : null}
        </ErrorSummary>
      </div>

      {hadDraft && phase === 'form' ? (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 text-card-foreground">
          <p className="text-sm text-muted-foreground">
            We restored what you had already written on this device.
          </p>
          <button
            type="button"
            onClick={() => {
              clearDraft();
              setEdited(initial);
              setStartedOver(true);
              setErrors([]);
              setFailure(null);
            }}
            className="mt-2 rounded-md border border-border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          >
            Start over
          </button>
        </div>
      ) : null}

      <div className="mt-8 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        {/*
          Hidden below `lg` rather than reshaped for it. A sticky element
          competing with an on-screen keyboard and a focused textarea costs a
          phone more room than the orientation is worth. Also hidden during
          review, when none of the sections it links to are on the page.
        */}
        <div className="hidden lg:block">
          {phase === 'form' ? (
            <SectionRail
              sections={sections}
              activeId={activeId}
              onNavigate={onNavigate}
              applyingTo={selectedPostings.map((posting) => posting.teamName)}
              onReview={handleReview}
              disabled={submitting}
            />
          ) : null}
        </div>

        <div className="min-w-0">
          {phase === 'review' ? (
            <div>
              <ReviewSection data={data} state={state} onEdit={() => setPhase('form')} />
            </div>
          ) : (
            <div className="flex flex-col gap-12">
              <IdentitySection
                name={state.name}
                email={state.email}
                yearOfStudy={state.yearOfStudy}
                homeDepartment={state.homeDepartment}
                errors={fieldErrors}
                disabled={submitting}
                onChange={(field, value) => update((previous) => ({ ...previous, [field]: value }))}
              />

              {visibleCoreQuestions(data, state).length > 0 ? (
                <section id="shared-questions" className="scroll-mt-8">
                  <QuestionList
                    questions={visibleCoreQuestions(data, state)}
                    fieldIdFor={coreFieldId}
                    answers={state.coreAnswers}
                    errors={fieldErrors}
                    disabled={submitting}
                    // A core `file` question would be resolved against any open
                    // posting; the route checks the question really belongs to it.
                    uploadPostingSlug={data.postings[0]?.slug ?? ''}
                    onAnswer={(questionId, value) =>
                      update((previous) => ({
                        ...previous,
                        coreAnswers: writeAnswer(previous.coreAnswers, questionId, value),
                      }))
                    }
                  />
                </section>
              ) : null}

              <TeamGates
                postings={data.postings}
                teams={state.teams}
                errors={fieldErrors}
                disabled={submitting}
                onSelect={(slug, selected) =>
                  update((previous) => ({
                    ...previous,
                    teams: {
                      ...previous.teams,
                      [slug]: { ...previous.teams[slug], selected },
                    },
                  }))
                }
              />

              {/*
            Only chosen teams render, which is the same condition that decides
            whether the rail carries a row for them.
          */}
              {selectedPostings.map((posting) => (
                <TeamQuestions
                  key={posting.slug}
                  posting={posting}
                  state={state.teams[posting.slug]}
                  errors={fieldErrors}
                  disabled={submitting}
                  onRank={(rankedSubteams) =>
                    update((previous) => ({
                      ...previous,
                      teams: {
                        ...previous.teams,
                        [posting.slug]: { ...previous.teams[posting.slug], rankedSubteams },
                      },
                    }))
                  }
                  onAnswer={(questionId, value) =>
                    update((previous) => ({
                      ...previous,
                      teams: {
                        ...previous.teams,
                        [posting.slug]: {
                          ...previous.teams[posting.slug],
                          answers: writeAnswer(
                            previous.teams[posting.slug].answers,
                            questionId,
                            value,
                          ),
                        },
                      },
                    }))
                  }
                />
              ))}

              <ResumeUpload
                resume={state.resume}
                error={fieldErrors.get('resume-upload')}
                disabled={submitting}
                onChange={(resume) => update((previous) => ({ ...previous, resume }))}
              />
            </div>
          )}

          {/* Hidden from sight and from assistive technology; never focusable. */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="website-field">Leave this field empty</label>
            <input
              id="website-field"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
            />
          </div>

          <div className="mt-12 flex flex-wrap gap-4">
            {phase === 'form' ? (
              <button
                type="button"
                onClick={handleReview}
                disabled={submitting}
                className="rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
              >
                Review your application
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Submit application'}
              </button>
            )}
            <p className="self-center text-sm text-muted-foreground">
              {selectedPostings.length === 0
                ? 'No teams chosen yet.'
                : `Applying to ${selectedPostings.map((posting) => posting.teamName).join(', ')}.`}
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}

/** The draft is read once per mount, so there is nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

/** No draft exists while rendering on the server. */
function noDraft(): FormState | null {
  return null;
}

/** Writing `undefined` removes the key, so an unanswered question stays absent. */
function writeAnswer(answers: AnswerMap, questionId: string, value: Answer | undefined): AnswerMap {
  const next = { ...answers };
  if (value === undefined) delete next[questionId];
  else next[questionId] = value;
  return next;
}

/** Answers for the questions that are actually on screen for this ranking. */
function visibleAnswers(
  questions: Question[],
  answers: AnswerMap,
  ranked: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const question of questions) {
    if (!isQuestionVisible(question, ranked)) continue;
    const value = answers[question.id];
    if (value !== undefined) out[question.id] = value;
  }
  return out;
}

/**
 * The payload for one submission.
 *
 * Core answers are merged into EVERY selected team, because each team's row
 * carries its own snapshot of core questions plus its own. Answers to questions
 * the ranking hid are left out rather than sent: they would be stored on the
 * application and read by a lead as something the applicant meant to say.
 */
export function buildSubmission(data: ApplyData, state: FormState, honeypot = ''): SubmissionInput {
  const selected: ApplyPosting[] = data.postings.filter(
    (posting) => state.teams[posting.slug]?.selected,
  );

  return {
    name: state.name.trim(),
    email: state.email.trim(),
    yearOfStudy: state.yearOfStudy,
    homeDepartment: state.homeDepartment.trim(),
    resumePath: state.resume?.path ?? null,
    honeypot,
    teams: selected.map((posting) => {
      const team = state.teams[posting.slug];
      const ranked = rankedSlugs(posting, team.rankedSubteams);
      return {
        postingSlug: posting.slug,
        answers: {
          ...visibleAnswers(data.coreQuestions, state.coreAnswers, ranked),
          ...visibleAnswers(posting.questions, team.answers, ranked),
        },
        // A team that does not rank subteams must send an empty list: the
        // server treats anything else as a payload this form could not produce.
        rankedSubteams: posting.ranking.enabled ? team.rankedSubteams : [],
      };
    }),
  };
}

/**
 * Moves focus to a field named by the error summary.
 *
 * Prefers the first control inside the field, since that is what the applicant
 * has to change. Falls back to the wrapper — a fieldset or a section — made
 * focusable for the purpose, which is how a group of radios or a matrix gets
 * focus at all.
 */
function focusField(fieldId: string): void {
  const container = document.getElementById(fieldId);
  if (!container) return;

  const control = container.querySelector<HTMLElement>(
    'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
  );

  const target = control ?? container;
  if (target === container && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  target.focus({ preventScroll: true });
  // Guarded: not every environment implements it, and losing the scroll is
  // survivable where losing focus is not.
  target.scrollIntoView?.({ block: 'center' });
}
