/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, signedInAs } from '@/test/supabase-helpers';
import {
  EMPTY_BOARD_FILTERS,
  getBoardApplications,
  type BoardCard,
  type BoardFilters,
} from '../queries';
import { getBoardApplicationNavigation } from '../navigation';

/**
 * The board query layer, against a real database.
 *
 * Everything here is asserted THROUGH `getBoardApplications` rather than
 * through raw PostgREST, because that is the layer the board actually calls. A
 * policy that is correct and a query that quietly runs as the wrong role are
 * indistinguishable from the outside, and only the second one ships.
 *
 * Negative assertions check three things, the same way the RLS suite does: the
 * query succeeded, the caller saw nothing, and — via the service role, which
 * bypasses RLS — the rows they could not see genuinely exist. Without the third
 * check every one of them would pass against an empty database.
 */

const admin = adminClient();

/**
 * Fixtures are namespaced so they cannot collide with the reference data
 * (mech/elec/soft) or with the forty development fixtures in seed.sql. A
 * blanket delete here would wipe both and every test would still pass, which is
 * what makes it dangerous rather than merely wrong.
 */
const FIXTURE_TEAM_SLUGS = ['test-board-soft', 'test-board-mech'];
const FIXTURE_POSTING_SLUGS = ['test-board-soft-2026', 'test-board-mech-2026'];

/**
 * A domain of this suite's own. The RLS suite deletes every user ending in
 * `@test.dev` during its own cleanup, and Jest runs suites in parallel workers,
 * so sharing that domain would let one suite sign the other one out mid-run.
 */
const USER_DOMAIN = '@boardtest.dev';

type Ids = Record<string, string>;

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechPostingId: string;
let subteams: Ids = {};
let applications: Ids = {};
let softLead: SupabaseClient;
let softLeadId: string;
let adminUser: SupabaseClient;

/** Fixed timestamps, so the date-range assertions do not drift with the clock. */
const T = {
  jan10: '2026-01-10T12:00:00.000Z',
  jan11: '2026-01-11T12:00:00.000Z',
  feb01: '2026-02-01T09:00:00.000Z',
  feb15: '2026-02-15T09:00:00.000Z',
  feb28late: '2026-02-28T23:30:00.000Z',
  mar05: '2026-03-05T09:00:00.000Z',
  mar20: '2026-03-20T09:00:00.000Z',
};

/** Two rows share this instant on purpose, to pin the tie-break down. */
const TIED_STATUS_CHANGE = '2026-03-01T08:00:00.000Z';

