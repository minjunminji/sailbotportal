/**
 * The Sailbot mark: a mainsail and a jib.
 *
 * Inline rather than a file in `public/`, because `fill="currentColor"` only
 * inherits if the SVG is part of the document. The app has a `.dark` variant,
 * and the supplied artwork was solid black — which is invisible against
 * `oklch(0.145 0 0)`.
 *
 * THE VIEWBOX IS CROPPED TO THE ARTWORK. The source is `0 0 796 796` with the
 * paths occupying x 135→660 and y 15→780, so roughly a sixth of the box is
 * dead space at the left and another sixth at the bottom right. Rendered in a
 * square that reads as a small, off-centre sail. Cropped, the box is the sail.
 *
 * That leaves a true aspect of 525:765 — taller than wide, as a sail should be.
 * Size it on one axis (`h-10 w-auto`), never both: a square box squashes it.
 */
export function SailbotMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="135 15 525 765"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      // Decorative. The heading beside it is the accessible name, and a mark
      // that announced itself would say the same thing twice.
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M364.256 249.633L323.684 780.073H135L364.256 249.633Z" />
      <path d="M380.178 15L660 780.073H355.737L380.178 15Z" />
    </svg>
  );
}
