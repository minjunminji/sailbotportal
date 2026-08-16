import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { signOut } from './actions';
import { AdminNavLink } from './nav-link';

export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const supabase = await createClient();

  // The proxy already turned signed-out visitors away, but that is an
  // optimistic check. This is the one that runs against the database.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: profile }, { data: teams }] = await Promise.all([
    supabase.from('profiles').select('name, email, role, team_id').eq('id', user.id).maybeSingle(),
    supabase.from('teams').select('id, name, slug').order('name'),
  ]);

  // A lead only works one board. Showing them the others would just be three
  // links to boards RLS empties out.
  const visibleTeams =
    profile?.role === 'lead' && profile.team_id
      ? (teams ?? []).filter((team) => team.id === profile.team_id)
      : (teams ?? []);

  return (
    // A fixed-height app shell, not a page that grows. The board needs a region
    // with a real height so its columns can scroll sideways under sticky
    // headers; every other admin screen simply scrolls inside the same region.
    <div className="flex h-dvh">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-border p-6">
        <p className="text-sm font-semibold">Sailbot hiring</p>

        <nav aria-label="Admin sections" className="mt-6 flex flex-col gap-1">
          <p className="px-3 py-2 text-sm text-muted-foreground">Boards</p>
          {visibleTeams.map((team) => (
            <AdminNavLink key={team.id} href={`/admin/${team.slug}`}>
              {team.name}
            </AdminNavLink>
          ))}
          <AdminNavLink href="/admin/postings">Postings</AdminNavLink>
        </nav>

        <div className="mt-8 border-t border-border pt-4">
          <p className="text-sm font-medium">{profile?.name || profile?.email || user.email}</p>
          <p className="text-sm text-muted-foreground">
            {profile?.role === 'admin' ? 'Admin' : 'Team lead'}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-3 rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* `overflow-x-hidden` is spelled out rather than left to default. With
          only `overflow-y-auto`, CSS computes the visible axis to `auto` as
          well, so this wrapper quietly became a second horizontal scroll
          container and the whole page scrolled sideways behind the board's own
          scrollbar. Screens that need horizontal room scroll inside themselves,
          the way the board does. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
