# Confirmation Email — Design

**Date:** 2026-08-16
**Status:** design agreed, not yet implemented

The one message the portal ever sends an applicant. It exists because the portal has no accounts,
which is a good decision with exactly one cost, and this is it.

Extends [the hiring portal design](./2026-08-15-hiring-portal-design.md) §4, which specified this and
left the provider open.

---

## 1. Why

An applicant fills in a long form, presses submit, sees a confirmation screen, and closes the tab.
From that moment they have **nothing**. No account to log into, no record of which teams they picked,
no proof they applied at all.

That produces two questions, and both currently arrive as a DM to a lead during the week the leads
are busiest:

- *"Did my application go through?"*
- *"When will I hear back?"*

One email answers both, permanently, for everyone. It is the cheapest support work available.

It is also the only outbound channel this system will ever have. Interview invitations are manual by
design — `interview_at` is v1 manual entry — so when a lead invites someone to interview, they reply
to this thread. Getting the from-address and reply-to right therefore matters more than the volume
suggests.

### What it is not

Not a status update, not a rejection notice, not a link to a candidate portal. Those are all
deliberately deferred (design §12), and nothing here should grow toward them. **One email per
submission, ever.**

---

## 2. The message

One email per submission, listing every team, addressed to the person — not one email per
`applications` row. The applicant is one human who filled in one form; three emails for one submit
would read as a bug, and would be the portal's internal row-per-team model leaking out to someone who
has no reason to know about it.

```
Subject: We got your UBC Sailbot application

Hi Jane,

We received your application on 16 August 2026 for:

  • Software
  • Mechanical

Each team reviews separately, so you may hear from them at different times.
We aim to reply to everyone within three weeks of applications closing.

No action needed from you — keep this email as your confirmation.

— UBC Sailbot
```

**"Each team reviews separately" is load-bearing.** It is the one place the applicant is told why
Software might interview them while Mechanical stays silent. Without it, silence from one team reads
as silence from Sailbot, and the candidate writes themselves off while a lead is still reading their
application.

**No copy of their answers.** Considered and rejected: it would mean rendering every question type as
email HTML, including the twenty-row skills matrix, in clients whose CSS support is from 2005. The
value is real but small — re-reading before an interview — and the cost is a second renderer to keep
in step with the first.

**Plain text and HTML, same content.** Text is not a fallback nobody sees; it is what several mail
clients and every screen reader default to.

---

## 3. Delivery

**Resend**, behind a one-function adapter. It is the default on Vercel, its free tier covers a
student team's volume many times over, and the design doc already named it as the likely choice.

The adapter boundary matters more than the provider does. Call sites see
`sendConfirmationEmail(...)` and know nothing about who delivers it, so swapping providers is one
file — the same rule `cache.ts` follows for FredDB.

**Unconfigured means log, not fail.** With no API key the adapter logs the message and reports
success, which is the normal path in development and in tests. This mirrors the cache's behaviour
exactly, and it means a developer running the app locally never has to think about mail.

**A verified sending domain is an operational prerequisite, not a code task.** Resend will only
deliver to the account owner's own address until a domain is verified via DNS. Someone with access to
the `ubcsailbot.org` DNS records has to do this, and it should be started before the code is, because
it is the step with a human dependency and a propagation delay.

**`reply-to` must be an address a human reads.** A receipt that arrives from `noreply@` and silently
discards replies is worse than no receipt: the applicant *will* reply to it with questions, because
it is the only address they have.

---

## 4. Failure

**The email is sent after the transaction commits, and can never fail the submission.**

The ordering is forced: you cannot email a receipt for rows that might still roll back. The
consequence is that a send failure lands after the application already exists.

**Reporting that failure as a failed submission would be actively harmful.** The applicant would
retry, and the unique index on `(posting_id, lower(applicant_email))` would answer *"You have already
applied with this email address."* They would reasonably conclude the portal is broken, while their
application sits in the database, complete and fine. `submitApplication` already reasons this way
about a different post-commit failure — see the note above the RPC result parse.

**So the submission stays successful, and the applicant is told on the confirmation screen instead:**

> We couldn't send your confirmation email. Your application went through — you may want to
> screenshot this page.

That is one extra field on the success result and one conditional in a component that already exists.
It converts an invisible failure into something the applicant can act on.

**Fire-and-forget was rejected.** Marginally simpler, and it fails silently — which during a
recruiting crunch means nobody finds out until someone complains, by which point the applicant has
already decided the team is disorganised.

**A retry queue was rejected.** A jobs table plus a cron worker is the robust answer to transient
mail failures, and it is far too much machinery for one email per applicant per term.

**Hard timeout via `AbortController`, ~5 seconds.** Same shape as the cache's 200ms timeout, longer
because there is no fallback to race against. A slow mailer must not hold someone on a spinner after
their work is already saved; past the timeout the send is abandoned and treated as a failure.

### Abuse

The mailer inherits the submission's existing controls rather than adding its own: the honeypot and
the per-IP rate limiter (5 per 10 minutes) already gate the action, and the unique index prevents a
second email to the same address for the same posting.

Worth stating plainly, because it is the honest limit of that: nothing stops someone submitting an
application under **another person's** email address and causing them to receive one unsolicited
message. The rate limiter caps how many, and no captcha is being added until abuse is actually
observed — the same position the design takes on spam generally.

---

## 5. Testing

- **Message building is a pure function** — name, teams, date in; subject, text, HTML out. Tested
  directly, including the one-team and several-team cases, since the list is the part that varies.
- **A failing transport still returns `ok: true`.** This is the important one. It is the invariant
  that keeps a mail outage from looking like a broken form, and it is the thing a future refactor is
  most likely to break by "improving" the error handling.
- **A timed-out send is a failed send**, not a hang.
- **No email is sent when the submission is rejected** — duplicate, closed posting, validation
  failure, honeypot. Nothing that did not commit gets a receipt.
- The transport is mocked throughout. Nothing in the suite talks to Resend.

---

## 6. Open questions

- The exact sending address and reply-to (`hiring@ubcsailbot.org`?), and who holds DNS access.
- Whether "within three weeks of applications closing" is a promise the team is willing to make. If
  not, it should be softened before it ships — a timeline that is missed is worse than none.
- Whether the subject line should name the teams. Shorter is better for mobile previews; naming them
  makes the email findable months later by searching "Sailbot Software".

---

## 7. Out of scope

Status-change emails, rejection notices, interview invitations, digests to leads about new
applications, and anything requiring the applicant to click through to a page. Each is recorded in
[FUTURE_FEATURES.md](../FUTURE_FEATURES.md).
