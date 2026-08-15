# Application Submission Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** An applicant can complete one form covering every open team and have it stored correctly —
one row per selected team, each carrying a frozen copy of the questions it was answered against.

**Architecture:** Questions are data, not code. A posting's `question_schema` plus the org-wide
`core_questions` are resolved into one flat array at render time, validated by a Zod schema
*derived* from that array, and frozen onto each application row at submit. Applicant writes never
touch the database directly — they go through a server action holding the service role, which is
therefore responsible for the checks RLS would otherwise do.

**Tech Stack:** TypeScript, Next.js 16 App Router, Zod, Supabase (Postgres + Storage), Jest.

**Reference:** [Design doc](./2026-08-15-hiring-portal-design.md) sections 2 (question model) and 4
(applicant experience). [Foundations plan](./2026-08-15-foundations-implementation-plan.md) for
environment gotchas — 544xx ports, flaky `db reset` exit code, `npm run typecheck` not bare `tsc`.

**Source material:** `docs/*Team Posting.txt` and the 2025 form transcript in the design doc.

---

## Scope

**In:** question type system, Zod derivation, snapshot resolution, real seeded quizzes, resume and
per-question file upload, the submission server action, and the multi-step form.

**Out:** the admin posting builder (leads edit `question_schema` via Studio until it exists), the
kanban board, the detail view, Excel export, and the confirmation email. The email is v1 scope per
the design doc but needs a provider decision — it is the first task of the next phase.

---

## Task 1: Question types

**Files:** Create `src/lib/questions/types.ts`, `src/lib/questions/__tests__/types.test.ts`

Eight types, closed set. Config and answer shapes:

| type | config | answer |
|---|---|---|
| `short_text` | `{ maxLength?, format?: 'url' \| 'email' }` | `string` |
| `long_text` | `{ maxLength?, minWords? }` | `string` |
| `select` | `{ options: string[] }` | `string` |
| `multi_select` | `{ options: string[], max? }` | `string[]` |
| `scale` | `{ min, max, minLabel?, maxLabel? }` | `number` |
| `matrix` | `{ rows: string[], columns: string[], mode: 'single' \| 'multi' }` | `Record<row, string[]>` |
| `ranking` | `{ options: string[], maxChoices }` | `string[]` (ordered) |
| `file` | `{ accept: string[], maxBytes }` | `{ path, filename, size }` |

`matrix` with `mode: 'multi'` is what the software skills question needs — 20 rows, two columns
("I have this skill" / "I want to learn or improve this skill"), any combination per row.

**`file` is a per-question type, distinct from the resume.** Software's technical quiz accepts a ZIP
upload as an alternative to a GitHub URL. The design doc listed this as an open question; it is
resolved here as yes, needed in v1.

**Note `ranking` is NOT how subteam preference is captured.** That lives in `postings.subteam_ranking`
and writes to the `ranked_subteams` column, because the board filters and the waitlist workflow query
it. A `ranking` question is for ordering arbitrary strings.

Define `Question`, `QuestionType`, per-type config types, and a discriminated union. Export a type
guard per question type. Tests assert the union narrows correctly.

Commit: "Add question type definitions"

---

## Task 2: Zod schema derivation

**Files:** Create `src/lib/questions/schema.ts`, `src/lib/questions/__tests__/schema.test.ts`

`buildAnswerSchema(questions: Question[]): ZodType` returns a schema keyed by question id.

**Write the tests first.** Cases that must be covered:

- Required vs optional per question — an optional `long_text` accepts `undefined`, a required one rejects `''`
- `maxLength` enforced; `minWords` counts words, not characters
- `select` rejects a value not in `options` — **the case that matters, since the client controls this**
- `multi_select` rejects unknown options and respects `max`
- `scale` rejects out-of-range and non-integers
- `matrix` rejects unknown row keys and unknown column values
- `ranking` rejects duplicates, unknown options, and more than `maxChoices`
- `short_text` with `format: 'url'` rejects `javascript:` and non-http schemes
- **Unknown keys in the answers object are stripped, not passed through** — otherwise a crafted
  submission writes arbitrary JSON into `answers`
- A question with `visibleIf` is optional when its condition is not met and required when it is

That last one is the subtle case. `visibleIf` is `{ subteam, topN }`, so the schema builder needs the
applicant's ranked subteams as context: `buildAnswerSchema(questions, { rankedSubteams })`.

Commit: "Add Zod schema derivation from question definitions"

---

## Task 3: Snapshot resolution and the invariant

**Files:** Create `src/lib/questions/snapshot.ts`, `src/lib/questions/__tests__/snapshot.test.ts`,
`src/lib/questions/__tests__/snapshot.integration.test.ts`

`resolveQuestions(coreQuestions, posting)` returns one flat ordered array: core questions by
`position`, then the posting's own by array order. Each carries its `stable_key` where it has one.

**This is the most important test in the project.** Write it first:

```
1. Create a posting with questions A and B.
2. Submit an application against it, storing question_schema_snapshot.
3. Edit the posting: reword A, delete B, add C.
4. Re-read the application.
5. Assert its snapshot still contains the ORIGINAL A and B, and does NOT contain C.
```

Run it as an integration test against the real database, not a unit test with mocks — the failure
mode being guarded against is a future developer reading the live posting instead of the snapshot,
and only a real round-trip catches that.

Also assert the snapshot is a **deep copy**. A shared reference would let a later mutation reach
back into stored rows.

