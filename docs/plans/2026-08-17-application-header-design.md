# Application Header — Design

**Status:** designed 2026-08-17

The `/apply` page's only header is `<h1>Apply to UBC Sailbot</h1>`, sitting above the grid and
scrolling away the moment the applicant starts work. On a form that runs to roughly forty questions
that means the entire session — every essay, every upload — happens on a page carrying no mark of
whose form it is.

This adds a Sailbot mark and wordmark that stay. It follows the section rail's stance exactly:
greyscale unchanged, desktop enhancement only, nothing new in the palette.

---

## Goal

A header of the Sailbot mark plus "UBC Sailbot Application". On scroll the wordmark slides left,
behind the mark, and out; the mark remains, sticky, as the crown of the section rail for the rest of
the page.

---

## 1. Placement

The header lives **inside the rail's sticky block**, above the row list. That is what makes it stick
with the sidebar without introducing a second sticky context to keep in sync with the first.

The sticky context moves up one level. Today it is on the `<nav>` in `section-rail.tsx`; it moves to
the rail column's wrapper, which then holds header and nav together:

```tsx
<div className="lg:sticky lg:top-8 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
  <ApplyHeader />
  {phase === 'form' ? <SectionRail sections={sections} … /> : null}
</div>
```

`self-start` stays load-bearing for the reason the rail design already gives: a grid item stretches
to row height by default, and a full-height item cannot stick.

The wrapper stops being `hidden lg:block` — only `SectionRail` needs hiding now. Below `lg` the grid
collapses to a single column and this div becomes an ordinary full-width row containing just the
header, non-sticky because every sticky utility on it is `lg:`-gated.

**This is why there is one `<h1>` and not two.** Desktop crown and mobile header are the same DOM
node under different layout, rather than a `lg:hidden`/`hidden lg:block` pair that would put two h1s
in the document.

### Mobile

Static: mark beside wordmark, at the top of the page, scrolling away like the h1 does today. No
collapse, no stickiness. Same judgement as the rail — a sticky element competing with an on-screen
keyboard and a focused textarea costs a phone more room than the orientation returns.

The collapse machinery still mounts on mobile but never fires, because nothing reads the class it
sets. Not worth a media-query branch in JS to avoid.

---

## 2. Geometry, and the overhang it creates

Expanded, the header is wider than the rail column:

```
40px mark + 12px gap + "UBC Sailbot Application" @ text-2xl  ≈ 322px (20rem)
rail 13rem (208px) + gap 3rem (48px)                          = 256px
```

So the wordmark overhangs the form column by roughly 66px. **This is deliberate.** Contained inside
13rem the title would have to shrink to rail scale, and the collapse would be a modest slide rather
than a transformation. Widening the rail was the alternative and was rejected: it either narrows the
form's 48rem measure — which the rail design explicitly protected, because it sets line length in
twenty-six essay fields — or grows `max-w-5xl` and pushes the whole page wider.

Two consequences, fixed separately:

- **At rest.** The form column takes a `lg:mt-*` equal to the header's height, so `About you` begins
  below the header's row and the overhang sits over empty space rather than over a field label.
- **Mid-transition.** For the few frames between the threshold firing and the animation finishing,
  the form is scrolling up beside a still-expanded wordmark. The header paints on `bg-background` at
  a raised `z-index`, which the effect requires anyway — text cannot disappear *behind* a mark that
  is transparent.

The threshold is **48px**, not 64: the expanded state should be gone before the form has travelled
far enough for the overhang to matter.

---

## 3. The collapse

Threshold snap, not a scroll-scrub. One boolean, one CSS transition, ~300ms. Scrubbing the width
frame-by-frame against scroll position needs rAF throttling and reads as unsettled under small
scroll increments; a snap reads as deliberate and is cheap to make correct.

Hysteresis was considered and dropped. With a 48px threshold, hovering the boundary means holding a
scroll position within a pixel or two of it — not a thing that happens in practice on a form people
scroll through in long strokes.

### Two nested elements, because one cannot both clip and slide

