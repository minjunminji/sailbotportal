'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The board-framed view of an application.
 *
 * A NATIVE `<dialog>`, opened with `showModal()`. That one call buys focus
 * trapping, Escape to dismiss, `inert` on the rest of the page, and top-layer
 * painting that no z-index can lose a fight with. Every one of those is fiddly
 * and easy to get subtly wrong by hand, and getting them wrong strands keyboard
 * users behind a page they cannot reach.
 *
 * RENDERED OPEN, THEN PROMOTED. `showModal()` can only run once the element
 * exists, and a closed dialog is `display: none` with no backdrop — so opening
 * it from an effect alone paints one frame of the bare, undimmed board every
 * time this element is created, which is on every load AND on every arrow
 * navigation, since the new applicant mounts a new dialog. Shipping it already
 * open makes the first painted frame the finished one. The dimming is ours for
 * the same reason: a dialog that is merely open has no `::backdrop` to tint,
 * and the real backdrop is left transparent so nothing darkens twice.
 *
 * Dismissal navigates rather than calling `close()`, so the promotion below —
 * which must close before it can re-open modally — can never be mistaken for
 * the user leaving.
 *
 * SIZED, NOT FULLSCREEN. It was edge to edge, and that read as a navigation
 * rather than an overlay — the board vanished, so nothing on screen said the
 * view was temporary or which column the applicant sat in. Leaving the board
 * visible and dimmed says both. The width is still generous because this is not
 * a peek: the answers and the resume sit side by side, and a PDF needs around
 * 500px before it stops being a thumbnail, so the two panes together set the
 * floor rather than the amount of text does.
 */
export function Takeover({
  label,
  returnHref,
  children,
}: {
  label: string;
  returnHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const dismiss = () => router.replace(returnHref);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // `showModal` rejects a dialog that is already open, so the painted-open
    // state has to be given up in the same breath it is replaced.
    if (dialog.open) dialog.close();
    dialog.showModal();
  }, []);

  return (
    <>
      {/* Below the dialog, above the board. Purely the tint; the dialog owns
          every interaction, including clicks that land beside it. */}
      <div className="pointer-events-none fixed inset-0 z-40 bg-black/50" />

      <dialog
        ref={ref}
        open
        aria-label={label}
        // Escape. Left open deliberately: the takeover stays put until the
        // board it is navigating to arrives, rather than blinking out first.
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        onClick={(event) => {
          // A click on the backdrop reports the dialog itself as its target;
          // anything inside reports that child. The inner element below covers
          // the dialog's whole content box, so this can only be the backdrop.
          if (event.target === ref.current) dismiss();
        }}
        // `m-auto` against `inset-0` is what centres it. A modal dialog is
        // normally centred by the user agent's own `margin: auto`, which
        // Tailwind's preflight resets to 0 — without this it sits in the
        // top-left corner. `max-h-none` overrides the user agent's default cap
        // for the same reason. `z-50` only matters before promotion; a modal
        // dialog paints in the top layer, where z-index has no say.
        className="fixed inset-0 z-50 m-auto h-[88vh] max-h-none w-[92vw] max-w-[1100px] rounded-lg border border-border bg-background p-0 text-foreground shadow-lg backdrop:bg-transparent"
      >
        {/* Padding lives here rather than on the dialog, so a click landing just
            inside the edge still counts as content and not as "outside". */}
        <div className="relative flex h-full min-h-0 flex-col p-6">
          <button
            type="button"
            onClick={dismiss}
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
    </>
  );
}