async function clearFixtures() {
  const { data: teams, error: teamsReadError } = await admin
    .from('teams')
    .select('id')
    .in('slug', FIXTURE_TEAM_SLUGS);
  if (teamsReadError) throw teamsReadError;

  const teamIds = (teams ?? []).map((team) => team.id);

  // postings.team_id is ON DELETE RESTRICT, so postings go before teams;
  // applications, notes and events all cascade from postings. profiles.team_id
  // references teams, so the users go before the teams do.
  //
  // By slug as well as by team, because `postings.slug` is UNIQUE globally: a
  // posting left behind by a half-failed run would block the insert below even
  // though its team is already gone.
  const { error: slugError } = await admin
    .from('postings')
    .delete()
    .in('slug', FIXTURE_POSTING_SLUGS);
  if (slugError) throw slugError;

  if (teamIds.length > 0) {
    const { error } = await admin.from('postings').delete().in('team_id', teamIds);
    if (error) throw error;
  }

  const { data: users, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  for (const user of users?.users ?? []) {
    if (!user.email?.endsWith(USER_DOMAIN)) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }

  const { error: teamsError } = await admin.from('teams').delete().in('slug', FIXTURE_TEAM_SLUGS);
  if (teamsError) throw teamsError;
}

/** Unique per call, so two signups inside one millisecond cannot collide. */
function testEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${USER_DOMAIN}`;
}

function names(cards: BoardCard[]): string[] {
  return cards.map((card) => card.applicantName).sort();
}

function withFilters(filters: Partial<BoardFilters>): BoardFilters {
  return { ...EMPTY_BOARD_FILTERS, ...filters };
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Board Software', slug: 'test-board-soft' },
      { name: 'Test Board Mechanical', slug: 'test-board-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((team) => team.slug === 'test-board-soft')!.id;
  mechTeamId = teams!.find((team) => team.slug === 'test-board-mech')!.id;

  const { data: subteamRows, error: subteamsError } = await admin
    .from('subteams')
    .insert([
      {
        team_id: softTeamId,
        name: 'Test Pathfinding',
        code: 'PATH',
        slug: 'test-board-path',
        position: 0,
      },
      {
        team_id: softTeamId,
        name: 'Test Network',
        code: 'NET',
        slug: 'test-board-net',
        position: 1,
      },
      {
        team_id: softTeamId,
        name: 'Test Website',
        code: null,
        slug: 'test-board-web',
        position: 2,
      },
    ])
    .select();
  if (subteamsError) throw subteamsError;
  subteams = Object.fromEntries((subteamRows ?? []).map((row) => [row.slug, row.id]));

  // `subteam_ranking` is spelled out on BOTH rows. PostgREST sends null rather
  // than the column default for a key present on only some rows of a batch
  // insert, so leaving it off the Mechanical posting fails the NOT NULL
  // constraint — for the whole batch, including the row that did set it.
  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Board Software',
        slug: 'test-board-soft-2026',
        status: 'open',
        subteam_ranking: { enabled: true, maxChoices: 3 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Board Mechanical',
        slug: 'test-board-mech-2026',
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((posting) => posting.slug === 'test-board-soft-2026')!.id;
  mechPostingId = postings!.find((posting) => posting.slug === 'test-board-mech-2026')!.id;

  // EVERY key is present on EVERY row. PostgREST sends null rather than the
  // column default for a key that appears on only some rows of a batch insert,
  // so an omitted `ranked_subteams` here would arrive as null and fail the NOT
  // NULL constraint rather than defaulting to '{}'.
  const rows = [
    {
      posting_id: softPostingId,
      applicant_name: 'Ada Bell',
      // The escaping case. An unescaped `_` is a single-character wildcard, so
      // a search for `a_b` would also return Axel Byrne below.
      applicant_email: 'a_b@boardtest.dev',
      year_of_study: '2',
      faculty: 'Science',
      home_department: 'CPSC',
      ranked_subteams: [subteams['test-board-path'], subteams['test-board-net']],
      status: 'applied',
      status_changed_at: T.jan10,
      submitted_at: T.jan10,
    },
    {
      posting_id: softPostingId,
      applicant_name: 'Axel Byrne',
      applicant_email: 'axb@boardtest.dev',
      year_of_study: '3',
      faculty: 'Applied Science',
      home_department: 'CPEN',
      ranked_subteams: [subteams['test-board-net']],
      status: 'applied',
      status_changed_at: T.jan11,
      submitted_at: T.jan11,
    },
    {
      posting_id: softPostingId,
      applicant_name: 'Cara Diaz',
      applicant_email: 'cara_diaz@boardtest.dev',
      year_of_study: '4',
      faculty: 'Applied Science',
      home_department: 'ELEC',
      ranked_subteams: [subteams['test-board-path'], subteams['test-board-web']],
      status: 'reviewing',
      status_changed_at: T.feb01,
      submitted_at: T.feb01,
    },
    {
      // Ranks PATH SECOND. `contains` would return this row for a
      // "ranked PATH first" filter; the generated column does not.
      posting_id: softPostingId,
      applicant_name: 'Liam Oro',
      applicant_email: 'liam_oro@boardtest.dev',
      year_of_study: '1',
      faculty: 'Applied Science',
      home_department: 'APSC',
      ranked_subteams: [subteams['test-board-net'], subteams['test-board-path']],
      status: 'applied',
      status_changed_at: T.feb15,
      submitted_at: T.feb15,
    },
    {
      posting_id: softPostingId,
      applicant_name: 'Gina Hale',
      applicant_email: 'gina_hale@boardtest.dev',
      year_of_study: 'masters',
      faculty: 'Applied Science',
      home_department: 'MECH',
      // Ranked nothing, which is what Mechanical and Electrical applicants
      // always look like.
      ranked_subteams: [],
      status: 'waitlisted',
      status_changed_at: T.feb15,
      submitted_at: T.feb15,
    },
    {
      // Submitted late on the last day of the range, which is the row that
      // fails if the upper bound is `<= '2026-02-28'` against a timestamptz.
      posting_id: softPostingId,
      applicant_name: 'Noah Pike',
      applicant_email: 'noah_pike@boardtest.dev',
      year_of_study: '2',
      faculty: 'Applied Science',
      home_department: 'IGEN',
      ranked_subteams: [subteams['test-board-web']],
      status: 'applied',
      status_changed_at: T.feb28late,
      submitted_at: T.feb28late,
    },
    {
      posting_id: softPostingId,
      applicant_name: 'Evan Ford',
      applicant_email: 'evan_ford@boardtest.dev',
      year_of_study: '5',
      faculty: 'Science',
      home_department: 'PHYS',
      ranked_subteams: [subteams['test-board-path']],
      status: 'offered',
      status_changed_at: TIED_STATUS_CHANGE,
      submitted_at: T.mar05,
    },
    {
      // Shares Evan's `status_changed_at` exactly. Two leads moving cards in
      // one sitting produce this constantly.
      posting_id: softPostingId,
      applicant_name: 'Rosa Vidal',
      applicant_email: 'rosa_vidal@boardtest.dev',
      year_of_study: '3',
      faculty: 'Science',
      home_department: 'CPSC',
      ranked_subteams: [subteams['test-board-net']],
      status: 'offered',
      status_changed_at: TIED_STATUS_CHANGE,
      submitted_at: T.mar20,
    },
    {
      // Another team entirely. The soft lead must never see this row.
      posting_id: mechPostingId,
      applicant_name: 'Mia Novak',
      applicant_email: 'mia_novak@boardtest.dev',
      year_of_study: '4',
      faculty: 'Applied Science',
      home_department: 'MECH',
      ranked_subteams: [],
      status: 'applied',
      status_changed_at: T.mar05,
      submitted_at: T.mar05,
    },
  ].map((row) => ({
    ...row,
    submission_id: crypto.randomUUID(),
    // The board never reads this column, which is exactly why the query must
    // not fetch it. Empty is fine here; the detail view's tests own the real
    // snapshot.
    question_schema_snapshot: [],
  }));

  const { data: inserted, error: appsError } = await admin
    .from('applications')
    .insert(rows)
    .select();
  if (appsError) throw appsError;
  applications = Object.fromEntries((inserted ?? []).map((row) => [row.applicant_name, row.id]));

  softLead = await signedInAs({
    email: testEmail('board-soft-lead'),
    role: 'lead',
    teamId: softTeamId,
  });
  softLeadId = (await softLead.auth.getUser()).data.user!.id;

  adminUser = await signedInAs({ email: testEmail('board-admin'), role: 'admin' });

  const { error: notesError } = await admin.from('application_notes').insert([
    { application_id: applications['Cara Diaz'], author_id: softLeadId, body: 'First read done.' },
    { application_id: applications['Cara Diaz'], author_id: softLeadId, body: 'Second opinion?' },
    {
      application_id: applications['Cara Diaz'],
      author_id: softLeadId,
      body: 'Moving to interview.',
    },
    { application_id: applications['Evan Ford'], author_id: softLeadId, body: 'Offer sent.' },
  ]);
  if (notesError) throw notesError;
});

// Cleared on the way out as well as the way in. Otherwise the fixture teams and
// their OPEN posting survive the run and appear on the developer's own public
// home page, which reads as a bug in the app rather than as leftover test data.
afterAll(clearFixtures);

describe('row visibility', () => {
  it('gives a lead every applicant on their own team board', async () => {
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    expect(names(cards)).toEqual([
      'Ada Bell',
      'Axel Byrne',
      'Cara Diaz',
      'Evan Ford',
      'Gina Hale',
      'Liam Oro',
      'Noah Pike',
      'Rosa Vidal',
    ]);
  });

  it('gives a lead nothing from another team board', async () => {
    const cards = await getBoardApplications(mechPostingId, EMPTY_BOARD_FILTERS, softLead);
    expect(cards).toHaveLength(0);

    // The row the lead could not see is really there, and an admin really can
    // see it — so this is RLS scoping and not an empty fixture or a broken
    // query.
    const hidden = await admin.from('applications').select('id').eq('posting_id', mechPostingId);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toHaveLength(1);

    const asAdmin = await getBoardApplications(mechPostingId, EMPTY_BOARD_FILTERS, adminUser);
    expect(names(asAdmin)).toEqual(['Mia Novak']);
  });

  it('a filter cannot widen a lead past their own team', async () => {
    // Filters narrow. Nothing a caller puts in the URL may turn another team's
    // board into rows, so the same query with every filter cleared and a search
    // that matches the hidden applicant still returns nothing.
    const cards = await getBoardApplications(
      mechPostingId,
      withFilters({ search: 'mia' }),
      softLead,
    );
    expect(cards).toHaveLength(0);
  });
});

describe('the card payload', () => {
  it('carries exactly what a card renders', async () => {
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    const cara = cards.find((card) => card.applicantName === 'Cara Diaz')!;

    expect(cara).toEqual({
      id: applications['Cara Diaz'],
      applicantName: 'Cara Diaz',
      yearOfStudy: '4',
      homeDepartment: 'ELEC',
      firstChoiceSubteam: {
        id: subteams['test-board-path'],
        name: 'Test Pathfinding',
        code: 'PATH',
      },
      status: 'reviewing',
      statusChangedAt: expect.any(String),
      noteCount: 3,
      assignedSubteamId: null,
    });
  });

  it('leaves answers and the question snapshot on the server', async () => {
    // A board of three hundred applicants would otherwise ship hundreds of
    // kilobytes of JSONB that no card renders. `toEqual` above already pins the
    // shape; this says why out loud, so a later "just add answers" is a test
    // failure rather than a silent regression.
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    for (const card of cards) {
      expect(card).not.toHaveProperty('answers');
      expect(card).not.toHaveProperty('question_schema_snapshot');
      expect(card).not.toHaveProperty('applicant_email');
    }
  });

  it('has no first choice for an applicant who ranked nothing', async () => {
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    const gina = cards.find((card) => card.applicantName === 'Gina Hale')!;
    expect(gina.firstChoiceSubteam).toBeNull();
  });

  it('keeps a subteam with no code', async () => {
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    const noah = cards.find((card) => card.applicantName === 'Noah Pike')!;
    expect(noah.firstChoiceSubteam).toEqual({
      id: subteams['test-board-web'],
      name: 'Test Website',
      code: null,
    });
  });
});

describe('note counts', () => {
  it('match an independent count of the notes themselves', async () => {
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);

    for (const card of cards) {
      const { count, error } = await admin
        .from('application_notes')
        .select('id', { count: 'exact', head: true })
        .eq('application_id', card.id);
      expect(error).toBeNull();
      expect(card.noteCount).toBe(count);
    }

    // And the counts are not all zero, which is the way this assertion would
    // otherwise pass without testing anything.
    expect(cards.map((card) => card.noteCount).sort()).toEqual([0, 0, 0, 0, 0, 0, 1, 3]);
  });
});

describe('filters', () => {
  it('narrows to applicants who ranked a subteam FIRST', async () => {
    const cards = await getBoardApplications(
      softPostingId,
      withFilters({ firstChoiceSubteamId: subteams['test-board-path'] }),
      softLead,
    );

    // Liam Oro ranked PATH second and must not be here. A `contains` filter
    // would have returned him, which is the mistake this fixture exists for.
    expect(names(cards)).toEqual(['Ada Bell', 'Cara Diaz', 'Evan Ford']);
  });

  it('narrows by submitted date, inclusive at both ends', async () => {
    const cards = await getBoardApplications(
      softPostingId,
      withFilters({ submittedFrom: '2026-02-01', submittedTo: '2026-02-28' }),
      softLead,
    );

    // Noah Pike submitted at 23:30 on the 28th. He belongs to a range ending on
    // the 28th, and drops out of one bounded by `<= 2026-02-28` as an instant.
    expect(names(cards)).toEqual(['Cara Diaz', 'Gina Hale', 'Liam Oro', 'Noah Pike']);
  });

  it('narrows by an open-ended date range', async () => {
    const from = await getBoardApplications(
      softPostingId,
      withFilters({ submittedFrom: '2026-03-01' }),
      softLead,
    );
    expect(names(from)).toEqual(['Evan Ford', 'Rosa Vidal']);

    const to = await getBoardApplications(
      softPostingId,
      withFilters({ submittedTo: '2026-01-10' }),
      softLead,
    );
    expect(names(to)).toEqual(['Ada Bell']);
  });

  it('searches name and email', async () => {
    const byName = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'cara' }),
      softLead,
    );
    expect(names(byName)).toEqual(['Cara Diaz']);

    const byEmail = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'gina_hale@boardtest.dev' }),
      softLead,
    );
    expect(names(byEmail)).toEqual(['Gina Hale']);

    // Case-insensitive, because nobody types a name the way it was stored.
    const byCase = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'ROSA' }),
      softLead,
    );
    expect(names(byCase)).toEqual(['Rosa Vidal']);
  });

  it('treats an underscore in a search as a literal, not a wildcard', async () => {
    // THE ESCAPING CASE. `_` matches any single character in LIKE, so an
    // unescaped `a_b` also matches `axb` — the exact bug already shipped once
    // in this codebase, where a duplicate-email check matched strangers.
    const cards = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'a_b' }),
      softLead,
    );
    expect(names(cards)).toEqual(['Ada Bell']);

    // Both rows exist and both are visible to this lead, so the one that is
    // missing was excluded by the escaping rather than by RLS or a typo.
    const axel = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'axb' }),
      softLead,
    );
    expect(names(axel)).toEqual(['Axel Byrne']);
  });

  it('treats percent and asterisk as literals too', async () => {
    // `%` is the other SQL wildcard, and PostgREST accepts `*` as its own alias
    // for it before Postgres sees the pattern. Neither may become a match-all.
    for (const search of ['%', '*', 'a%b', 'a*b']) {
      const cards = await getBoardApplications(softPostingId, withFilters({ search }), softLead);
      expect(names(cards)).toEqual([]);
    }
  });

  it('does not let a search steer the query', async () => {
    // Unquoted PostgREST `or=` values end at a comma or a bracket. A term that
    // carried them through would be read as extra filters and could widen the
    // board rather than narrow it.
    const cards = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'zzz,status.eq.applied' }),
      softLead,
    );
    expect(cards).toHaveLength(0);
  });

  it('composes filters rather than letting the last one win', async () => {
    const cards = await getBoardApplications(
      softPostingId,
      withFilters({
        firstChoiceSubteamId: subteams['test-board-path'],
        submittedFrom: '2026-01-01',
        submittedTo: '2026-02-28',
        search: 'a',
      }),
      softLead,
    );

    // PATH first, submitted in range, and containing an 'a': Ada Bell and Cara
    // Diaz both rank PATH first, but only these two also fall inside the dates.
    expect(names(cards)).toEqual(['Ada Bell', 'Cara Diaz']);

    // Each filter is doing work: dropping the date range lets Evan Ford back in.
    const wider = await getBoardApplications(
      softPostingId,
      withFilters({ firstChoiceSubteamId: subteams['test-board-path'], search: 'a' }),
      softLead,
    );
    expect(names(wider)).toEqual(['Ada Bell', 'Cara Diaz', 'Evan Ford']);
  });

  it('returns an empty board rather than everything when nothing matches', async () => {
    const cards = await getBoardApplications(
      softPostingId,
      withFilters({ search: 'nobody-by-that-name' }),
      softLead,
    );
    expect(cards).toHaveLength(0);
  });
});

describe('ordering', () => {
  it('puts the longest-untouched card first', async () => {
    const cards = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    const changed = cards.map((card) => card.statusChangedAt);
    expect([...changed].sort()).toEqual(changed);
  });

  it('breaks ties on a unique column, so the order is the same every call', async () => {
    // Evan Ford and Rosa Vidal share `status_changed_at` exactly. Without the
    // `id` tie-break Postgres may return them in either order, which shows up
    // as cards that shuffle on refresh — and, once a `range()` is added, as
    // pagination that repeats one row and skips another.
    const first = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    const second = await getBoardApplications(softPostingId, EMPTY_BOARD_FILTERS, softLead);
    expect(first.map((card) => card.id)).toEqual(second.map((card) => card.id));

    // Compared as instants: Postgres renders the same moment as
    // `2026-03-01T08:00:00+00:00`, not as the `Z` form it was written with.
    const tiedAt = new Date(TIED_STATUS_CHANGE).getTime();
    const tied = first
      .filter((card) => new Date(card.statusChangedAt).getTime() === tiedAt)
      .map((card) => card.id);
    expect(tied).toHaveLength(2);
    expect(tied).toEqual([...tied].sort());
  });
});

describe('detail navigation', () => {
  it('uses the filtered board order for previous and next applicants', async () => {
    const navigation = await getBoardApplicationNavigation(
      softPostingId,
      applications['Cara Diaz'],
      withFilters({ firstChoiceSubteamId: subteams['test-board-path'] }),
      softLead,
    );

    expect(navigation).toEqual({
      previousId: applications['Ada Bell'],
      nextId: applications['Evan Ford'],
    });
  });

  it('cannot navigate through rows hidden by RLS', async () => {
    const navigation = await getBoardApplicationNavigation(
      mechPostingId,
      applications['Mia Novak'],
      EMPTY_BOARD_FILTERS,
      softLead,
    );

    expect(navigation).toEqual({ previousId: null, nextId: null });
  });
});