```tsx
<Link href="/" aria-label="UBC Sailbot" className="… bg-background">
  <SailbotMark className="relative z-10 h-10 w-auto shrink-0" aria-hidden />
  <span className={clip}>        {/* overflow-hidden; max-w-0 when collapsed */}
    <span className={slide}>     {/* -translate-x-full when collapsed */}
      UBC Sailbot Application
    </span>
  </span>
</Link>
```

The outer span animates `max-width` to zero — that is what reclaims the space and pulls the right
edge leftward. The inner span translates `-100%` over the same duration, so the text travels *left,
under the mark*, instead of being squeezed against a static left edge. Without the inner slide the
result is a wipe. With it, the text goes behind the mast.

`max-width` rather than `width` because the text is intrinsically sized; there is no measured number
to keep in sync with the string. The expanded ceiling (`17rem`) is comfortably above the real width
and never renders.

`opacity-0` rides along on the slider. It is belt-and-braces: it guarantees nothing peeks past the
clip edge on subpixel rounding at the end of the travel.

**Reduced motion drops the transition, not the collapse.** The header simply is expanded or
collapsed with no tween, following the pattern already in `globals.css`.

### Accessible name

The link's text content vanishes when collapsed, so it carries an explicit `aria-label`. The mark is
`aria-hidden` — the `<h1>` text is the name, and an unlabelled decorative path announcing itself
beside it would say the same thing twice.

The h1 text is **clipped, never `display:none`**. Screen readers and document outline get the title
at every scroll position.

---

## 4. The mark

Supplied as a two-path SVG. Two changes before it ships:

**The viewBox is cropped to the artwork.** As given it is `0 0 796 796` with the paths occupying
x 135→660, y 15→780 — around 135px of dead space at the left and 136 at the bottom right. Rendered
in a square box the mark would sit small and visibly off-centre. Cropped to `135 15 525 765` the
box is the sail.

That makes the true aspect 525:765, roughly 0.69 — taller than wide, as a sail should be. It is
therefore sized `h-10 w-auto` and never `size-10`, which would squash it.

**`fill="currentColor"` on the root**, with the paths' `fill="black"` removed. The app has a `.dark`
variant in `globals.css`; a hardcoded black mark disappears against `oklch(0.145 0 0)`.

It ships as a React component rather than a file in `public/`, because `currentColor` only inherits
if the SVG is inline in the document.

---

## 5. Files

| File | Change |
|---|---|
| `src/components/sailbot-mark.tsx` | new — inline SVG, cropped viewBox, `currentColor` |
| `src/components/apply/apply-header.tsx` | new — h1, collapse state, scroll listener |
| `src/components/apply/apply-form.tsx` | rail wrapper gains sticky + header; form column gains top offset |
| `src/components/apply/section-rail.tsx` | drops `sticky top-8`, now owned by the wrapper |
| `src/app/(public)/apply/page.tsx` | h1 removed; empty-recruiting branch renders `ApplyHeader` |

Collapse state lives in `ApplyHeader`, not lifted into `ApplyForm`. Nothing else on the page reads
it, and keeping it local is what lets the empty-recruiting branch render the same component with no
props at all.

---

## 6. Testing

No browser automation, per standing preference. Component tests over `ApplyHeader`:

- the h1 text is in the DOM in **both** states — the collapse must never remove it
- setting `window.scrollY` past 48 and dispatching `scroll` applies the collapsed classes; scrolling
  back below restores them
- the link keeps an accessible name while collapsed

The scroll listener is thin enough that this is its whole surface. There is no equivalent of the
rail's `IntersectionObserver` problem here: jsdom has `window.scrollY` and dispatches scroll events
fine, so the real code under test is the real code.

`apply-page.test.tsx` needs updating — it asserts on the h1 that is moving.

---

## Not doing

- **A full-width sticky bar.** It would not be "sticky with the sidebar", and on a page whose form
  column is already offset it buys a second sticky context to keep aligned with the first.
- **Collapse on mobile.** See §1.
- **Anything in the palette.** Greyscale, as the rail design established.
