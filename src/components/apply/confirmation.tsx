import type { SubmittedTeam } from '@/app/actions/submit-application';

/**
 * What replaces the form once the rows are written.
 *
 * Names every team, because one submission creates one application per team and
 * they are then judged independently — "your application was received" leaves
 * someone who ticked two boxes with no way to know both landed.
 */
export function Confirmation({ teams, email }: { teams: SubmittedTeam[]; email: string }) {
  return (
    <section aria-labelledby="confirmation-heading">
      <h1 id="confirmation-heading" tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        Your application is in
      </h1>

      <p className="mt-3 text-base text-muted-foreground">
        We have your application for {teams.length === 1 ? 'this team' : 'these teams'}:
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {teams.map((team) => (
          <li
            key={team.postingSlug}
            className="rounded-lg border border-border bg-card p-4 text-base font-medium text-card-foreground"
          >
            {team.teamName || team.postingSlug}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-base text-muted-foreground">
        Each team reviews its own applications, so you may hear from them separately. We will reply
        to {email}. There is nothing else to do for now — you do not need to submit this form again.
      </p>
    </section>
  );
}
