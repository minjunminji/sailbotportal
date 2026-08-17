import Link from 'next/link';
import type { ApplicationDetail as Detail } from '@/lib/applications/detail';
import type { ApplicationNavigation } from '@/lib/applications/navigation';
import { resolveLabel } from '@/lib/questions/labels';
import { BOARD_COLUMNS } from '@/components/board/columns';
import { shortYearLabel } from '@/components/board/columns';
import { NotesPanel } from '@/components/notes/notes-panel';
import { AnswerView } from './answer-view';
import { DetailPanes } from './detail-panes';
import { ResumeViewer } from './resume-viewer';

/**
 * The contents of one application's board-framed modal.
 *
 * EVERY QUESTION COMES FROM `detail.questions`, which is the frozen snapshot —
 * never the posting's current `question_schema`. See `getApplicationDetail`.
 * The temptation to "simplify" by joining the posting is exactly what this
 * column exists to prevent, and doing so would silently rewrite the history of
 * every application already submitted.
 */

/** Explicit format and timezone, so the server and the client agree. */
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function statusLabel(status: string): string {
  return BOARD_COLUMNS.find((column) => column.status === status)?.label ?? status;
}

export function ApplicationDetailView({
  detail,
  navigation = { previousHref: null, nextHref: null },
}: {
  detail: Detail;
  navigation?: ApplicationNavigation;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3">
        {/* `pr-10` reserves the corner for the takeover's absolutely positioned
            close button. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-10">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.applicantName}</h1>
          <span className="rounded-md border border-border px-2 py-0.5 text-sm">
            {statusLabel(detail.status)}
          </span>
          <NotesPanel applicationId={detail.id} initialNotes={detail.notes} />
          <nav aria-label="Applicant navigation" className="flex items-center gap-1">
            <ApplicantArrow direction="previous" href={navigation.previousHref} />
            <ApplicantArrow direction="next" href={navigation.nextHref} />
          </nav>
        </div>

        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Email</dt>
            {/* A `mailto:` because the next thing a lead does with an address is
                write to it. */}
            <dd>
              <a
                href={`mailto:${detail.applicantEmail}`}
                className="rounded-sm underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {detail.applicantEmail}
              </a>
            </dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-muted-foreground">Year</dt>
            <dd>{shortYearLabel(detail.yearOfStudy)}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-muted-foreground">Faculty</dt>
            {/* Empty only on a row written before the column existed. */}
            <dd>{detail.faculty || '—'}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-muted-foreground">Program</dt>
            <dd>{detail.homeDepartment}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="text-muted-foreground">Submitted</dt>
            <dd>{DATE.format(new Date(detail.submittedAt))}</dd>
          </div>
        </dl>

        {detail.assignedSubteam ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Placed in </span>
            {detail.assignedSubteam.name}
          </p>
        ) : detail.rankedSubteams.length > 0 ? (
          <div className="text-sm">
            <p className="text-muted-foreground">Subteam preference</p>
            {/* Ordered, because the order IS the answer. */}
            <ol className="mt-1 ml-5 list-decimal">
              {detail.rankedSubteams.map((subteam) => (
                <li key={subteam.id}>
                  {subteam.name}
                  {subteam.code ? (
                    <span className="text-muted-foreground"> · {subteam.code}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {detail.siblings.length > 0 ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Also applied to</span>
            {detail.siblings.map((sibling) => (
              <Link
                key={sibling.id}
                href={`/admin/${sibling.teamSlug}/applications/${sibling.id}`}
                className="rounded-sm underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {sibling.teamName}
                <span className="text-muted-foreground"> · {statusLabel(sibling.status)}</span>
              </Link>
            ))}
          </p>
        ) : null}
      </header>

      <DetailPanes
        answers={<Answers detail={detail} />}
        resume={
          <ResumeViewer
            applicationId={detail.id}
            applicantName={detail.applicantName}
            hasResume={detail.resumePath !== null}
          />
        }
      />
    </div>
  );
}

function ApplicantArrow({
  direction,
  href,
}: {
  direction: 'previous' | 'next';
  href: string | null;
}) {
  const label = direction === 'previous' ? 'Previous applicant' : 'Next applicant';
  const icon = (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === 'previous' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
  const classes =
    'rounded-md border border-border p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

  return href === null ? (
    <button
      type="button"
      aria-label={label}
      disabled
      className={`${classes} cursor-not-allowed text-muted-foreground opacity-40`}
    >
      {icon}
    </button>
  ) : (
    <Link
      href={href}
      replace
      aria-label={label}
      className={`${classes} text-muted-foreground hover:text-foreground`}
    >
      {icon}
    </Link>
  );
}

function Answers({ detail }: { detail: Detail }) {
  const first = detail.rankedSubteams[0];
  const firstChoice = first ? first.code || first.name : null;

  if (detail.questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This application has no recorded questions. Its snapshot is empty.
      </p>
    );
  }

  return (
    // Capped at a readable measure. The pane grew with the modal, and prose
    // set to the full width of it is measurably harder to read than prose at
    // roughly seventy characters — the eye loses its place returning to the
    // start of the next line.
    <dl className="flex max-w-[72ch] flex-col gap-6 pr-2">
      {detail.questions.map((entry, index) =>
        entry.ok ? (
          <div key={entry.question.id}>
            {/*
              Resolved against this applicant's own ranking. The snapshot stores
              the placeholder, so without this a lead would read the template —
              "why is {firstSubteam} your first choice?" — instead of the
              question the applicant answered.
            */}
            <dt className="text-sm font-medium text-muted-foreground">
              {resolveLabel(entry.question.label, firstChoice)}
            </dt>
            <dd className="mt-1">
              <AnswerView question={entry.question} answer={detail.answers[entry.question.id]} />
            </dd>
          </div>
        ) : (
          // A question the current code can no longer read. Named rather than
          // dropped, so the page does not quietly show fewer questions than
          // were asked.
          <div key={entry.id ?? `unreadable-${index}`}>
            <dt className="text-sm font-medium text-muted-foreground">
              {entry.label ?? 'Unnamed question'}
            </dt>
            <dd className="mt-1 text-sm text-destructive">
              This question was recorded in a format this version cannot display.
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
