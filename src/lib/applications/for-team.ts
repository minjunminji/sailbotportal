import { createClient } from '@/lib/supabase/server';
import { getApplicationDetail, type ApplicationDetail } from './detail';
import {
  appendBoardQuery,
  getBoardApplicationNavigation,
  navigationHrefs,
  type ApplicationNavigation,
} from './navigation';
import { parseBoardFilters, serialiseBoardFilters, type SearchParamsInput } from './queries';

/**
 * The load both the real application page and its intercepting twin perform.
 *
 * Shared so the two cannot drift. They render the same application through the
 * same checks; the only difference between them is the frame around it, and a
 * second copy of "does this team exist, may this caller see this row, does this
 * URL actually name it" is a second copy that can be fixed in one place only.
 *
 * Server-only: it builds a client from the request's cookies.
 */
export async function loadApplicationForTeam(
  teamSlug: string,
  applicationId: string,
  searchParams: SearchParamsInput,
): Promise<{
  team: { id: string; name: string; slug: string };
  detail: ApplicationDetail;
  boardHref: string;
  navigation: ApplicationNavigation;
} | null> {
  const supabase = await createClient();

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, slug')
    .eq('slug', teamSlug)
    .maybeSingle();
  if (!team) return null;

  // RLS decides whether this row exists for this caller, so a lead editing the
  // id in the URL gets nothing rather than another team's applicant.
  const detail = await getApplicationDetail(applicationId, supabase);
  if (!detail) return null;

  // A real application reached through the wrong team's URL. Refused, because
  // this address does not name it — and because letting it through would make
  // `/admin/soft/applications/<a mech id>` render a Mechanical applicant inside
  // the Software board's frame.
  if (detail.teamSlug !== team.slug) return null;

  const filters = parseBoardFilters(searchParams);
  const boardQuery = serialiseBoardFilters(filters).toString();
  const neighbours = await getBoardApplicationNavigation(
    detail.postingId,
    detail.id,
    filters,
    supabase,
  );

  return {
    team,
    detail,
    boardHref: appendBoardQuery(`/admin/${team.slug}`, boardQuery),
    navigation: navigationHrefs(team.slug, neighbours, boardQuery),
  };
}
