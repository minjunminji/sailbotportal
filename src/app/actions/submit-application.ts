'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildAnswerSchema } from '@/lib/questions/schema';
import { resolveQuestions } from '@/lib/questions/snapshot';
import { isFile, type Question } from '@/lib/questions/types';
import type { Json } from '@/lib/supabase/types';
import { RateLimiter, clientIp } from '@/lib/uploads';

/**
 * The one place applicant data enters the database.
 *
 * An applicant fills a single form covering every open team. One submission
 * writes ONE `applications` row PER SELECTED TEAM, each with its own frozen
 * question snapshot, all sharing a `submission_id` and one `resume_path`. That
 * split is what lets mechanical reject someone while software still interviews
 * them, and it is why the write is a transaction rather than a loop.
 *
 * THIS FUNCTION HOLDS THE SERVICE ROLE, SO RLS PROTECTS NOTHING INSIDE IT.
 * Every check RLS would normally perform is this file's responsibility, and the
 * entire input is treated as hostile — it arrives from an anonymous browser and
 * a server action is a public HTTP endpoint whether or not a form calls it.
 *
 * What is trusted, and what is not:
 *
 * - The DATABASE decides what the questions are. `question_schema` and
 *   `core_questions` are loaded and re-resolved on every submission; the
 *   client's idea of what it rendered is never consulted, so a crafted payload
 *   cannot answer a question that does not exist or skip one that does.
 * - The DATABASE decides whether a posting accepts applications. A `draft` or
 *   `closed` posting is refused even though the client named it.
 * - The DATABASE decides which subteams a posting may be ranked against, and
 *   whether ranking applies at all.
 * - STORAGE decides whether a file path is real. A path this app never issued
 *   is refused rather than stored.
 * - The client decides only its own answers, and even those are parsed by a
 *   schema derived from the posting, which strips unknown keys.
 *
 * The only thing taken on faith is the applicant's identity: applications are
 * anonymous by design, so nothing here proves the person behind an email
 * address. That is the same trade the 2025 Google Form made, and the duplicate
 * index is what keeps it from being abused at scale.
 */

/** One team's half of the form. `postingSlug` names the posting it belongs to. */
export type TeamSelection = {
  postingSlug: string;
  /** Keyed by question id. Unknown keys are stripped, not stored. */
  answers?: Record<string, unknown>;
  /** Subteam ids, most preferred first. Empty unless the posting ranks subteams. */
  rankedSubteams?: string[];
};

export type SubmissionInput = {
  name: string;
  email: string;
  /** Ordinal: '1'..'5', 'masters', 'phd'. */
  yearOfStudy: string;
  homeDepartment: string;
  /** Storage path returned by /api/upload?purpose=resume. Shared by every row. */
  resumePath?: string | null;
  teams: TeamSelection[];
  /**
   * Honeypot. A hidden input a person never sees and never fills; a bot that
   * fills every field in the form fills this one too.
   */
  honeypot?: string;
};

export type SubmittedTeam = {
  teamSlug: string;
  teamName: string;
  postingSlug: string;
  applicationId: string;
};

/** A team that already holds an application for this email. */
export type DuplicateTeam = {
  teamSlug: string;
  teamName: string;
  postingSlug: string;
};

/** One rejection, addressed to the field that caused it. */
export type SubmissionIssue = {
  /** The posting this belongs to, or null for a shared field. */
  posting: string | null;
  /** Question id or shared field name, or null when it applies to the whole form. */
  field: string | null;
  message: string;
};

export type SubmitErrorCode =
  | 'rate_limited'
  | 'rejected'
  | 'invalid_input'
  | 'no_teams'
  | 'posting_unavailable'
  | 'invalid_subteams'
  | 'invalid_answers'
  | 'invalid_file'
  | 'duplicate'
  | 'server_error';

export type SubmitSuccess = {
  ok: true;
  submissionId: string;
  teams: SubmittedTeam[];
};

export type SubmitFailure = {
  ok: false;
  code: SubmitErrorCode;
  /** Safe to render. Never echoes a database message or a client-supplied string. */
  message: string;
  issues: SubmissionIssue[];
  /** Only for `duplicate`: the teams that already have this applicant on file. */
  duplicateTeams?: DuplicateTeam[];
  /** Only for `rate_limited`. */
  retryAfterSeconds?: number;
};

export type SubmitResult = SubmitSuccess | SubmitFailure;

const BUCKET = 'resumes';

