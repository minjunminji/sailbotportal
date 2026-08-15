# Sailbot Hiring Portal — Design

**Date:** 2026-08-15
**Status:** design agreed, not yet implemented

A hiring portal where team leads compose their own application forms, applicants submit without
creating an account, and leads move candidates through a kanban board.

Deferred work and the reasoning behind each cut live in [FUTURE_FEATURES.md](../FUTURE_FEATURES.md).

---

## 1. Organisational model

Two levels, and the naming matters because the original spec used different words:

- **Team** — mech, elec, soft. Three of them.

  Operations exists on the wider team but is **out of scope for this portal**: it is roughly six
  people and hires personally, with no application form. Nothing in the schema assumes three, so
  adding it later is one seed row and a posting.
- **Subteam** — pathfinding, website, network, and so on. Belongs to exactly one team.

**One posting per team**, but **one submission flow across all of them.** This mirrors the existing
Google Form: the applicant answers shared questions once, opts in to each team individually, answers
that team's questions, and uploads a resume once at the end.

**One submission writes one `applications` row per selected team.** This is the important part. A
candidate who applies to mech and software needs *two independent statuses* — mech must be able to
reject them while software is still interviewing. One row cannot hold that. So the applicant
experiences a single form while leads get genuinely separate pipelines, each on its own board.

Rows created together share a `submission_id`, which is how the admin UI can say "this person also
applied to Software" without conflating it with a separate application made months later.

**Subteam ranking is per-posting, not universal.** Software asks applicants to rank their top three
of NET/PATH/SIM/WEB/CTRL/DevOps. Mechanical and Electrical do not rank at all. Postings therefore
carry ranking config rather than every team being assumed to want it.

**Applications are fungible within a team.** Any subteam lead can review any application under
their team. Ranking is a hint about who looks first, not an ownership assignment. A lead who passes
on a candidate can drop them into `Waitlisted`, where any subteam with an open spot can pick them
up.

### Why not a posting per subteam

Considered and rejected. Per-subteam postings give sharper customisation but force the candidate to
guess which three to apply to, and leave several leads independently reviewing the same person with
no idea the others are looking. Ranking inside one application preserves the handoff behaviour the
current Google Form already provides.

### Subteams carry content, not just a label

The team postings describe each subteam substantially — PATH has a "You'll be a great fit if" list,
each electrical subteam states a goal and a projects list, and several name their codebases. An
applicant ranking NET against PATH against SIM has to be able to read what those are, on the form,
at the moment they rank. So `subteams` carries `code`, `description`, and a `details` JSONB for
goal/projects/codebases — not merely a name to display in a dropdown.

---

## 2. Question model

A posting's rendered form is **core questions + that team's own questions**, resolved at render
time.

**Core questions are org-wide and admin-owned.** Leads can reorder them but cannot edit or delete
them. Each carries a `stable_key` so exports align across teams permanently, even if the wording is
later revised.

They are **referenced, not copied into each posting**. Duplicating looks cheaper and costs more
every time after: rewording a question means editing it in four places, the wordings drift apart
within a cycle or two, and once they differ the export can no longer put those answers in one
column across teams.

**Subteam extras are optional and conditional.** A question may carry a `visibleIf` clause naming a
subteam and a rank threshold; it renders only for applicants who ranked that subteam that highly.

Extras are deliberately kept to a thin layer on top of a uniform core. Because any lead can review
any application, and because waitlist pulls are the point of the waitlist, **every application must
carry a complete core**. Full per-subteam branching was considered and rejected: it makes
applications non-comparable and lands waitlist pulls on partial data.

### Question shape

```ts
type Question = {
  id: string;
  type: 'short_text' | 'long_text' | 'select' | 'multi_select'
      | 'file' | 'scale' | 'matrix' | 'ranking';
  label: string;
  help?: string;
  required: boolean;
  config: Record<string, unknown>;   // options, min/max, rows/cols, etc.
  visibleIf?: { subteam: string; topN: number };
};
```

`stable_key` additionally appears on core questions.

Interactive puzzle types (the Wordle idea from the original spec) are **not** an extension of this
system — see FUTURE_FEATURES.md.

### The snapshot invariant

**At submit time, core questions and team questions are flattened into a single frozen array stored
on the application.** Authoring stays DRY; stored applications are self-contained.

