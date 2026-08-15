# Foundations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the project skeleton, database schema, RLS policies, cache layer, and admin auth
that every later feature depends on — with no application UI yet.

**Architecture:** Next.js App Router on Vercel, Postgres and auth and storage via Supabase, FredDB
as an optional cache in front of public posting reads with silent fallback to Supabase. The database
is the source of truth for permissions: RLS policies keyed off a `profiles` table, not UI guards.
Applicant writes never reach the database directly — they go through server-side code holding the
service role, after Zod validation.

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Jest 30 + Testing Library,
`@supabase/ssr` + `supabase-js`, Supabase CLI for local Postgres, Zod.

**Conventions inherited from the `resumegit` project** (keep these consistent):
Jest via `next/jest`, `@/*` import alias to `src/`, Tailwind v4 through `@tailwindcss/postcss`,
shadcn token vocabulary, ESLint 9 + Prettier + husky + lint-staged.

**Package manager: npm.** pnpm is installed locally but this is a team repo that other students will
clone, and npm is the lowest-friction default. Do not mix lockfiles.

**Reference:** [Design doc](./2026-08-15-hiring-portal-design.md) — read Section 3 (data model) and
Section 9 (permissions) before starting Task 6.

---

## Prerequisites

Verify before Task 1. All were confirmed present on 2026-08-15:

```bash
node --version       # v25.2.1
npm --version        # 11.6.2
supabase --version   # 2.66.0
docker --version     # 29.1.3 — must be RUNNING, not just installed
```

Docker Desktop must be actually running before Task 5. `supabase start` boots Postgres in
containers and fails with an unhelpful error if the daemon is down.

---

## Task 1: Scaffold Next.js

**Files:**
- Create: the whole app skeleton at repo root

**Step 1: Scaffold into a temp directory**

`create-next-app` refuses to run in a directory containing unrecognised entries, and we already have
`docs/`. Scaffold elsewhere and copy in.

```bash
SCRATCH="$TMPDIR/sailbot-scaffold"
npx create-next-app@latest "$SCRATCH" \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --yes
```

Expected: "Success! Created sailbot-scaffold".

**Step 2: Copy into the repo, excluding git and modules**

```bash
cd "$SCRATCH"
rm -rf node_modules .git
cp -r . /c/Users/ryank/Documents/Code/sailbothiringportal/
cd /c/Users/ryank/Documents/Code/sailbothiringportal
rm -rf "$SCRATCH"
```

The scaffold's `.gitignore` will overwrite ours. Ours is more complete (Supabase, Vercel, editors) —
restore it: `git checkout .gitignore`.

**Step 3: Install and verify the dev server boots**

```bash
npm install
npm run dev
```

Expected: "Ready in ..." on http://localhost:3000. Stop the server.

**Step 4: Verify the build passes**

```bash
npm run build
```

Expected: build completes with no type errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with TypeScript and Tailwind v4"
```

---

## Task 2: Jest and Testing Library

Test infrastructure comes before the first real code so every later task can be TDD.

**Files:**
- Create: `jest.config.js`, `jest.setup.ts`, `src/lib/__tests__/smoke.test.ts`
- Modify: `package.json`

**Step 1: Install dev dependencies**

```bash
npm install -D jest@^30 jest-environment-jsdom@^30 @types/jest@^30 \
  @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 \
  ts-node@^10
```

**Step 2: Create `jest.config.js`**

Two projects: jsdom for component tests, node for anything touching Postgres or the network.
Integration tests are excluded from the default run because they need `supabase start`.

```js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

const customJestConfig = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFilesAfterEach: undefined,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
};

