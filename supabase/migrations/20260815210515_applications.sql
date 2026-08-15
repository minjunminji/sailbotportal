create table applications (
  id                       uuid primary key default gen_random_uuid(),
  posting_id               uuid not null references postings(id) on delete cascade,
  submission_id            uuid not null,   -- groups rows written by one submission
  applicant_name           text not null,
  applicant_email          text not null,
  year_of_study            text not null,   -- ordinal: '1'..'5', 'masters', 'phd'
  home_department          text not null,   -- APSC, IGEN, MECH, ENPH, CPSC, ...
  resume_path              text,            -- shared across the submission
  ranked_subteams          uuid[] not null default '{}',
  answers                  jsonb not null default '{}'::jsonb,
  question_schema_snapshot jsonb not null,
  status                   text not null default 'applied' check (status in (
                             'applied', 'reviewing',
                             'interview_email_sent', 'interview_scheduled', 'interview_completed',
                             'waitlisted', 'offered', 'rejected'
                           )),
  assigned_subteam_id      uuid references subteams(id),
  interview_at             timestamptz,
  status_changed_at        timestamptz not null default now(),
  submitted_at             timestamptz not null default now()
);

create unique index applications_posting_email_uniq
  on applications (posting_id, lower(applicant_email));

create index applications_posting_status_idx on applications(posting_id, status);
create index applications_email_idx on applications(lower(applicant_email));
create index applications_submission_id_idx on applications(submission_id);

-- Powers the days-in-column figure on the board card.
create or replace function public.touch_status_changed_at()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();
  end if;
  return new;
end;
$$;

create trigger applications_status_changed
  before update on applications
  for each row execute function public.touch_status_changed_at();

create table application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id      uuid not null references profiles(id),
  body           text not null check (length(trim(body)) > 0),
  created_at     timestamptz not null default now()
);

create index application_notes_application_id_idx
  on application_notes(application_id, created_at desc);

create table application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  actor_id       uuid references profiles(id),
  type           text not null,
  from_status    text,
  to_status      text,
  created_at     timestamptz not null default now()
);

create index application_events_application_id_idx
  on application_events(application_id, created_at desc);

alter table applications enable row level security;
alter table application_notes enable row level security;
alter table application_events enable row level security;

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
