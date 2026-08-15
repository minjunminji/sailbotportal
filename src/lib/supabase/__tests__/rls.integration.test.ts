/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, anonClient, signedInAs } from '@/test/supabase-helpers';

const admin = adminClient();

// A denied read and a failed query both yield zero rows. Every negative
// assertion below therefore checks three things: the query itself succeeded
// (error is null), the caller saw nothing, and — via the service role, which
// bypasses RLS — the thing they could not see actually exists. Without the
// third check these tests would pass against an empty database.

const NOTE_BODY = 'Original note body';

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let softDraftPostingId: string;
let mechPostingId: string;
let mechApplicationId: string;
let softApplicationId: string;
let softLead: SupabaseClient;
let softLeadId: string;
let mechLeadId: string;
let softNoteId: string;
let softEventId: string;
let mechNoteId: string;
let mechEventId: string;

/**
 * Fixture teams are namespaced so they cannot collide with the reference data
 * (mech/elec/soft) installed by the reference_data migration.
 *
 * A blanket `.delete().neq('id', NIL_UUID)` would wipe that reference data and
 * leave the local database unusable for app development until the next
 * `db reset` — the tests would still pass, which is what makes it dangerous.
 */
const FIXTURE_TEAM_SLUGS = ['test-soft', 'test-mech', 'test-elec'];

/**
 * Same reasoning for postings. A developer's local database also holds whatever
 * postings they created to look at the site, so every assertion below filters
 * to these rather than counting the table.
 */
const FIXTURE_POSTING_SLUGS = ['soft-2026', 'soft-2027', 'mech-2026'];

/** Fixtures use fixed slugs, so clear any leftovers first and keep runs repeatable. */
async function clearFixtures() {
  const { data: teams, error: teamsReadError } = await admin
    .from('teams')
    .select('id')
    .in('slug', FIXTURE_TEAM_SLUGS);
  if (teamsReadError) throw teamsReadError;

  const teamIds = (teams ?? []).map((t) => t.id);

  // Order matters. postings.team_id is ON DELETE RESTRICT, so postings go before
  // teams; applications, notes, and events all cascade from postings. And
  // profiles.team_id references teams, so users go before the teams do.
  if (teamIds.length > 0) {
    const { error } = await admin.from('postings').delete().in('team_id', teamIds);
    if (error) throw error;
  }

  const { data: users, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  for (const user of users?.users ?? []) {
    if (!user.email?.endsWith('@test.dev')) continue;
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
  }

  const { error: teamsError } = await admin.from('teams').delete().in('slug', FIXTURE_TEAM_SLUGS);
  if (teamsError) throw teamsError;
}

/** Unique per call, so concurrent signups inside one millisecond cannot collide. */
function testEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Software', slug: 'test-soft' },
      { name: 'Test Mechanical', slug: 'test-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((t) => t.slug === 'test-soft')!.id;
  mechTeamId = teams!.find((t) => t.slug === 'test-mech')!.id;

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      { team_id: softTeamId, title: 'Software', slug: 'soft-2026', status: 'open' },
      { team_id: softTeamId, title: 'Software Next', slug: 'soft-2027', status: 'draft' },
      { team_id: mechTeamId, title: 'Mechanical', slug: 'mech-2026', status: 'draft' },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((p) => p.slug === 'soft-2026')!.id;
  softDraftPostingId = postings!.find((p) => p.slug === 'soft-2027')!.id;
  mechPostingId = postings!.find((p) => p.slug === 'mech-2026')!.id;

  const { data: apps, error: appsError } = await admin
    .from('applications')
    .insert([
      {
        posting_id: mechPostingId,
        submission_id: crypto.randomUUID(),
        applicant_name: 'Mech Applicant',
        applicant_email: 'mech@student.ubc.ca',
        year_of_study: '3',
        home_department: 'MECH',
        question_schema_snapshot: [],
      },
      {
        posting_id: softPostingId,
        submission_id: crypto.randomUUID(),
        applicant_name: 'Soft Applicant',
        applicant_email: 'soft@student.ubc.ca',
        year_of_study: '2',
        home_department: 'CPSC',
        question_schema_snapshot: [],
      },
    ])
    .select();
  if (appsError) throw appsError;
  mechApplicationId = apps!.find((a) => a.posting_id === mechPostingId)!.id;
  softApplicationId = apps!.find((a) => a.posting_id === softPostingId)!.id;

  softLead = await signedInAs({
    email: testEmail('soft-lead-shared'),
    role: 'lead',
    teamId: softTeamId,
  });
  softLeadId = (await softLead.auth.getUser()).data.user!.id;

  const mechLead = await signedInAs({
    email: testEmail('mech-lead-shared'),
    role: 'lead',
    teamId: mechTeamId,
  });
  mechLeadId = (await mechLead.auth.getUser()).data.user!.id;

  const { data: note, error: noteError } = await admin
    .from('application_notes')
    .insert({ application_id: softApplicationId, author_id: softLeadId, body: NOTE_BODY })
    .select()
    .single();
  if (noteError) throw noteError;
  softNoteId = note!.id;

  const { data: event, error: eventError } = await admin
    .from('application_events')
    .insert({
      application_id: softApplicationId,
      actor_id: softLeadId,
      type: 'status_changed',
      from_status: 'applied',
      to_status: 'reviewing',
    })
    .select()
    .single();
  if (eventError) throw eventError;
  softEventId = event!.id;

  // Cross-team rows, so the notes and events read policies have something they
  // are required to hide. Without these, `using (true)` would pass every test.
  const { data: mechNote, error: mechNoteError } = await admin
    .from('application_notes')
    .insert({ application_id: mechApplicationId, author_id: mechLeadId, body: 'Mech-only note' })
    .select()
    .single();
  if (mechNoteError) throw mechNoteError;
  mechNoteId = mechNote!.id;

  const { data: mechEvent, error: mechEventError } = await admin
    .from('application_events')
    .insert({ application_id: mechApplicationId, actor_id: mechLeadId, type: 'created' })
    .select()
    .single();
  if (mechEventError) throw mechEventError;
  mechEventId = mechEvent!.id;
});

