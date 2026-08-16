'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * pane looks the same for everybody — and the only way zoom can be ours.
 *
 * ZOOMING RE-RASTERISES rather than scaling the canvas with a CSS transform.
 * A transform is instant and free, and it also means zooming in enlarges pixels
 * that were rendered for a smaller box, so the text goes soft exactly when
 * somebody is squinting at it. Re-rendering at the new scale is the reason to
 * have a real PDF engine here at all.
 *
 * THE PAGES ARE BUILT IMPERATIVELY. pdf.js draws into a canvas and positions a
 * text layer against it; both are DOM it owns. React manages the shell and gets
 * out of the way inside, which is why this reaches for refs rather than state
 * to hold the output.
 */

type Status = 'loading' | 'ready' | 'error';

/** Zoom stops, rather than a continuous scale: each one is a re-render. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
/** `1` is fit-to-width, which is where the viewer opens. */
const FIT_INDEX = ZOOM_STEPS.indexOf(1);

/** Beyond this, more pixels stop being visible and start being memory. */
const MAX_DEVICE_SCALE = 2;
/**
 * A ceiling on total rasterisation, in multiples of the PDF's natural size.
 *
 * Without it, zoom 3 on a retina screen asks for a canvas six times the page in
 * each direction — roughly 78MB of bitmap per page, per render. Capping the
 * product means zooming in trades a little sharpness for not exhausting memory
 * on a laptop with twenty applications opened over an afternoon.
 */
const MAX_RASTER_SCALE = 4;

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
  const [status, setStatus] = useState<Status>('loading');
  const [width, setWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const zoom = ZOOM_STEPS[zoomIndex];

  // The pane's width sets the fit-to-width scale, so it has to be known before
  // anything is drawn and re-read when the window changes. Measured on the
  // scroll container's content box, so it stays the visible width even once
  // zooming has made the content wider than it.
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

  const stepZoom = useCallback((direction: -1 | 1) => {
    setZoomIndex((current) => {
      const next = current + direction;
      return next < 0 || next >= ZOOM_STEPS.length ? current : next;
    });
  }, []);

  // Ctrl/Cmd + wheel, the gesture every document viewer has trained people to
  // expect. Bound natively rather than through React's `onWheel` because the
  // browser's own page zoom has to be prevented, and React attaches wheel
  // listeners passively — where `preventDefault` does nothing.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !hasResume) return;

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      stepZoom(event.deltaY < 0 ? 1 : -1);
    }

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [hasResume, stepZoom]);

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

        // Drawn into a fragment and swapped in at the end, so the pane never
        // shows a half-rendered document while a zoom is being applied.
        const rendered = window.document.createDocumentFragment();

        for (let number = 1; number <= doc.numPages; number += 1) {
          const page = await doc.getPage(number);
          if (cancelled) return;

          const unscaled = page.getViewport({ scale: 1 });
          const scale = (width / unscaled.width) * zoom;
          const viewport = page.getViewport({ scale });

          const deviceScale = Math.min(
            window.devicePixelRatio || 1,
            MAX_DEVICE_SCALE,
            MAX_RASTER_SCALE / scale,
          );

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

          rendered.append(sheet);

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

        if (cancelled) return;
        container.replaceChildren(rendered);
        setStatus('ready');
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
  }, [src, width, zoom, hasResume]);

  if (!hasResume) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No resume was uploaded with this application.
        </p>
      </div>
    );
  }

  const controlClasses =
    'rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background disabled:opacity-40 disabled:hover:text-muted-foreground';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => stepZoom(-1)}
          disabled={zoomIndex === 0}
          aria-label="Zoom out"
          className={controlClasses}
        >
          &minus;
        </button>
        {/* Announced as a live value, so zooming by keyboard says what it did. */}
        <span aria-live="polite" className="w-12 text-center text-sm tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => stepZoom(1)}
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          aria-label="Zoom in"
          className={controlClasses}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoomIndex(FIT_INDEX)}
          disabled={zoomIndex === FIT_INDEX}
          className={controlClasses}
        >
          Fit
        </button>

        {/* Permanent rather than shown on failure: it is also the way to get
            the file itself, and the way out of anything the renderer gets
            wrong. */}
        <a
          href={`${src}?download`}
          className="ml-auto rounded-sm text-sm text-muted-foreground underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Download
        </a>
      </div>

      <div
        ref={scrollRef}
        // Scrolls in BOTH directions: once zoomed past the pane the page is
        // wider than the box, and panning is that scroll.
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted p-3"
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

        {/* `w-max` with `min-w-full`, not just `items-center`. Centring alone
            makes content wider than the container overflow past its left edge,
            where scrolling cannot reach it. Sizing this to the widest page and
            at least the container keeps the whole page scrollable at any
            zoom. */}
        <div ref={pagesRef} className="flex w-max min-w-full flex-col items-center gap-3" />
      </div>
    </div>
  );
}
