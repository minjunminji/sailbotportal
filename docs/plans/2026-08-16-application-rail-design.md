# Application Section Rail — Design

**Status:** designed 2026-08-16

The first product/UX work on this project. Everything before it was scaffolding: the form works and
is correct, but it is one undifferentiated scroll with no sense of scale or place. With all three
teams selected it runs to roughly forty questions, twenty-six of which are essays, and nothing on
screen tells an applicant how much of that they have left.

**Colours and typography are deliberately unchanged.** The palette stays the neutral greyscale it is
today. Every signal in this design is shape, weight, position, or text — the one exception being
`--destructive`, which already exists and carries no other meaning in the app.

---

## Goal

A persistent left rail listing the form's sections, showing where the applicant is, how much of each
section is done, and where the problems are. Clicking a section scrolls to it.

---

## 1. The section model

One derived function is the source of truth for both the rail and the page, so the two cannot drift:

```ts
type FormSection = {
  id: string;       // DOM id of the <section> — the scroll anchor
  label: string;    // rail row text
  answered: number; // required items filled
  total: number;    // required items in this section
  invalid: boolean; // carries an error from the last failed submit
};

function formSections(data: ApplyData, state: FormState, errors: FieldError[]): FormSection[]
```

| id | label | required items |
|---|---|---|
| `about-you` | About you | 4 — name, email, year, department |
| `shared-questions` | Why Sailbot | 1 — `why_sailbot` |
| `team-selection` | Choose teams | 1 — at least one gate answered Yes |
| `answers-{slug}` | Mechanical / Electrical / Software | that posting's required questions, +1 where `ranking.enabled` |
| `resume-upload` | Resume | 1 |

**A team's row exists only once its gate is Yes.** The rail grows as the applicant commits, rather
than listing three teams and annotating two of them as "not applying" — the rail should describe the
application being written, not the one that was possible. `team-selection` is the permanent anchor
that makes this reversible: it is always in the list, so changing your mind is always one click away.

**Counting reuses the existing notion of "answered" rather than inventing a second one.**
`visibleCoreQuestions` and `visibleTeamQuestions` already filter by `visibleIf`, so a question the
subteam ranking has hidden is absent from the denominator. The count cannot demand an answer to a
question that is not on screen.

`invalid` is read off the `FieldError[]` that `validateForm` already returns, so the rail lights up
on the same failed submit that fills the error summary. No parallel validation path exists to
disagree with the real one.

### Required questions only

The denominator counts required questions and nothing else.

Software has four optional questions (`technical_skills`, `github_url`, `quiz_zip`,
`anything_else`), and `github_url` and `quiz_zip` are alternatives — a candidate submits one or the
other, never both. Counting every question would leave a complete, submittable Software section
reading `5/9` with no completion mark, and would make `9/9` literally unreachable. A progress
indicator that cannot reach its own maximum trains people to ignore it.

So the count means exactly one thing: **what is left before you can submit.**

---

## 2. Layout and scroll-spy

`main` becomes `lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12`, capped at `max-w-5xl`. The
arithmetic is deliberate — 13 + 3 + 48 = 64rem — so the form column keeps its current `48rem`
measure and line length in the essay fields does not change.

The rail is `sticky top-8 self-start max-h-[calc(100vh-4rem)] overflow-y-auto`. `self-start` is
load-bearing: a grid item stretches to row height by default, and a full-height item cannot stick.

**Below `lg` the rail is not rendered.** The form is exactly what it is today. A sticky element
competing with an on-screen keyboard and a focused textarea costs more than it returns on a phone.

### Rows are real anchors

`<a href="#section-id">`, not buttons calling `scrollIntoView`. Anchors work before hydration, and —
the part that is easy to lose — the browser moves *focus* to the target, not merely the viewport. A
keyboard user clicking "Software" with a JS-only handler watches the page scroll while their focus
stays behind in the rail. Each `<section>` carries `scroll-mt-8` so its heading does not land flush
against the top edge.

### Active row

A `useActiveSection(ids)` hook: one `IntersectionObserver` with `rootMargin: '-20% 0px -70% 0px'`, a
band near the top of the viewport. The section intersecting the band is active; the last known one
persists when none does.

Two behaviours that will otherwise be read as bugs:

- Clicking a row smooth-scrolls *through* the sections between here and there, and the active row
  flickers down the list on the way. Set active on click and ignore observer callbacks until
  scrolling settles.
- Smooth scrolling is gated behind `prefers-reduced-motion`.

---

## 3. Rail rows

