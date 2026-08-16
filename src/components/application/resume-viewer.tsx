'use client';

import { useEffect, useRef, useState } from 'react';
// Type-only, so it is erased at build and does not drag pdf.js into any bundle
// that merely mentions this component.
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

/**
 * The resume, rendered by the app rather than by the browser.
 *
 * WHY NOT A NATIVE `<embed>`. It was one, and it mostly worked — but what a
 * browser does with an embedded PDF is the browser's business, not ours.
 * Chrome's "Download PDFs instead of automatically opening them" setting turns
 * the pane into a grey download prompt; with the setting off it renders the
 * whole Chrome PDF application inside the pane, a second toolbar and thumbnail
 * rail competing with our own UI. Neither is detectable from script, so the app
 * could not even fall back. Rendering the pages ourselves is the only way the
 * pane looks the same for everybody.
 *
 * `pdfjs-dist` is a real dependency and not a small one, but it loads only on
 * this route — the board and the public apply form never import it — and it is
 * the same engine Firefox ships as its built-in viewer.
 *
 * THE PAGES ARE BUILT IMPERATIVELY. pdf.js draws into a canvas and positions a
 * text layer against it; both are DOM it owns. React manages the shell and gets
 * out of the way inside, which is why this reaches for refs rather than state
 * to hold the output.
 */

type Status = 'loading' | 'ready' | 'empty' | 'error';

/** Beyond this, more pixels stop being visible and start being memory. */
const MAX_DEVICE_SCALE = 2;

export function ResumeViewer({
  applicationId,
  applicantName,
  hasResume,
}: {
  applicationId: string;
  applicantName: string;
  hasResume: boolean;
}) {
  const src = `/api/resume/${applicationId}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>(hasResume ? 'loading' : 'empty');
  const [width, setWidth] = useState(0);

  // The pane's width decides the render scale, so it has to be known before
  // anything is drawn and re-read when the window changes.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      // Ignored below a few pixels: re-rasterising every page for a one-pixel
      // scrollbar change is expensive and invisible.
      setWidth((current) => (Math.abs(current - next) > 8 ? next : current));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasResume]);

  useEffect(() => {
    if (!hasResume || width === 0) return;

    let cancelled = false;
    // The loading TASK, not the document: `destroy` lives here, and holding it
    // means an unmount can abort a load still in flight.
    let task: PDFDocumentLoadingTask | undefined;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Served from `public/`, put there by `scripts/copy-pdf-worker.mjs`.
        // An absolute path rather than a bundler-resolved one: see that script
        // for why the usual `new URL(...)` trick fails silently at runtime.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

        // Fetched here rather than handed to pdf.js as a URL: this is one
        // same-origin request that follows the route's redirect with the
        // session cookie attached, instead of pdf.js issuing range requests
        // against a redirected cross-origin signed URL.
        const response = await fetch(src);
        if (!response.ok) throw new Error(`resume request failed: ${response.status}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;

        task = pdfjs.getDocument({ data });
        const doc = await task.promise;
        if (cancelled) return;

        const container = pagesRef.current;
        if (!container) return;
        container.replaceChildren();

        const deviceScale = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_SCALE);

        for (let number = 1; number <= doc.numPages; number += 1) {
          const page = await doc.getPage(number);
          if (cancelled) return;

          const unscaled = page.getViewport({ scale: 1 });
          const scale = width / unscaled.width;
          const viewport = page.getViewport({ scale });

          const sheet = window.document.createElement('div');
          sheet.className = 'relative bg-white shadow-sm';
          sheet.style.width = `${Math.floor(viewport.width)}px`;
          sheet.style.height = `${Math.floor(viewport.height)}px`;

          const canvas = window.document.createElement('canvas');
          // Drawn at device resolution and displayed at CSS resolution, or the
          // text is soft on every retina screen.
          canvas.width = Math.floor(viewport.width * deviceScale);
          canvas.height = Math.floor(viewport.height * deviceScale);
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.display = 'block';
          sheet.append(canvas);

          const textLayer = window.document.createElement('div');
          textLayer.className = 'pdf-text-layer';
          // pdf.js positions each run in units of this, so it must match the
          // viewport the text layer was built against.
          textLayer.style.setProperty('--scale-factor', String(scale));
          sheet.append(textLayer);

          container.append(sheet);

          await page.render({
            canvas,
            viewport: page.getViewport({ scale: scale * deviceScale }),
          }).promise;
          if (cancelled) return;

          // A real text layer, so a lead can select and copy from the resume
          // and the browser's own find-in-page still works — the thing a
          // canvas-only render would quietly take away.
          const text = new pdfjs.TextLayer({
            textContentSource: await page.getTextContent(),
            container: textLayer,
            viewport,
          });
          await text.render();
        }

        if (!cancelled) setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('[resume] render failed', error);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      // Releases the worker and the page bitmaps. Without it, opening twenty
      // applications in a sitting keeps twenty documents alive.
      void task?.destroy();
    };
  }, [src, width, hasResume]);

  if (!hasResume) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No resume was uploaded with this application.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted p-3"
        aria-label={`Resume from ${applicantName}`}
      >
        {status === 'loading' ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading resume…</p>
        ) : null}

        {status === 'error' ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This resume could not be displayed. Download it instead.
          </p>
        ) : null}

        <div ref={pagesRef} className="flex flex-col items-center gap-3" />
      </div>

      {/* Permanent rather than shown on failure: it is also the way to get the
          file itself, and the way out of anything the renderer gets wrong. */}
      <a
        href={`${src}?download`}
        className="self-start rounded-sm text-sm text-muted-foreground underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Download resume
      </a>
    </div>
  );
}