describe('anonymous access', () => {
  it('can read open postings', async () => {
    const { data, error } = await anonClient().from('postings').select().eq('status', 'open');
    expect(error).toBeNull();
    const fixtures = data!.filter((p) => FIXTURE_POSTING_SLUGS.includes(p.slug));
    expect(fixtures.map((p) => p.slug)).toEqual(['soft-2026']);
  });

  it('can read teams, subteams and core questions', async () => {
    const anon = anonClient();
    const teams = await anon.from('teams').select();
    expect(teams.error).toBeNull();
    // The reference_data migration installs mech/elec/soft alongside these
    // fixtures, so assert visibility rather than an exact global count.
    expect(teams.data!.map((t) => t.slug)).toEqual(
      expect.arrayContaining(['test-soft', 'test-mech']),
    );

    const subteams = await anon.from('subteams').select();
    expect(subteams.error).toBeNull();

    const coreQuestions = await anon.from('core_questions').select();
    expect(coreQuestions.error).toBeNull();
  });

  it('cannot read draft postings', async () => {
    const { data, error } = await anonClient().from('postings').select().eq('status', 'draft');
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // The drafts the anon caller could not see are really there.
    const seen = await admin.from('postings').select().eq('status', 'draft');
    expect(seen.data!.map((p) => p.slug)).toEqual(
      expect.arrayContaining(['soft-2027', 'mech-2026']),
    );
  });

  it('cannot read applications at all', async () => {
    const { data, error } = await anonClient().from('applications').select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const seen = await admin.from('applications').select();
    expect(seen.data!.length).toBe(2);
  });

  it('cannot read profiles', async () => {
    const { data, error } = await anonClient().from('profiles').select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const seen = await admin.from('profiles').select();
    expect(seen.data!.length).toBeGreaterThan(0);
  });

  it('cannot insert an application directly', async () => {
    const { error } = await anonClient().from('applications').insert({
      posting_id: softPostingId,
      submission_id: crypto.randomUUID(),
      applicant_name: 'Sneaky',
      applicant_email: 'sneaky@example.com',
      year_of_study: '1',
      home_department: 'CPSC',
      question_schema_snapshot: [],
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501'); // insufficient_privilege, not a schema mistake

    const written = await admin
      .from('applications')
      .select()
      .eq('applicant_email', 'sneaky@example.com');
    expect(written.data).toHaveLength(0);
  });

  it('cannot insert a team', async () => {
    const { error } = await anonClient().from('teams').insert({ name: 'Fake', slug: 'fake' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});

describe('lead access', () => {
  it('reads its own team applications', async () => {
    const { data, error } = await softLead.from('applications').select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(softApplicationId);
  });

  it('cannot read another team applications', async () => {
    const lead = await signedInAs({
      email: testEmail('soft-lead'),
      role: 'lead',
      teamId: softTeamId,
    });
    const { data, error } = await lead.from('applications').select().eq('id', mechApplicationId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    // The mech application exists; the lead simply cannot see it.
    const seen = await admin.from('applications').select().eq('id', mechApplicationId);
    expect(seen.data).toHaveLength(1);
  });

  it('cannot update another team applications', async () => {
    const { data, error } = await softLead
      .from('applications')
      .update({ status: 'rejected' })
      .eq('id', mechApplicationId)
      .select();
    expect(data ?? []).toHaveLength(0);

    const after = await admin
      .from('applications')
      .select('status')
      .eq('id', mechApplicationId)
      .single();
    expect(after.data!.status).toBe('applied');
    if (error) expect(error.code).toBe('42501');
  });

  it('cannot move its own application onto another team posting', async () => {
    // Re-homing a row the lead *can* see onto another team's posting. Postgres
    // refuses because the resulting row would fall outside this lead's visible
    // set; the update policy's WITH CHECK backs up the same boundary. Verified
    // to hold at raw SQL level too, not just through PostgREST.
    const { error } = await softLead
      .from('applications')
      .update({ posting_id: mechPostingId })
      .eq('id', softApplicationId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');

    const after = await admin
      .from('applications')
      .select('posting_id')
      .eq('id', softApplicationId)
      .single();
    expect(after.data!.posting_id).toBe(softPostingId);
  });

  it('can update its own team applications', async () => {
    const { data, error } = await softLead
      .from('applications')
      .update({ status: 'reviewing' })
      .eq('id', softApplicationId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].status).toBe('reviewing');
  });

  it('cannot edit another team posting', async () => {
    const lead = await signedInAs({
      email: testEmail('soft-lead2'),
      role: 'lead',
      teamId: softTeamId,
    });
    const { data, error } = await lead
      .from('postings')
      .update({ title: 'Hijacked' })
      .eq('team_id', mechTeamId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const after = await admin.from('postings').select('title').eq('id', mechPostingId).single();
    expect(after.data!.title).toBe('Mechanical');
  });

  it('can edit its own team posting', async () => {
    const { data, error } = await softLead
      .from('postings')
      .update({ description: 'Updated by the soft lead' })
      .eq('id', softPostingId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('can read its own team draft postings but not another team draft', async () => {
    const { data, error } = await softLead.from('postings').select();
    expect(error).toBeNull();
    const ids = data!.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([softPostingId, softDraftPostingId]));
    expect(ids).not.toContain(mechPostingId);
  });
});

describe('application notes and events are append-only', () => {
  it('lead can read and insert notes on its own team applications', async () => {
    const { data: read, error: readError } = await softLead.from('application_notes').select();
    expect(readError).toBeNull();
    expect(read!.map((n) => n.id)).toContain(softNoteId);
    expect(read!.map((n) => n.id)).not.toContain(mechNoteId);

    const { data, error } = await softLead
      .from('application_notes')
      .insert({ application_id: softApplicationId, author_id: softLeadId, body: 'A new note' })
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('lead cannot read another team notes or events', async () => {
    const notes = await softLead.from('application_notes').select().eq('id', mechNoteId);
    expect(notes.error).toBeNull();
    expect(notes.data).toHaveLength(0);

    const events = await softLead.from('application_events').select().eq('id', mechEventId);
    expect(events.error).toBeNull();
    expect(events.data).toHaveLength(0);

    // Both rows exist; the lead is simply not allowed to see them.
    const seenNote = await admin.from('application_notes').select().eq('id', mechNoteId);
    expect(seenNote.data).toHaveLength(1);
    const seenEvent = await admin.from('application_events').select().eq('id', mechEventId);
    expect(seenEvent.data).toHaveLength(1);
  });

  it('lead reads its own team events', async () => {
    const { data, error } = await softLead.from('application_events').select();
    expect(error).toBeNull();
    expect(data!.map((e) => e.id)).toContain(softEventId);
    expect(data!.map((e) => e.id)).not.toContain(mechEventId);
  });

  it('lead can insert an event on its own team application but not another team', async () => {
    const own = await softLead
      .from('application_events')
      .insert({ application_id: softApplicationId, type: 'note_added' })
      .select();
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);

    const cross = await softLead
      .from('application_events')
      .insert({ application_id: mechApplicationId, type: 'note_added' });
    expect(cross.error).not.toBeNull();
    expect(cross.error!.code).toBe('42501');
  });

  it('lead cannot insert a note on another team application', async () => {
    const { error } = await softLead
      .from('application_notes')
      .insert({ application_id: mechApplicationId, author_id: softLeadId, body: 'Cross-team' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('lead cannot insert a note attributed to someone else', async () => {
    // mechLeadId is a real profile row, so a failure here is the RLS check
    // author_id = auth.uid(), not a foreign key violation.
    const { error } = await softLead
      .from('application_notes')
      .insert({ application_id: softApplicationId, author_id: mechLeadId, body: 'Impersonation' });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('lead cannot update a note', async () => {
    const { data, error } = await softLead
      .from('application_notes')
      .update({ body: 'Edited after the fact' })
      .eq('id', softNoteId)
      .select();
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.code).toBe('42501');

    const after = await admin
      .from('application_notes')
      .select('body')
      .eq('id', softNoteId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data!.body).toBe(NOTE_BODY);
  });

  it('lead cannot delete a note', async () => {
    const { data, error } = await softLead
      .from('application_notes')
      .delete()
      .eq('id', softNoteId)
      .select();
    expect(data ?? []).toHaveLength(0);
    if (error) expect(error.code).toBe('42501');

    const after = await admin.from('application_notes').select().eq('id', softNoteId);
    expect(after.data).toHaveLength(1);
  });

  it('lead cannot update or delete an event', async () => {
    const updated = await softLead
      .from('application_events')
      .update({ to_status: 'offered' })
      .eq('id', softEventId)
      .select();
    expect(updated.data ?? []).toHaveLength(0);

    const deleted = await softLead
      .from('application_events')
      .delete()
      .eq('id', softEventId)
      .select();
    expect(deleted.data ?? []).toHaveLength(0);

    const after = await admin
      .from('application_events')
      .select('to_status')
      .eq('id', softEventId)
      .single();
    expect(after.error).toBeNull();
    expect(after.data!.to_status).toBe('reviewing');
  });

  it('admin cannot update or delete a note either', async () => {
    const adminUser = await signedInAs({ email: testEmail('admin-notes'), role: 'admin' });

    const updated = await adminUser
      .from('application_notes')
      .update({ body: 'Admin edit' })
      .eq('id', softNoteId)
      .select();
    expect(updated.data ?? []).toHaveLength(0);

    const deleted = await adminUser
      .from('application_notes')
      .delete()
      .eq('id', softNoteId)
      .select();
    expect(deleted.data ?? []).toHaveLength(0);

    const after = await admin
      .from('application_notes')
      .select('body')
      .eq('id', softNoteId)
      .single();
    expect(after.data!.body).toBe(NOTE_BODY);
  });
});

describe('admin access', () => {
  it('reads every team applications', async () => {
    const adminUser = await signedInAs({ email: testEmail('admin'), role: 'admin' });
    const { data, error } = await adminUser.from('applications').select();
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.map((a) => a.id)).toEqual(
      expect.arrayContaining([softApplicationId, mechApplicationId]),
    );
  });

  it('reads draft postings and writes teams', async () => {
    const adminUser = await signedInAs({ email: testEmail('admin2'), role: 'admin' });

    const postings = await adminUser.from('postings').select();
    expect(postings.error).toBeNull();
    expect(postings.data!.map((p) => p.slug)).toEqual(
      expect.arrayContaining(FIXTURE_POSTING_SLUGS),
    );

    const inserted = await adminUser
      .from('teams')
      .insert({ name: 'Test Electrical', slug: 'test-elec' })
      .select();
    expect(inserted.error).toBeNull();
    expect(inserted.data).toHaveLength(1);
    await admin.from('teams').delete().eq('slug', 'test-elec');
  });
});

describe('profile visibility', () => {
  it('authenticated users read profiles but only update their own', async () => {
    const { data, error } = await softLead.from('profiles').select();
    expect(error).toBeNull(); // a recursive policy would error here
    expect(data!.length).toBeGreaterThan(0);

    const other = data!.find((p) => p.id !== softLeadId);
    if (other) {
      const hijack = await softLead
        .from('profiles')
        .update({ role: 'admin' })
        .eq('id', other.id)
        .select();
      expect(hijack.data ?? []).toHaveLength(0);
    }

    const own = await softLead
      .from('profiles')
      .update({ name: 'Soft Lead' })
      .eq('id', softLeadId)
      .select();
    expect(own.error).toBeNull();
    expect(own.data).toHaveLength(1);
  });
});
