/**
 * The board and, alongside it, the takeover slot.
 *
 * `modal` is a parallel route. It renders nothing at all until the intercepting
 * route under `@modal/(.)applications/[id]` matches, which happens only on a
 * client-side navigation from the board — clicking a card. A pasted link or a
 * refresh hits the real `applications/[id]` page instead, with no interception,
 * which is the entire point of the arrangement.
 */
export default function TeamLayout({ children, modal }: LayoutProps<'/admin/[team]'>) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
