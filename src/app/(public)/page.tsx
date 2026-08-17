import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { cached, cacheKeys } from '@/lib/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Open postings go through the cache: they are public, small, and read far more
 * often than they change. `cached` falls back to this query whenever the cache
 * is unreachable or unconfigured, which is the normal path in development.
 */
async function getOpenPostings() {
  return cached(cacheKeys.openPostings(), 60, async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('postings')
      .select('id, title, slug, description, team_id')
      .eq('status', 'open')
      .order('position');
    return data ?? [];
  });
}

/** Reference data, read straight from Postgres. Public under RLS. */
async function getTeams() {
  const supabase = await createClient();
  const { data } = await supabase
    .from('teams')
    .select('id, name, slug, subteams(id, name, code, description, active)')
    .order('name')
    .order('position', { referencedTable: 'subteams' });
  return data ?? [];
}

export default async function HomePage() {
  const [postings, teams] = await Promise.all([getOpenPostings(), getTeams()]);
  const teamNamesById = new Map(teams.map((team) => [team.id, team.name]));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">UBC Sailbot hiring</h1>
        <p className="mt-3 text-base text-muted-foreground">
          UBC Sailbot is a student design team that builds autonomous sailboats. We recruit across
          three engineering teams, each made up of several subteams you can rank when you apply.
        </p>
      </header>

      <section className="mt-12" aria-labelledby="open-postings-heading">
        <h2 id="open-postings-heading" className="text-lg font-semibold">
          Open postings
        </h2>

        {postings.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing is open for applications right now"
              description="Recruitment runs at the start of each term. The teams and subteams below are still worth reading through, so you know where you want to land when it opens."
            />
          </div>
        ) : (
          <>
            <ul className="mt-4 flex flex-col gap-4">
              {postings.map((posting) => (
                <li
                  key={posting.id}
                  className="rounded-lg border border-border bg-card p-6 text-card-foreground"
                >
                  <p className="text-sm text-muted-foreground">
                    {teamNamesById.get(posting.team_id) ?? 'UBC Sailbot'}
                  </p>
                  <h3 className="mt-2 text-lg font-semibold">{posting.title}</h3>
                  {posting.description ? (
                    <p className="mt-2 text-base text-muted-foreground">{posting.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            <Link
              href="/apply"
              className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-base font-medium text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Start an application
            </Link>
          </>
        )}
      </section>

      <section className="mt-12" aria-labelledby="teams-heading">
        <h2 id="teams-heading" className="text-lg font-semibold">
          The teams
        </h2>

        {teams.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Team information is unavailable"
              description="We could not load the team list. Refresh in a moment, or email the team if it keeps happening."
            />
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-8">
            {teams.map((team) => {
              const subteams = team.subteams.filter((subteam) => subteam.active);
              return (
                <article key={team.id}>
                  <h3 className="text-base font-semibold">{team.name}</h3>
                  <ul className="mt-4 flex flex-col gap-4">
                    {subteams.map((subteam) => (
                      <li
                        key={subteam.id}
                        className="rounded-lg border border-border bg-card p-4 text-card-foreground"
                      >
                        <p className="text-base font-medium">
                          {subteam.name}
                          {subteam.code ? (
                            <span className="ml-2 text-sm font-normal text-muted-foreground">
                              {subteam.code}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">{subteam.description}</p>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
