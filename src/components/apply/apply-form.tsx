'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Answer, AnswerMap } from '@/lib/questions/types';
import { ErrorSummary } from './error-summary';
import { IdentitySection } from './identity-section';
import { QuestionList } from './question-field';
import { clearDraft, loadDraft, saveDraft } from './storage';
import { coreFieldId, emptyFormState, type ApplyData, type FormState } from './types';
import { errorMap, validateForm, type FieldError } from './validate';
import { visibleCoreQuestions } from './visibility';

/**
 * The applicant-facing form: one form covering every open team.
 *
 * State lives here rather than in a store or in the URL. It is one screen, it
 * is thrown away on success, and the only thing that has to outlive a refresh
 * is the draft — which `./storage` handles on its own.
 *
 * This is the shared half: who is applying, and the questions every team asks.
 * The per-team branches and the submission hang off the same state.
 */
export function ApplyForm({ data }: { data: ApplyData }) {
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

  const [errors, setErrors] = useState<FieldError[]>([]);

  const summaryHeading = useRef<HTMLHeadingElement>(null);
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

  function update(change: (previous: FormState) => FormState) {
    setEdited((previous) => change(previous ?? draft ?? initial));
  }

  function check(): FieldError[] {
    const found = validateForm(data, state);
    setErrors(found);
    if (found.length > 0) {
      // The summary is rendered above the form; focus goes to the first field
      // that needs work, which is what someone can act on immediately.
      focusTarget.current = found[0].fieldId;
    }
    return found;
  }

  return (
    <form
      // The browser's own validation bubbles would compete with the summary and
      // stop at the first field; this form reports every problem at once.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        check();
      }}
    >
      {/* In the DOM before it has content, so filling it is announced. */}
      <div aria-live="assertive" className="empty:hidden">
        <ErrorSummary errors={errors} headingRef={summaryHeading} />
      </div>

      {hadDraft ? (
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
            }}
            className="mt-2 rounded-md border border-border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          >
            Start over
          </button>
        </div>
      ) : null}

      <div className="mt-8 flex flex-col gap-12">
        <IdentitySection
          name={state.name}
          email={state.email}
          yearOfStudy={state.yearOfStudy}
          homeDepartment={state.homeDepartment}
          errors={fieldErrors}
          onChange={(field, value) => update((previous) => ({ ...previous, [field]: value }))}
        />

        {visibleCoreQuestions(data, state).length > 0 ? (
          <section aria-labelledby="shared-questions-heading">
            <h2 id="shared-questions-heading" className="text-lg font-semibold">
              About your interest in Sailbot
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Asked once, whichever teams you apply to.
            </p>
            <div className="mt-6">
              <QuestionList
                questions={visibleCoreQuestions(data, state)}
                fieldIdFor={coreFieldId}
                answers={state.coreAnswers}
                errors={fieldErrors}
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
            </div>
          </section>
        ) : null}
      </div>

      <div className="mt-12">
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          Check your answers
        </button>
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
export function writeAnswer(
  answers: AnswerMap,
  questionId: string,
  value: Answer | undefined,
): AnswerMap {
  const next = { ...answers };
  if (value === undefined) delete next[questionId];
  else next[questionId] = value;
  return next;
}

/**
 * Moves focus to a field named by the error summary.
 *
 * Prefers the first control inside the field, since that is what the applicant
 * has to change. Falls back to the wrapper — a fieldset or a section — made
 * focusable for the purpose, which is how a group of radios or a matrix gets
 * focus at all.
 */
export function focusField(fieldId: string): void {
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
