'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
// Type-only, so it is erased at build and does not drag pdf.js into any bundle
// that merely mentions this component.
import type { PDFDocumentLoadingTask, PDFPageProxy, RenderTask } from 'pdfjs-dist';

/**
 * The resume, rendered by the app rather than by the browser.
 *
 * WHY NOT A NATIVE `<embed>`. It was one, and it mostly worked — but what a
 * browser does with an embedded PDF is the browser's business, not ours.
 * Chrome's "Download PDFs instead of automatically opening them" setting turns
 * the pane into a grey download prompt; with the setting off it renders the
 * whole Chrome PDF application inside the pane, a second toolbar and thumbnail
 * rail competing with our own UI. Neither is detectable from script, so the app
 * could not even fall back.
 *
 * ## How zoom stays instant
 *
 * Rasterising a page takes tens of milliseconds at best, so a viewer that
 * re-renders before it repaints feels broken however fast the render is. Every
 * PDF viewer worth using therefore does two things per zoom step, and this does
 * the same:
 *
 * 1. SCALE WHAT IS ALREADY ON SCREEN, with a CSS transform. That is a compositor
 *    operation — it lands on the next frame, and it scales the canvas and the
 *    text layer together so selection stays aligned with the glyphs.
 * 2. RE-RASTERISE SHORTLY AFTER, once the zooming has stopped, and drop the
 *    transform back to 1. Zooming in on a transform enlarges pixels drawn for a
 *    smaller box, so this is what turns a soft page crisp again.
 *
 * The transform lives on an inner element while an outer one carries the
 * display size, because a transform does not affect layout — without the pair,
 * a zoomed page would paint over its neighbours and could not be scrolled to.
 *
 * The document is fetched and parsed ONCE. It used to be a dependency of the
 * render effect alongside the zoom, so every step re-downloaded and re-parsed
 * the file before drawing anything, which is where the lag came from.
 */

type Status = 'loading' | 'ready' | 'error';

/** Zoom stops, rather than a continuous scale. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
/** `1` is fit-to-width, which is where the viewer opens. */
const FIT_INDEX = ZOOM_STEPS.indexOf(1);

/** Beyond this, more pixels stop being visible and start being memory. */
const MAX_DEVICE_SCALE = 2;
/**
 * A ceiling on rasterisation, in multiples of the page's natural size. Without
 * it, 300% on a retina screen asks for a canvas six times the page in each
 * direction — around 78MB of bitmap per page, per render.
 */
const MAX_RASTER_SCALE = 4;
/** Long enough to coalesce a burst of wheel or button steps into one render. */
const RASTER_DELAY_MS = 180;

type PageView = {
  page: PDFPageProxy;
  /** Carries the display size, so layout and scrolling follow the zoom. */
  frame: HTMLDivElement;
  /** Carries the transform, at the size it was actually rasterised. */
  sheet: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  /** Page dimensions at scale 1, in PDF units. */
  base: { width: number; height: number };
  /** The scale the canvas and text layer currently hold. */
  renderedScale: number;
  task?: RenderTask;
};

