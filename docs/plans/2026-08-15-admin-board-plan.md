# Admin Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A lead can see every applicant to their team on a kanban board, move them through stages by
drag or keyboard, open any application in full, and leave attributed notes.

**Architecture:** One board per team posting, eight flat status columns. Status lives in a single
column on `applications`; the board's layout is presentation config mapping status to column order.
Every move appends to `application_events`, so history is complete without extra bookkeeping. Reads
are scoped by RLS, so a lead physically cannot fetch another team's applicants.

**Tech Stack:** Next.js 16 App Router, `dnd-kit`, Supabase Realtime, framer-motion (already a
dependency via the ported pill), Jest + Testing Library.

**Reference:** [Design doc](./2026-08-15-hiring-portal-design.md) section 5 (admin experience).
Environment gotchas in the [foundations plan](./2026-08-15-foundations-implementation-plan.md) —
544xx ports, flaky `db reset` exit code, `npm run verify` not bare `tsc`, namespaced test fixtures.

---

## Scope

**In:** dev fixtures, board with filters, drag and keyboard status moves, realtime sync, the
full-screen detail view, resume viewer, attributed notes, prev/next navigation.

**Out:** the posting builder, Excel export, status-change emails, analytics. Export is the next
phase and depends on nothing here.

---

## Task 1: Dev fixtures

**Files:** `supabase/seed.sql`

The board cannot be built against an empty database, and there is still no way to submit an
application through the UI at volume.

`seed.sql` has been deliberately empty until now — reference data went into migrations because
production needs it. **This is what `seed.sql` is actually for**: disposable fixtures that run only
on local `db reset` and must never reach production.

Generate ~40 applications spread across the three postings and all eight statuses, with realistic
names, years, home departments, varied `ranked_subteams` for Software, a few sharing a
`submission_id` (the same person applying to two teams), a few sharing an email across submissions,
and `status_changed_at` values spread over several weeks so days-in-column is visibly different.
Include a handful with notes and events already attached.

**Every fixture email must contain an underscore.** An unescaped `_` in `ilike` is a wildcard, and
that bug has already been caught once here.

Also seed two lead accounts and one admin so the board can be exercised as each role.

Commit: "Add development fixtures for board work"

---

## Task 2: Board data layer

**Files:** `src/lib/applications/queries.ts` and tests

`getBoardApplications(postingId, filters)` returning the fields the card needs and nothing more:
id, name, year, home department, first-choice subteam, status, `status_changed_at`, note count,
`assigned_subteam_id`.

Filters: subteam ranked first, date submitted, and free text over name and email. **Filters live in
the URL**, so a filtered board survives a refresh and can be shared — and so the detail view's
prev/next can walk the same set.

Note count comes from an aggregate, not by loading every note. Loading notes to count them is how a
board with 300 applicants gets slow.

**Integration tests:** a lead sees only their team's applicants (RLS, again, from the query layer
this time); filters compose correctly; the count aggregate matches reality.

Commit: "Add board query layer with URL-driven filters"

---

## Task 3: Board UI

**Files:** `src/app/(admin)/admin/[team]/page.tsx` and components under `src/components/board/`

Eight columns: `Applied` → `Reviewing` → `Interview: email sent` → `Interview: scheduled` →
`Interview: completed` → `Waitlisted` → `Offered` → `Rejected`.

- Board scrolls horizontally; **`Rejected` and `Waitlisted` collapse to narrow labelled strips by
  default** and stay valid drop targets. `Rejected` sits far right — it grows fastest, is read least.
- Column headers sticky with live counts.
- **Empty columns must still render as visible drop targets.** A column that disappears when empty
  can never receive its first card.
- **Card shows five things and stops:** name, year + home department, first-choice subteam,
  days-in-column, note count. Days-in-column is what surfaces neglected candidates. A subteam badge
  replaces the first-choice line once `assigned_subteam_id` is set.

Commit: "Add kanban board with collapsible columns"

---

## Task 4: Status moves

**Files:** `src/app/actions/move-application.ts`, a migration, components

`dnd-kit` for drag. **Keyboard drag must work** — `dnd-kit` provides it if the sensors and
announcements are wired, and it is the accessibility feature that is expensive to retrofit.

The server action: assert the target status is valid, update, **and append an
`application_events` row in the same transaction.** A status change with no audit row is worse than
no audit at all, because the history looks complete and is not. Same Postgres-function pattern as
`submit_application` — and **the same revoke**: every function in `public` is a PostgREST endpoint
until you revoke it from `public`, `anon`, and `authenticated`.

