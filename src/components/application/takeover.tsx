'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The board's card-click view of an application.
 *
 * A NATIVE `<dialog>`, opened with `showModal()`. That one call buys focus
 * trapping, Escape to dismiss, `inert` on the rest of the page, and top-layer
 * painting that no z-index can lose a fight with. Every one of those is fiddly
 * and easy to get subtly wrong by hand, and getting them wrong strands keyboard
 * users behind a page they cannot reach.
 *
 * Closing means going BACK, not hiding a div. The takeover exists because an
 * intercepting route put an application's URL in the address bar; leaving that
 * URL in place while removing the view would leave the two disagreeing, and the
 * back button would then appear to do nothing.
 *
 * SIZED, NOT FULLSCREEN. It was edge to edge, and that read as a navigation
 * rather than an overlay — the board vanished, so nothing on screen said the
 * view was temporary or which column the applicant sat in. Leaving the board
 * visible and dimmed says both. The width is still generous because this is not
 * a peek: the answers and the resume sit side by side, and a PDF needs around
 * 500px before it stops being a thumbnail, so the two panes together set the
 * floor rather than the amount of text does.
 */
export function Takeover({ label, children }: { label: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      // Fires for Escape and for `close()` alike, so every route out leads to
      // the same place.
      onClose={() => router.back()}
      onClick={(event) => {
        // A click on the backdrop reports the dialog itself as its target;
        // anything inside reports that child. The inner element below covers
        // the dialog's whole content box, so this can only be the backdrop.
        if (event.target === ref.current) ref.current?.close();
      }}
      // `m-auto` against `inset-0` is what centres it. A modal dialog is
      // normally centred by the user agent's own `margin: auto`, which
      // Tailwind's preflight resets to 0 — without this it sits in the
      // top-left corner. `max-h-none` overrides the user agent's default cap
      // for the same reason.
      className="fixed inset-0 m-auto h-[88vh] max-h-none w-[92vw] max-w-[1100px] rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
    >
      {/* Padding lives here rather than on the dialog, so a click landing just
          inside the edge still counts as content and not as "outside". */}
      <div className="relative flex h-full min-h-0 flex-col p-6">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label="Close application"
          className="absolute top-4 right-4 rounded-md p-1.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>

        {children}
      </div>
    </dialog>
  );
}