/**
 * Five submissions per ten minutes per IP.
 *
 * Generous for a real applicant — a submission plus retries after validation
 * errors — and tight enough that filling the table by hand is tedious. PER
 * INSTANCE and resettable by a deploy, exactly like the upload limiter; see the
 * note on `RateLimiter`. It is reused rather than reimplemented because the
 * shape is identical, and a second limiter is a second thing to get wrong.
 */
const limiter = new RateLimiter(5, 10 * 60 * 1000);

/** The ordinals `applications.year_of_study` is documented to hold. */
const YEARS_OF_STUDY = ['1', '2', '3', '4', '5', 'masters', 'phd'] as const;

/**
 * Storage paths this app issues, and nothing else.
 *
 * `randomStoragePath` produces `<prefix>/<uuid>.<ext>`, so anything that does
 * not have that exact shape was not issued here and is refused before storage
 * is consulted. The existence check still runs — the shape only proves it could
 * have been ours.
 */
const RESUME_PATH = /^resume\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.pdf$/;
const QUESTION_FILE_PATH = /^question\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:pdf|zip)$/;

/**
 * Trimmed and lowercased BEFORE anything else looks at it, so the duplicate
 * check, the stored value, and the unique index on `lower(applicant_email)` all
 * agree on what the address is.
 */
const emailField = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.email('Enter a valid email address').max(254));

const teamSelectionSchema = z.object({
  postingSlug: z.string().trim().min(1).max(100),
  // Values stay `unknown` here on purpose. The schema built from the posting is
  // what parses them, and it is the thing that strips unknown keys.
  answers: z.record(z.string(), z.unknown()).default({}),
  rankedSubteams: z.array(z.uuid()).max(50).default([]),
});

const submissionSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: emailField,
  yearOfStudy: z.enum(YEARS_OF_STUDY, 'Choose your year of study'),
  homeDepartment: z.string().trim().min(1, 'Enter your home department').max(80),
  resumePath: z.string().trim().min(1).nullish(),
  teams: z.array(teamSelectionSchema).max(20).default([]),
  honeypot: z.string().nullish(),
});

/** The posting fields the submission path needs, loaded fresh every time. */
type PostingRow = {
  id: string;
  slug: string;
  status: string;
  team_id: string;
  question_schema: Json;
  subteam_ranking: Json;
};

const subteamRankingSchema = z.object({
  enabled: z.boolean().default(false),
  maxChoices: z.number().int().positive().default(3),
});

function failure(
  code: SubmitErrorCode,
  message: string,
  issues: SubmissionIssue[] = [],
  extra: Pick<SubmitFailure, 'duplicateTeams' | 'retryAfterSeconds'> = {},
): SubmitFailure {
  return { ok: false, code, message, issues, ...extra };
}

/**
 * Escapes the characters LIKE treats as wildcards.
 *
 * The duplicate check matches case-insensitively, which means `ilike`, which
 * means an unescaped `_` in an address matches any character. Emails contain
 * underscores routinely, and the failure mode is a false "you already applied"
 * against a stranger's row.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function issuesFromZod(error: z.ZodError, posting: string | null): SubmissionIssue[] {
  return error.issues.map((issue) => ({
    posting,
    field: issue.path.length > 0 ? issue.path.map((part) => String(part)).join('.') : null,
    message: issue.message,
  }));
}

/** The IP the rate limiter counts against, or 'unknown' outside a request. */
async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