module.exports = createJestConfig(customJestConfig);
```

**Step 3: Create `jest.setup.ts`**

```ts
import '@testing-library/jest-dom';
```

**Step 4: Add scripts to `package.json`**

```json
"test": "jest --testPathIgnorePatterns '/node_modules/' '/.next/' '\\.integration\\.test\\.ts$'",
"test:integration": "jest --testMatch '**/*.integration.test.ts'",
"test:watch": "jest --watch"
```

**Step 5: Write a smoke test that fails**

`src/lib/__tests__/smoke.test.ts`:

```ts
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('merges conflicting tailwind classes, last wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy values', () => {
    expect(cn('p-2', false && 'hidden', undefined)).toBe('p-2');
  });
});
```

**Step 6: Run it and confirm it fails for the right reason**

```bash
npm test
```

Expected: FAIL — "Cannot find module '@/lib/utils'". A failure for any *other* reason means the Jest
config is wrong; fix that before continuing.

**Step 7: Create `src/lib/utils.ts`**

```bash
npm install clsx tailwind-merge
```

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**Step 8: Run tests and confirm they pass**

```bash
npm test
```

Expected: 2 passed.

**Step 9: Commit**

```bash
git add -A
git commit -m "Add Jest and Testing Library with cn() utility"
```

---

## Task 3: Prettier, ESLint, and pre-commit hooks

**Files:**
- Create: `.prettierrc`, `.prettierignore`, `.gitattributes`
- Modify: `package.json`

**Step 1: Create `.gitattributes`**

This must land early. Git is currently converting LF to CRLF, which produces noisy diffs the moment
a teammate on macOS touches a file.

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.pdf binary
```

**Step 2: Normalise existing files**

```bash
git add --renormalize .
```

**Step 3: Install and configure Prettier**

```bash
npm install -D prettier husky lint-staged
```

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "trailingComma": "all"
}
```

`.prettierignore`:

```
.next
node_modules
supabase/.temp
*.md
```

**Step 4: Wire husky and lint-staged**

```bash
npx husky init
echo "npx lint-staged" > .husky/pre-commit
```

Add to `package.json`:

```json
"lint-staged": {
  "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,css}": ["prettier --write"]
}
```

**Step 5: Verify the hook fires**

```bash
npx prettier --write .
git add -A
git commit -m "Add Prettier, lint-staged, and LF normalisation"
```

Expected: lint-staged output appears during the commit.

---

## Task 4: Design tokens

Implements Section 8 of the design doc. **The rule this enforces: no component takes a colour prop.**

**Files:**
- Modify: `src/app/globals.css`

**Step 1: Replace `src/app/globals.css` entirely**

Tailwind v4 is CSS-first — there is no `tailwind.config.ts` for this. `@theme inline` maps our
semantic variables onto Tailwind's colour namespace so `bg-card` and `text-muted-foreground` work.

```css
@import 'tailwindcss';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;

  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.985 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

**Step 2: Verify tokens resolve**

Put `<div className="bg-card text-muted-foreground border p-4">token check</div>` on the home page,
run `npm run dev`, confirm it renders with a visible border and grey text, then remove it.

**Step 3: Commit**

```bash
git add -A
git commit -m "Add semantic design tokens using shadcn vocabulary"
```

---

## Task 5: Supabase local development

**Files:**
- Create: `supabase/config.toml` (generated), `.env.local`, `.env.example`

**Step 1: Confirm Docker is running**

```bash
docker info
```

Expected: server info, no "cannot connect to the Docker daemon".

**Step 2: Initialise and start**

```bash
supabase init
supabase start
```

Expected: a table of local URLs and keys. This pulls several images on first run — it is slow once,
then fast. **Copy the `API URL`, `anon key`, and `service_role key` from the output.**

> **Two environment findings from the first run, both already applied.**
>
> **Ports moved to a `544xx` block.** The `resumegit` project holds a local Supabase stack on the
> default `543xx` ports, and two projects cannot share them. This project uses API 54421, db 54422,
> studio 54423. **Never hardcode `54321`** — read the URL from env. Reverting to defaults means
> stopping `resumegit` and editing seven numbers in `config.toml` plus `.env.local`.
>
> **`analytics.enabled = false` in `config.toml`.** The `supabase_vector` container crash-loops on
> Windows unless the Docker daemon is exposed on `tcp://localhost:2375`, which made every
> `supabase db reset` end in a 502 and exit non-zero *despite every migration applying fine*. That
> false failure would break any script gating on the exit code. Verified fixed: reset now exits 0.

**Step 3: Create `.env.local`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>

FREDB_API_KEY=
FREDB_BASE_URL=https://db.fredyang.com
```

**Step 4: Create `.env.example`**

Same keys, empty values, committed. `.env.local` is already gitignored — **confirm** with
`git check-ignore .env.local` before committing anything.

**Step 5: Commit**

```bash
git add supabase/config.toml .env.example
git commit -m "Initialise Supabase local development"
```

---

## Task 6: Migration — teams and subteams

**Files:**
- Create: `supabase/migrations/<timestamp>_teams_and_subteams.sql`

**Step 1: Generate the migration file**

```bash
supabase migration new teams_and_subteams
```

**Step 2: Write the migration**

```sql
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
```

Note: RLS is enabled with **no policies yet**, which denies everything by default. Policies land in
Task 10. This ordering is deliberate — a table that is briefly readable by the world is a worse
mistake than one that is briefly readable by nobody.

**Step 3: Apply and verify**

```bash
supabase db reset
```

Expected: migrations apply with no errors.

**Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Add teams and subteams tables"
```

