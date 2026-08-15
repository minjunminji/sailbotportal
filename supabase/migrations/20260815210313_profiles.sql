create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null default '',
  role        text not null default 'lead' check (role in ('admin', 'lead')),
  team_id     uuid references teams(id),
  subteam_id  uuid references subteams(id),
  created_at  timestamptz not null default now()
);

create index profiles_team_id_idx on profiles(team_id);

alter table profiles enable row level security;

-- Security-definer helpers. These MUST be security definer: a policy on `profiles`
-- that queries `profiles` recurses and errors at query time.
create or replace function public.current_profile_team()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

-- Create a profile row whenever an admin invites a user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