export async function submitApplication(input: SubmissionInput): Promise<SubmitResult> {
  const ip = await requestIp();
  if (!limiter.check(ip)) {
    return failure('rate_limited', 'Too many submissions. Try again shortly.', [], {
      retryAfterSeconds: limiter.retryAfterSeconds(ip),
    });
  }

  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      'invalid_input',
      'Check the highlighted fields.',
      issuesFromZod(parsed.error, null),
    );
  }
  const submission = parsed.data;

  // Bots fill every input they find. A person never sees this one, so anything
  // in it is a bot — refused with the same wording a person would never trigger.
  if (typeof submission.honeypot === 'string' && submission.honeypot.trim() !== '') {
    return failure('rejected', 'This submission could not be accepted.');
  }

  // The one genuinely ambiguous end state of a form built from optional
  // branches: every question answered and no team chosen. Silently writing
  // nothing and reporting success is the worst possible reading of it.
  if (submission.teams.length === 0) {
    return failure('no_teams', 'Choose at least one team to apply to.', [
      { posting: null, field: 'teams', message: 'Choose at least one team' },
    ]);
  }

  const requestedSlugs = submission.teams.map((team) => team.postingSlug);
  if (new Set(requestedSlugs).size !== requestedSlugs.length) {
    return failure('invalid_input', 'Each team may be applied to once.', [
      { posting: null, field: 'teams', message: 'Each team may be applied to once' },
    ]);
  }

  const admin = createAdminClient();

  // --- The postings, from the database, and only if they are open ----------

  const { data: postingRows, error: postingError } = await admin
    .from('postings')
    .select('id, slug, status, team_id, question_schema, subteam_ranking')
    .in('slug', requestedSlugs);

  if (postingError) {
    console.error('[submit] posting lookup failed', { message: postingError.message });
    return failure('server_error', 'Something went wrong. Try again shortly.');
  }

  const postings = new Map<string, PostingRow>(
    (postingRows ?? []).map((row) => [row.slug, row as PostingRow]),
  );

  // "No such posting" and "not open" share one message, so this cannot be used
  // to enumerate which drafts exist.
  const unavailable = requestedSlugs.filter((slug) => postings.get(slug)?.status !== 'open');
  if (unavailable.length > 0) {
    return failure(
      'posting_unavailable',
      'One of the teams you selected is no longer accepting applications.',
      unavailable.map((slug) => ({
        posting: slug,
        field: null,
        message: 'This team is not accepting applications',
      })),
    );
  }

  const selected = submission.teams.map((team) => ({
    team,
    posting: postings.get(team.postingSlug)!,
  }));

  // --- Team names, for the result and for the duplicate error ---------------

  const teamIds = [...new Set(selected.map(({ posting }) => posting.team_id))];

  const { data: teamRows, error: teamError } = await admin
    .from('teams')
    .select('id, slug, name')
    .in('id', teamIds);

  if (teamError) {
    console.error('[submit] team lookup failed', { message: teamError.message });
    return failure('server_error', 'Something went wrong. Try again shortly.');
  }
  const teams = new Map((teamRows ?? []).map((row) => [row.id, row]));

  // --- Subteam preference --------------------------------------------------

  const { data: subteamRows, error: subteamError } = await admin
    .from('subteams')
    .select('id, team_id, slug, active')
    .in('team_id', teamIds);

  if (subteamError) {
    console.error('[submit] subteam lookup failed', { message: subteamError.message });
    return failure('server_error', 'Something went wrong. Try again shortly.');
  }
  const subteams = new Map((subteamRows ?? []).map((row) => [row.id, row]));

  const subteamIssues: SubmissionIssue[] = [];
  /** Ranked subteam SLUGS per posting, in preference order — what `visibleIf` reads. */
  const rankedSlugs = new Map<string, string[]>();

  for (const { team, posting } of selected) {
    const ranking = subteamRankingSchema.safeParse(posting.subteam_ranking);
    if (!ranking.success) {
      console.error('[submit] posting has an unreadable subteam_ranking', { slug: posting.slug });
      return failure('server_error', 'Something went wrong. Try again shortly.');
    }

    const ranked = team.rankedSubteams;

    // Disabled means the form never asked, so a non-empty list is a payload
    // this form could not have produced. Storing it anyway would put subteam
    // preferences on a team that assigns subteams after the interview.
    if (!ranking.data.enabled) {
      if (ranked.length > 0) {
        subteamIssues.push({
          posting: posting.slug,
          field: 'rankedSubteams',
          message: 'This team does not rank subteams',
        });
      }
      rankedSlugs.set(posting.slug, []);
      continue;
    }

    if (new Set(ranked).size !== ranked.length) {
      subteamIssues.push({
        posting: posting.slug,
        field: 'rankedSubteams',
        message: 'Each subteam may be ranked once',
      });
      continue;
    }

    if (ranked.length > ranking.data.maxChoices) {
      subteamIssues.push({
        posting: posting.slug,
        field: 'rankedSubteams',
        message: `Rank at most ${ranking.data.maxChoices} subteams`,
      });
      continue;
    }

    // Membership is checked against the POSTING'S team. A software applicant
    // ranking a mechanical subteam would otherwise land a row whose
    // `assigned_subteam_id` could never be filled from its own list.
    const slugs: string[] = [];
    let invalid = false;
    for (const id of ranked) {
      const subteam = subteams.get(id);
      if (!subteam || subteam.team_id !== posting.team_id || !subteam.active) {
        invalid = true;
        break;
      }
      slugs.push(subteam.slug);
    }
    if (invalid) {
      subteamIssues.push({
        posting: posting.slug,
        field: 'rankedSubteams',
        message: 'Choose subteams from this team',
      });
      continue;
    }

    rankedSlugs.set(posting.slug, slugs);
  }

  if (subteamIssues.length > 0) {
    return failure('invalid_subteams', 'Check your subteam preferences.', subteamIssues);
  }

  // --- Answers, against a schema rebuilt from the database ------------------

  const { data: coreQuestions, error: coreError } = await admin
    .from('core_questions')
    .select('stable_key, position, definition')
    .order('position');

  if (coreError) {
    console.error('[submit] core question lookup failed', { message: coreError.message });
    return failure('server_error', 'Something went wrong. Try again shortly.');
  }

  type Prepared = {
    posting: PostingRow;
    snapshot: Question[];
    answers: Record<string, unknown>;
    rankedSubteams: string[];
  };

  const prepared: Prepared[] = [];
  const answerIssues: SubmissionIssue[] = [];

  for (const { team, posting } of selected) {
    let snapshot: Question[];
    try {
      // The resolved array is a deep copy, and it is BOTH what the answers are
      // validated against and what is frozen onto the row. Validating against
      // one array and storing another is how a snapshot stops describing the
      // form that was actually answered.
      snapshot = resolveQuestions(coreQuestions ?? [], posting);
    } catch (error) {
      console.error('[submit] posting questions could not be resolved', {
        slug: posting.slug,
        message: error instanceof Error ? error.message : String(error),
      });
      return failure('server_error', 'Something went wrong. Try again shortly.');
    }

    const schema = buildAnswerSchema(snapshot, {
      rankedSubteams: rankedSlugs.get(posting.slug) ?? [],
    });

    const answers = schema.safeParse(team.answers);
    if (!answers.success) {
      answerIssues.push(...issuesFromZod(answers.error, posting.slug));
      continue;
    }

    prepared.push({
      posting,
      snapshot,
      // The PARSED value, so unknown keys are gone rather than merely unread.
      answers: answers.data,
      rankedSubteams: team.rankedSubteams,
    });
  }

  if (answerIssues.length > 0) {
    return failure('invalid_answers', 'Some answers need another look.', answerIssues);
  }

  // --- Files must be ones this app issued -----------------------------------

  const resumePath = submission.resumePath ?? null;
  const fileIssues: SubmissionIssue[] = [];
  /** path -> where it came from, deduplicated so each object is checked once. */
  const filePaths = new Map<string, SubmissionIssue>();

  if (resumePath !== null) {
    if (!RESUME_PATH.test(resumePath)) {
      fileIssues.push({ posting: null, field: 'resumePath', message: 'Upload your resume again' });
    } else {
      filePaths.set(resumePath, {
        posting: null,
        field: 'resumePath',
        message: 'Upload your resume again',
      });
    }
  }

  for (const entry of prepared) {
    for (const question of entry.snapshot) {
      if (!isFile(question)) continue;
      const answer = entry.answers[question.id];
      if (answer === undefined || answer === null) continue;

      // The shape is already guaranteed by the file field schema; this reads
      // the path out of it.
      const path = (answer as { path?: unknown }).path;
      const issue: SubmissionIssue = {
        posting: entry.posting.slug,
        field: question.id,
        message: 'Upload this file again',
      };

      if (typeof path !== 'string' || !QUESTION_FILE_PATH.test(path)) {
        fileIssues.push(issue);
        continue;
      }
      filePaths.set(path, issue);
    }
  }

  if (fileIssues.length === 0 && filePaths.size > 0) {
    try {
      const checks = await Promise.all(
        [...filePaths.keys()].map(async (path) => ({
          path,
          // A HEAD against the private bucket: no bytes move and no URL is
          // minted. A path the app never issued does not exist here, which is
          // what stops a crafted payload attaching someone else's object — or
          // a path that resolves to nothing at all — to an application.
          exists: (await admin.storage.from(BUCKET).exists(path)).data === true,
        })),
      );
      for (const check of checks) {
        if (!check.exists) fileIssues.push(filePaths.get(check.path)!);
      }
    } catch (error) {
      console.error('[submit] storage existence check failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      return failure('server_error', 'Something went wrong. Try again shortly.');
    }
  }

  if (fileIssues.length > 0) {
    return failure('invalid_file', 'One of your uploads could not be found.', fileIssues);
  }

  // --- Already applied? -----------------------------------------------------

  const duplicates = await findDuplicates(
    admin,
    submission.email,
    prepared.map((entry) => entry.posting),
  );
  if (duplicates === null) {
    return failure('server_error', 'Something went wrong. Try again shortly.');
  }
  if (duplicates.length > 0) {
    return duplicateFailure(duplicates, teams);
  }

  // --- One id, one transaction ---------------------------------------------

  const submissionId = crypto.randomUUID();

  const rows = prepared.map((entry) => ({
    posting_id: entry.posting.id,
    submission_id: submissionId,
    applicant_name: submission.name,
    applicant_email: submission.email,
    year_of_study: submission.yearOfStudy,
    home_department: submission.homeDepartment,
    resume_path: resumePath,
    ranked_subteams: entry.rankedSubteams,
    answers: entry.answers,
    question_schema_snapshot: entry.snapshot,
  }));

  const { data: inserted, error: rpcError } = await admin.rpc('submit_application', {
    p_rows: rows as unknown as Json,
  });

  if (rpcError) {
    // 23505 is the unique index on (posting_id, lower(applicant_email)). The
    // check above already ran, so reaching here means two submissions raced.
    // Re-running the check turns the race back into the same named error a
    // person can act on, rather than a bare "duplicate key" they cannot.
    if (rpcError.code === '23505') {
      const raced = await findDuplicates(
        admin,
        submission.email,
        prepared.map((entry) => entry.posting),
      );
      if (raced && raced.length > 0) return duplicateFailure(raced, teams);
      return failure('duplicate', 'You have already applied with this email address.');
    }

    console.error('[submit] insert failed', { code: rpcError.code, message: rpcError.message });
    return failure('server_error', 'Something went wrong. Try again shortly.');
  }

  const written = z
    .array(z.object({ id: z.uuid(), posting_id: z.uuid() }))
    .safeParse(inserted ?? []);

  if (!written.success || written.data.length !== rows.length) {
    // The transaction committed, so the rows are there; only the receipt is
    // unreadable. Reporting failure would invite a retry the unique index would
    // then refuse, so this is logged and treated as the success it is.
    console.error('[submit] unexpected rpc result shape', { submissionId });
  }

  const idByPosting = new Map(
    (written.success ? written.data : []).map((row) => [row.posting_id, row.id]),
  );

  return {
    ok: true,
    submissionId,
    teams: prepared.map((entry) => {
      const team = teams.get(entry.posting.team_id);
      return {
        teamSlug: team?.slug ?? '',
        teamName: team?.name ?? '',
        postingSlug: entry.posting.slug,
        applicationId: idByPosting.get(entry.posting.id) ?? '',
      };
    }),
  };
}