Commit: "Add question snapshot resolution with invariant test"

---

## Task 4: Seed the real 2025 quizzes

**Files:** Create `supabase/migrations/<timestamp>_team_postings.sql`

Three postings, `status = 'draft'`, with `question_schema` transcribed from the real form. Reference
data, not fixtures — same reasoning as the teams migration, so it is a migration and idempotent.

- **Mechanical** — 11 `long_text` questions (ballast, dissimilar metals, points of sail, tack vs
  gybe, wingsail, and so on). `subteam_ranking.enabled = false`.
- **Electrical** — the Saturday availability `select`, the "project you're proud of" `long_text`,
  and 6 technical `long_text` questions. `subteam_ranking.enabled = false`.
- **Software** — Saturday availability, the 20-row skills `matrix`, a project `long_text`, the
  GitHub URL `short_text` with `format: 'url'`, the ZIP `file` question, the language `select`, and
  the free-form "anything else". **`subteam_ranking.enabled = true, maxChoices = 3`.**

Verify each posting's `question_schema` parses against the Task 1 types — write that as a test, not
an eyeball check. A typo in 300 lines of hand-transcribed JSON is likely and silent.

Commit: "Add real team postings with 2025 question sets"

---

## Task 5: File upload

**Files:** Create `src/app/api/upload/route.ts`, `src/lib/uploads.ts`, plus tests

Handles both the resume and per-question `file` answers. **This is the main untrusted-input surface
in the app**, since uploads are anonymous by design.

- Validate **magic bytes**, not just the `Content-Type` header or the extension — a client controls
  both. PDF is `%PDF`, ZIP is `PK\x03\x04`.
- Enforce `maxBytes` **before** buffering the whole body into memory.
- Write to the private `resumes` bucket under a random UUID, never the client's filename. Keep the
  original name as metadata for the admin UI to display.
- Return only the storage path. The client never gets a URL.
- Rate limit per IP.

Tests: a `.pdf` extension on a PNG body is rejected; oversize is rejected; a valid PDF returns a
path; the stored path does not contain the client filename.

Commit: "Add validated file upload for resumes and file questions"

---

## Task 6: Submission server action

**Files:** Create `src/app/actions/submit-application.ts`, plus an integration test

The one place applicant data enters the database. It holds the **service role, so RLS protects
nothing here** — every check is this function's responsibility.

In order:

1. Validate shared fields (name, email, year, home department) with Zod.
2. Reject a submission selecting **zero teams**.
3. For each selected team, load the posting and **assert `status = 'open'`**. A closed or draft
   posting must be rejected even though it appeared in the payload.
4. Rebuild the answer schema **from the database**, never from the client's copy, and validate.
5. Generate one `submission_id`.
6. Insert one row per team, each with its own resolved snapshot, sharing `submission_id` and
   `resume_path`.
7. Return a result the form can render.

**Insert all rows in a single transaction via an RPC.** Separate inserts can partially fail, leaving
someone applied to mechanical but not software with no way to tell. Add a Postgres function for this.

Integration tests:
- Two teams selected → exactly 2 rows, same `submission_id`, same `resume_path`, different snapshots
- Zero teams → rejected, nothing written
- A `draft` posting in the payload → rejected, nothing written
- Duplicate email for the same posting → the unique index surfaces a friendly error, not a 500
- Answers not matching the posting's schema → rejected
- **A partial failure writes nothing** — force the second insert to fail and assert zero rows

Commit: "Add application submission with per-team rows in one transaction"

---

## Task 7: Form — shared steps

**Files:** `src/app/(public)/apply/page.tsx` and components under `src/components/apply/`

Steps 1 and 2: about you, then core questions. Server component loads open postings, core questions,
teams, and subteams; a client component owns form state.

- `localStorage` autosave keyed by a form version, cleared on success
- Real `<label>` elements, `autoComplete` on the identity fields
- `year_of_study` select storing ordinals; `home_department` combobox over a seed list that still
  accepts free text
- Errors summarised at the top on submit, each linking to its field, and announced via `aria-live`

Commit: "Add application form shared steps"

---

## Task 8: Form — team branches and submit

**Files:** More components under `src/components/apply/`

- One gate per open posting, in `position` order: "Do you want to apply to X?"
- On yes, render that team's questions. If `subteam_ranking.enabled`, the ranking UI comes **first**,
  because it drives `visibleIf`
- Question renderer dispatching on type — one component per type, no giant switch in the page
- Resume upload, then a review step showing every answer
- Submit calls the Task 6 action; success replaces the form with a confirmation naming each team
  applied to

**Empty state that matters:** if no postings are open, `/apply` says recruiting is closed and when it
opens — it must not render an empty form.

Commit: "Add team branches, question renderer, and submit flow"

---

## Definition of done

- [ ] `npm run build`, `npm run typecheck`, `npm run lint` all clean
- [ ] `npm test` and `npm run test:integration` pass
- [ ] The snapshot invariant test passes: editing a posting does not alter stored applications
- [ ] Applying to two teams creates two rows with independent statuses
- [ ] A submission naming a draft posting is rejected
- [ ] A PNG renamed `.pdf` is rejected
- [ ] Integration tests leave no fixture residue

## Deliberately deferred

The admin posting builder — leads edit `question_schema` in Studio until it exists. This is
acceptable only because the seeded quizzes are the real ones; it stops being acceptable the moment a
lead wants to change a question themselves.
