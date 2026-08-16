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
      // Fires for Escape and for `close()` alike, so both routes out lead to
      // the same place.
      onClose={() => router.back()}
      onClick={(event) => {
        // A click on the backdrop reports the dialog itself as its target;
        // clicks on anything inside report that child. This is the whole
        // difference between "clicked outside" and "clicked the content".
        if (event.target === ref.current) ref.current?.close();
      }}
      className="h-[90dvh] w-[95vw] max-w-6xl rounded-lg border border-border bg-background p-0 text-foreground backdrop:bg-black/40"
    >
      {/* The padding lives here rather than on the dialog, so a click landing
          in the padding still counts as a click on the content. */}
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="self-start rounded-md text-sm text-muted-foreground underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Close
        </button>
        {children}
      </div>
    </dialog>
  );
}
