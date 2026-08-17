'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SailbotMark } from '@/components/sailbot-mark';

/**
 * The application's title, and the mark that outlasts it.
 *
 * The page's only header used to sit above the grid and scroll away the moment
 * anyone started typing, so a forty-question session happened on a page
 * carrying no sign of whose form it was. This crowns the section rail's sticky
 * block instead: past a short scroll the wordmark slides left behind the mark
 * and the mark stays, all the way down.
 *
 * ONE NODE SERVES BOTH LAYOUTS. On desktop the caller's wrapper is sticky and
 * this is the rail's crown; below `lg` that wrapper is an ordinary full-width
 * row and this is a static header that scrolls away, matching the rail's own
 * decision not to compete with an on-screen keyboard. Rendering a second
 * mobile-only copy would put two `<h1>`s in the document.
 *
 * The collapse still mounts on a phone but nothing reads what it sets, since
 * the classes it toggles are the ones the animation uses. Not worth a
 * media-query branch in JS to avoid.
 */

/**
 * Short on purpose. The expanded wordmark is wider than the rail column and
 * overhangs the form beside it, so it wants to be gone before the form has
 * travelled far enough for the overlap to be visible.
 */
const COLLAPSE_AT = 48;

export function ApplyHeader() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const onScroll = () => setCollapsed(window.scrollY > COLLAPSE_AT);
    // Read once on mount: a reload or a back-navigation restores scroll
    // position without ever firing a scroll event, and an expanded wordmark
    // sitting over the middle of the form is how that failure looks.
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const transition = 'motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out';

  return (
    // The heading is a block and stops at the 13rem column edge, so the paint
    // and the stacking context both belong to the link below, which is
    // `inline-flex` and therefore as wide as its content — overhang included.
    <h1 className="mb-8">
      <Link
        href="/"
        // The link's text content disappears when collapsed, so the name
        // cannot come from its children.
        aria-label="UBC Sailbot"
        // No flex `gap`: the gap belongs to the text (`pl-3` below) so that the
        // clipping edge sits flush against the mark. With a gap, the wordmark
        // would vanish into 12px of empty space instead of behind the sail.
        // `pl-3` matches the rail rows' own left padding, so the mark's left
        // edge lines up with the row labels beneath it rather than sitting a
        // few pixels proud of the column. The mark's viewBox is cropped flush
        // to the artwork, so there is no internal padding to account for and
        // this is the whole inset.
        //
        // `relative z-10` over an opaque background, so that during the few
        // frames between the threshold firing and the animation finishing, the
        // form scrolling up beneath the overhang passes behind it rather than
        // showing through it.
        className="relative z-10 inline-flex items-center rounded-md bg-background pl-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <SailbotMark className="h-10 w-auto shrink-0" />

        {/*
          The clipper. Animating `max-width` to zero is what actually reclaims
          the space and pulls the right edge leftward.

          `max-width` rather than `width` because the text is intrinsically
          sized — there is no measured number here to keep in sync with the
          string. The expanded ceiling is comfortably above the real width and
          never renders at that size.
        */}
        <span
          className={[
            'block overflow-hidden whitespace-nowrap',
            transition,
            collapsed ? 'max-w-0' : 'max-w-[17rem]',
          ].join(' ')}
        >
          {/*
            The slider, which is why this is two elements and not one: a single
            box cannot both clip its overflow and move within its own clip.
            Translating -100% sends the text left, out under the mark, instead
            of squeezing it against a static left edge. Without this the effect
            is a wipe; with it, the text goes behind the mast.

            `opacity` rides along as belt-and-braces, so nothing can peek past
            the clip edge on subpixel rounding at the end of the travel.
          */}
          <span
            className={[
              'block pl-3 text-2xl font-semibold tracking-tight',
              transition,
              collapsed ? '-translate-x-full opacity-0' : 'translate-x-0 opacity-100',
            ].join(' ')}
          >
            UBC Sailbot Application
          </span>
        </span>
      </Link>
    </h1>
  );
}
