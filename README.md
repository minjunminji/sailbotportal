# Sailbot Hiring Portal

The hiring portal for [UBC Sailbot](https://www.ubcsailbot.org/).

Applicants use one public form to apply to any combination of the Mechanical, Electrical, and Software teams without creating an account. Team leads and administrators sign in to review each team's candidates on a kanban board, read applications and resumes, and move candidates through the hiring process.

This repository is also the shared workspace for the student developers, designers, and
product managers building the portal. Start with the section for your role, then use the
rest of this README as the common onboarding guide.

## Project status

The repository currently includes:

- the public recruiting home page and multi-team application flow;
- secure PDF resume uploads to private Supabase Storage;
- Supabase authentication and team-scoped row-level security for leads;
- per-team kanban boards with filtering and audited status changes; and
- linkable application detail views with answers and resume previews.

Some v1 work is still incomplete, including the posting builder, confirmation email,
spreadsheet export, realtime board synchronization, and parts of the application-review
workflow. Candidate accounts, automated scheduling, status-change emails, recruiting
cycles, and analytics are deliberately deferred.

The code, migrations, and tests describe current behaviour. The documents under `docs/` explain the intended product and the reasoning behind it, but some implementation-plan status labels are older than the code.

## Start here for your role



### Developers

1. Complete [Local development](#local-development).
2. Read [Architecture in one minute](#architecture-in-one-minute).
3. Read `AGENTS.md` before making Next.js changes. This project uses Next.js 16, whose
  APIs and conventions differ from earlier versions.
4. Run `npm run verify` before opening a pull request.
5. If you change the database, RLS, storage, server actions, or API routes, also run
  `npm run test:integration`.



### Designers

1. Read the UI direction in
  `[docs/plans/2026-08-15-hiring-portal-design.md](docs/plans/2026-08-15-hiring-portal-design.md)`,
   especially section 8.
2. Review the semantic design tokens in `src/app/globals.css`.Preserve semantic HTML, visible focus states, keyboard interaction, readable empty anderror states, and non-colour status cues.
3. Prefer changing shared tokens over adding one-off colours to components. Components should not accept colour props.
4. Include responsive and interaction states when handing work to developers.

Brand assets, typography, and a final visual direction have not yet been established in  
this repository.

## Product model

- A **team** is Mechanical, Electrical, or Software.
- A **subteam** is a specialty within one team, such as Pathfinding, Communications, or Sail.
- A **posting** contains one team's recruiting copy, questions, and open/draft/closed
status.
- A **submission** is one applicant's completed form.
- An **application** is that submission's record for one selected team.

One submission creates one application row per selected team. The rows share a submission
ID and resume, but each has an independent hiring status. This lets, for example,
Mechanical reject an applicant while Software is still interviewing them.

Applicants are anonymous and have no read access to application data. Leads can access
their own team's applications. Admins can access all teams and manage shared core
questions. These permissions are enforced by Postgres row-level security, not just by
hidden UI.

## Tech stack

- Next.js 16 App Router, React 19, and TypeScript
- Tailwind CSS 4
- Supabase Postgres, Auth, and private Storage
- Zod for application validation
- dnd-kit for the kanban board
- pdf.js for resume previews
- Jest and Testing Library
- FredDB as an optional cache for public posting reads

The project uses **npm** and `package-lock.json`. Do not add a lockfile from another
package manager.

## Local development



### Prerequisites

- Node.js 22 (the version used in CI)
- npm
- Docker Desktop, running before Supabase starts
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)



### First-time setup

From the repository root:

```bash
npm install
supabase start
```

Copy `.env.example` to `.env.local`, then fill in the local values printed by:

```bash
supabase status -o env
```

The required variables are:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`FREDB_API_KEY` and `FREDB_BASE_URL` are optional. If they are absent or FredDB is
unavailable, public posting reads fall back to Supabase.

Apply all migrations and load local fixtures:

```bash
supabase db reset
npm run db:seed-storage
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Supabase Studio is available at
[http://localhost:54423](http://localhost:54423).

The local stack deliberately uses ports in the `544xx` range:

- API: `54421`
- Postgres: `54422`
- Studio: `54423`
- local email inbox: `54424`

Do not copy the Supabase CLI's common `54321` examples into `.env.local`; this project uses
`http://127.0.0.1:54421`.

### Local accounts

These credentials exist only in the local seed data:

- Software lead: `soft_lead@sailbot.local` / `sailbot-local-dev`
- Mechanical lead: `mech_lead@sailbot.local` / `sailbot-local-dev`
- Admin for all teams: `hiring_admin@sailbot.local` / `sailbot-local-dev`

There is no separate seeded Electrical lead; use the admin account to view that board.
The seed also creates sample applications, notes, and status events.

### Windows Supabase caveat

`supabase db reset` can occasionally report a `502` during a container restart on Windows
even after the migrations and seed completed successfully. Check `supabase status` and the
data in Studio before assuming the reset failed. Analytics is disabled in
`supabase/config.toml` because its local vector container is unreliable on Windows.

## Common commands

```bash
npm run dev               # Start the development server
npm run build             # Create a production build
npm run start             # Serve a completed production build
npm run lint              # Run ESLint
npm run typecheck         # Generate Next route types and run TypeScript
npm test                  # Run unit and component tests
npm run test:watch        # Run Jest in watch mode
npm run test:integration  # Run tests against the local Supabase stack
npm run verify            # Run typecheck, lint, and unit tests
npm run db:types          # Regenerate tracked Supabase TypeScript types
npm run db:seed-storage   # Upload local fixture resumes
```

CI runs `npm run verify` and the integration suite in separate jobs. Integration tests
require the local Supabase stack and a valid `.env.local`.

## Architecture in one minute

