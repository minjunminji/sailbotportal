/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, signedInAs } from '@/test/supabase-helpers';

/**
 * The resume route, against real storage and real RLS.
 *
 * The route builds its client from the request's cookies, which do not exist in
 * a Jest worker, so `createClient` is the one thing mocked. Everything the
 * tests are about stays real: the private bucket, the object in it, the RLS
 * policy that decides who may see the application, and Supabase's own signing.
 *
 * The negative cases assert the caller was refused AND that the object really
 * exists and really is reachable for someone allowed to see it. Without the
 * second half, a route that was simply broken would pass every one of them.
 */

let currentClient: SupabaseClient;

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => currentClient),
}));

import { GET } from '../[id]/route';

const admin = adminClient();

const FIXTURE_TEAM_SLUGS = ['test-resume-soft', 'test-resume-mech'];
const FIXTURE_POSTING_SLUGS = ['test-resume-soft-2026', 'test-resume-mech-2026'];
const USER_DOMAIN = '@resumetest.dev';
const BUCKET = 'resumes';

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechPostingId: string;
let softLead: SupabaseClient;
let adminUser: SupabaseClient;
let anon: SupabaseClient;

let withResumeId: string;
let withoutResumeId: string;
let mechApplicationId: string;

const resumePath = `test-resume/${crypto.randomUUID()}.pdf`;
const mechResumePath = `test-resume/${crypto.randomUUID()}.pdf`;
/** A real, if minimal, PDF — the bytes matter to nothing here but honesty. */
const PDF_BYTES = Buffer.from('%PDF-1.4\n%test fixture\n');

function request(url = 'http://localhost/api/resume/x') {
  return new Request(url);
}
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function clearFixtures() {
  const { data: teams, error: readError } = await admin
    .from('teams')
    .select('id')
    .in('slug', FIXTURE_TEAM_SLUGS);
  if (readError) throw readError;

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

  await admin.storage.from(BUCKET).remove([resumePath, mechResumePath]);
}

function testEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${USER_DOMAIN}`;
}

async function makeApplication(postingId: string, path: string | null, name: string) {
  const { data, error } = await admin
    .from('applications')
    .insert({
      posting_id: postingId,
      submission_id: crypto.randomUUID(),
      applicant_name: name,
      applicant_email: `resume_${crypto.randomUUID()}@resumetest.dev`,
      year_of_study: '2',
      home_department: 'CPSC',
      ranked_subteams: [],
      answers: {},
      question_schema_snapshot: [],
      resume_path: path,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data!.id;
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Resume Software', slug: 'test-resume-soft' },
      { name: 'Test Resume Mechanical', slug: 'test-resume-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((t) => t.slug === 'test-resume-soft')!.id;
  mechTeamId = teams!.find((t) => t.slug === 'test-resume-mech')!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Resume Software',
        slug: 'test-resume-soft-2026',
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Resume Mechanical',
        slug: 'test-resume-mech-2026',
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((p) => p.slug === 'test-resume-soft-2026')!.id;
  mechPostingId = postings!.find((p) => p.slug === 'test-resume-mech-2026')!.id;

  for (const path of [resumePath, mechResumePath]) {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, PDF_BYTES, { contentType: 'application/pdf', upsert: true });
    if (error) throw error;
  }

  withResumeId = await makeApplication(softPostingId, resumePath, 'Rosa Vidal');
  withoutResumeId = await makeApplication(softPostingId, null, 'Noah Pike');
  mechApplicationId = await makeApplication(mechPostingId, mechResumePath, 'Mia Novak');

  softLead = await signedInAs({
    email: testEmail('resume-soft-lead'),
    role: 'lead',
    teamId: softTeamId,
  });
  adminUser = await signedInAs({ email: testEmail('resume-admin'), role: 'admin' });
  anon = (await import('@/test/supabase-helpers')).anonClient();
});

afterAll(clearFixtures);

describe('a lead with a right to the application', () => {
  beforeEach(() => {
    currentClient = softLead;
  });

  it('is redirected to a signed URL that actually serves the file', async () => {
    const response = await GET(request(), context(withResumeId));

    expect(response.status).toBe(307);
    const location = response.headers.get('location')!;
    expect(location).toContain('/storage/v1/object/sign/');
    expect(location).toContain('token=');

    // The signed URL is not merely well-formed: it fetches the bytes.
    const fetched = await fetch(location);
    expect(fetched.status).toBe(200);
    expect(
      Buffer.from(await fetched.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('signs a short-lived URL rather than an open-ended one', async () => {
    const response = await GET(request(), context(withResumeId));
    const location = new URL(response.headers.get('location')!);

    // The expiry is inside the JWT the token carries.
    const token = location.searchParams.get('token')!;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    const lifetime = claims.exp - claims.iat;
    expect(lifetime).toBeLessThanOrEqual(600);
    expect(lifetime).toBeGreaterThan(0);
  });

  it('asks the browser to save it when download is requested', async () => {
    const response = await GET(
      request('http://localhost/api/resume/x?download'),
      context(withResumeId),
    );
    // Read as a parameter rather than as a substring: the value is
    // form-encoded, so its spaces are `+` and `decodeURIComponent` leaves them.
    const location = new URL(response.headers.get('location')!);
    // Named for the applicant, not for the UUID the object is stored under.
    expect(location.searchParams.get('download')).toBe('Rosa Vidal resume.pdf');
  });

  it('404s for an application with no resume attached', async () => {
    const response = await GET(request(), context(withoutResumeId));
    expect(response.status).toBe(404);
  });
});

describe('a lead reaching for another team', () => {
  beforeEach(() => {
    currentClient = softLead;
  });

  it('cannot get a signed URL for a Mechanical applicant', async () => {
    const response = await GET(request(), context(mechApplicationId));
    expect(response.status).toBe(404);

    // The object is really there and really is servable — so the refusal came
    // from RLS, not from a broken route or a missing fixture.
    currentClient = adminUser;
    const asAdmin = await GET(request(), context(mechApplicationId));
    expect(asAdmin.status).toBe(307);
    const fetched = await fetch(asAdmin.headers.get('location')!);
    expect(fetched.status).toBe(200);
  });

  it('answers the same way for an id that does not exist', async () => {
    const response = await GET(request(), context(crypto.randomUUID()));
    expect(response.status).toBe(404);
  });
});

describe('a caller with no session', () => {
  it('is refused before anything is signed', async () => {
    currentClient = anon;
    const response = await GET(request(), context(withResumeId));
    expect(response.status).toBe(404);
  });
});

describe('the bucket itself', () => {
  it('is still private, so a path alone is worth nothing', async () => {
    const { data } = await admin.storage.from(BUCKET).getPublicUrl(resumePath);
    const fetched = await fetch(data.publicUrl);
    expect(fetched.status).toBe(400);
  });

  it('is not listable by an authenticated lead', async () => {
    // No storage policies exist for `authenticated`, which is what makes the
    // route's service-role signing the only way in.
    const { data, error } = await softLead.storage.from(BUCKET).list('test-resume');
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});