Optimistic update: move the card immediately, roll back with a toast on failure.

**Tests:** a lead cannot move another team's applicant (through the action, not just RLS); the event
row is written with the correct from/to; a failed update rolls the card back; `status_changed_at`
advances; keyboard drag produces the same result as pointer drag.

Commit: "Add drag and keyboard status moves with audit trail"

---

## Task 5: Realtime

**Files:** a hook under `src/components/board/`

Subscribe to `applications` for the current posting. Several leads work one board during recruiting;
without this, two people drag the same card in opposite directions and neither sees it.

Reconcile against optimistic state carefully — an echo of your own change must not fight your
pending update. Unsubscribe on unmount.

Commit: "Add realtime board sync"

---

## Task 6: Application detail

**Files:** `src/app/(admin)/admin/[team]/applications/[id]/page.tsx` + intercepting route

**A real route**, using intercepting routes so a card click is an instant takeover while a pasted
link opens the same view. Leads share candidates in chat constantly; a modal that cannot be linked
to forces "scroll to the third column, the one named Jane".

Two panes: left scrolls answers, right pins the resume. On narrow screens the resume becomes a tab.

**Answers render from `question_schema_snapshot`, never the live posting.** This is the payoff for
that column — and the place a future developer will be tempted to "simplify" by reading the posting.
Add a test that edits the posting and asserts the detail view still shows the original questions.

Header: name, email as `mailto:`, year + home department, ranked subteams in order, submitted date,
and a link to the other applications sharing this `submission_id`.

Commit: "Add application detail view rendering from snapshot"

---

## Task 7: Resume viewer

**Files:** a route handler minting signed URLs, plus the viewer

Native `<embed>` against a **short-lived signed URL minted server-side per page load** (~10 minutes),
with a download fallback for PDFs that fail to embed. The bucket is private and must stay private.

**Verify the z-index behaviour early** — overlaying HTML on a native PDF embed has historically had
problems in some browsers, and Task 8's notes pill sits at the bottom of this pane. If it misbehaves,
inset the embed so the pill gets its own strip.

Commit: "Add resume viewer with short-lived signed URLs"

---

## Task 8: Notes panel

**Files:** components under `src/components/notes/`

Port the hover-expand pill from `C:\Users\ryank\Documents\Code\resumegit`,
`src/components/quick-add/quick-add-pill.tsx`. Read the source before judging the fit — the porting
cost is in the assumptions it carries, not the visible behaviour.

Adaptations, all decided already:
- **Drop the fixed positioning.** It is `fixed bottom-6 left-1/2 z-40` and mounted app-wide there.
  Here it is horizontally centred at the bottom of the **right (resume) pane**.
- **Remove the blob combobox** — the target is implicit. The notes list replaces it above the input.
- **Collapsed state shows the note count** ("3 notes"), not a `+` icon.
- **Remove the global `Cmd/Ctrl+K` binding entirely.** A contextual panel should not own a window
  listener, and that chord is wanted for search later.
- **Strip posthog.** Keep the reducer state machine, the pinned-vs-hover distinction, and the
  optimistic collapse with content preserved on failure — that is the valuable part.
- On touch pointers, render an always-expanded panel rather than the FAB.

Notes are **append-only** — no policy grants UPDATE or DELETE, so the UI must not offer either.

**Never place this component on kanban cards.** Hover-expand and drag-and-drop fight badly.

Port `quick-add-pill.test.tsx` too; most of its state-machine coverage still applies.

Commit: "Add append-only notes panel ported from quick-add pill"

---

## Task 9: Prev/next navigation

**Files:** detail view components

Arrow buttons plus `J`/`K`, walking the **currently filtered** set from the board. Reviewing forty
applications should be forty keystrokes, not forty round trips.

**Keyboard guards required:** `J`/`K` must not fire while focus is in the note input, and Escape must
close the notes pill first, the takeover on a second press.

Commit: "Add prev/next application navigation"

---

## Definition of done

- [ ] `npm run verify` and `npm run test:integration` clean
- [ ] A lead cannot see or move another team's applicants — proven through the query and action layers
- [ ] Every status move writes an `application_events` row
- [ ] The board is fully keyboard operable, including moving a card between columns
- [ ] Editing a posting does not change what the detail view shows for existing applications
- [ ] The resume bucket is still private; no public URL is ever emitted
- [ ] Integration tests leave no fixture residue, and `seed.sql` data never reaches a migration