This is the single most important rule in the design. Without it, a lead editing a posting silently
corrupts the rendering and export of every application already submitted. An application from March
must still display and export correctly after the posting is rewritten in August.

Detail views and exports read the snapshot. **Never the live posting.**

---

## 3. Data model

Postgres via Supabase. Seven tables. DDL below is illustrative rather than final.

| Table | Purpose |
|---|---|
| `teams` | 4 rows: mech, elec, soft, ops |
| `subteams` | belongs to a team; `code`, `description`, `details`, `active` flag |
| `profiles` | extends `auth.users`; drives all RLS |
| `postings` | one per team, owns `question_schema` |
| `core_questions` | org-wide, admin-owned |
| `applications` | built-in columns + custom answers + snapshot |
| `application_notes` | append-only, attributed |
| `application_events` | append-only status audit |

### profiles

```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  name        text not null,
  role        text not null check (role in ('admin', 'lead')),
  team_id     uuid references teams(id),
  subteam_id  uuid references subteams(id)   -- optional
);
```

Leads see and act on rows under their `team_id` only. Admins see everything. This is enforced in
RLS, not in the UI.

### postings

```sql
create table postings (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references teams(id),
  title           text not null,
  slug            text not null unique,
  description     text,
  requirements    text,
  status          text not null default 'draft'
                  check (status in ('draft', 'open', 'closed')),
  question_schema jsonb not null default '[]',
  subteam_ranking jsonb not null default '{"enabled": false, "maxChoices": 3}',
  position        integer not null default 0,   -- order of the team's branch in the form
  closes_at       timestamptz,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
```

There is **no recruiting-cycle entity**. Postings are simply open or closed. A **Duplicate posting**
action clones title, description, requirements and the full question set, which removes the
re-entry pain each term at a fraction of the cost.

### applications

Built-in fields stay real columns so filtering, dedupe-by-email, and export are plain SQL. Only
custom answers go to JSONB.

```sql
create table applications (
  id                       uuid primary key default gen_random_uuid(),
  posting_id               uuid not null references postings(id),
  submission_id            uuid not null,     -- groups rows written by one submission
  applicant_name           text not null,
  applicant_email          text not null,
  year_of_study            text not null,     -- ordinal: '1'..'5', 'masters', 'phd'
  home_department          text not null,     -- APSC, MECH, CPSC, ENPH, IGEN, ...
  resume_path              text,              -- private bucket key, shared across the submission
  ranked_subteams          uuid[] not null default '{}',   -- ordered, index 0 = first choice
  answers                  jsonb not null default '{}',
  question_schema_snapshot jsonb not null,
  status                   text not null default 'applied',
  assigned_subteam_id      uuid references subteams(id),   -- null until claimed
  interview_at             timestamptz,       -- manual entry in v1
  submitted_at             timestamptz not null default now()
);

create unique index applications_posting_email_uniq
  on applications (posting_id, lower(applicant_email));
```

The unique index turns an accidental double submit into a clear message rather than a duplicate row
or a 500.

#### Year and home department

The existing form asks "Year/Type of Education" and "Home Department (APSC, IGEN, MECH, ENPH, CPSC,
etc.)". Keep that vocabulary rather than inventing a faculty/major split the team does not use.

- **`year_of_study`** — dropdown. **Stored as an ordinal** (`'1'`…`'5'`, plus grad values), rendered
  through a label map. Storing `"3rd year"` makes "3rd year and above" inexpressible as a filter and
  sorts alphabetically.
- **`home_department`** — a **combobox with type-ahead over a seed list that still accepts free
  text**. Plain free text fragments fast: "CPEN", "Computer Engineering", "comp eng", and "cpen
  (co-op)" become four values within one cycle, and grouping in the export stops working. The seed
  list normalises the common cases while unusual departments still get through, and nobody maintains
  it. `quick-add-blob-combobox.tsx` in the resumegit project is the same pattern.

### Status values

A **single flat status column**, not a stage/substage pair. One field keeps transitions atomic,
makes `application_events` audit substage moves for free, and avoids two columns drifting out of
sync. Board layout is presentation config mapping status to column order.

```
applied
reviewing
interview_email_sent
interview_scheduled
interview_completed
waitlisted
offered
rejected
```

