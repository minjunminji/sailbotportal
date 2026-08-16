/**
 * The resume, beside the answers.
 *
 * A NATIVE `<embed>` rather than a JavaScript PDF renderer. Every browser a
 * lead will use already has a PDF viewer with text selection, search, zoom and
 * printing; shipping pdf.js to reimplement those would be several hundred
 * kilobytes to arrive at something worse.
 *
 * `src` points at this app's own route, never at storage. The route checks the
 * caller against RLS and redirects to a ten-minute signed URL, so no
 * credential-bearing URL is ever written into the page and authorisation is
 * re-checked on every request.
 *
 * THE DOWNLOAD LINK IS NOT A NICETY. An `<embed>` that cannot render gives no
 * error and fires no event — it just shows nothing, and there is no reliable
 * way to detect that. So the fallback is always visible rather than revealed on
 * a failure that cannot be observed: if the pane looks empty, the way out is
 * already on screen.
 */
export function ResumeViewer({
  applicationId,
  applicantName,
  hasResume,
}: {
  applicationId: string;
  applicantName: string;
  hasResume: boolean;
}) {
  if (!hasResume) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No resume was uploaded with this application.
        </p>
      </div>
    );
  }

  const src = `/api/resume/${applicationId}`;

  /**
   * PDF Open Parameters, which Chrome's built-in viewer honours.
   *
   * Without them the pane shows Chrome's whole PDF application — a grey
   * chrome bar with zoom, rotate, print, download and a thumbnail rail —
   * nested inside the page. That is a second set of controls competing with
   * the app's own, and it steals most of the width of a pane that only has to
   * show one page of A4.
   *
   * `toolbar=0` drops the bar, `navpanes=0` the thumbnail rail, and
   * `view=FitH` fits the page to the pane's width rather than opening at
   * whatever zoom was last used. Scrolling still works, which a two-page
   * resume needs.
   *
   * These live in the FRAGMENT, which is never sent to a server — and a
   * fragment survives a redirect whose target carries none of its own, so it
   * still applies after `/api/resume/<id>` bounces to the signed URL.
   *
   * Best-effort by nature: a browser whose viewer ignores them shows its own
   * UI, which is why the download link below is permanent rather than a
   * fallback that has to be triggered.
   */
  const embedSrc = `${src}#toolbar=0&navpanes=0&view=FitH`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        <embed
          src={embedSrc}
          type="application/pdf"
          className="h-full w-full"
          aria-label={`Resume from ${applicantName}`}
        />
      </div>

      <a
        href={`${src}?download`}
        className="self-start rounded-sm text-sm text-muted-foreground underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Download resume
      </a>
    </div>
  );
}
