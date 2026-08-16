import { notFound } from 'next/navigation';
import { ApplicationDetailView } from '@/components/application/application-detail';
import { Takeover } from '@/components/application/takeover';
import { loadApplicationForTeam } from '@/lib/applications/for-team';

/**
 * The same application, reached by clicking a card.
 *
 * `(.)` intercepts `applications/[id]` from the board. `@modal` is a slot
 * rather than a route segment, so despite sitting two folders deep this is one
 * segment away from the target — which is why the matcher is `(.)` and not
 * `(..)`.
 *
 * This runs ONLY on a client-side navigation from the board. A pasted link, a
 * refresh, or an opened-in-new-tab request bypasses interception entirely and
 * renders the real page. Both go through `loadApplicationForTeam`, so the two
 * cannot disagree about what is visible or to whom.
 */
export default async function InterceptedApplicationPage({
  params,
}: PageProps<'/admin/[team]/applications/[id]'>) {
  const { team: slug, id } = await params;

  const loaded = await loadApplicationForTeam(slug, id);
  if (!loaded) notFound();

  return (
    <Takeover label={`Application from ${loaded.detail.applicantName}`}>
      <ApplicationDetailView detail={loaded.detail} />
    </Takeover>
  );
}
