import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { validateQuestion } from '@/lib/questions/validate';
import type { AnswerMap, Question } from '@/lib/questions/types';
import { getApplicationNotes, type ApplicationNote } from './notes';
import type { ApplicationStatus, BoardSubteam } from './queries';

/**
 * One application, in full.
 *
 * THE QUESTIONS COME FROM THE SNAPSHOT, NOT FROM THE POSTING. Every application
 * froze the exact question set it was answering at submit time into
 * `question_schema_snapshot`, and this reads that column. A lead who edits a
 * posting mid-cycle — fixes a typo, drops a question, adds another — must not
 * change what an already-submitted application appears to have been asked. That
 * is the entire reason the column exists, and reading `postings.question_schema`
 * here instead would look correct in every test written against a posting that
 * had not been edited yet.
 *
 * Row visibility is RLS's job, as everywhere else: this must be called with the
 * caller's client, never the service role.
 */

/**
 * A question from the snapshot, or the raw JSON if it no longer validates.
 *
 * A snapshot is an archive: it was written by the code of its day and is read
 * by the code of some later day. If the `Question` type gains a required field,
 * every snapshot written before it stops validating — and a detail view that
 * threw would make those applications permanently unopenable, which is the
 * opposite of what freezing them was for. One unreadable question degrades to a
 * visible note; the other twenty still render.
 */
export type SnapshotEntry =
  { ok: true; question: Question } | { ok: false; id: string | null; label: string | null };

export type SiblingApplication = {
  id: string;
  teamName: string;
  teamSlug: string;
  status: ApplicationStatus;
};

export type ApplicationDetail = {
  id: string;
  postingId: string;
  postingTitle: string;
  teamSlug: string;
  submissionId: string;
  applicantName: string;
  applicantEmail: string;
  yearOfStudy: string;
  faculty: string;
  homeDepartment: string;
  resumePath: string | null;
  status: ApplicationStatus;
  submittedAt: string;
  /** In the applicant's own order of preference. Empty for teams that do not rank. */
  rankedSubteams: BoardSubteam[];
  assignedSubteam: BoardSubteam | null;
  answers: AnswerMap;
  questions: SnapshotEntry[];
  notes: ApplicationNote[];
  /**
   * The other teams this person applied to in the same submission.
   *
   * SCOPED BY RLS, deliberately. A Software lead sees that the applicant also
   * applied to Mechanical only if they are allowed to see Mechanical's
   * applications — which a lead is not, and an admin is. Showing a name and a
   * status for a row the caller cannot open would leak the existence of another
   * team's pipeline.
   */
  siblings: SiblingApplication[];
};

type DetailRow = {
  id: string;
  posting_id: string;
  submission_id: string;
  applicant_name: string;
  applicant_email: string;
  year_of_study: string;
  faculty: string;
  home_department: string;
  resume_path: string | null;
  ranked_subteams: string[] | null;
  answers: unknown;
  question_schema_snapshot: unknown;
  status: string;
  assigned_subteam_id: string | null;
  submitted_at: string;
  postings: { title: string; teams: { slug: string } | null } | null;
};

/** Null when the row does not exist OR the caller may not see it — the same answer. */
export async function getApplicationDetail(
  applicationId: string,
  supabase: SupabaseClient<Database>,
): Promise<ApplicationDetail | null> {
  const { data, error } = await supabase
    .from('applications')
    .select(
      'id, posting_id, submission_id, applicant_name, applicant_email, year_of_study, ' +
        'faculty, home_department, resume_path, ranked_subteams, answers, question_schema_snapshot, ' +
        // `question_schema` is deliberately NOT selected. The questions come from
        // `question_schema_snapshot` above; not fetching the live column means the
        // "simplification" that would break this cannot be made by accident.
        'status, assigned_subteam_id, submitted_at, postings(title, teams(slug))',
    )
    .eq('id', applicationId)
    .maybeSingle();

  if (error) {
    console.error('[application] detail query failed', { applicationId, message: error.message });
    throw new Error('Could not load this application.');
  }
  if (!data) return null;

  const row = data as unknown as DetailRow;

  const subteamIds = [
    ...(row.ranked_subteams ?? []),
    ...(row.assigned_subteam_id ? [row.assigned_subteam_id] : []),
  ];
  const [subteams, siblings, notes] = await Promise.all([
    loadSubteams(supabase, subteamIds),
    loadSiblings(supabase, row.submission_id, row.id),
    getApplicationNotes(row.id, supabase),
  ]);

  return {
    id: row.id,
    postingId: row.posting_id,
    postingTitle: row.postings?.title ?? 'Application',
    teamSlug: row.postings?.teams?.slug ?? '',
    submissionId: row.submission_id,
    applicantName: row.applicant_name,
    applicantEmail: row.applicant_email,
    yearOfStudy: row.year_of_study,
    faculty: row.faculty,
    homeDepartment: row.home_department,
    resumePath: row.resume_path,
    status: row.status as ApplicationStatus,
    submittedAt: row.submitted_at,
    // Mapped through the ranked order rather than the order the lookup
    // returned: `ranked_subteams[0]` is the first choice and that is the whole
    // meaning of the column. A subteam deleted since is dropped rather than
    // rendered as a gap.
    rankedSubteams: (row.ranked_subteams ?? [])
      .map((id) => subteams.get(id))
      .filter((subteam): subteam is BoardSubteam => subteam !== undefined),
    assignedSubteam: row.assigned_subteam_id
      ? (subteams.get(row.assigned_subteam_id) ?? null)
      : null,
    answers: (row.answers ?? {}) as AnswerMap,
    questions: readSnapshot(row.question_schema_snapshot),
    notes,
    siblings,
  };
}

/**
 * Validates the frozen questions one at a time.
 *
 * Per question rather than per set, so a single entry that no longer conforms
 * costs one row of the page instead of the whole application.
 */
export function readSnapshot(snapshot: unknown): SnapshotEntry[] {
  if (!Array.isArray(snapshot)) return [];

  return snapshot.map((entry) => {
    try {
      return { ok: true, question: validateQuestion(entry) };
    } catch {
      const record = (entry ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        id: typeof record.id === 'string' ? record.id : null,
        label: typeof record.label === 'string' ? record.label : null,
      };
    }
  });
}

async function loadSubteams(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Map<string, BoardSubteam>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.from('subteams').select('id, name, code').in('id', unique);
  if (error) {
    console.error('[application] subteam lookup failed', { message: error.message });
    throw new Error('Could not load this application.');
  }

  return new Map(
    (data ?? []).map((row) => [row.id, { id: row.id, name: row.name, code: row.code }]),
  );
}

type SiblingRow = {
  id: string;
  status: string;
  postings: { teams: { name: string; slug: string } | null } | null;
};

async function loadSiblings(
  supabase: SupabaseClient<Database>,
  submissionId: string,
  selfId: string,
): Promise<SiblingApplication[]> {
  const { data, error } = await supabase
    .from('applications')
    .select('id, status, postings(teams(name, slug))')
    .eq('submission_id', submissionId)
    .neq('id', selfId);

  if (error) {
    console.error('[application] sibling lookup failed', { message: error.message });
    throw new Error('Could not load this application.');
  }

  return ((data ?? []) as unknown as SiblingRow[])
    .filter((row) => row.postings?.teams)
    .map((row) => ({
      id: row.id,
      teamName: row.postings!.teams!.name,
      teamSlug: row.postings!.teams!.slug,
      status: row.status as ApplicationStatus,
    }));
}
