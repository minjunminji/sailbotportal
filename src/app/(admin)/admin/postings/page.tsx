import { EmptyState } from '@/components/empty-state';
import { createClient } from '@/lib/supabase/server';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
};

export default async function PostingsPage() {
  const supabase = await createClient();

  // RLS scopes this: an admin sees every posting, a lead only their team's.
  const [{ data: postings }, { data: teams }] = await Promise.all([
    supabase.from('postings').select('id, title, slug, status, team_id').order('position'),
    supabase.from('teams').select('id, name'),
  ]);

  const teamNamesById = new Map((teams ?? []).map((team) => [team.id, team.name]));

  return (
    <main className="flex-1 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Postings</h1>
      <p className="mt-3 text-base text-muted-foreground">
        One posting per team. Opening a posting is what makes it visible to applicants.
      </p>

      <div className="mt-8">
        {!postings || postings.length === 0 ? (
          <EmptyState
            title="No postings yet"
            description="A posting carries a team's description and its questions. There is no way to create one from this screen yet, so for now they are added directly to the database."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {postings.map((posting) => (
              <li
                key={posting.id}
                className="rounded-lg border border-border bg-card p-4 text-card-foreground"
              >
                <p className="text-sm text-muted-foreground">
                  {teamNamesById.get(posting.team_id) ?? 'Unassigned'}
                </p>
                <p className="mt-2 text-base font-medium">{posting.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {STATUS_LABELS[posting.status] ?? posting.status}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
