import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApplicationDetailView } from '@/components/application/application-detail';
import { loadApplicationForTeam } from '@/lib/applications/for-team';

/**
 * One application, at its own address.
 *
 * THE REAL ROUTE. The board also renders this through an intercepting route so
 * a card click is an instant takeover, but this page is what a pasted link
 * opens and what a refresh lands on. Leads share candidates in chat constantly;
 * a modal that cannot be linked to forces "scroll to the third column, the one
 * named Jane".
 */
export default async function ApplicationPage({
  params,
}: PageProps<'/admin/[team]/applications/[id]'>) {
  const { team: slug, id } = await params;

  const loaded = await loadApplicationForTeam(slug, id);
  if (!loaded) notFound();

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-6">
      <Link
        href={`/admin/${loaded.team.slug}`}
        className="inline-block self-start rounded-sm text-sm text-muted-foreground underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Back to the {loaded.team.name} board
      </Link>

      <ApplicationDetailView detail={loaded.detail} />
    </main>
  );
}
