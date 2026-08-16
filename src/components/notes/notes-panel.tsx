'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { addApplicationNote } from '@/app/actions/add-application-note';
import type { ApplicationNote } from '@/lib/applications/notes';

export function NotesPanel({
  applicationId,
  initialNotes,
}: {
  applicationId: string;
  initialNotes: ApplicationNote[];
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mobileModal, setMobileModal] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closingRef = useRef(false);

  const countLabel = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;

  function close() {
    closingRef.current = true;
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    closingRef.current = false;
    setOpen(true);
  }

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 639px)');
    if (!media) return;

    const update = () => setMobileModal(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    };

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dialogRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) composerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !mobileModal) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (closingRef.current || dialog.contains(event.target as Node)) return;
      event.stopPropagation();
      composerRef.current?.focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [mobileModal, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await addApplicationNote(applicationId, body);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotes((current) => [...current, result.note]);
      setDraft('');
    } catch {
      setError('Could not add this note. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative ml-auto">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Notes, ${countLabel}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
        </svg>
        <span>Notes</span>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
          {notes.length}
        </span>
      </button>

      {open ? (
        <>
          <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/40 sm:hidden" />
          <section
            ref={dialogRef}
            role="dialog"
            aria-label="Application notes"
            aria-modal={mobileModal || undefined}
            className="fixed inset-x-3 top-12 z-50 flex max-h-[min(28rem,calc(100dvh-4rem))] flex-col rounded-lg border border-border bg-background shadow-xl sm:absolute sm:inset-x-auto sm:top-10 sm:right-0 sm:w-[24rem] sm:max-w-[calc(100vw-3rem)]"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {notes.length === 0 ? (
                <p className="py-5 text-center text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <ol className="space-y-4">
                  {notes.map((note) => (
                    <li key={note.id} className="border-l-2 border-border pl-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium">{note.authorName}</span>
                        <time
                          dateTime={note.createdAt}
                          className="text-xs tabular-nums text-muted-foreground"
                        >
                          {formatNoteDate(note.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{note.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <form onSubmit={submit} className="border-t border-border p-4">
              <textarea
                ref={composerRef}
                id={`note-${applicationId}`}
                aria-label="New note"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="New note"
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {error ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={draft.trim().length === 0 || submitting}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {submitting ? 'Adding…' : 'Add note'}
                </button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}

const NOTE_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

function formatNoteDate(value: string): string {
  return NOTE_DATE.format(new Date(value));
}