---

## Task 7: Migration — profiles

**Files:**
- Create: `supabase/migrations/<timestamp>_profiles.sql`

**Step 1: Generate and write**

```bash
supabase migration new profiles
```

```sql
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
```

**Step 2: Apply and verify**

```bash
supabase db reset
```

**Step 3: Commit**

```bash
git add supabase/migrations
git commit -m "Add profiles table with role helpers and signup trigger"
```

---

## Task 8: Migration — postings and core questions

**Files:**
- Create: `supabase/migrations/<timestamp>_postings.sql`

**Step 1: Generate and write**

```bash
supabase migration new postings
```

```sql
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
```

`stable_key` is what keeps export columns aligned across teams forever, even if question wording
changes. It is never edited after creation.

**Step 2: Apply, then commit**

```bash
supabase db reset
git add supabase/migrations
git commit -m "Add postings and core_questions tables"
```

---

## Task 9: Migration — applications, notes, events

**Files:**
- Create: `supabase/migrations/<timestamp>_applications.sql`

**Step 1: Generate and write**

```bash
supabase migration new applications
```

```sql
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
```

**Step 2: Create the private resume bucket**

Same migration, appended:

```sql
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;
```

**Public is `false` and must stay false.** No storage policies are created for `anon` or
`authenticated` — all resume access goes through server-side code holding the service role, which
mints short-lived signed URLs.

**Step 3: Apply, then commit**

```bash
supabase db reset
git add supabase/migrations
git commit -m "Add applications, notes, events tables and private resume bucket"
```

---

## Task 10: RLS policies, test-first

This is the security boundary. **Write the tests first** — they are the only thing that proves a
lead cannot read another team's applicants.

**Files:**
- Create: `supabase/migrations/<timestamp>_rls_policies.sql`
- Create: `src/lib/supabase/__tests__/rls.integration.test.ts`
- Create: `src/test/supabase-helpers.ts`

**Step 1: Write the test helper**

`src/test/supabase-helpers.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

/** Creates a confirmed user, sets their profile row, returns a client signed in as them. */
export async function signedInAs(opts: {
  email: string;
  role: 'admin' | 'lead';
  teamId?: string;
}): Promise<SupabaseClient> {
  const admin = adminClient();
  const password = 'test-password-123';

  const { data: created, error } = await admin.auth.admin.createUser({
    email: opts.email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  // The signup trigger already inserted the profile row; update it.
  await admin
    .from('profiles')
    .update({ role: opts.role, team_id: opts.teamId ?? null })
    .eq('id', created.user!.id);

  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email: opts.email,
    password,
  });
  if (signInError) throw signInError;

  return client;
}
```

**Step 2: Write the failing test**