**No ratings.** The decision is advance-or-fail, and advancing *is* the status move.
`application_events` already records who moved a candidate, from where, to where, and when — so
there is no separate decision or review entity.

### application_notes

```sql
create table application_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  author_id      uuid not null references profiles(id),
  body           text not null,
  created_at     timestamptz not null default now()
);
```

**Append-only, never edited in place.** A shared editable textarea gets silently clobbered: a lead
pulling someone off the waitlist opens the application and overwrites what the previous reviewer
wrote — and that overwritten note ("strong on algorithms, we just filled our spots") is the entire
reason the waitlist pull was worth making. Attribution comes free.

### application_events

```sql
create table application_events (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  actor_id       uuid references profiles(id),
  type           text not null,
  from_status    text,
  to_status      text,
  created_at     timestamptz not null default now()
);
```

Cheap to write, and it answers "who rejected this person and when" without a dedicated table.

---

## 4. Applicant experience

No login, no account. Email is the identifier.

Routes: `/` lists open postings and describes the teams, `/apply` is the single form covering all of
them.

### Steps, in this order

1. **About you** — name, email, year of study, home department
2. **Core questions** — asked once, regardless of which teams they pick
3. **Per team, one gate each** — "Do you want to apply to Mechanical?" If yes, that team's questions
   render inline, including the subteam ranking if that posting enables it. If no, skip to the next
   team. Teams appear in a fixed order; only `open` postings appear at all.
4. **Resume upload** — once, shared by every row the submission creates
5. **Review and submit**

Ranking sits inside its team's branch and before that team's questions, because it drives
`visibleIf`. Putting it after would mean re-rendering questions the applicant has already answered.

**On submit, one row per selected team**, all sharing a freshly generated `submission_id`,
`resume_path`, and the shared answers. Each row gets its own snapshot of *that* posting's flattened
question set — so mech's row carries mech's quiz, not software's.

A submission selecting zero teams is rejected client- and server-side. It is the one genuinely
ambiguous end state of a form built out of optional branches.

### Draft persistence

Autosave to `localStorage`, keyed by posting slug, cleared on successful submit. No accounts means
no server-side drafts, but a student who refreshes mid-essay must not lose twenty minutes of
writing. Does not survive a device switch — accepted tradeoff.

### Resume upload

The one genuine security surface, since uploads are unauthenticated.

- Upload goes to a **route handler**, never direct-to-bucket from the browser.
- Validate **MIME type and magic bytes** (PDF only) and cap size at ~5MB.
- Write to a **private** Supabase Storage bucket under a random UUID, using the service role.
- **No public read, ever.** Admin-side access is via short-lived signed URLs.

Getting this wrong makes every applicant's resume a guessable public URL.

### Validation

A Zod schema derived from `question_schema`, used on both client and server. **The server rebuilds
it from the posting and never trusts the client's copy.**

### Submit

Revalidate against the live schema, flatten core + team questions into `question_schema_snapshot`,
insert, send **one confirmation email**. With no accounts, that receipt is the applicant's only
proof they applied.

Spam control is a honeypot field plus a per-IP rate limit. No captcha until abuse is actually
observed.

---

## 5. Admin experience

### Board

One board per team posting. Eight flat columns, no rows-within-columns:

```
Applied → Reviewing → Interview: email sent → Interview: scheduled
       → Interview: completed → Waitlisted → Offered → Rejected
```

Eight columns at a readable width exceeds any laptop, so the board scrolls horizontally. Two things
keep that manageable:

- `Rejected` and `Waitlisted` **collapse to narrow labelled strips** by default. They remain valid
  drop targets. `Rejected` sits at the far right — it grows fastest and is read least.
- Column headers are **sticky, with live counts**.

**Empty columns must still render as visible drop targets.** A column that disappears when empty
can never receive its first card.

**Card shows five things and stops:** name, year + program, first-choice subteam,
**days-in-column**, and a note count. Days-in-column is what surfaces neglected candidates during a
busy cycle. Once a subteam claims the candidate, a badge replaces the first-choice line.

**Drag updates optimistically** — move the card, write in the background, roll back with a toast on
failure. Every move appends an `application_events` row.

