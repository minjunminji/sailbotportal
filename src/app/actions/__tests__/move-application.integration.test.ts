/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, signedInAs } from '@/test/supabase-helpers';

/**
 * Status moves, against a real database.
 *
 * `moveApplication` builds its Supabase client from the request's cookies,
 * which do not exist in a Jest worker, so `createClient` is the ONE thing
 * mocked here. Everything the test is actually about stays real: the RLS
 * policies decide which rows the caller can touch, the check constraint decides
 * which statuses exist, and the trigger writes the audit row. Mocking the
 * database instead would leave every assertion below testing a mock.
 *
 * The negative cases assert three things rather than one — the call reported
 * failure, the row is genuinely unchanged when read through the service role,
 * and no event was written. A test that only checked the return value would
 * pass just as happily against an action that returned an error after
 * successfully writing.
 */

let currentClient: SupabaseClient;

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => currentClient),
}));

// `revalidatePath` throws outside a request scope, and what it does is not
// something this suite can observe anyway.
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { moveApplication } from '../move-application';

const admin = adminClient();

const FIXTURE_TEAM_SLUGS = ['test-move-soft', 'test-move-mech'];
const FIXTURE_POSTING_SLUGS = ['test-move-soft-2026', 'test-move-mech-2026'];
/** Its own domain: sibling suites delete users by domain during cleanup. */
const USER_DOMAIN = '@movetest.dev';

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechPostingId: string;
let softLead: SupabaseClient;
let softLeadId: string;
let adminUser: SupabaseClient;
let adminUserId: string;

