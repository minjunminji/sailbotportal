import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { createClient } from '@/lib/supabase/server';

export default async function TeamBoardPage({ params }: PageProps<'/admin/[team]'>) {
  const { team: slug } = await params;
  const supabase = await createClient();

  const { data: team } = await supabase
    .from('teams')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle();

  if (!team) notFound();

  return (
    <main className="flex-1 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{team.name} board</h1>
      <p className="mt-3 text-base text-muted-foreground">
        Applicants move left to right through review, interview, and decision.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No applicants yet"
          description="Cards appear here as soon as people start submitting. Open the team's posting first — nothing can arrive while it is still a draft."
        />
      </div>
    </main>
  );
}
