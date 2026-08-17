/**
 * @jest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, signedInAs } from '@/test/supabase-helpers';
import { getApplicationDetail } from '../detail';

/**
 * The application detail read, against a real database.
 *
 * THE POINT OF THIS SUITE is the pair of tests under "the snapshot is frozen".
 * `question_schema_snapshot` exists so that editing a posting mid-cycle cannot
 * rewrite the history of applications already submitted, and a detail view that
 * read `postings.question_schema` instead would pass every other test in this
 * file — the two columns are identical until somebody edits the posting.
 */

const admin = adminClient();

const FIXTURE_TEAM_SLUGS = ['test-detail-soft', 'test-detail-mech'];
const FIXTURE_POSTING_SLUGS = ['test-detail-soft-2026', 'test-detail-mech-2026'];
const USER_DOMAIN = '@detailtest.dev';

let softTeamId: string;
let mechTeamId: string;
let softPostingId: string;
let mechPostingId: string;
let subteams: Record<string, string> = {};
let softLead: SupabaseClient;
let adminUser: SupabaseClient;

let applicationId: string;
let mechApplicationId: string;
const submissionId = crypto.randomUUID();

/** What the posting asked at the moment of submission. */
const ORIGINAL_QUESTIONS = [
  {
    id: 'why_sailbot',
    type: 'long_text',
    label: 'Why do you want to join Sailbot?',
    required: true,
    config: { maxLength: 2000 },
  },
  {
    id: 'skills',
    type: 'matrix',
    label: 'What relevant technical skills do you have?',
    required: false,
    config: {
      rows: ['Python', 'C++', 'Sailing'],
      columns: ['I have this skill', 'I want to learn this skill'],
      mode: 'multi',
    },
  },
  {
    id: 'github_url',
    type: 'short_text',
    label: 'Paste your repository URL',
    required: false,
    config: { format: 'url' },
  },
];

/** What a lead changes the posting to, three weeks later. */
const REVISED_QUESTIONS = [
  {
    id: 'why_sailbot',
    type: 'long_text',
    // Reworded.
    label: 'Tell us why Sailbot interests you.',
    required: true,
    config: { maxLength: 2000 },
  },
  {
    // Brand new, and never asked of the application below.
    id: 'availability',
    type: 'select',
    label: 'Are you available on Saturdays?',
    required: true,
    config: { options: ['Yes', 'No'] },
  },
];

const ANSWERS = {
  why_sailbot: 'I have wanted to build an autonomous boat since I was fifteen.',
  skills: { Python: ['I have this skill'], Sailing: ['I want to learn this skill'] },
  github_url: 'https://github.com/example/quiz',
};

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
}

function testEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${USER_DOMAIN}`;
}

beforeAll(async () => {
  await clearFixtures();

  const { data: teams, error: teamsError } = await admin
    .from('teams')
    .insert([
      { name: 'Test Detail Software', slug: 'test-detail-soft' },
      { name: 'Test Detail Mechanical', slug: 'test-detail-mech' },
    ])
    .select();
  if (teamsError) throw teamsError;
  softTeamId = teams!.find((t) => t.slug === 'test-detail-soft')!.id;
  mechTeamId = teams!.find((t) => t.slug === 'test-detail-mech')!.id;

  const { data: subteamRows, error: subteamsError } = await admin
    .from('subteams')
    .insert([
      {
        team_id: softTeamId,
        name: 'Detail Pathfinding',
        code: 'PATH',
        slug: 'test-detail-path',
        position: 0,
      },
      {
        team_id: softTeamId,
        name: 'Detail Network',
        code: 'NET',
        slug: 'test-detail-net',
        position: 1,
      },
      {
        team_id: softTeamId,
        name: 'Detail Website',
        code: null,
        slug: 'test-detail-web',
        position: 2,
      },
    ])
    .select();
  if (subteamsError) throw subteamsError;
  subteams = Object.fromEntries((subteamRows ?? []).map((r) => [r.slug, r.id]));

  const { data: postings, error: postingsError } = await admin
    .from('postings')
    .insert([
      {
        team_id: softTeamId,
        title: 'Test Detail Software',
        slug: 'test-detail-soft-2026',
        status: 'open',
        question_schema: ORIGINAL_QUESTIONS,
        subteam_ranking: { enabled: true, maxChoices: 3 },
      },
      {
        team_id: mechTeamId,
        title: 'Test Detail Mechanical',
        slug: 'test-detail-mech-2026',
        status: 'open',
        question_schema: [],
        subteam_ranking: { enabled: false, maxChoices: 3 },
      },
    ])
    .select();
  if (postingsError) throw postingsError;
  softPostingId = postings!.find((p) => p.slug === 'test-detail-soft-2026')!.id;
  mechPostingId = postings!.find((p) => p.slug === 'test-detail-mech-2026')!.id;

  // Two rows from ONE submission: the same person applied to both teams.
  const { data: apps, error: appsError } = await admin
    .from('applications')
    .insert([
      {
        posting_id: softPostingId,
        submission_id: submissionId,
        applicant_name: 'Devon Marsh',
        applicant_email: 'devon_marsh@detailtest.dev',
        year_of_study: '3',
        faculty: 'Science',
        home_department: 'CPSC',
        resume_path: 'resumes/devon.pdf',
        // Second choice first on purpose: the order IS the answer.
        ranked_subteams: [subteams['test-detail-net'], subteams['test-detail-path']],
        answers: ANSWERS,
        question_schema_snapshot: ORIGINAL_QUESTIONS,
        status: 'reviewing',
      },
      {
        posting_id: mechPostingId,
        submission_id: submissionId,
        applicant_name: 'Devon Marsh',
        applicant_email: 'devon_marsh@detailtest.dev',
        year_of_study: '3',
        faculty: 'Science',
        home_department: 'CPSC',
        resume_path: 'resumes/devon.pdf',
        ranked_subteams: [],
        answers: {},
        question_schema_snapshot: [],
        status: 'applied',
      },
    ])
    .select();
  if (appsError) throw appsError;
  applicationId = apps!.find((a) => a.posting_id === softPostingId)!.id;
  mechApplicationId = apps!.find((a) => a.posting_id === mechPostingId)!.id;

  softLead = await signedInAs({
    email: testEmail('detail-soft-lead'),
    role: 'lead',
    teamId: softTeamId,
  });
  adminUser = await signedInAs({ email: testEmail('detail-admin'), role: 'admin' });
});

afterAll(clearFixtures);

describe('the snapshot is frozen', () => {
  it('shows the questions the applicant actually answered', async () => {
    const detail = await getApplicationDetail(applicationId, softLead);
    expect(detail!.questions.map((entry) => (entry.ok ? entry.question.id : 'unreadable'))).toEqual(
      ['why_sailbot', 'skills', 'github_url'],
    );
  });

  it('does not change when the posting is edited underneath it', async () => {
    // THE TEST THIS COLUMN EXISTS FOR. A lead rewords one question and adds
    // another, three weeks into the cycle.
    const { error } = await admin
      .from('postings')
      .update({ question_schema: REVISED_QUESTIONS })
      .eq('id', softPostingId);
    expect(error).toBeNull();

    // The posting really did change, so this is not a test passing because
    // nothing happened.
    const { data: posting } = await admin
      .from('postings')
      .select('question_schema')
      .eq('id', softPostingId)
      .single();
    expect((posting!.question_schema as { id: string }[]).map((q) => q.id)).toEqual([
      'why_sailbot',
      'availability',
    ]);

    const detail = await getApplicationDetail(applicationId, softLead);
    const questions = detail!.questions.flatMap((entry) => (entry.ok ? [entry.question] : []));

    // Still the original three, in the original order.
    expect(questions.map((q) => q.id)).toEqual(['why_sailbot', 'skills', 'github_url']);
    // Still the ORIGINAL wording, not the reworded label.
    expect(questions[0].label).toBe('Why do you want to join Sailbot?');
    // And the question that never existed for this applicant is absent.
    expect(questions.some((q) => q.id === 'availability')).toBe(false);
  });

  it('keeps the answers keyed to the frozen questions', async () => {
    const detail = await getApplicationDetail(applicationId, softLead);
    expect(detail!.answers.why_sailbot).toBe(ANSWERS.why_sailbot);
    expect(detail!.answers.skills).toEqual(ANSWERS.skills);
  });
});

describe('the header facts', () => {
  it('carries the applicant and the posting', async () => {
    const detail = await getApplicationDetail(applicationId, softLead);
    expect(detail).toMatchObject({
      applicantName: 'Devon Marsh',
      applicantEmail: 'devon_marsh@detailtest.dev',
      yearOfStudy: '3',
      homeDepartment: 'CPSC',
      status: 'reviewing',
      resumePath: 'resumes/devon.pdf',
      teamSlug: 'test-detail-soft',
    });
  });

  it('lists ranked subteams in the applicant’s order, not the database’s', async () => {
    // NET was ranked first even though PATH sits earlier in `subteams.position`.
    // Returning them in table order would silently invert the answer.
    const detail = await getApplicationDetail(applicationId, softLead);
    expect(detail!.rankedSubteams.map((s) => s.code)).toEqual(['NET', 'PATH']);
  });

  it('includes attributed notes for the detail header panel', async () => {
    const authorId = (await softLead.auth.getUser()).data.user!.id;
    const { error } = await admin.from('application_notes').insert({
      application_id: applicationId,
      author_id: authorId,
      body: 'Detail panel note',
      created_at: '2026-08-16T12:00:00.000Z',
    });
    if (error) throw error;

    const detail = await getApplicationDetail(applicationId, softLead);

    expect(detail!.notes).toEqual([
      expect.objectContaining({
        applicationId,
        body: 'Detail panel note',
        createdAt: '2026-08-16T12:00:00.000Z',
      }),
    ]);
    expect(detail!.notes[0].authorName).not.toBe('');
  });
});

describe('the other applications from one submission', () => {
  it('are hidden from a lead who may not see them', async () => {
    // The Mechanical row exists and shares this submission, but a Software lead
    // has no business knowing about Mechanical's pipeline.
    const detail = await getApplicationDetail(applicationId, softLead);
    expect(detail!.siblings).toEqual([]);

    const { data: real } = await admin
      .from('applications')
      .select('id')
      .eq('submission_id', submissionId);
    expect(real).toHaveLength(2);
  });

  it('are listed for an admin, who may', async () => {
    const detail = await getApplicationDetail(applicationId, adminUser);
    expect(detail!.siblings).toEqual([
      {
        id: mechApplicationId,
        teamName: 'Test Detail Mechanical',
        teamSlug: 'test-detail-mech',
        status: 'applied',
      },
    ]);
  });
});

describe('row visibility', () => {
  it('gives a lead nothing for another team’s application', async () => {
    const detail = await getApplicationDetail(mechApplicationId, softLead);
    expect(detail).toBeNull();

    // The row is really there, and an admin really can read it — so this is
    // RLS and not a missing fixture.
    const asAdmin = await getApplicationDetail(mechApplicationId, adminUser);
    expect(asAdmin!.applicantName).toBe('Devon Marsh');
  });

  it('answers the same way for an id that does not exist', async () => {
    expect(await getApplicationDetail(crypto.randomUUID(), softLead)).toBeNull();
  });
});