`src/lib/supabase/__tests__/rls.integration.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { adminClient, anonClient, signedInAs } from '@/test/supabase-helpers';

const admin = adminClient();

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechApplicationId: string;

beforeAll(async () => {
  const { data: teams } = await admin
    .from('teams')
    .insert([
      { name: 'Software', slug: 'soft' },
      { name: 'Mechanical', slug: 'mech' },
    ])
    .select();
  softTeamId = teams!.find((t) => t.slug === 'soft')!.id;
  mechTeamId = teams!.find((t) => t.slug === 'mech')!.id;

  const { data: postings } = await admin
    .from('postings')
    .insert([
      { team_id: softTeamId, title: 'Software', slug: 'soft-2026', status: 'open' },
      { team_id: mechTeamId, title: 'Mechanical', slug: 'mech-2026', status: 'draft' },
    ])
    .select();
  softPostingId = postings!.find((p) => p.slug === 'soft-2026')!.id;
  const mechPostingId = postings!.find((p) => p.slug === 'mech-2026')!.id;

  const { data: app } = await admin
    .from('applications')
    .insert({
      posting_id: mechPostingId,
      submission_id: crypto.randomUUID(),
      applicant_name: 'Mech Applicant',
      applicant_email: 'mech@student.ubc.ca',
      year_of_study: '3',
      home_department: 'MECH',
      question_schema_snapshot: [],
    })
    .select()
    .single();
  mechApplicationId = app!.id;
});

describe('anonymous access', () => {
  it('can read open postings', async () => {
    const { data } = await anonClient().from('postings').select().eq('status', 'open');
    expect(data).toHaveLength(1);
  });

  it('cannot read draft postings', async () => {
    const { data } = await anonClient().from('postings').select().eq('status', 'draft');
    expect(data).toHaveLength(0);
  });

  it('cannot read applications at all', async () => {
    const { data } = await anonClient().from('applications').select();
    expect(data).toHaveLength(0);
  });

  it('cannot insert an application directly', async () => {
    const { error } = await anonClient().from('applications').insert({
      posting_id: softPostingId,
      submission_id: crypto.randomUUID(),
      applicant_name: 'Sneaky',
      applicant_email: 'sneaky@example.com',
      year_of_study: '1',
      home_department: 'CPSC',
      question_schema_snapshot: [],
    });
    expect(error).not.toBeNull();
  });
});

describe('lead access', () => {
  it('cannot read another team applications', async () => {
    const softLead = await signedInAs({
      email: `soft-lead-${Date.now()}@test.dev`,
      role: 'lead',
      teamId: softTeamId,
    });
    const { data } = await softLead.from('applications').select().eq('id', mechApplicationId);
    expect(data).toHaveLength(0);
  });

  it('cannot edit another team posting', async () => {
    const softLead = await signedInAs({
      email: `soft-lead2-${Date.now()}@test.dev`,
      role: 'lead',
      teamId: softTeamId,
    });
    const { data } = await softLead
      .from('postings')
      .update({ title: 'Hijacked' })
      .eq('team_id', mechTeamId)
      .select();
    expect(data).toHaveLength(0);
  });
});

describe('admin access', () => {
  it('reads every team applications', async () => {
    const adminUser = await signedInAs({ email: `admin-${Date.now()}@test.dev`, role: 'admin' });
    const { data } = await adminUser.from('applications').select();
    expect(data!.length).toBeGreaterThan(0);
  });
});
```

**Step 3: Run it and confirm it fails**

```bash
npm install -D dotenv
npm run test:integration
```

Expected: FAIL. With RLS on and no policies, even the anon "can read open postings" case returns
zero rows. That is the correct starting failure.

If tests error on missing env vars, add `require('dotenv').config({ path: '.env.local' })` to a
`jest.setup.integration.ts` and reference it from the integration script.

**Step 4: Write the policies**

```bash
supabase migration new rls_policies
```

```sql
-- teams and subteams: world-readable, admin-writable.
-- The public application form needs these before anyone authenticates.
create policy "teams are public" on teams for select using (true);
create policy "admins write teams" on teams for all
  using (is_admin()) with check (is_admin());

create policy "subteams are public" on subteams for select using (true);
create policy "admins write subteams" on subteams for all
  using (is_admin()) with check (is_admin());

-- core_questions: world-readable so the form renders, admin-owned.
create policy "core questions are public" on core_questions for select using (true);
create policy "admins write core questions" on core_questions for all
  using (is_admin()) with check (is_admin());

-- profiles: any authenticated user may read profiles, so note attribution can
-- resolve author names. Users update only their own row; admins update any.
create policy "authenticated read profiles" on profiles for select
  to authenticated using (true);
create policy "update own profile" on profiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- postings: open ones are public; leads own their team's.
create policy "open postings are public" on postings for select
  using (status = 'open' or is_admin() or team_id = current_profile_team());
create policy "leads write own team postings" on postings for all
  to authenticated
  using (is_admin() or team_id = current_profile_team())
  with check (is_admin() or team_id = current_profile_team());

-- applications: NO anon policy at all. Applicant submissions go through
-- server-side code holding the service role, which bypasses RLS entirely.
-- That server code is therefore responsible for checking the posting is open.
create policy "leads read own team applications" on applications for select
  to authenticated
  using (
    is_admin() or exists (
      select 1 from postings p
      where p.id = applications.posting_id and p.team_id = current_profile_team()
    )
  );
create policy "leads update own team applications" on applications for update
  to authenticated
  using (
    is_admin() or exists (
      select 1 from postings p
      where p.id = applications.posting_id and p.team_id = current_profile_team()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from postings p
      where p.id = applications.posting_id and p.team_id = current_profile_team()
    )
  );

-- notes: readable and insertable within team. No update or delete policy
-- exists, which is what makes them append-only at the database level.
create policy "leads read own team notes" on application_notes for select
  to authenticated
  using (
    is_admin() or exists (
      select 1 from applications a
      join postings p on p.id = a.posting_id
      where a.id = application_notes.application_id and p.team_id = current_profile_team()
    )
  );
create policy "leads insert own team notes" on application_notes for insert
  to authenticated
  with check (
    author_id = auth.uid() and (
      is_admin() or exists (
        select 1 from applications a
        join postings p on p.id = a.posting_id
        where a.id = application_notes.application_id and p.team_id = current_profile_team()
      )
    )
  );

-- events: same shape, also append-only.
create policy "leads read own team events" on application_events for select
  to authenticated
  using (
    is_admin() or exists (
      select 1 from applications a
      join postings p on p.id = a.posting_id
      where a.id = application_events.application_id and p.team_id = current_profile_team()
    )
  );
create policy "leads insert own team events" on application_events for insert
  to authenticated
  with check (
    is_admin() or exists (
      select 1 from applications a
      join postings p on p.id = a.posting_id
      where a.id = application_events.application_id and p.team_id = current_profile_team()
    )
  );
```

