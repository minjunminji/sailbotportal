import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { createClient } from '@/lib/supabase/server';

export default async function ApplicationPage({
  params,
}: PageProps<'/admin/[team]/applications/[id]'>) {
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
      <Link
        href={`/admin/${team.slug}`}
        className="inline-block rounded-md text-sm text-muted-foreground underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Back to the {team.name} board
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Application</h1>
      <p className="mt-3 text-base text-muted-foreground">
        The applicant&rsquo;s answers, their ranked subteams, and the notes the team has left.
      </p>

      <div className="mt-8">
        <EmptyState
          title="Nothing to show yet"
          description="Applications cannot be submitted until the form is built, so there is no record behind this address. Notes and the decision history will live here once there is."
        />
      </div>
    </main>
  );
}
