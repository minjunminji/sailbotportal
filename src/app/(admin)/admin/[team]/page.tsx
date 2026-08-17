import { notFound } from 'next/navigation';
import { Board } from '@/components/board/board';
import { BoardFilterBar } from '@/components/board/filter-bar';
import { EmptyState } from '@/components/empty-state';
import {
  getBoardApplications,
  parseBoardFilters,
  serialiseBoardFilters,
} from '@/lib/applications/queries';
import { createClient } from '@/lib/supabase/server';

/**
 * A team's board.
 *
 * Everything here is read through the request's own client, so RLS is what
 * decides which rows exist: a lead who edits the URL to another team's slug
 * gets that team's name and an empty board, never its applicants.
 */
export default async function TeamBoardPage({ params, searchParams }: PageProps<'/admin/[team]'>) {
  const { team: slug } = await params;
  const filters = parseBoardFilters(await searchParams);
  const supabase = await createClient();

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (!team) notFound();

  // One posting per team today. `position` is the deliberate tie-break for the
  // day there are several — recruiting cycles are a noted future feature, and
  // when they arrive this is the line that learns to ask for the current one.
  const [{ data: posting }, { data: subteams }] = await Promise.all([
    supabase
      .from('postings')
      .select('id, title, subteam_ranking')
      .eq('team_id', team.id)
      .order('position')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('subteams')
      .select('id, name, code')
      .eq('team_id', team.id)
      .eq('active', true)
      .order('position'),
  ]);

  const heading = <h1 className="text-2xl font-semibold tracking-tight">{team.name} board</h1>;

  if (!posting) {
    return (
      <main className="flex-1 p-6">
        {heading}
        <div className="mt-8">
          <EmptyState
            title="No posting for this team"
            description="A board shows the applicants to a posting, and this team does not have one yet. Add it from the Postings screen and the board appears here."
          />
        </div>
      </main>
    );
  }

  const cards = await getBoardApplications(posting.id, filters, supabase);

  const ranking = posting.subteam_ranking as { enabled?: boolean } | null;

  return (
    // `min-w-0` as well as `min-h-0`: a flex item's automatic minimum size is
    // its CONTENT's size, so without this the eight columns would widen the
    // page instead of scrolling inside the board.
    <main className="flex h-full min-h-0 min-w-0 flex-col gap-4 p-6">
      {heading}

      <BoardFilterBar
        filters={filters}
        subteams={subteams ?? []}
        showSubteamFilter={ranking?.enabled === true}
        basePath={`/admin/${team.slug}`}
      />

      {/* Announced rather than merely rendered: filtering happens through a
          navigation, and without this a screen reader user submits the form and
          is told nothing about what changed. */}
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {cards.length === 0
          ? 'No applicants match these filters.'
          : `${cards.length} ${cards.length === 1 ? 'applicant' : 'applicants'}`}
      </p>

      {/* The board renders even when it is empty. Its columns are drop targets,
          and a board that waited for its first applicant to appear would have
          nowhere to put them. */}
      <Board
        cards={cards}
        postingId={posting.id}
        teamSlug={team.slug}
        now={new Date().toISOString()}
        subteams={subteams ?? []}
        boardQuery={serialiseBoardFilters(filters).toString()}
      />
    </main>
  );
}
