import { notFound } from 'next/navigation';
import { ApplicationDetailView } from '@/components/application/application-detail';
import { Takeover } from '@/components/application/takeover';
import { loadApplicationForTeam } from '@/lib/applications/for-team';
import TeamBoardPage from '../../page';

/**
 * One application at a stable, shareable address, always over its board.
 *
 * There is deliberately one rendering path for card clicks, arrow navigation,
 * pasted links, and refreshes. Keeping a separate intercepted route lets the
 * canonical full-page result appear while Next reconciles its parallel slot.
 */
export default async function ApplicationPage({
  params,
  searchParams,
}: PageProps<'/admin/[team]/applications/[id]'>) {
  const { team: slug, id } = await params;
  const resolvedSearchParams = await searchParams;

  const [loaded, board] = await Promise.all([
    loadApplicationForTeam(slug, id, resolvedSearchParams),
    TeamBoardPage({
      params: Promise.resolve({ team: slug }),
      searchParams: Promise.resolve(resolvedSearchParams),
    }),
  ]);
  if (!loaded) notFound();

  return (
    <>
      {board}
      <Takeover
        label={`Application from ${loaded.detail.applicantName}`}
        returnHref={loaded.boardHref}
      >
        <ApplicationDetailView detail={loaded.detail} navigation={loaded.navigation} />
      </Takeover>
    </>
  );
}
