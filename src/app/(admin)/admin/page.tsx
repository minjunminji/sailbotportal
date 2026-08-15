import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { createClient } from '@/lib/supabase/server';

/**
 * There is no useful "admin home" — the work happens on a board. Send a lead to
 * their own team and everyone else to the first team.
 */
export default async function AdminIndexPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('team_id')
    .eq('id', user.id)
    .maybeSingle();

  const { data: teams } = await supabase.from('teams').select('id, slug').order('name');

  const destination =
    (profile?.team_id && teams?.find((team) => team.id === profile.team_id)?.slug) ??
    teams?.[0]?.slug;

  if (destination) redirect(`/admin/${destination}`);

  return (
    <main className="flex-1 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <div className="mt-8">
        <EmptyState
          title="No teams are set up"
          description="Hiring boards are organised by team, and there are no teams in the database yet. Reference data is seeded by migration, so running the migrations should be enough to fix this."
        />
      </div>
    </main>
  );
}