**Step 5: Apply and confirm the tests pass**

```bash
supabase db reset
npm run test:integration
```

Expected: all pass. **If any "cannot read" test passes only because a query errored rather than
returning zero rows, look closely** — an error and an empty result are different failures, and only
one of them means the policy works.

**Step 6: Commit**

```bash
git add -A
git commit -m "Add RLS policies with integration tests proving team isolation"
```

---

## Task 11: Seed data

**Files:**
- Create: `supabase/seed.sql`

**Step 1: Write the seed**

```sql
insert into teams (name, slug) values
  ('Mechanical', 'mech'),
  ('Electrical', 'elec'),
  ('Software', 'soft')
on conflict (slug) do nothing;

-- Taken from the real team postings in docs/. Operations is intentionally
-- absent: it is a ~6-person group that hires personally with no application
-- form, so it is out of scope for this portal entirely.
insert into subteams (team_id, name, code, slug, position, description)
select t.id, s.name, s.code, s.slug, s.position, s.description
from teams t
join (values
  ('soft', 'Pathfinding', 'PATH', 'pathfinding', 0,
   'The brain of the boat, responsible for determining an efficient route from start to finish using vector math, calculus, and path planning algorithms.'),
  ('soft', 'Rudder and Wingsail Controller', 'CTRL', 'controller', 1,
   'The virtual helmsman: turns abstract objectives such as a desired heading into commands for the rudder and sails, using control theory and physical modelling.'),
  ('soft', 'Boat Simulator', 'SIM', 'simulator', 2,
   'Mimics the real-world environment so software can be tested without a physical vessel, including a physics model of the boat and artificial sensor noise.'),
  ('soft', 'Network Systems', 'NET', 'network-systems', 3,
   'The software-hardware interface: a bridge for data and commands to travel between the two, working with the Electrical firmware team as much as the software team.'),
  ('soft', 'Website', 'WEB', 'website', 4,
   'The platform for data interactions to and from the vessel, serving team members, vessel operations, researchers, and the general public.'),
  ('soft', 'DevOps', 'DevOps', 'devops', 5,
   'Infrastructure as Code: development environments, CI/CD pipelines, and the docs site, so software deploys quickly, correctly, and consistently.'),

  ('elec', 'Communications', 'COM', 'communications', 0,
   'A robust communication network transmitting data, commands, and errors, spanning transmission lines, network interface PCBs, firmware, sensors, and message formats.'),
  ('elec', 'Drive', 'DRV', 'drive', 1,
   'The boat''s control systems: hardware and firmware controlling the rudder and wingsail, including PID control algorithms and critical pathfinding sensors.'),
  ('elec', 'Power', 'PWR', 'power', 2,
   'The boat''s power system: solar panels, power tracking, battery management, and the power budget that allocates a finite resource across every device.'),

  ('mech', 'Sail', null, 'sail', 0,
   'Construction of the wingsail, including the composite shell, the trim tab, and the internal structure.'),
  ('mech', 'Rudder', null, 'rudder', 1,
   'The rudder body and actuation mechanism, from CNC milling and composite layups through structural validation and integration with Hull and Electrical.'),
  ('mech', 'Hull', null, 'hull', 2,
   'Design and construction of the hull and keel using Maxsurf, SolidWorks, and Ansys, with heavy focus on composite fabrication and cross-team integration.')
) as s(team_slug, name, code, slug, position, description) on s.team_slug = t.slug
on conflict (team_id, slug) do nothing;

-- Wording taken verbatim from the 2025 form. Note how SMALL the genuinely
-- shared set is: name, email, year, and home department are built-in columns,
-- which leaves exactly one shared question. Everything else on that form was
-- team-specific. Resist padding this out — every key added here becomes a
-- permanent export column for all three teams.
insert into core_questions (stable_key, position, definition) values
  ('why_sailbot', 0, '{
     "type": "long_text",
     "label": "Briefly, describe yourself and why you would like to join UBC Sailbot",
     "help": "Suggested under 50 words",
     "required": true,
     "config": {"maxLength": 600}
   }'::jsonb)
on conflict (stable_key) do nothing;
```