```
│▌ About you          ✓ │   active + complete
│  Why Sailbot        ✓ │   complete
│  Choose teams       ✓ │
│  ─────────────────── │
│  Mechanical      4/11 │   in progress
│  Software         0/5 │   untouched
│  ─────────────────── │
│  Resume         needed │   invalid, after a failed submit
│                        │
│  [ Review your        │
│    application → ]     │
│  Applying to           │
│  Mechanical, Software  │
```

**Counts show from zero and are never hidden.** `Mechanical 0/11` is the most useful single thing the
rail says to someone deciding whether to tick that box: it prices the commitment before they pay it.
Digits get `tabular-nums` so the column does not jitter as it climbs.

**Completion swaps the count for a check** rather than showing `11/11`, at which point the number
has no work left to do.

States: untouched is `text-muted-foreground`; touched is `text-foreground`; active adds the indicator
strip, `font-medium`, and a faint `bg-accent`; invalid turns the trailing status `text-destructive`
**and replaces it with a word**. Colour alone would fail contrast checks and vanish for a colourblind
applicant.

### Review lives in the rail footer

The rail's list stays purely anchors. The footer holds the persistent "Review your application"
button and the "Applying to …" line. Review still takes over the main column exactly as it does
today — the deliberate check-before-sending moment is worth keeping.

The gain is that on a forty-question page the submit affordance is always visible, instead of
requiring a scroll to the bottom to find out whether you are allowed to finish.

### Accessibility

The rail is `<nav aria-label="Application sections">`. Each anchor carries `aria-current="true"` when
active and an `sr-only` suffix, so a screen reader hears "Mechanical, 4 of 11 answered" rather than
"Mechanical 4 11".

The rail is **not** an `aria-live` region. Counts change on every keystroke; announcing that would be
unbearable.

---

## 4. Component split

Team gates move out of the per-team blocks and into one section, so that selecting a team is a single
decision made in a single place — and so the rail has an anchor to point at for a team that has not
been chosen yet.

`TeamSection` splits in two:

- **`TeamGates`** — one `<section id="team-selection">` holding all three yes/no fieldsets. That id
  already exists as `SHARED_FIELD_IDS.teams`, the anchor the server's "no teams selected" error
  routes to, so error routing survives the refactor untouched. Team descriptions stay here: this is
  where the decision is made, so this is where the context belongs.
- **`TeamQuestions`** — one `<section id="answers-{slug}">` per selected team, holding the subteam
  ranking and then the `QuestionList`.

**The id is `answers-{slug}`, not `team-{slug}`.** The gate fieldset already claims `team-{slug}`, and
duplicate ids would silently break both the error summary's anchor links and the rail's.

Mapping errors onto rail rows needs no change to `validate.ts`. The `fieldId` prefixes already encode
the section — `applicant-*`, `q-core-*`, `q-{slug}-*`, `ranking-{slug}`, `team-{slug}`,
`resume-upload` — so a small `sectionForFieldId` derives it.

---

## 5. Testing

The weight goes on `formSections` as a pure function. It needs no DOM, and every rule described above
lives in it:

- selecting a team adds its row; deselecting removes it
- a `visibleIf`-hidden question is absent from the denominator
- Software's four optional questions never enter the denominator, and `5/5` marks complete
- a `FieldError` on `q-soft-2026-quiz_language` marks the Software row invalid, not Mechanical's

Then a component test over the rail for the four row states.

`useActiveSection` stays deliberately thin and untested. jsdom has no `IntersectionObserver`, and
stubbing one to assert against the fake would be testing the stub. Scroll-spy is what a human notices
immediately and a test notices never.

`apply-form.test.tsx` needs updating for the gate/questions split.

---

## Not doing

- **Mobile rail.** Desktop enhancement only, per above.
- **Per-question rows in the rail.** Eleven Mechanical essays would make the rail longer than the
  viewport and turn navigation into its own scrolling problem.
- **Auto-advance or step gating.** The form stays one scroll. Nothing becomes unreachable because
  something earlier is incomplete.

---

## Open question

`software_project` is seeded `required: true`, but Q31 on the 2025 form carries no asterisk, and
`docs/2025-application-form.md` declares itself the source of truth for exactly this kind of
question. One of the two is wrong.

It matters here because it changes what the Software row counts to — `3/3` or `2/2`. Needs a lead to
confirm intent before it is changed either way.

---

## Note on posting status

All three postings seed as `status = 'draft'` and only `soft-2026` was open locally, which is why
`/apply` showed one team. The three quizzes have been correctly seeded since
`20260815224500_team_postings.sql` — 11 Mechanical, 8 Electrical, 7 Software. Nothing needs porting
from the 2025 form.

`mech-2026` and `elec-2026` were flipped to `open` in the local database to exercise this design. The
migration is unchanged and still seeds draft, which is right: postings go live through the admin
UI's `set-posting-status` action, after a lead has read them.