/**
 * The postings this email has already applied to, or null if the lookup failed.
 *
 * Run BEFORE the insert so the applicant is told which team already has their
 * application. Letting the unique index be the only guard would fail the whole
 * transaction with a message naming a constraint — and someone who applied to
 * two teams, one of which silently conflicts, emails the exec instead of
 * retrying.
 */
async function findDuplicates(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  postings: PostingRow[],
): Promise<PostingRow[] | null> {
  const { data, error } = await admin
    .from('applications')
    .select('posting_id')
    .in(
      'posting_id',
      postings.map((posting) => posting.id),
    )
    // Case-insensitive, matching the unique index on lower(applicant_email),
    // so a row written with different casing is still found.
    .ilike('applicant_email', escapeLike(email));

  if (error) {
    console.error('[submit] duplicate check failed', { message: error.message });
    return null;
  }

  const taken = new Set((data ?? []).map((row) => row.posting_id));
  return postings.filter((posting) => taken.has(posting.id));
}

function duplicateFailure(
  postings: PostingRow[],
  teams: Map<string, { id: string; slug: string; name: string }>,
): SubmitFailure {
  const duplicateTeams: DuplicateTeam[] = postings.map((posting) => {
    const team = teams.get(posting.team_id);
    return {
      teamSlug: team?.slug ?? '',
      teamName: team?.name ?? '',
      postingSlug: posting.slug,
    };
  });

  const names = duplicateTeams.map((team) => team.teamName || team.postingSlug);
  return failure(
    'duplicate',
    names.length === 1
      ? `You have already applied to ${names[0]} with this email address.`
      : `You have already applied to ${names.join(' and ')} with this email address.`,
    duplicateTeams.map((team) => ({
      posting: team.postingSlug,
      field: null,
      message: 'You have already applied to this team',
    })),
    { duplicateTeams },
  );
}
