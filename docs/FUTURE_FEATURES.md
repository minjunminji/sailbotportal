# Future Features

Deliberately deferred out of v1. Each entry records *why* it was cut, so the decision can be
re-evaluated on evidence rather than re-argued from scratch.

---

## Automated interview scheduling

**Status:** deferred (2026-08-15)

Candidates would receive a booking link and self-schedule; the chosen slot writes back onto the
application and appears on the kanban card.

**Why deferred:** scheduling is much larger than it looks — timezones, DST, multi-lead
availability, reschedules, cancellations, reminders, and races where two candidates claim the same
slot. The hard part is calendar sync: without reading a lead's own Google Calendar, leads get
double-booked and stop trusting the tool.

**When it comes back, use Cal.com rather than building it.** Sketch:

- Email carries the team's booking link with the application ID as metadata.
- Webhook route handles `BOOKING_CREATED` and `BOOKING_CANCELLED`, writing `interview_at`,
  `interview_url`, and `cal_booking_id` onto the application.
- Verify the webhook signature — the endpoint is otherwise unauthenticated.
- Treat webhook failure as non-fatal: a blank time on a card, never a lost interview.
- Keep the manual "set interview time" field permanently. Some leads will always schedule over
  Discord, and the board must reflect reality.

**Check before committing:** Cal's *collective* events (a slot where two leads are both free) may
be on a paid tier. If budget is zero, per-lead individual links work on the free tier — you lose
multi-lead availability matching and nothing else.

**v1 stand-in:** the Interview stage carries substages (`email sent` → `scheduled` → `completed`)
that leads advance by hand after emailing candidates themselves.

---

## Candidate accounts

**Status:** deferred (2026-08-15)

v1 is anonymous, email-only: applicants submit and receive a confirmation email, with no login.

**Why deferred:** accounts add an auth surface and a failure point at the exact moment someone is
trying to apply. Magic links at submit time are friction during a recruiting push.

**What it would unlock:** server-side drafts, a "my applications" status page, and profile reuse
(name / year / program / resume) across postings so applying to a second team is quick.

**Trigger to reconsider:** applicants asking "did my application go through?" often enough that
answering it manually costs real time.

---

## Server-side drafts

**Status:** deferred (2026-08-15)

v1 autosaves to `localStorage`, keyed by posting slug, cleared on successful submit.

**Why deferred:** depends on candidate accounts. `localStorage` covers the common case — a refresh
mid-essay — for near-zero cost.

**Limitation to watch:** drafts do not survive switching devices or clearing browser data.

---

## Interactive / puzzle question types

**Status:** deferred (2026-08-15)

The original spec floated Wordle-style puzzles and other interactive problem-solving assessments.

**Why deferred:** these are not really form fields. They need their own renderer contract, scoring
model, anti-cheat story, and accessibility answer. Bending the question-schema system to fit them
now would distort it for the seven types that ship in v1.

**When it comes back:** add a `puzzle` question type whose `config` names a registered renderer
component, rather than extending the generic field system. Scoring writes into `answers` alongside
a replay log so leads can see *how* the candidate solved it, not just whether they did.

---

## Recruiting cycles

**Status:** deferred (2026-08-15)

v1 postings are simply open or closed, with no notion of "Fall 2026".

**Why deferred:** YAGNI at current scale. The main pain — re-entering every question each term — is
solved far more cheaply by the "Duplicate posting" button, which is in v1.

**Trigger to reconsider:** wanting to answer "who did we take in Fall 2026" without filtering by
date range by hand, or boards getting cluttered with prior-term applicants.

---

## Rejection and status-change emails

**Status:** deferred (2026-08-15)

v1 sends exactly one email: the application confirmation receipt.

**Why deferred:** templating, per-team tone, and the need for leads to review before anything goes
out. Sending rejections automatically on a drag gesture is a good way to fire off an email someone
did not mean to send.

**When it comes back:** require an explicit send action with a preview step. Never trigger candidate
email as a pure side effect of a status change.

---

## Analytics and reporting

**Status:** deferred (2026-08-15)

Funnel conversion, time-in-stage, source tracking, reviewer-rating calibration.

**Why deferred:** the Excel export covers ad-hoc questions in v1, and `application_events` already
records the raw data these reports would need. Nothing is being lost by waiting — the history
accumulates from day one.

---

## Drop the `draft` posting status

**Status:** agreed, scheduled (2026-08-16). This is a removal, not a feature.

Collapse `postings.status` from `draft | open | closed` to `open | closed`.

**Why.** Nothing in the codebase distinguishes `draft` from `closed`. Every branch on posting status
asks one question — is it `open`?

- RLS: `using (status = 'open' or is_admin() or team_id = current_profile_team())`
- `apply/page.tsx`: `.eq('status', 'open')`
- `submit-application.ts` and `api/upload/route.ts`: both assert `status = 'open'`

Grepping for code branching on `'closed'` returns one hit: its label in `POSTING_STATUSES`. So the
control offers leads three options of which two are identical, and nothing signals that. A lead
choosing Draft over Closed because it sounds safer is getting a placebo.

`draft` is the state that protects an authoring phase, and there is no authoring in the app. Question
sets arrive by migration and leads edit `question_schema` in Studio until a builder exists — and
Studio does not care what status the row is in. The state was designed for a builder that was
deliberately cut.

**What is lost, and the cheaper fix.** `draft` is the only record of "never launched this term" as
against "recruiting is over"; the `status_change_audit` trigger covers `applications`, not
`postings`, so no history answers it. This shows up on a fresh database, where the seed lands all
three postings non-open and three rows reading "Closed" claim recruiting finished when it never
started. That is a wording problem on `/admin/postings`, not a state-machine one — an empty-state
sentence costs less than a third status.

**Why not done immediately:** it is a check-constraint migration plus `src/lib/postings/statuses.ts`
plus roughly six integration test files that seed `'draft'` as their "not open" fixture. That churn
runs through the submit path, and it was not worth burying the section-rail diff underneath it.

**When it is done:** migrate existing `draft` rows to `closed`, change the check constraint, and add
the empty-state line to `/admin/postings` in the same change — otherwise the regression above ships
on its own.


weighted scores for SOFT based on subteam. it'd calculate a score based on the 1-5 profieincy self-ratings for each skill in the skills section, and then calculate an overall team match score based on those skill scores. e.g. NET would have higher weight for low level, WEB would weigh web dev skills more, etc.