async function clearFixtures() {
  const { data: teams, error: teamsReadError } = await admin
    .from('teams')
    .select('id')
    .in('slug', FIXTURE_TEAM_SLUGS);
  if (teamsReadError) throw teamsReadError;

  const { error: slugError } = await admin
    .from('postings')
    .delete()
    .in('slug', FIXTURE_POSTING_SLUGS);
  if (slugError) throw slugError;

  const teamIds = (teams ?? []).map((team) => team.id);
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

function testEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${USER_DOMAIN}`;
}

/** A fresh application every time, so no test depends on another's leftovers. */
async function makeApplication(
  postingId: string,
  status = 'applied',
): Promise<{ id: string; statusChangedAt: string }> {
  const { data, error } = await admin
    .from('applications')
    .insert({
      posting_id: postingId,
      submission_id: crypto.randomUUID(),
      applicant_name: 'Test Applicant',
      applicant_email: `move_${crypto.randomUUID()}@movetest.dev`,
      year_of_study: '2',
      faculty: 'Science',
      home_department: 'CPSC',
      ranked_subteams: [],
      question_schema_snapshot: [],
      status,
      // Backdated, so "status_changed_at advanced" is a real comparison rather
      // than two timestamps a millisecond apart.
      status_changed_at: '2026-01-01T00:00:00.000Z',
    })
    .select('id, status_changed_at')
    .single();
  if (error) throw error;
  return { id: data!.id, statusChangedAt: data!.status_changed_at };
}

async function readApplication(id: string) {
  const { data, error } = await admin
    .from('applications')
    .select('status, status_changed_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data!;
}

async function readEvents(id: string) {
  const { data, error } = await admin
    .from('application_events')
    .select('type, from_status, to_status, actor_id')
    .eq('application_id', id)
    .order('created_at');
  if (error) throw error;
  return data ?? [];
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Move Software', slug: 'test-move-soft' },
      { name: 'Test Move Mechanical', slug: 'test-move-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((team) => team.slug === 'test-move-soft')!.id;
  mechTeamId = teams!.find((team) => team.slug === 'test-move-mech')!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Move Software',
        slug: 'test-move-soft-2026',
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Move Mechanical',
        slug: 'test-move-mech-2026',
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((posting) => posting.slug === 'test-move-soft-2026')!.id;
  mechPostingId = postings!.find((posting) => posting.slug === 'test-move-mech-2026')!.id;

  softLead = await signedInAs({
    email: testEmail('move-soft-lead'),
    role: 'lead',
    teamId: softTeamId,
  });
  softLeadId = (await softLead.auth.getUser()).data.user!.id;

  // No team: an admin's reach comes from their role, not from a team_id.
  adminUser = await signedInAs({ email: testEmail('move-admin'), role: 'admin' });
  adminUserId = (await adminUser.auth.getUser()).data.user!.id;
});

afterAll(clearFixtures);

describe('a lead moving their own team’s applicant', () => {
  beforeEach(() => {
    currentClient = softLead;
  });

  it('moves the card and reports success', async () => {
    const { id } = await makeApplication(softPostingId);

    const result = await moveApplication(id, 'reviewing', 'test-move-soft');

    expect(result).toEqual({ ok: true });
    expect((await readApplication(id)).status).toBe('reviewing');
  });

  it('writes one event naming who moved it, and from where to where', async () => {
    const { id } = await makeApplication(softPostingId, 'applied');

    await moveApplication(id, 'interview_scheduled', 'test-move-soft');

    expect(await readEvents(id)).toEqual([
      {
        type: 'status_change',
        from_status: 'applied',
        to_status: 'interview_scheduled',
        actor_id: softLeadId,
      },
    ]);
  });

  it('advances status_changed_at, which is what days-in-column measures', async () => {
    const { id, statusChangedAt } = await makeApplication(softPostingId);

    // Asserted before the timestamp, so a move that was refused reports the
    // refusal rather than an unhelpful "2026-01-01 is not greater than
    // 2026-01-01" several lines further down.
    expect(await moveApplication(id, 'reviewing', 'test-move-soft')).toEqual({ ok: true });

    const after = await readApplication(id);
    expect(new Date(after.status_changed_at).getTime()).toBeGreaterThan(
      new Date(statusChangedAt).getTime(),
    );
  });

  it('records every step of a candidate walking the whole board', async () => {
    const { id } = await makeApplication(softPostingId);

    for (const status of ['reviewing', 'interview_scheduled', 'offered']) {
      expect(await moveApplication(id, status, 'test-move-soft')).toEqual({ ok: true });
    }

    expect((await readEvents(id)).map((event) => event.to_status)).toEqual([
      'reviewing',
      'interview_scheduled',
      'offered',
    ]);
  });
});

describe('a lead reaching for another team', () => {
  beforeEach(() => {
    currentClient = softLead;
  });

  it('cannot move a Mechanical applicant, and leaves no trace of trying', async () => {
    const { id } = await makeApplication(mechPostingId, 'applied');

    const result = await moveApplication(id, 'rejected', 'test-move-mech');

    expect(result.ok).toBe(false);
    // The row is genuinely untouched, read past RLS through the service role.
    expect((await readApplication(id)).status).toBe('applied');
    expect(await readEvents(id)).toEqual([]);
  });

  it('says the same thing for an application that does not exist', async () => {
    // Distinguishing "not yours" from "no such row" would confirm an id exists
    // to someone who cannot see it.
    const mech = await makeApplication(mechPostingId);
    const forbidden = await moveApplication(mech.id, 'rejected', 'test-move-mech');
    const missing = await moveApplication(crypto.randomUUID(), 'rejected', 'test-move-soft');

    expect(forbidden.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(forbidden).toEqual(missing);
  });
});

describe('an admin', () => {
  beforeEach(() => {
    currentClient = adminUser;
  });

  it('moves an applicant on any team, attributed to themselves', async () => {
    const { id } = await makeApplication(mechPostingId);

    expect(await moveApplication(id, 'reviewing', 'test-move-mech')).toEqual({ ok: true });
    expect((await readEvents(id))[0].actor_id).toBe(adminUserId);
  });
});

describe('refusing a status that is not a status', () => {
  beforeEach(() => {
    currentClient = softLead;
  });

  it.each(['deleted', 'APPLIED', 'interview', '', 'applied; drop table applications'])(
    'refuses %p without touching the row',
    async (status) => {
      const { id } = await makeApplication(softPostingId, 'applied');

      const result = await moveApplication(id, status, 'test-move-soft');

      expect(result.ok).toBe(false);
      expect((await readApplication(id)).status).toBe('applied');
      expect(await readEvents(id)).toEqual([]);
    },
  );
});

/**
 * The reason the audit row is written by a trigger rather than by the action.
 *
 * RLS grants leads UPDATE on `applications`, and every table in `public` is a
 * PostgREST endpoint, so a lead can move a card without going near this app. If
 * the event were written in application code, that path would produce a status
 * change with no history behind it — and the history would still LOOK complete.
 */
describe('the audit trail cannot be skipped', () => {
  it('writes an event for a direct update that never touches the action', async () => {
    const { id } = await makeApplication(softPostingId, 'applied');

    const { error } = await softLead
      .from('applications')
      .update({ status: 'rejected' })
      .eq('id', id);
    expect(error).toBeNull();

    expect(await readEvents(id)).toEqual([
      {
        type: 'status_change',
        from_status: 'applied',
        to_status: 'rejected',
        actor_id: softLeadId,
      },
    ]);
  });

  it('writes nothing when an update does not change the status', async () => {
    // Otherwise editing any other column would litter the history with moves
    // that never happened.
    const { id } = await makeApplication(softPostingId, 'applied');

    const { error } = await softLead
      .from('applications')
      .update({ status: 'applied', interview_at: '2026-09-01T17:00:00.000Z' })
      .eq('id', id);
    expect(error).toBeNull();

    expect(await readEvents(id)).toEqual([]);
  });

  it('still records the move when a service-role script makes it', async () => {
    // No profile behind the service role, so the event is unattributed rather
    // than absent. An anonymous true record beats a missing one.
    const { id } = await makeApplication(softPostingId, 'applied');

    const { error } = await admin
      .from('applications')
      .update({ status: 'waitlisted' })
      .eq('id', id);
    expect(error).toBeNull();

    expect(await readEvents(id)).toEqual([
      {
        type: 'status_change',
        from_status: 'applied',
        to_status: 'waitlisted',
        actor_id: null,
      },
    ]);
  });
});

describe('a caller with no session', () => {
  it('is refused before the query runs', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    currentClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { id } = await makeApplication(softPostingId, 'applied');
    const result = await moveApplication(id, 'reviewing', 'test-move-soft');

    expect(result.ok).toBe(false);
    expect((await readApplication(id)).status).toBe('applied');
  });
});
