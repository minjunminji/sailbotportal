import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

/**
 * The read path behind the admin board.
 *
 * Two things shape every decision in this file.
 *
 * FIRST, THE BOARD IS A LIST OF CARDS, NOT A LIST OF APPLICATIONS. A card shows
 * five things — name, year and home department, first-choice subteam,
 * days-in-column, note count — so this returns those and nothing else. In
 * particular it returns NEITHER `answers` NOR `question_schema_snapshot`. Those
 * two columns are the bulk of an application row: a Software snapshot is eight
 * questions including a twenty-row skills matrix, and a board of three hundred
 * applicants would ship hundreds of kilobytes of JSONB that no card renders.
 * The detail view fetches one row and reads them there.
 *
 * SECOND, EVERY FILTER RUNS IN POSTGRES. Note counts come back as an aggregate
 * rather than as notes this code then counts, the first-choice filter is an
 * indexed column comparison rather than a post-filter over rows about to be
 * discarded, and the text search is one `ilike` per column rather than a scan
 * in JavaScript. A board is opened constantly during recruiting and grows all
 * season; the moment it matters is the moment it is slowest.
 *
 * Row visibility is NOT enforced here. It comes from RLS on `applications`: a
 * lead sees only rows whose posting belongs to their team, an admin sees all.
 * That means this must be called with a client carrying the caller's session —
 * never the service role, which bypasses RLS and would hand one team's board
 * another team's applicants.
 */

/** The eight board columns, in the order a candidate moves through them. */
export const APPLICATION_STATUSES = [
  'applied',
  'reviewing',
  'interview_email_sent',
  'interview_scheduled',
  'interview_completed',
  'waitlisted',
  'offered',
  'rejected',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type BoardSubteam = {
  id: string;
  name: string;
  /** PATH, NET, PWR. Null for Mechanical, whose subteams have no code. */
  code: string | null;
};

/** Exactly what a card renders, and nothing that only the detail view needs. */
export type BoardCard = {
  id: string;
  applicantName: string;
  /** Ordinal: '1'..'5', 'masters', 'phd'. */
  yearOfStudy: string;
  homeDepartment: string;
  /**
   * The subteam ranked first, resolved to a name. Null for Mechanical and
   * Electrical, which do not rank on the form, and null if the row's first
   * choice points at a subteam that has since been deleted.
   */
  firstChoiceSubteam: BoardSubteam | null;
  status: ApplicationStatus;
  /** What days-in-column is measured from. */
  statusChangedAt: string;
  noteCount: number;
  /** Set once a lead places the applicant; the card shows it instead of first choice. */
  assignedSubteamId: string | null;
};

/**
 * The board's filter state.
 *
 * Null means "not filtering", not "filter for null". Dates are plain calendar
 * days (`YYYY-MM-DD`) rather than instants, because the control is a date
 * picker and a lead asking for applications "up to the 14th" means the whole of
 * the 14th.
 */
export type BoardFilters = {
  /** Applicants who ranked this subteam FIRST. Not "ranked it anywhere". */
  firstChoiceSubteamId: string | null;
  /** Inclusive lower bound on `submitted_at`, as a UTC calendar day. */
  submittedFrom: string | null;
  /** Inclusive upper bound on `submitted_at`, as a UTC calendar day. */
  submittedTo: string | null;
  /** Free text matched against applicant name and email. */
  search: string | null;
};

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  firstChoiceSubteamId: null,
  submittedFrom: null,
  submittedTo: null,
  search: null,
};

/**
 * The URL parameter names, which are part of the app's public surface: these
 * end up in links leads paste to each other.
 */
export const BOARD_FILTER_PARAMS = {
  firstChoiceSubteamId: 'subteam',
  submittedFrom: 'from',
  submittedTo: 'to',
  search: 'q',
} as const;

/** What Next hands a page as `searchParams`, alongside a plain URLSearchParams. */
export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Long enough for a full name and address, short enough not to be a payload. */
const MAX_SEARCH_LENGTH = 100;

