/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, signedInAs } from '@/test/supabase-helpers';

/**
 * Opening and closing a posting, against a real database.
 *
 * This is the one operation that decides whether the portal is accepting
 * applications at all, so the negative cases assert the ROW as well as the
 * return value: an action that reported failure after successfully writing
 * would leave applications open while telling a lead they were closed, and a
 * test that only read the return value would pass against exactly that bug.
 *
 * `createClient` is mocked because it builds from request cookies that do not
 * exist in a Jest worker. Everything the test is about stays real — RLS decides
 * whose posting can be touched, and the check constraint decides which statuses
 * exist.
 */

let currentClient: SupabaseClient;

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => currentClient),
}));

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

// The public postings list is cached, so closing a posting has to evict it.
// FredDB is not configured in tests; this is mocked to observe the call.
// Recorded in an array rather than a jest.fn: the keys evicted are the whole
// assertion, and a plain list says that more directly than call arguments do.
// The `mock` prefix is required for jest to allow the reference from inside the
// factory below.
const mockInvalidated: string[] = [];
jest.mock('@/lib/cache', () => ({
  invalidate: async (key: string) => {
    mockInvalidated.push(key);
  },
  cacheKeys: { openPostings: () => 'posting:list:open', posting: (s: string) => `posting:${s}` },
}));

import { setPostingStatus } from '../set-posting-status';

const admin = adminClient();

const FIXTURE_TEAM_SLUGS = ['test-status-soft', 'test-status-mech'];
const FIXTURE_POSTING_SLUGS = ['test-status-soft-2026', 'test-status-mech-2026'];
/** Its own domain: sibling suites delete users by domain during cleanup. */
const USER_DOMAIN = '@statustest.dev';

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechPostingId: string;
let softLead: SupabaseClient;
let adminUser: SupabaseClient;

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

async function readStatus(postingId: string): Promise<string> {
  const { data, error } = await admin
    .from('postings')
    .select('status')
    .eq('id', postingId)
    .single();
  if (error) throw error;
  return data!.status;
}

async function setStatus(postingId: string, status: string) {
  const { error } = await admin.from('postings').update({ status }).eq('id', postingId);
  if (error) throw error;
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Status Software', slug: 'test-status-soft' },
      { name: 'Test Status Mechanical', slug: 'test-status-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((team) => team.slug === 'test-status-soft')!.id;
  mechTeamId = teams!.find((team) => team.slug === 'test-status-mech')!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Status Software',
        slug: 'test-status-soft-2026',
        status: 'draft',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Status Mechanical',
        slug: 'test-status-mech-2026',
        status: 'draft',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((p) => p.slug === 'test-status-soft-2026')!.id;
  mechPostingId = postings!.find((p) => p.slug === 'test-status-mech-2026')!.id;

  softLead = await signedInAs({
    email: testEmail('soft-lead'),
    role: 'lead',
    teamId: softTeamId,
  });
  adminUser = await signedInAs({ email: testEmail('hiring-admin'), role: 'admin' });
});

afterAll(async () => {
  await clearFixtures();
});

beforeEach(async () => {
  mockInvalidated.length = 0;
  await setStatus(softPostingId, 'draft');
  await setStatus(mechPostingId, 'draft');
});

describe('a lead', () => {
  it('opens their own team posting', async () => {
    currentClient = softLead;

    const result = await setPostingStatus(softPostingId, 'open');

    expect(result).toEqual({ ok: true });
    expect(await readStatus(softPostingId)).toBe('open');
  });

  it('closes their own team posting', async () => {
    await setStatus(softPostingId, 'open');
    currentClient = softLead;

    const result = await setPostingStatus(softPostingId, 'closed');

    expect(result).toEqual({ ok: true });
    expect(await readStatus(softPostingId)).toBe('closed');
  });

  it('cannot touch another team posting, and does not', async () => {
    currentClient = softLead;

    const result = await setPostingStatus(mechPostingId, 'open');

    expect(result.ok).toBe(false);
    // The row is what matters. A failure reported after a successful write
    // would be the worst possible outcome here.
    expect(await readStatus(mechPostingId)).toBe('draft');
  });

  it('is told nothing about whether another team posting exists', async () => {
    currentClient = softLead;

    const missing = await setPostingStatus(crypto.randomUUID(), 'open');
    const theirs = await setPostingStatus(mechPostingId, 'open');

    // Identical messages: distinguishing them would confirm an id exists to
    // someone who is not allowed to see it.
    expect(missing).toEqual(theirs);
  });
});

describe('an admin', () => {
  it('opens any team posting', async () => {
    currentClient = adminUser;

    const result = await setPostingStatus(mechPostingId, 'open');

    expect(result).toEqual({ ok: true });
    expect(await readStatus(mechPostingId)).toBe('open');
  });
});

describe('the status itself', () => {
  it('accepts all three real statuses', async () => {
    currentClient = softLead;

    for (const status of ['open', 'closed', 'draft']) {
      expect(await setPostingStatus(softPostingId, status)).toEqual({ ok: true });
      expect(await readStatus(softPostingId)).toBe(status);
    }
  });

  it('refuses a status that is not one of the three, without writing', async () => {
    currentClient = softLead;

    const result = await setPostingStatus(softPostingId, 'archived');

    expect(result.ok).toBe(false);
    expect(await readStatus(softPostingId)).toBe('draft');
  });

  it('refuses a status even when it is a valid APPLICATION status', async () => {
    // The two vocabularies are unrelated, and 'rejected' being meaningful
    // elsewhere in this codebase is exactly why it is worth pinning down.
    currentClient = softLead;

    const result = await setPostingStatus(softPostingId, 'rejected');

    expect(result.ok).toBe(false);
    expect(await readStatus(softPostingId)).toBe('draft');
  });
});

describe('the public postings cache', () => {
  it('is evicted when a posting opens', async () => {
    currentClient = softLead;

    await setPostingStatus(softPostingId, 'open');

    expect(mockInvalidated).toContain('posting:list:open');
  });

  it('is evicted when a posting closes', async () => {
    // The important direction. Without this the landing page can keep
    // advertising a closed posting, and /apply keeps accepting it, for as long
    // as the entry lives.
    await setStatus(softPostingId, 'open');
    currentClient = softLead;

    await setPostingStatus(softPostingId, 'closed');

    expect(mockInvalidated).toContain('posting:list:open');
  });

  it('is left alone when the write was refused', async () => {
    currentClient = softLead;

    await setPostingStatus(mechPostingId, 'open');

    expect(mockInvalidated).toEqual([]);
  });
});
