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
 * It covers the viewport rather than floating over it. Reading an application
 * is the task, not a glance at one — the board behind would only be something
 * to lose the cursor in.
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
      // FILLS THE VIEWPORT. `fixed inset-0` rather than a width and a height,
      // and `m-0 max-w-none max-h-none` to beat the user-agent's own sizing —
      // a modal dialog is centred by `margin: auto`, which Tailwind's preflight
      // resets to `0`, so without this it sits in the top-left corner at
      // whatever size it was given.
      //
      // There is no backdrop left to click, so closing is Escape or the button.
      className="fixed inset-0 m-0 h-auto max-h-none w-auto max-w-none border-0 bg-background p-0 text-foreground"
    >
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
