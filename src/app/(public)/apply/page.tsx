import type { Metadata } from 'next';
import Link from 'next/link';
import { submitApplication } from '@/app/actions/submit-application';
import { ApplyForm } from '@/components/apply/apply-form';
import { ApplyHeader } from '@/components/apply/apply-header';
import type { ApplyData, ApplyPosting, ApplySubteam } from '@/components/apply/types';
import { EmptyState } from '@/components/empty-state';
import { resolveQuestions, type CoreQuestionRow } from '@/lib/questions/snapshot';
import type { Question } from '@/lib/questions/types';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Apply | UBC Sailbot hiring',
};

/**
 * Applicants answer here.
 *
 * The page is a server component so the questions arrive with the HTML: they
 * live in the database, they are large, and a form that appears a second after
 * the page does is a form people start typing into before it is ready.
 *
 * Read live rather than through the cache. The submission action re-reads the
 * same rows and validates against them, so a cached question set could hand an
 * applicant a form the server would then reject — the sixty seconds saved are
 * not worth a rejection nobody can explain.
 */

type PostingRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  team_id: string;
  question_schema: unknown;
  subteam_ranking: unknown;
};

/** Defaults match the column default, so a malformed value fails closed. */
function readRanking(value: unknown): { enabled: boolean; minChoices: number; maxChoices: number } {
  const config = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const enabled = config.enabled === true;
  const maxChoices =
    typeof config.maxChoices === 'number' &&
    Number.isInteger(config.maxChoices) &&
    config.maxChoices > 0
      ? config.maxChoices
      : 3;
  // Absent means no floor, which is how every posting behaved before there was
  // one. Clamped to the ceiling so a bad pair cannot demand the unreachable.
  const minChoices =
    typeof config.minChoices === 'number' &&
    Number.isInteger(config.minChoices) &&
    config.minChoices > 0
      ? Math.min(config.minChoices, maxChoices)
      : 0;
  return { enabled, minChoices, maxChoices };
}

async function loadApplyData(): Promise<ApplyData> {
  const supabase = await createClient();

  // RLS shows an anonymous visitor only `status = 'open'`, so this is also the
  // check that a draft posting never reaches the form.
  const { data: postingRows } = await supabase
    .from('postings')
    .select('id, slug, title, description, team_id, question_schema, subteam_ranking')
    .eq('status', 'open')
    .order('position');

  const postings = (postingRows ?? []) as PostingRow[];
  if (postings.length === 0) return { coreQuestions: [], postings: [] };

  const teamIds = [...new Set(postings.map((posting) => posting.team_id))];

  const [{ data: coreRows }, { data: teamRows }, { data: subteamRows }] = await Promise.all([
    supabase.from('core_questions').select('stable_key, position, definition').order('position'),
    supabase.from('teams').select('id, name').in('id', teamIds),
    supabase
      .from('subteams')
      .select('id, team_id, slug, name, code, description, active')
      .in('team_id', teamIds)
      .eq('active', true)
      .order('position'),
  ]);

  const core = (coreRows ?? []) as CoreQuestionRow[];
  const teamNames = new Map((teamRows ?? []).map((team) => [team.id, team.name]));

  const subteamsByTeam = new Map<string, ApplySubteam[]>();
  for (const row of subteamRows ?? []) {
    const list = subteamsByTeam.get(row.team_id) ?? [];
    list.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      code: row.code,
      description: row.description,
    });
    subteamsByTeam.set(row.team_id, list);
  }

  // Resolved through the same function the submission uses, so the form is
  // built from exactly the array that will be frozen onto the row.
  let coreQuestions: Question[] = [];
  try {
    coreQuestions = resolveQuestions(core, {});
  } catch (error) {
    console.error('[apply] core questions could not be resolved', {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const coreIds = new Set(coreQuestions.map((question) => question.id));

  const resolved: ApplyPosting[] = [];
  for (const posting of postings) {
    let questions: Question[];
    try {
      questions = resolveQuestions(core, posting);
    } catch (error) {
      // One posting with a bad `question_schema` must not take down the form
      // for the other two. It is left out rather than half-rendered, because a
      // posting this app cannot resolve is one the submission would reject.
      console.error('[apply] posting questions could not be resolved', {
        slug: posting.slug,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const ranking = readRanking(posting.subteam_ranking);

    resolved.push({
      slug: posting.slug,
      title: posting.title,
      teamName: teamNames.get(posting.team_id) ?? posting.title,
      description: posting.description,
      // Core questions are asked once for the whole form; each posting keeps
      // only its own half here and they are merged back at submission.
      questions: questions.filter((question) => !coreIds.has(question.id)),
      ranking,
      subteams: ranking.enabled ? (subteamsByTeam.get(posting.team_id) ?? []) : [],
    });
  }

  return { coreQuestions, postings: resolved };
}

export default async function ApplyPage() {
  const data = await loadApplyData();

  return (
    // Wide enough for the rail beside the form without narrowing the form: the
    // rail is 13rem and the gap 3rem, so the column keeps the 48rem measure it
    // had when it was alone on the page. Essay fields are read at the same line
    // length as before.
    <main className="mx-auto w-full max-w-5xl flex-1 p-6">
      {data.postings.length === 0 ? (
        // The header renders here only on this branch. On the other one it
        // belongs to the form, which mounts it as the crown of its sticky rail
        // — so exactly one `<h1>` exists on either path.
        <div className="max-w-3xl">
          <ApplyHeader />

          <p className="text-base text-muted-foreground">
            One application covers every team that is recruiting.
          </p>
          <div className="mt-8">
            {/*
              The state this page is in for most of the year. It must say so,
              rather than render an empty form: a form with no teams on it looks
              broken, and someone will fill it in and wonder why nothing
              happened.
            */}
            <EmptyState
              title="Recruiting is currently closed"
              description="No team is accepting applications right now. Recruiting runs at the start of each term — check the home page, where every open posting appears as soon as a team opens it."
            />
          </div>
          <Link
            href="/"
            className="mt-6 inline-block rounded-md px-2 py-1 text-base underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Back to open postings
          </Link>
        </div>
      ) : (
        <ApplyForm data={data} submit={submitApplication} />
      )}
    </main>
  );
}