function createPageSheet() {
  const sheet = window.document.createElement('div');
  sheet.className = 'absolute top-0 left-0 origin-top-left bg-white shadow-sm';

  const canvas = window.document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';

  const textLayer = window.document.createElement('div');
  textLayer.className = 'pdf-text-layer';

  sheet.append(canvas, textLayer);
  return { sheet, canvas, textLayer };
}

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
  const viewsRef = useRef<PageView[]>([]);
  const rasterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Bumped on every rasterise, so a superseded one can bail out. */
  const rasterSeq = useRef(0);

  const [status, setStatus] = useState<Status>('loading');
  const [width, setWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const [ready, setReady] = useState(0);
  const zoom = ZOOM_STEPS[zoomIndex];

  /**
   * What a page should measure on screen right now.
   *
   * Takes the page's natural width rather than the `PageView` itself: a
   * memoised function that receives the view and is then used as an effect
   * dependency makes the compiler treat those views as frozen, and the effects
   * below exist precisely to mutate their DOM.
   */
  const displayScale = useCallback(
    (baseWidth: number) => (width === 0 ? 0 : (width / baseWidth) * zoom),
    [width, zoom],
  );

  // The pane's width sets the fit-to-width scale. Measured on the scroll
  // container's content box, so it stays the VISIBLE width even once zooming
  // has made the content inside wider than it.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      // Ignored below a few pixels: re-laying out every page for a one-pixel
      // scrollbar change is churn nobody can see.
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
  // expect. Bound natively rather than through React's `onWheel`, because the
  // browser's own page zoom has to be prevented and React attaches wheel
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

  // --- Load once -----------------------------------------------------------
  useEffect(() => {
    if (!hasResume) return;

    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // Served from `public/`, put there by `scripts/copy-pdf-worker.mjs`.
        // An absolute path rather than a bundler-resolved one: see that script
        // for why the usual `new URL(...)` trick fails silently at runtime.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

        // Fetched here rather than handed to pdf.js as a URL: one same-origin
        // request that follows the route's redirect with the session cookie
        // attached, instead of pdf.js issuing range requests against a
        // redirected cross-origin signed URL.
        const response = await fetch(src);
        if (!response.ok) throw new Error(`resume request failed: ${response.status}`);
        const data = await response.arrayBuffer();
        if (cancelled) return;

        task = pdfjs.getDocument({ data });
        const doc = await task.promise;
        if (cancelled) return;

        const views: PageView[] = [];
        const fragment = window.document.createDocumentFragment();

        for (let number = 1; number <= doc.numPages; number += 1) {
          const page = await doc.getPage(number);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });

          const frame = window.document.createElement('div');
          frame.className = 'relative';

          const { sheet, canvas, textLayer } = createPageSheet();
          frame.append(sheet);
          fragment.append(frame);

          views.push({
            page,
            frame,
            sheet,
            canvas,
            textLayer,
            base: { width: base.width, height: base.height },
            // Nothing drawn yet; the first rasterise sets this properly.
            renderedScale: 0,
          });
        }

        if (cancelled) return;
        pagesRef.current?.replaceChildren(fragment);
        viewsRef.current = views;
        setStatus('ready');
        setReady((value) => value + 1);
      } catch (error) {
        if (cancelled) return;
        console.error('[resume] load failed', error);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      for (const view of viewsRef.current) view.task?.cancel();
      viewsRef.current = [];
      // Releases the worker and the page bitmaps. Without it, opening twenty
      // applications in a sitting keeps twenty documents alive.
      void task?.destroy();
    };
  }, [src, hasResume]);

  // --- Resize the pages now, sharpen them shortly after ---------------------
  /* eslint-disable react-hooks/immutability -- pdf.js owns this imperative DOM subtree; React only owns its shell. */
  useEffect(() => {
    if (width === 0 || viewsRef.current.length === 0) return;

    // Invalidate and stop work for the previous zoom immediately. Waiting
    // until this zoom's debounce expires would let an obsolete render finish
    // and briefly replace the page with the wrong scale.
    const sequence = (rasterSeq.current += 1);
    for (const view of viewsRef.current) {
      view.task?.cancel();
    }

    // 1. Immediate: every page takes its new size, and the already-drawn
    //    bitmap is stretched to fit it. One compositor frame, no decoding.
    for (const view of viewsRef.current) {
      const scale = displayScale(view.base.width);
      view.frame.style.width = `${Math.round(view.base.width * scale)}px`;
      view.frame.style.height = `${Math.round(view.base.height * scale)}px`;

      if (view.renderedScale > 0) {
        const ratio = scale / view.renderedScale;
        view.sheet.style.transform = ratio === 1 ? '' : `scale(${ratio})`;
      }
    }

    // 2. Deferred: redraw at the new scale so the pixels match the size.
    clearTimeout(rasterTimer.current);
    rasterTimer.current = setTimeout(() => {
      void (async () => {
        for (const view of viewsRef.current) {
          if (sequence !== rasterSeq.current) return;
          const scale = displayScale(view.base.width);
          if (scale === 0 || scale === view.renderedScale) continue;

          const pdfjs = await import('pdfjs-dist');
          const viewport = view.page.getViewport({ scale });
          const deviceScale = Math.min(
            window.devicePixelRatio || 1,
            MAX_DEVICE_SCALE,
            MAX_RASTER_SCALE / scale,
          );

          // Double-buffer the page. Resizing a canvas clears it synchronously,
          // so rendering into the visible one produces a white flash. Keep the
          // CSS-scaled old sheet on screen while this detached replacement is
          // rasterised and its text layer is built.
          const next = createPageSheet();
          next.sheet.style.width = `${Math.round(viewport.width)}px`;
          next.sheet.style.height = `${Math.round(viewport.height)}px`;
          next.canvas.width = Math.floor(viewport.width * deviceScale);
          next.canvas.height = Math.floor(viewport.height * deviceScale);

          try {
            view.task = view.page.render({
              canvas: next.canvas,
              viewport: view.page.getViewport({ scale: scale * deviceScale }),
            });
            await view.task.promise;
          } catch {
            // A cancelled render throws; that is the mechanism working.
            continue;
          }
          if (sequence !== rasterSeq.current) return;

          // Rebuilt at the new scale rather than rescaled, so the invisible
          // text sits exactly on the glyphs it belongs to.
          next.textLayer.style.setProperty('--scale-factor', String(scale));
          const text = new pdfjs.TextLayer({
            textContentSource: await view.page.getTextContent(),
            container: next.textLayer,
            viewport,
          });
          await text.render();
          if (sequence !== rasterSeq.current) return;

          // One DOM mutation installs the complete sharp page. The old raster
          // remains visible until this point, so there is no blank frame.
          view.frame.replaceChildren(next.sheet);
          view.sheet = next.sheet;
          view.canvas = next.canvas;
          view.textLayer = next.textLayer;
          view.renderedScale = scale;
          view.task = undefined;
        }
      })();
    }, RASTER_DELAY_MS);

    return () => clearTimeout(rasterTimer.current);
  }, [width, zoom, ready, displayScale]);
  /* eslint-enable react-hooks/immutability */

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
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
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
            at least the container keeps the whole page reachable at any zoom. */}
        <div ref={pagesRef} className="flex w-max min-w-full flex-col items-center gap-3" />
      </div>
    </div>
  );
}
