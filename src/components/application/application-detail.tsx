import Link from 'next/link';
import type { ApplicationDetail as Detail } from '@/lib/applications/detail';
import { BOARD_COLUMNS } from '@/components/board/columns';
import { shortYearLabel } from '@/components/board/columns';
import { AnswerView } from './answer-view';
import { DetailPanes } from './detail-panes';

/**
 * The full-screen view of one application.
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

export function ApplicationDetailView({ detail }: { detail: Detail }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.applicantName}</h1>
          <span className="rounded-md border border-border px-2 py-0.5 text-sm">
            {statusLabel(detail.status)}
          </span>
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
            <dt className="text-muted-foreground">Department</dt>
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
        resume={<ResumePlaceholder present={detail.resumePath !== null} />}
      />
    </div>
  );
}

function Answers({ detail }: { detail: Detail }) {
  if (detail.questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This application has no recorded questions. Its snapshot is empty.
      </p>
    );
  }

  return (
    <dl className="flex flex-col gap-6 pr-2">
      {detail.questions.map((entry, index) =>
        entry.ok ? (
          <div key={entry.question.id}>
            <dt className="text-sm font-medium text-muted-foreground">{entry.question.label}</dt>
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

/** Task 7 replaces this with the signed-URL viewer. */
function ResumePlaceholder({ present }: { present: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <p className="text-sm text-muted-foreground">
        {present
          ? 'A resume was uploaded with this application. The viewer is not built yet.'
          : 'No resume was uploaded with this application.'}
      </p>
    </div>
  );
}
