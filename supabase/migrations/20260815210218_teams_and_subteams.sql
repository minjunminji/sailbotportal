create extension if not exists "pgcrypto";

create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

create table subteams (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  name        text not null,
  code        text,                                  -- PATH, NET, PWR; null for mech
  slug        text not null,
  description text not null default '',
  details     jsonb not null default '{}'::jsonb,    -- goal, projects, codebases
  position    integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (team_id, slug)
);

create index subteams_team_id_idx on subteams(team_id);

alter table teams enable row level security;
alter table subteams enable row level security;