> Subteams, codes, and descriptions come from the real postings in `docs/`. **Operations is
> deliberately not seeded** — it hires personally with no application form, so it is out of scope.
> Nothing in the schema assumes three teams; adding it later is one seed row and a posting.
>
> The per-team technical quizzes (mechanical's 11 questions, electrical's 8, software's skills
> matrix and quiz submission) are **not** seeded here. They belong in `postings.question_schema` and
> land with the posting builder in the next phase.

**Step 2: Apply and verify**

```bash
supabase db reset
```

Then confirm counts in Supabase Studio (see the port note in Task 5) — **3 teams, 12 subteams
(6 soft, 3 elec, 3 mech), 1 core question.**

**Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "Add seed data for teams, subteams, and core questions"
```

---

## Task 12: Typed Supabase clients

**Files:**
- Create: `src/lib/supabase/types.ts` (generated), `client.ts`, `server.ts`, `admin.ts`
- Modify: `package.json`

**Step 1: Install and generate types**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

Add a script:

```json
"db:types": "supabase gen types typescript --local > src/lib/supabase/types.ts"
```

```bash
npm run db:types
```

Expected: a `Database` type covering all seven tables. **Re-run this after every migration** — a
stale types file produces confident, wrong autocomplete.

**Step 2: Browser client** — `src/lib/supabase/client.ts`

```ts
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

**Step 3: Server client** — `src/lib/supabase/server.ts`

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Safe to ignore when middleware is refreshing sessions.
          }
        },
      },
    },
  );
}
```

**Step 4: Service-role client** — `src/lib/supabase/admin.ts`

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

/**
 * Bypasses RLS entirely. Use ONLY for applicant-facing writes, which are
 * anonymous by design, and always after Zod validation plus an explicit
 * check that the target posting is open.
 *
 * Never import this into a Client Component. The `server-only` package
 * turns that into a build error rather than a leaked key.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
```

```bash
npm install server-only
```

**Step 5: Commit**

```bash
git add -A
git commit -m "Add typed Supabase clients for browser, server, and service role"
```

---

## Task 13: FredDB cache layer, test-first

Implements Section 7 of the design doc. **Everything here is failure handling** — the cache being
down must be invisible.

