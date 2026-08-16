/**
 * The board's two icons, inline.
 *
 * A whole icon package for two glyphs would be a dependency, a bundle, and a
 * version to keep current; these are eight path elements. They follow the
 * common 24×24 stroked-outline convention so a designer swapping in a real icon
 * set later finds the same shape and sizing already in place.
 *
 * FOLD RATHER THAN AN ARROW. A chevron has to point somewhere, and there is no
 * honest direction here: collapsing `Applied` folds it to the left of the
 * board, collapsing `Rejected` folds it to the right. Arrows pointing at a
 * centre line say "make this narrower" wherever the column happens to sit.
 *
 * Both are `aria-hidden`: the button that holds them carries the real name.
 */

const shared = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** Arrows pointing inward at a dashed seam: fold this column away. */
export function FoldIcon({ className }: { className?: string }) {
  return (
    <svg {...shared} className={className}>
      <path d="M2 12h6" />
      <path d="M22 12h-6" />
      <path d="M12 2v2" />
      <path d="M12 8v2" />
      <path d="M12 14v2" />
      <path d="M12 20v2" />
      <path d="m19 9-3 3 3 3" />
      <path d="m5 9 3 3-3 3" />
    </svg>
  );
}

/** The same seam with the arrows reversed: open this column back up. */
export function UnfoldIcon({ className }: { className?: string }) {
  return (
    <svg {...shared} className={className}>
      <path d="M16 12h6" />
      <path d="M8 12H2" />
      <path d="M12 2v2" />
      <path d="M12 8v2" />
      <path d="M12 14v2" />
      <path d="M12 20v2" />
      <path d="m19 15 3-3-3-3" />
      <path d="m5 9-3 3 3 3" />
    </svg>
  );
}