**Supabase Realtime is on for `applications`.** Several leads work the same board during recruiting;
without it two people drag the same card in opposite directions and neither sees the other.

**Filters above the board:** subteam ranked first, date submitted, and text search over name and
email. Filters narrow columns in place rather than switching views, so counts always describe what
is on screen.

### Application detail

A **real route** — `/[team]/applications/[id]` — using Next's intercepting routes, so clicking a
card is an instant takeover while a pasted link opens the same view directly. Leads share candidates
in chat constantly; a modal that cannot be linked to forces "scroll to the third column, the one
named Jane".

**Two panes.** Left scrolls answers; right pins the resume. Reviewers read an answer, glance at the
resume, read the next one — tabs make them lose their place every time. The resume collapses to a
tab on narrow screens.

- **Resume viewer:** native `<embed>` against a signed URL minted server-side per page load
  (~10 minutes), with a download fallback for PDFs that fail to embed.
- **Answers render from `question_schema_snapshot`.**
- **Header:** name, email as `mailto:`, year + program, ranked subteams in order, submitted date.
- **Stage control:** a horizontal stepper across all eight stages, click to move. Shares one code
  path with the board drag.
- **Prev/next navigation** with arrow buttons and `J`/`K`, walking the *currently filtered* set.
  Reviewing forty applications should be forty keystrokes, not forty round trips through the board.
  Filter state lives in the URL so the sequence survives a refresh.

### Notes panel

Ported from the `quick-add` pill in the `resumegit` project
(`src/components/quick-add/quick-add-pill.tsx`). Its `appendAccomplishment` action is already
append-only, which matches `application_notes` exactly.

Adaptations:

- **Drop the fixed positioning.** It is `fixed bottom-6 left-1/2 z-40` and mounted app-wide there.
  Here it is horizontally centred at the bottom of the **right (resume) pane**.
- **Remove the blob combobox** — the target is implicit. The notes list replaces it above the input.
- **Collapsed state shows the note count** ("3 notes"), not a `+` icon.
- **Remove the global `Cmd/Ctrl+K` binding entirely.** A contextual panel should not own a window
  listener, and that chord is wanted for search later.
- **Strip posthog.** `framer-motion`, `@tanstack/react-query`, lucide, shadcn `Button`, and
  `lib/machine` / `lib/shortcut` / `lib/hint-storage` come along — note that react-query is a stack
  decision arriving by import, and should be made deliberately.
- On touch pointers, render an always-expanded panel rather than the FAB.

**Keyboard guards required:** `J`/`K` prev/next must not fire while focus is in the note input, and
Escape must close the pill first, the takeover on a second press.

**Never place this component on kanban cards** — hover-expand and drag-and-drop fight badly.

**Verify early:** overlaying HTML on a native PDF `<embed>` has historically had z-index problems in
some browsers. If it misbehaves, inset the embed so the pill gets its own strip.

---

## 6. Export

Server-side, in a route handler, using **`exceljs`** — streaming and actively maintained. Avoid
SheetJS's npm build.

Column order: built-in fields, then core questions **keyed by `stable_key`** so they align across
every team, then that team's own questions, then ranked subteams as ordered columns, then status,
assigned subteam, and submitted date.

Two things that are easy to get wrong:

- **Run under the requesting user's RLS, never the service role.** Otherwise a lead exports another
  team's applicants with one URL guess.
- **Respect the board's active filters**, so the export matches what is on screen.

Decide flattening rules once for `multi_select` and `matrix` answers — one column per option reads
better than a joined string.

Resumes cannot embed in a sheet. Include a link column pointing at an **auth-checked route that
mints a fresh signed URL per visit**; a raw signed URL in a spreadsheet is dead in ten minutes.

---

## 7. Caching (FredDB)

FredDB is a minimal KV store that states plainly that data may be lost at any time and that
databases expire after 67 days of inactivity. It is treated strictly as a cache.

**Cached: postings list and posting detail.** Read-heavy, rarely changing, not sensitive.

**Never cached: applications, notes, or anything applicant-related.** It is PII in a store with no
durability guarantee, and a stale kanban board is worse than a slow one.

Three things it needs because of what FredDB does not provide:

- **No TTL exists.** Store `{ data, expiresAt }` and treat expired values as misses.
- **Hard timeout via `AbortController` (~200ms).** Any error, timeout, or 401 falls through to
  Supabase silently.
