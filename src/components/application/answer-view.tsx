import {
  assertNeverQuestion,
  type Answer,
  type FileAnswer,
  type MatrixAnswer,
  type Question,
} from '@/lib/questions/types';

/**
 * One frozen question and what the applicant answered.
 *
 * Reading is the whole job here. The apply form's field components are built to
 * COLLECT an answer — labels bound to inputs, validation, error wiring — and
 * none of that applies to a lead scanning forty applications. So this is a
 * separate, much smaller set of renderers rather than the form components in
 * read-only mode, which would carry every one of those assumptions along.
 *
 * The `switch` is exhaustive: `assertNeverQuestion` stops this compiling if a
 * ninth question type joins the union, so a new type cannot ship rendering as
 * nothing.
 */

function Unanswered() {
  // Said out loud rather than left blank. An empty space beneath a question
  // reads as a rendering bug; "No answer" is a fact about the application, and
  // for an optional question it is a perfectly normal one.
  return <p className="text-sm text-muted-foreground italic">No answer</p>;
}

function isBlank(answer: Answer | undefined): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === 'string') return answer.trim() === '';
  if (Array.isArray(answer)) return answer.length === 0;
  return false;
}

/** 1.4 MB rather than 1468006. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AnswerView({
  question,
  answer,
}: {
  question: Question;
  answer: Answer | undefined;
}) {
  if (isBlank(answer)) return <Unanswered />;

  switch (question.type) {
    case 'short_text': {
      const value = String(answer);
      if (question.config.format === 'url') {
        return (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm text-base break-all underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {value}
          </a>
        );
      }
      if (question.config.format === 'email') {
        return (
          <a
            href={`mailto:${value}`}
            className="rounded-sm text-base break-all underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {value}
          </a>
        );
      }
      return <p className="text-base">{value}</p>;
    }

    case 'long_text':
      // `whitespace-pre-wrap`, because applicants write in paragraphs and
      // collapsing their line breaks turns a structured answer into a wall.
      return <p className="text-base whitespace-pre-wrap">{String(answer)}</p>;

    case 'select':
      return <p className="text-base">{String(answer)}</p>;

    case 'multi_select':
      return (
        <ul className="flex flex-wrap gap-2">
          {(answer as string[]).map((option) => (
            <li key={option} className="rounded-md border border-border px-2 py-0.5 text-sm">
              {option}
            </li>
          ))}
        </ul>
      );

    case 'scale':
      return (
        <p className="text-base">
          {String(answer)}{' '}
          <span className="text-sm text-muted-foreground">
            of {question.config.max}
            {question.config.maxLabel ? ` · ${question.config.maxLabel}` : ''}
          </span>
        </p>
      );

    case 'matrix':
      return <MatrixView answer={answer as MatrixAnswer} rows={question.config.rows} />;

    case 'ranking':
      // An ordered list numbers itself, so the applicant's order is carried by
      // the markup rather than by text a screen reader has to infer.
      return (
        <ol className="ml-5 list-decimal text-base">
          {(answer as string[]).map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ol>
      );

    case 'file': {
      const file = answer as FileAnswer;
      // Named, not linked. Serving a private file needs a signed URL minted on
      // the server; until that exists a dead link would be worse than a name.
      return (
        <p className="text-base">
          {file.filename}{' '}
          <span className="text-sm text-muted-foreground">({fileSize(file.size)})</span>
        </p>
      );
    }

    default:
      return assertNeverQuestion(question);
  }
}

/**
 * The skills grid, as rows that were actually ticked.
 *
 * The form renders this as a 20×2 grid of checkboxes. Reproducing that here
 * would give a lead twenty rows to scan of which perhaps six carry anything;
 * listing only the rows with a selection says the same thing in a sixth of the
 * space, which is what makes it readable on a page holding twenty other
 * questions.
 */
function MatrixView({ answer, rows }: { answer: MatrixAnswer; rows: string[] }) {
  const chosen = rows
    .map((row) => ({ row, columns: answer[row] ?? [] }))
    .filter((entry) => entry.columns.length > 0);

  if (chosen.length === 0) return <Unanswered />;

  return (
    <dl className="flex flex-col gap-1">
      {chosen.map(({ row, columns }) => (
        <div key={row} className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-base">{row}</dt>
          <dd className="text-sm text-muted-foreground">{columns.join(' · ')}</dd>
        </div>
      ))}
    </dl>
  );
}
