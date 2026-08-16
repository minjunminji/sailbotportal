/**
 * Nothing, which is what the slot should render whenever no application is
 * open. Without this file Next has no fallback for the unmatched slot and a
 * refresh on the board itself 404s.
 */
export default function Default() {
  return null;
}