function firstValue(input: SearchParamsInput, key: string): string | null {
  const raw = input instanceof URLSearchParams ? input.get(key) : input[key];
  if (raw === undefined || raw === null) return null;
  // A repeated parameter (?q=a&q=b) is a hand-edited URL, not something the UI
  // produces. Taking the first is the same rule URLSearchParams.get follows.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Reads board filters out of URL search parameters.
 *
 * The board page and the detail view's prev/next both call this, which is the
 * point: prev/next has to walk the SAME set the board is showing, and it can
 * only do that if both derive their filters from the URL through one function
 * rather than each reading the parameters it happens to remember.
 *
 * Unknown parameters are ignored rather than carried through. Anything else
 * would let a pasted link put a filter into a query this file never declared —
 * and a value that fails its own format check is dropped for the same reason: a
 * malformed `subteam=` is a bad link, and the honest response is an unfiltered
 * board rather than a Postgres error page.
 */
export function parseBoardFilters(input: SearchParamsInput): BoardFilters {
  const subteam = firstValue(input, BOARD_FILTER_PARAMS.firstChoiceSubteamId);
  const from = firstValue(input, BOARD_FILTER_PARAMS.submittedFrom);
  const to = firstValue(input, BOARD_FILTER_PARAMS.submittedTo);
  const search = firstValue(input, BOARD_FILTER_PARAMS.search);

  return {
    firstChoiceSubteamId: subteam !== null && UUID.test(subteam) ? subteam : null,
    submittedFrom: from !== null && isCalendarDay(from) ? from : null,
    submittedTo: to !== null && isCalendarDay(to) ? to : null,
    search: search === null ? null : search.slice(0, MAX_SEARCH_LENGTH),
  };
}

/**
 * The inverse. Only set filters appear, so an unfiltered board has a clean URL,
 * and the key order is fixed so the same filters always produce the same string
 * (a URL that reshuffles itself on every navigation looks broken and defeats
 * browser history).
 */
export function serialiseBoardFilters(filters: BoardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.firstChoiceSubteamId !== null) {
    params.set(BOARD_FILTER_PARAMS.firstChoiceSubteamId, filters.firstChoiceSubteamId);
  }
  if (filters.submittedFrom !== null) {
    params.set(BOARD_FILTER_PARAMS.submittedFrom, filters.submittedFrom);
  }
  if (filters.submittedTo !== null) {
    params.set(BOARD_FILTER_PARAMS.submittedTo, filters.submittedTo);
  }
  if (filters.search !== null) {
    params.set(BOARD_FILTER_PARAMS.search, filters.search);
  }
  return params;
}

/** `2026-02-30` matches the shape and is still not a day. */
function isCalendarDay(value: string): boolean {
  if (!CALENDAR_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function startOfDayUtc(day: string): string {
  return `${day}T00:00:00.000Z`;
}

/**
 * The instant the day AFTER `day` begins, so an upper bound can be `< this`
 * and still include everything submitted during `day` itself. Comparing
 * `<= day` against a timestamptz would silently exclude all but the first
 * instant of it.
 */
function startOfNextDayUtc(day: string): string {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

/**
 * Neutralises every wildcard before a value is interpolated into an `ilike`
 * pattern.
 *
 * `_` matches any single character and `%` matches any run of them, so an
 * address like `jane_chen@…` searched literally would match strangers — that
 * exact bug has already been shipped and caught once in this codebase, in the
 * duplicate-email check in `submitApplication`.
 *
 * `*` is here because PostgREST accepts it as its own alias for `%` and
 * rewrites it before Postgres ever sees the pattern, so escaping only the SQL
 * metacharacters would leave a second wildcard the caller never asked for.
 *
 * Backslash goes first, or it would escape the escapes added after it.
 */
function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_*]/g, (character) => `\\${character}`);
}

/**
 * Strips the characters that steer PostgREST's `or=` grammar.
 *
 * Values inside `or=(…)` may be quoted, but PostgREST consumes backslashes
 * inside quotes, which destroys the escaping above and hands the wildcards
 * straight back. So the value has to go in UNQUOTED, and unquoted values end at
 * a comma or a closing parenthesis: a search for `a,status.eq.rejected` would
 * otherwise be read as a second filter and widen the result set rather than
 * narrow it. Removing those four characters is safe — none of them appears in a
 * name or an email address anyone is searching for.
 */
