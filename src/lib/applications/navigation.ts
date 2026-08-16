import type { SupabaseClient } from '@supabase/supabase-js';
import { BOARD_COLUMNS } from '@/components/board/columns';
import type { Database } from '@/lib/supabase/types';
import { getBoardApplications, type BoardCard, type BoardFilters } from './queries';

export type ApplicationNeighbours = {
  previousId: string | null;
  nextId: string | null;
};

export type ApplicationNavigation = {
  previousHref: string | null;
  nextHref: string | null;
};

export function boardApplicationIds(cards: BoardCard[]): string[] {
  return BOARD_COLUMNS.flatMap(({ status }) =>
    cards.filter((card) => card.status === status).map((card) => card.id),
  );
}

export function neighboursOf(ids: string[], currentId: string): ApplicationNeighbours {
  const index = ids.indexOf(currentId);
  if (index === -1) return { previousId: null, nextId: null };

  return {
    previousId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

export async function getBoardApplicationNavigation(
  postingId: string,
  currentId: string,
  filters: BoardFilters,
  supabase: SupabaseClient<Database>,
): Promise<ApplicationNeighbours> {
  const cards = await getBoardApplications(postingId, filters, supabase);
  return neighboursOf(boardApplicationIds(cards), currentId);
}

export function appendBoardQuery(path: string, boardQuery: string): string {
  return boardQuery === '' ? path : `${path}?${boardQuery}`;
}

export function navigationHrefs(
  teamSlug: string,
  neighbours: ApplicationNeighbours,
  boardQuery: string,
): ApplicationNavigation {
  const href = (id: string | null) =>
    id === null ? null : appendBoardQuery(`/admin/${teamSlug}/applications/${id}`, boardQuery);

  return {
    previousHref: href(neighbours.previousId),
    nextHref: href(neighbours.nextId),
  };
}