- **Circuit breaker.** After a few consecutive failures, skip FredDB entirely for some minutes.
  Otherwise every request pays the full timeout for as long as it is down.

Invalidation is a best-effort delete on posting write — logged, never thrown.

**All of it lives behind a single `cache.ts`.** Call sites see `getPosting(id)` and have no idea
FredDB exists.

> Worth stating plainly: Next's `unstable_cache` and ISR would do this for free on Vercel. If
> FredDB is a deliberate constraint, that is fine — but keep dropping it a one-file change.

---

## 8. UI base

No visual direction yet. A UI designer arrives later; the goal now is a base that does not need
tearing out.

**Adopt shadcn's token vocabulary wholesale** — `bg-card`, `border-border`,
`text-muted-foreground`, `focus:ring-ring`. The ported pill already speaks it, it is a dialect a
future designer likely reads, and it makes dark mode nearly free later. Tailwind v4, tokens as CSS
variables in one file.

**The rule that makes a restyle cheap: no component takes a colour prop, ever.** Every surface,
border, and text colour resolves through a semantic token. Done properly the designer edits one
file. Done sloppily — one stray `bg-slate-800` — they are grepping two hundred.

**Constrain the scales, since taste is not yet available:**

- Spacing: 4, 8, 12, 16, 24, 32, 48. Nothing else.
- Type: four sizes.
- One font. The system stack is genuinely fine and reads as deliberate rather than unfinished.
- Neutral greys, one accent, plus semantic status colours for the eight columns. Colour is never the
  only signal; the columns carry labels regardless.

**Libraries:** Radix primitives via shadcn for dialog, dropdown, select, tabs, popover. `dnd-kit`
for the board.

**Do not build a component library up front.** Build what the screens need and extract on the third
repetition. Speculative components are wrong in ways that only surface during the rewrite.

**The base that actually matters is the part a designer cannot retrofit:** semantic HTML, real form
labels, visible focus rings, keyboard paths through the board, and correct loading and empty states.
`dnd-kit` provides keyboard drag if its announcements are wired. Empty states especially — an empty
column, a posting with no applicants, a failed resume load — get skipped in every prototype and are
most of what "feels finished" means.

Colour and type are cheap to change later. Structure and accessibility are not.

---

## 9. Permissions

| Actor | Can |
|---|---|
| Applicant | Submit to any open posting. No read access to anything. |
| Lead | Full CRUD on their own team's postings; read, note, and move applications under their team. |
| Admin | Everything, plus sole ownership of the core question set. |

Enforced in **RLS policies keyed off `profiles`**, not in the UI. A lead physically cannot fetch
another team's applicants — this is not a hidden route.

---

## 10. Stack

- **TypeScript + Next.js** (App Router), deployed on **Vercel**
- **Supabase** — Postgres, auth (admin side only), storage
- **FredDB** — cache for public posting reads, with Supabase fallback
- **Tailwind v4** + shadcn/Radix, **dnd-kit**, **framer-motion**
- **exceljs** for export, **Zod** for validation

---

## 11. Open questions

- Which email provider for the confirmation receipt (Resend is the obvious default on Vercel).
- Whether `@tanstack/react-query` is adopted app-wide or confined to the ported notes component.
- Concrete `config` shapes for the `matrix` and `ranking` question types.
- Whether Sailbot recruits graduate students. If so, `year_of_study` wants `masters` and `phd`
  rather than a single catch-all `grad`.
- The seed list of common home departments (APSC, IGEN, MECH, ENPH, CPSC, …).
- **A second file upload per question.** Software's technical quiz accepts either a public GitHub
  URL or a ZIP upload, which the `file` question type currently does not model — the design assumed
  one resume upload per submission and nothing else.
- Whether the two "available in person every Saturday" confirmations (electrical and software, but
  not mechanical) should become a core question, a per-team question, or stay duplicated.

---

## 12. Explicitly out of scope for v1

Automated interview scheduling, candidate accounts, server-side drafts, interactive puzzle
questions, recruiting cycles, rejection and status-change emails, analytics.

Each is recorded in [FUTURE_FEATURES.md](../FUTURE_FEATURES.md) with its reasoning and a trigger for
reconsidering it.
