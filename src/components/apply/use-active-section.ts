'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Which section the applicant is currently reading.
 *
 * Deliberately thin, and deliberately not unit tested: jsdom has no
 * `IntersectionObserver`, so a test would have to supply a fake and would then
 * be asserting against the fake rather than against any scrolling that ever
 * happens. This is the part a person notices in half a second and a test never
 * notices at all.
 *
 * The observer watches a band near the top of the viewport rather than the
 * whole of it. With a full-viewport root, every tall section is intersecting
 * almost all the time and "active" becomes meaningless; with a thin band, the
 * active section is whichever one has just reached reading position.
 */

/** Roughly the top fifth of the viewport. */
const BAND = '-20% 0px -70% 0px';

/** How long a click's own scroll is allowed to take before the observer wins. */
const SETTLE_MS = 700;

export function useActiveSection(ids: string[]): {
  activeId: string | null;
  onNavigate: (id: string) => void;
} {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Following a rail link scrolls THROUGH every section in between, and each
  // one entering the band would set itself active on the way past — the rail
  // flickers down the list and lands correctly, which reads as a bug even
  // though it ends up right. Clicks set the answer directly and hold the
  // observer off until the scrolling has stopped.
  const suppressUntil = useRef(0);

  const onNavigate = useCallback((id: string) => {
    suppressUntil.current = Date.now() + SETTLE_MS;
    setActiveId(id);
  }, []);

  // The ids are a new array on every render; joining them means the observer is
  // rebuilt when the sections actually change, not on every keystroke.
  const key = ids.join('|');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const sectionIds = key.split('|').filter(Boolean);
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < suppressUntil.current) return;

        // Entries arrive only for what changed, so the last one to enter the
        // band is the answer. Nothing is set when none is intersecting, which
        // leaves the previous section active rather than blanking the rail
        // between two of them.
        const entered = entries.filter((entry) => entry.isIntersecting);
        if (entered.length === 0) return;

        const last = entered[entered.length - 1];
        setActiveId(last.target.id);
      },
      { rootMargin: BAND },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  return { activeId, onNavigate };
}
