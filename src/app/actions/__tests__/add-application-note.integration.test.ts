/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, signedInAs } from '@/test/supabase-helpers';

let currentClient: SupabaseClient;

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => currentClient),
}));

import { addApplicationNote } from '../add-application-note';
import { getApplicationNotes } from '@/lib/applications/notes';

const admin = adminClient();
const TEAM_SLUGS = ['test-notes-soft', 'test-notes-mech'];
const POSTING_SLUGS = ['test-notes-soft-2026', 'test-notes-mech-2026'];
const USER_DOMAIN = '@notestest.dev';

let softPostingId: string;
let mechPostingId: string;
let softApplicationId: string;
let mechApplicationId: string;
let softLead: SupabaseClient;
let softLeadId: string;

async function clearFixtures() {
  const { data: teams, error: teamsReadError } = await admin
    .from('teams')
    .select('id')
    .in('slug', TEAM_SLUGS);
  if (teamsReadError) throw teamsReadError;

  const { error: postingError } = await admin.from('postings').delete().in('slug', POSTING_SLUGS);
  if (postingError) throw postingError;

  const teamIds = (teams ?? []).map((team) => team.id);
  if (teamIds.length > 0) {
    const { error } = await admin.from('postings').delete().in('team_id', teamIds);
    if (error) throw error;
  }

  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw usersError;
  for (const user of users?.users ?? []) {
    if (user.email?.endsWith(USER_DOMAIN)) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw error;
    }
  }

  const { error: teamsError } = await admin.from('teams').delete().in('slug', TEAM_SLUGS);
  if (teamsError) throw teamsError;
}

async function makeApplication(postingId: string, email: string): Promise<string> {
  const { data, error } = await admin
    .from('applications')
    .insert({
      posting_id: postingId,
      submission_id: crypto.randomUUID(),
      applicant_name: 'Notes Applicant',
      applicant_email: email,
      year_of_study: '3',
      faculty: 'Science',
      home_department: 'CPSC',
      ranked_subteams: [],
      question_schema_snapshot: [],
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
      { name: 'Test Notes Software', slug: TEAM_SLUGS[0] },
      { name: 'Test Notes Mechanical', slug: TEAM_SLUGS[1] },
    ])
    .select('id, slug');
  if (teamsError) throw teamsError;
  const softTeamId = teams!.find((team) => team.slug === TEAM_SLUGS[0])!.id;
  const mechTeamId = teams!.find((team) => team.slug === TEAM_SLUGS[1])!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Notes Software',
        slug: POSTING_SLUGS[0],
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Notes Mechanical',
        slug: POSTING_SLUGS[1],
        status: 'open',
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select('id, slug');
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((posting) => posting.slug === POSTING_SLUGS[0])!.id;
  mechPostingId = postings!.find((posting) => posting.slug === POSTING_SLUGS[1])!.id;

  softLead = await signedInAs({
    email: `soft-lead-${Date.now()}${USER_DOMAIN}`,
    role: 'lead',
    teamId: softTeamId,
  });
  softLeadId = (await softLead.auth.getUser()).data.user!.id;
  const { error: profileError } = await admin
    .from('profiles')
    .update({ name: 'Avery Lead' })
    .eq('id', softLeadId);
  if (profileError) throw profileError;

  softApplicationId = await makeApplication(softPostingId, 'soft_notes@notestest.dev');
  mechApplicationId = await makeApplication(mechPostingId, 'mech_notes@notestest.dev');
});

afterAll(clearFixtures);

it('adds an attributed note to an accessible application', async () => {
  currentClient = softLead;

  const result = await addApplicationNote(softApplicationId, '  Strong systems answer.  ');

  expect(result).toMatchObject({
    ok: true,
    note: {
      applicationId: softApplicationId,
      authorName: 'Avery Lead',
      body: 'Strong systems answer.',
    },
  });
  expect(await getApplicationNotes(softApplicationId, softLead)).toHaveLength(1);
});

it('does not add a note to another team application', async () => {
  currentClient = softLead;

  const result = await addApplicationNote(mechApplicationId, 'Should not be visible');

  expect(result).toEqual({ ok: false, error: 'Could not add this note. Try again.' });
  const { count, error } = await admin
    .from('application_notes')
    .select('id', { count: 'exact', head: true })
    .eq('application_id', mechApplicationId);
  expect(error).toBeNull();
  expect(count).toBe(0);
});

it('reads attributed notes in chronological order', async () => {
  const applicationId = await makeApplication(
    softPostingId,
    `chronology_${crypto.randomUUID()}@notestest.dev`,
  );
  const { error } = await admin.from('application_notes').insert([
    {
      application_id: applicationId,
      author_id: softLeadId,
      body: 'Later note',
      created_at: '2026-08-16T12:00:00.000Z',
    },
    {
      application_id: applicationId,
      author_id: softLeadId,
      body: 'Earlier note',
      created_at: '2026-08-15T12:00:00.000Z',
    },
  ]);
  if (error) throw error;

  const notes = await getApplicationNotes(applicationId, softLead);

  expect(notes.map((note) => note.body)).toEqual(['Earlier note', 'Later note']);
  expect(notes.every((note) => note.authorName === 'Avery Lead')).toBe(true);
});