**Verified API** (from https://db.fredyang.com/robot, checked 2026-08-15):

| Operation | Request |
|---|---|
| Provision | `POST https://db.fredyang.com/provision` → returns API key |
| Get | `GET /key/{KEY}` with `X-Api-Key` → raw text value |
| Set | `PUT /key/{KEY}` with `X-Api-Key`, body is the raw value |
| Delete | `DELETE /key/{KEY}` with `X-Api-Key` |
| Range | `GET /range?start=&end=` with `X-Api-Key` → JSON array |

Values are **raw text**, so we serialise and parse JSON ourselves. There is **no TTL**, so expiry
is stored inside the value.

**Files:**
- Create: `src/lib/cache/fredb.ts`, `src/lib/cache/index.ts`
- Create: `src/lib/cache/__tests__/cache.test.ts`

**Step 1: Provision a database**

```bash
curl -X POST https://db.fredyang.com/provision
```

Put the returned key in `.env.local` as `FREDB_API_KEY`.

**Step 2: Write the failing tests**

`src/lib/cache/__tests__/cache.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { cached, __resetBreaker } from '@/lib/cache';

const originalFetch = global.fetch;

beforeEach(() => {
  __resetBreaker();
  jest.useFakeTimers();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe('cached', () => {
  it('returns the fallback value on a cache miss', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    const result = await cached('k', 60, async () => 'from-db');
    expect(result).toBe('from-db');
  });

  it('returns the cached value on a hit without calling the fallback', async () => {
    const stored = JSON.stringify({ data: 'from-cache', expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => stored }) as never;

    const fallback = jest.fn();
    const result = await cached('k', 60, fallback);

    expect(result).toBe('from-cache');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('treats an expired value as a miss', async () => {
    const stored = JSON.stringify({ data: 'stale', expiresAt: Date.now() - 1 });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => stored }) as never;

    const result = await cached('k', 60, async () => 'fresh');
    expect(result).toBe('fresh');
  });

  it('falls through when the cache throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    const result = await cached('k', 60, async () => 'from-db');
    expect(result).toBe('from-db');
  });

  it('falls through when the cache exceeds the timeout', async () => {
    global.fetch = jest.fn().mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as never;

    const promise = cached('k', 60, async () => 'from-db');
    jest.advanceTimersByTime(250);
    await expect(promise).resolves.toBe('from-db');
  });

  it('stops calling the cache after repeated failures', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fetchMock as never;

    for (let i = 0; i < 5; i++) {
      await cached(`k${i}`, 60, async () => 'from-db');
    }
    const callsAfterTripping = fetchMock.mock.calls.length;

    await cached('k-later', 60, async () => 'from-db');
    expect(fetchMock.mock.calls.length).toBe(callsAfterTripping);
  });

  it('never lets a cache write failure reject the caller', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockRejectedValueOnce(new Error('write failed')) as never;

    await expect(cached('k', 60, async () => 'value')).resolves.toBe('value');
  });
});
```

**Step 3: Run and confirm failure**

```bash
npm test -- cache
```

Expected: FAIL — "Cannot find module '@/lib/cache'".

**Step 4: Write the FredDB client** — `src/lib/cache/fredb.ts`

```ts
import 'server-only';

const BASE = process.env.FREDB_BASE_URL ?? 'https://db.fredyang.com';
const API_KEY = process.env.FREDB_API_KEY;
const TIMEOUT_MS = 200;

function headers() {
  return { 'X-Api-Key': API_KEY! };
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fredbGet(key: string): Promise<string | null> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${BASE}/key/${encodeURIComponent(key)}`, {
      headers: headers(),
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.text();
  });
}

export async function fredbPut(key: string, value: string): Promise<void> {
  await withTimeout(async (signal) => {
    await fetch(`${BASE}/key/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: headers(),
      body: value,
      signal,
      cache: 'no-store',
    });
  });
}

export async function fredbDelete(key: string): Promise<void> {
  await withTimeout(async (signal) => {
    await fetch(`${BASE}/key/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: headers(),
      signal,
      cache: 'no-store',
    });
  });
}
```

**Step 5: Write the cache wrapper** — `src/lib/cache/index.ts`

```ts
import 'server-only';
import { fredbGet, fredbPut, fredbDelete } from './fredb';

const FAILURE_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let breakerOpenedAt = 0;

/** Test-only hook. */
export function __resetBreaker() {
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
}

function breakerIsOpen(): boolean {
  if (consecutiveFailures < FAILURE_THRESHOLD) return false;
  if (Date.now() - breakerOpenedAt > BREAKER_COOLDOWN_MS) {
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures === FAILURE_THRESHOLD) breakerOpenedAt = Date.now();
}

type Envelope<T> = { data: T; expiresAt: number };

/**
 * Cache-aside with silent fallback. The cache is never allowed to fail the
 * request: every error path returns the fallback value.
 *
 * Cache PUBLIC data only. Never applications — FredDB states plainly that
 * data may be lost, and applicant records are PII.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fallback: () => Promise<T>,
): Promise<T> {
  if (!process.env.FREDB_API_KEY || breakerIsOpen()) {
    return fallback();
  }

  try {
    const raw = await fredbGet(key);
    if (raw) {
      const envelope = JSON.parse(raw) as Envelope<T>;
      if (envelope.expiresAt > Date.now()) {
        consecutiveFailures = 0;
        return envelope.data;
      }
    }
    consecutiveFailures = 0;
  } catch {
    recordFailure();
    return fallback();
  }

  const fresh = await fallback();

  // Write-behind, deliberately not awaited into the response path.
  const envelope: Envelope<T> = { data: fresh, expiresAt: Date.now() + ttlSeconds * 1000 };
  void fredbPut(key, JSON.stringify(envelope)).catch(() => recordFailure());

  return fresh;
}

/** Best-effort invalidation. Never throws. */
export async function invalidate(key: string): Promise<void> {
  if (!process.env.FREDB_API_KEY) return;
  try {
    await fredbDelete(key);
  } catch {
    recordFailure();
  }
}

