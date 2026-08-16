import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
  type BoardCard,
} from '@/lib/applications/queries';
import { YEAR_OF_STUDY_OPTIONS } from '@/components/apply/types';

/**
 * Everything the board knows that is not a React tree.
 *
 * The board's layout is presentation config, not data: `applications.status` is
 * one column holding one of eight values, and this file is the only place that
 * decides what those values are called, what order they sit in, and which ones
 * start folded away. A future recruiting process that renames "Reviewing" or
 * moves a column changes this file and nothing else.
 */

/** Column order is the order a candidate moves through, left to right. */
export const BOARD_COLUMNS: { status: ApplicationStatus; label: string }[] = [
  { status: 'applied', label: 'Applied' },
  { status: 'reviewing', label: 'Reviewing' },
  { status: 'interview_email_sent', label: 'Interview: email sent' },
  { status: 'interview_scheduled', label: 'Interview: scheduled' },
  { status: 'interview_completed', label: 'Interview: completed' },
  { status: 'waitlisted', label: 'Waitlisted' },
  { status: 'offered', label: 'Offered' },
  { status: 'rejected', label: 'Rejected' },
];

/**
 * The two columns that open folded to a narrow strip.
 *
 * Both are terminal and both are read rarely — `Rejected` grows faster than
 * every other column combined, and a board that spends a third of its width on
 * the outcome nobody revisits pushes `Applied` off screen. They stay real
 * columns underneath: still counted, still expandable, and still valid drop
 * targets, because rejecting someone is the single most common move made on
 * this board and it must not require expanding anything first.
 */
export const DEFAULT_COLLAPSED: ApplicationStatus[] = ['waitlisted', 'rejected'];

/**
 * Short year labels, for a card with about twelve characters to spend on this
 * line.
 *
 * `YEAR_OF_STUDY_OPTIONS` carries the long forms the applicant chose from
 * ("Fifth year or beyond"), which is right on a form and far too wide here. The
 * two are kept in step by a test asserting every ordinal has a short label, so
 * adding a year of study to the form cannot silently leave the board rendering
 * a raw `'phd'`.
 */
const SHORT_YEAR_LABELS: Record<string, string> = {
  '1': '1st yr',
  '2': '2nd yr',
  '3': '3rd yr',
  '4': '4th yr',
  '5': '5th yr+',
  masters: "Master's",
  phd: 'PhD',
};

/** Falls back to the stored ordinal rather than rendering nothing. */
export function shortYearLabel(yearOfStudy: string): string {
  return SHORT_YEAR_LABELS[yearOfStudy] ?? yearOfStudy;
}

/** The ordinals the form offers, so a test can assert this file covers them. */
export const KNOWN_YEAR_ORDINALS = YEAR_OF_STUDY_OPTIONS.map((option) => option.value);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days since the card last changed column.
 *
 * This is the number the board exists to surface — a candidate sitting eleven
 * days in `Reviewing` is the failure the kanban is meant to make impossible to
 * miss — so it is worth being careful about.
 *
 * `now` is a parameter rather than a call to `Date.now()` because the board
 * renders on the server and hydrates on the client. Reading the clock in both
 * places gives two different answers milliseconds apart, which React reports as
 * a hydration mismatch the moment one of them lands on the far side of a day
 * boundary. One `now`, taken once per page render, is passed down instead.
 *
 * Clamped at zero: a clock skew between Postgres and the web server can put
 * `status_changed_at` a second in the future, and "-0 days" is a bug report.
 */
export function daysInColumn(statusChangedAt: string, now: string): number {
  const then = new Date(statusChangedAt).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(current)) return 0;
  return Math.max(0, Math.floor((current - then) / MS_PER_DAY));
}

/** Reads as a duration, not as a count of something. */
export function daysInColumnLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/**
 * Cards bucketed by status, with an entry for EVERY column.
 *
 * The empty arrays are the point. A column derived only from the statuses
 * present would vanish once its last card left, and a column that is not
 * rendered cannot be dropped onto — so the first card could never get back in.
 *
 * A row holding a status outside the eight is dropped rather than rendered in a
 * ninth column: the check constraint on `applications.status` means it cannot
 * happen, and if the constraint is ever relaxed, silently inventing a column is
 * worse than showing the eight that are real.
 */
export function groupByStatus(cards: BoardCard[]): Record<ApplicationStatus, BoardCard[]> {
  const grouped = Object.fromEntries(
    APPLICATION_STATUSES.map((status) => [status, [] as BoardCard[]]),
  ) as Record<ApplicationStatus, BoardCard[]>;

  for (const card of cards) {
    grouped[card.status]?.push(card);
  }

  return grouped;
}
