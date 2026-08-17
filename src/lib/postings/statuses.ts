/**
 * The three states a posting can be in, in lifecycle order.
 *
 * SHARED BECAUSE THE TWO SIDES MUST AGREE. The control renders one option per
 * entry and the server action validates against the same list, so a fourth
 * state added to only one of them would produce a button that always fails or a
 * status nothing can reach. One list, imported twice.
 *
 * It also has to live outside the action file: a `'use server'` module may
 * export async functions and nothing else, so a `const` array exported
 * alongside the action throws at runtime the first time the page is requested.
 * That is not a style preference — it is the error this file was extracted to
 * fix. See `__tests__/server-exports.test.ts`.
 *
 * `closed` is last because it is where a posting ends and stays.
 */
export const POSTING_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
] as const;

export type PostingStatus = (typeof POSTING_STATUSES)[number]['value'];

/** Just the values, for validating something that arrived as a plain string. */
export const POSTING_STATUS_VALUES: readonly string[] = POSTING_STATUSES.map(
  (status) => status.value,
);
