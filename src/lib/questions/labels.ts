/**
 * Question labels that name something only the applicant knows.
 *
 * Question text is authored once and frozen onto every application row at
 * submission, so it cannot be written per applicant. Where a label needs to
 * refer to one of their own answers it carries a placeholder, and the
 * substitution happens at render time — on the form, and again in the admin
 * view, so a lead reads the question as it was actually asked rather than the
 * template it was stored as.
 *
 * There is exactly one placeholder, and it exists because the software team's
 * "why is this your first choice?" question is unanswerable without naming the
 * choice. Resist adding more: every one of these is a way for stored text and
 * rendered text to disagree.
 */

export const FIRST_SUBTEAM_TOKEN = '{firstSubteam}';

/** Reads as a sentence before the ranking below it has been touched. */
const NO_CHOICE_YET = 'that subteam';

export function resolveLabel(label: string, firstChoice?: string | null): string {
  if (!label.includes(FIRST_SUBTEAM_TOKEN)) return label;
  return label.split(FIRST_SUBTEAM_TOKEN).join(firstChoice?.trim() || NO_CHOICE_YET);
}