function sanitiseSearchTerm(value: string): string {
  return value.replace(/[,()"]/g, '').trim();
}

/** The shape PostgREST returns for the select below. */
type BoardRow = {
  id: string;
  applicant_name: string;
  year_of_study: string;
  home_department: string;
  status: string;
  status_changed_at: string;
  assigned_subteam_id: string | null;
  first_choice_subteam_id: string | null;
  // `table(count)` comes back as a one-element array of aggregates, and as a
  // bare object under some PostgREST versions. Both are handled.
  application_notes: { count: number }[] | { count: number } | null;
};

function noteCountOf(row: BoardRow): number {
  const aggregate = row.application_notes;
  if (aggregate === null || aggregate === undefined) return 0;
  if (Array.isArray(aggregate)) return aggregate[0]?.count ?? 0;
  return aggregate.count ?? 0;
}

/**
 * The cards for one posting's board, oldest-in-column first.
 *
 * ORDERING IS `status_changed_at` THEN `id`. The first half is the board's
 * whole point — whoever has sat untouched longest is at the top of their
 * column. The second half is not decoration: `status_changed_at` ties are
 * common (a lead moving four cards in one sitting, or a seeded batch), and an
 * ordering with ties is not an ordering. Postgres is free to return tied rows
 * in a different order on each call, which shows up as cards that shuffle on
 * refresh now, and as pagination that repeats and skips rows the moment a
 * `range()` is added.
 *
 * @param postingId which board.
 * @param filters   from the URL, via `parseBoardFilters`.
 * @param client    optional, and always the CALLER'S client — the request's
 *                  cookie-backed session by default. RLS is what scopes this to
 *                  their team, so a service-role client here would hand one
 *                  team's board every other team's applicants. Tests pass a
 *                  signed-in client directly, which is the only way to assert
 *                  that scoping from this side of the query.
 */
export async function getBoardApplications(
  postingId: string,
  filters: BoardFilters = EMPTY_BOARD_FILTERS,
  client?: SupabaseClient<Database>,
): Promise<BoardCard[]> {
  // Imported lazily so this module can be used from a test or a script without
  // dragging `next/headers` — and its request context — in behind it.
  const supabase = client ?? (await (await import('@/lib/supabase/server')).createClient());

  let query = supabase
    .from('applications')
    .select(
      'id, applicant_name, year_of_study, home_department, status, status_changed_at, ' +
        'assigned_subteam_id, first_choice_subteam_id, application_notes(count)',
    )
    .eq('posting_id', postingId);

  if (filters.firstChoiceSubteamId !== null) {
    // The generated `first_choice_subteam_id` column, not `contains`:
    // `ranked_subteams @> {id}` would also return everyone who ranked it
    // second or third, which is a different question with a similar answer.
    query = query.eq('first_choice_subteam_id', filters.firstChoiceSubteamId);
  }

  if (filters.submittedFrom !== null) {
    query = query.gte('submitted_at', startOfDayUtc(filters.submittedFrom));
  }

  if (filters.submittedTo !== null) {
    query = query.lt('submitted_at', startOfNextDayUtc(filters.submittedTo));
  }

  if (filters.search !== null) {
    const term = sanitiseSearchTerm(filters.search);
    // An all-punctuation search sanitises down to nothing. Matching everything
    // would be the opposite of what was asked for, so it is left off entirely.
    if (term !== '') {
      const pattern = `%${escapeIlikePattern(term)}%`;
      query = query.or(`applicant_name.ilike.${pattern},applicant_email.ilike.${pattern}`);
    }
  }

  const { data, error } = await query
    .order('status_changed_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    // The caller renders an error state; the detail belongs in the log, not in
    // a page, because a PostgREST message names columns and constraints.
    console.error('[board] application query failed', { postingId, message: error.message });
    throw new Error('Could not load applications for this board.');
  }

  const rows = (data ?? []) as unknown as BoardRow[];
  const subteams = await loadSubteams(supabase, rows);

  return rows.map((row) => ({
    id: row.id,
    applicantName: row.applicant_name,
    yearOfStudy: row.year_of_study,
    homeDepartment: row.home_department,
    firstChoiceSubteam:
      row.first_choice_subteam_id === null
        ? null
        : (subteams.get(row.first_choice_subteam_id) ?? null),
    // The check constraint on `applications.status` is what makes this cast
    // safe; there is no eighth-and-a-half status a row could be holding.
    status: row.status as ApplicationStatus,
    statusChangedAt: row.status_changed_at,
    noteCount: noteCountOf(row),
    assignedSubteamId: row.assigned_subteam_id,
  }));
}

/**
 * Names for the first choices actually present in this page of cards.
 *
 * A separate small query rather than an embed: `ranked_subteams` is a plain
 * uuid[] with no foreign key, so there is no relationship for PostgREST to
 * follow, and the generated column deliberately did not add one either. At most
 * six rows come back per team, and `subteams` is world-readable, so this is
 * cheap and needs no privileges of its own.
 */
async function loadSubteams(
  client: SupabaseClient<Database>,
  rows: BoardRow[],
): Promise<Map<string, BoardSubteam>> {
  const ids = [
    ...new Set(
      rows.map((row) => row.first_choice_subteam_id).filter((id): id is string => id !== null),
    ),
  ];

  if (ids.length === 0) return new Map();

  const { data, error } = await client.from('subteams').select('id, name, code').in('id', ids);

  if (error) {
    console.error('[board] subteam lookup failed', { message: error.message });
    throw new Error('Could not load applications for this board.');
  }

  return new Map(
    (data ?? []).map((row) => [row.id, { id: row.id, name: row.name, code: row.code }]),
  );
}
