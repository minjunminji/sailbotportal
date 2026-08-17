/**
 * The note that explains why a form nobody has typed into is already full.
 *
 * It is pinned to the bottom of the viewport rather than sitting in the form's
 * flow. It is a fact about the page, not a step in the application, and in the
 * flow it pushed the first question down the screen and made the form open on
 * an administrative message.
 *
 * IT DOES NOT EXPIRE. The usual toast disappears after a few seconds because it
 * confirms something the person just did and already knows. This one answers a
 * question — "why is all of this filled in?" — that occurs to someone a little
 * after the page has loaded, which is precisely when a timed toast would be
 * gone. It leaves when it is dismissed, or when starting over makes it untrue.
 */

/** 24×24 stroked outline, matching `../board/icons`. */
function CloseIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function DraftNotice({
  onStartOver,
  onDismiss,
}: {
  onStartOver: () => void;
  onDismiss: () => void;
}) {
  return (
    // The wrapper spans the viewport to centre the notice and takes no clicks;
    // a full-width fixed bar that swallowed them would make the text underneath
    // it unselectable and any control beneath it dead.
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
      <div
        role="status"
        className="pointer-events-auto flex max-w-full items-center gap-3 rounded-lg border border-border bg-card py-2 pl-4 pr-2 text-card-foreground shadow-lg"
      >
        <p className="text-sm text-muted-foreground">
          We restored what you had already written on this device.
        </p>

        {/*
          Text, not a bordered button. It is the lesser of the two things
          somebody wants here — most people came back precisely to keep what
          they wrote — and an outlined button beside a sentence reads as the
          action the notice is asking for.
        */}
        <button
          type="button"
          onClick={onStartOver}
          className="rounded-sm text-sm font-medium underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Start over
        </button>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-md p-2 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