export const cacheKeys = {
  openPostings: () => 'posting:list:open',
  posting: (slug: string) => `posting:${slug}`,
};
```

**Step 6: Run and confirm all pass**

```bash
npm test -- cache
```

Expected: 7 passed.

**Step 7: Commit**

```bash
git add -A
git commit -m "Add FredDB cache layer with timeout, TTL, and circuit breaker"
```

---

## Task 14: Admin auth

**Files:**
- Create: `src/middleware.ts`, `src/app/(admin)/login/page.tsx`, `src/lib/supabase/middleware.ts`

**Step 1: Session refresh helper** — `src/lib/supabase/middleware.ts`

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // Do not remove: this refreshes the auth token on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
```

**Step 2: Middleware** — `src/middleware.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin');
  const isLoginRoute = request.nextUrl.pathname === '/login';

  if (isAdminRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (isLoginRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
};
```

**Step 3: Login page**

Email plus password, since leads are invited by an admin rather than self-registering. Keep it
plain — real styling comes later.

Create `src/app/(admin)/login/page.tsx` as a Client Component calling
`supabase.auth.signInWithPassword`, then `router.push(next ?? '/admin')`.

**Step 4: Verify manually**

```bash
npm run dev
```

- Visiting `/admin` while signed out redirects to `/login`.
- Create a user via Studio, sign in, land on `/admin`.
- Visiting `/login` while signed in redirects to `/admin`.

**Step 5: Commit**

```bash
git add -A
git commit -m "Add admin auth with session refresh middleware"
```

---

## Task 15: Route skeleton and app shell

**Files:**
- Create: the route group structure below

**Step 1: Create the structure**

```
src/app/
  (public)/
    page.tsx                      # open postings list, team descriptions
    apply/page.tsx                # the single cross-team application form (placeholder)
  (admin)/
    login/page.tsx
    admin/
      layout.tsx                  # sidebar shell, signed-in user
      page.tsx                    # redirects to first team board
      postings/page.tsx           # placeholder
      [team]/
        page.tsx                  # kanban board (placeholder)
        applications/[id]/page.tsx
```

Each placeholder renders a heading and nothing else. The point is that routing, layouts, and auth
boundaries are proven before any feature work begins.

**Step 2: Wire the public home page to real data through the cache**

This is the first end-to-end proof that Supabase, the typed client, and the cache all work together:

```tsx
import { cached, cacheKeys } from '@/lib/cache';
import { createClient } from '@/lib/supabase/server';

async function getOpenPostings() {
  return cached(cacheKeys.openPostings(), 60, async () => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('postings')
      .select('id, title, slug, description, team_id')
      .eq('status', 'open');
    return data ?? [];
  });
}
```

**Step 3: Verify**

Set one seeded posting to `open` in Studio, then confirm it renders on `/`. Then stop the internet
or blank `FREDB_API_KEY` and confirm the page still renders from Supabase. **That fallback check is
the whole point of Task 13** — do not skip it.

**Step 4: Add empty states**

Every placeholder gets a real empty state now, while it is cheap: no open postings, no applicants
yet, no notes yet. These are the thing that always gets skipped and always gets noticed.

**Step 5: Commit**

```bash
git add -A
git commit -m "Add route skeleton with cached public postings list"
```

---

## Definition of done

- [ ] `npm run build` passes clean
- [ ] `npm test` passes
- [ ] `npm run test:integration` passes against a local Supabase
- [ ] A lead cannot read another team's applications — proven by test, not by inspection
- [ ] The home page renders correctly with `FREDB_API_KEY` blank
- [ ] `/admin` redirects to `/login` when signed out
- [ ] The resume bucket is private and has no anon storage policy

## Deliberately not in this plan

The posting builder, the application form renderer, the kanban board, the detail view, the notes
pill port, and the Excel export. Each depends on the schema and RLS landing first.

The `question_schema_snapshot` invariant has no test yet because nothing writes applications so far.
**The first task of the next phase must be that test:** edit a posting, then assert an existing
application still renders its original questions.
