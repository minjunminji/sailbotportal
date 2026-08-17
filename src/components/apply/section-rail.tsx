'use client';

import type { FormSection } from './sections';

/**
 * The section rail: where you are in the application, and how much of it is
 * left.
 *
 * DESKTOP ONLY, by decision rather than by omission. The caller hides it below
 * `lg`. A sticky element competing with an on-screen keyboard and a focused
 * textarea costs a phone more room than the orientation is worth.
 *
 * ROWS AND NOTHING ELSE. It carried a footer naming the teams the application
 * covered, which said what the rows already say — a chosen team has a row here
 * and an unchosen one does not — and the form's own submit line says it again
 * where the decision is acted on. Review has never been offered here either:
 * that is the form's action and it lives at the end of the form, where someone
 * who has just answered the last question already is.
 *
 * Rows are real anchors, not buttons calling `scrollIntoView`. They work before
 * hydration, and — the part that is easy to lose — following an anchor moves
 * FOCUS to the section, not merely the viewport. With a click handler alone, a
 * keyboard user watches the page scroll while their focus stays behind in the
 * rail, and their next Tab continues from a place they can no longer see.
 */

export function SectionRail({
  sections,
  activeId,
  onNavigate,
}: {
  sections: FormSection[];
  /** The section currently being read, from `useActiveSection`. */
  activeId: string | null;
  /** Lets the hook settle the active row immediately instead of mid-scroll. */
  onNavigate?: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Application sections"
      // Sticks within its wrapper, which is the grid item and stretches to the
      // height of the form beside it — that stretch is what gives the rail
      // something to travel along.
      className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto"
    >
      <ul className="flex flex-col gap-1">
        {sections.map((section) => (
          <RailRow
            key={section.id}
            section={section}
            active={section.id === activeId}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </nav>
  );
}

function RailRow({
  section,
  active,
  onNavigate,
}: {
  section: FormSection;
  active: boolean;
  onNavigate?: (id: string) => void;
}) {
  const complete = section.total > 0 && section.answered >= section.total;

  // Built as one string rather than assembled from sibling elements. The
  // accessible name of an anchor is its children joined by spaces, which turns
  // a label and a fraction into "Mechanical 4 11" — and inserts a space before
  // any punctuation meant to hold it together.
  const status = complete ? 'complete' : `${section.answered} of ${section.total} answered`;
  const announced = `${section.label}, ${status}${section.invalid ? ', needs attention' : ''}`;

  return (
    <li>
      <a
        href={`#${section.id}`}
        aria-label={announced}
        aria-current={active ? 'true' : undefined}
        // The navigation itself is left to the browser, which moves focus as
        // well as the viewport; this only stops the rail flickering through
        // every section the scroll passes on the way.
        onClick={() => onNavigate?.(section.id)}
        className={[
          'flex items-center gap-2 rounded-md py-1.5 pr-2 text-sm',
          // The indicator strip is a left border on every row, coloured only on
          // the active one, so nothing shifts sideways as the active row moves.
          'border-l-2 pl-3',
          active ? 'border-foreground bg-accent font-medium' : 'border-transparent',
          section.answered > 0 || active ? 'text-foreground' : 'text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
        ].join(' ')}
      >
        <span className="flex-1 truncate">{section.label}</span>

        {/* Visible status. The sentence above is what gets announced. */}
        <span
          className={[
            'shrink-0 text-xs tabular-nums',
            section.invalid ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}
        >
          {complete ? '✓' : `${section.answered}/${section.total}`}
        </span>

        {section.invalid ? (
          // A word, not only a hue. Colour alone disappears for a colourblind
          // applicant and fails contrast checks besides.
          <span className="shrink-0 rounded-sm border border-destructive px-1 text-[0.625rem] font-medium leading-4 text-destructive">
            !
          </span>
        ) : null}
      </a>
    </li>
  );
}
