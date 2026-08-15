create table postings (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id) on delete restrict,
  title           text not null,
  slug            text not null unique,
  description     text not null default '',
  requirements    text not null default '',
  status          text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  question_schema jsonb not null default '[]'::jsonb,
  subteam_ranking jsonb not null default '{"enabled": false, "maxChoices": 3}'::jsonb,
  position        integer not null default 0,
  closes_at       timestamptz,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index postings_team_id_idx on postings(team_id);
create index postings_status_idx on postings(status);

create table core_questions (
  id          uuid primary key default gen_random_uuid(),
  stable_key  text not null unique,
  position    integer not null default 0,
  definition  jsonb not null,
  created_at  timestamptz not null default now()
);

alter table postings enable row level security;
alter table core_questions enable row level security;
