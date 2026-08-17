import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubmitResult } from '@/app/actions/submit-application';
import { isQuestionVisible } from '@/lib/questions/schema';
import { ApplyForm } from '../apply-form';
import { DRAFT_KEY } from '../storage';
import {
  applyData,
  mechanicalPosting,
  pathOnlyQuestion,
  softwarePosting,
  subteams,
} from '@/test/apply-fixtures';

/**
 * The form as an applicant meets it: gates, a ranking that decides which
 * questions exist, a draft that survives a refresh, and a submission that has
 * to say something useful when it is refused.
 */

const RESUME = {
  path: 'resume/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
  filename: 'cv.pdf',
  size: 42,
};

function succeeds() {
  return jest.fn<Promise<SubmitResult>, [unknown]>(async () => ({
    ok: true as const,
    submissionId: 'sub-1',
    teams: [
      {
        teamSlug: 'mech',
        teamName: 'Mechanical',
        postingSlug: 'mech-2026',
        applicationId: 'app-1',
      },
    ],
  }));
}

const QUIZ = {
  path: 'question/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.zip',
  filename: 'quiz.zip',
  size: 9,
};

/** The upload route, stubbed at the fetch boundary. */
function stubUpload() {
  const fetchMock = jest.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => (url.includes('purpose=resume') ? RESUME : QUIZ),
  }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  window.localStorage.clear();
  stubUpload();
});

async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Full name/), 'Sam Rivers');
  await user.type(screen.getByLabelText(/^Email/), 'sam@student.ubc.ca');
  await user.selectOptions(screen.getByLabelText(/Year of study/), '2');
  await user.selectOptions(screen.getByLabelText(/Faculty/), 'Applied Science');
  // Applied Science asks for a program code from a list; every other faculty
  // takes free text, which is covered in its own test below.
  await user.selectOptions(screen.getByLabelText(/Program or major/), 'MECH');
  await user.type(screen.getByLabelText(/Why do you want to join/), 'Boats.');
}

/**
 * Teams are chosen from one checkbox list, one box per team, named by the team.
 * This used to be a yes/no radio pair per team, so most of these tests clicked
 * an ambiguous "Yes".
 */
async function chooseTeam(user: ReturnType<typeof userEvent.setup>, teamName: string) {
  await user.click(screen.getByRole('checkbox', { name: teamName }));
}

/** Review is offered once, at the end of the form. `getBy` asserts that. */
async function clickReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Review your application' }));
}

async function uploadResume(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    screen.getByLabelText(/^Resume/, { selector: 'input' }),
    new File(['%PDF-'], 'cv.pdf', { type: 'application/pdf' }),
  );
  await screen.findByText(/Uploaded cv.pdf/);
}

describe('conditional questions', () => {
  const data = applyData([softwarePosting([pathOnlyQuestion])]);

  it('appears and disappears as the ranking changes, agreeing with isQuestionVisible', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    await chooseTeam(user, 'Software');

    // Nothing ranked: the rule cannot be satisfied, and neither side shows it.
    expect(isQuestionVisible(pathOnlyQuestion, [])).toBe(false);
    expect(screen.queryByLabelText(/What is a heuristic/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add Pathfinding/ }));

    expect(isQuestionVisible(pathOnlyQuestion, ['pathfinding'])).toBe(true);
    expect(screen.getByLabelText(/What is a heuristic/)).toBeInTheDocument();

    // Dropped and re-picked last, it is outside the top two again. That is the
    // whole of reordering now the move buttons are gone.
    await user.click(screen.getByRole('button', { name: /Remove Pathfinding/ }));
    await user.click(screen.getByRole('button', { name: /Add Network Systems/ }));
    await user.click(screen.getByRole('button', { name: /Add Boat Simulator/ }));
    await user.click(screen.getByRole('button', { name: /Add Pathfinding/ }));

    expect(
      isQuestionVisible(pathOnlyQuestion, ['network-systems', 'boat-simulator', 'pathfinding']),
    ).toBe(false);
    expect(screen.queryByLabelText(/What is a heuristic/)).not.toBeInTheDocument();
  });

  it('puts the ranking above the questions it decides', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);
    await chooseTeam(user, 'Software');
    await user.click(screen.getByRole('button', { name: /Add Pathfinding/ }));

    const ranking = screen.getByRole('group', { name: /subteams you're interested in/ });
    const question = screen.getByLabelText(/What is a heuristic/);

    expect(ranking.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('faculty and program', () => {
  const data = applyData([mechanicalPosting()]);

  it('asks for a program code under Applied Science and free text elsewhere', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    // Nothing chosen yet: the box takes whatever the applicant studies, because
    // there is no list to offer until a faculty says which one.
    expect(screen.getByLabelText(/Program or major/).tagName).toBe('INPUT');

    await user.selectOptions(screen.getByLabelText(/Faculty/), 'Applied Science');
    const program = screen.getByLabelText(/Program or major/);
    expect(program.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: /MECH/ })).toBeInTheDocument();

    await user.selectOptions(program, 'MECH');
    // The CODE alone is what is stored, not the label the applicant read.
    expect(program).toHaveValue('MECH');

    await user.selectOptions(screen.getByLabelText(/Faculty/), 'Science');
    expect(screen.getByLabelText(/Program or major/).tagName).toBe('INPUT');
  });

  it('drops a program that the new faculty cannot express, and keeps one it can', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    await user.selectOptions(screen.getByLabelText(/Faculty/), 'Applied Science');
    await user.selectOptions(screen.getByLabelText(/Program or major/), 'MECH');

    // 'MECH' means nothing in Arts, and the field it was chosen in no longer
    // exists, so leaving it would submit an engineering code under Arts.
    await user.selectOptions(screen.getByLabelText(/Faculty/), 'Arts');
    expect(screen.getByLabelText(/Program or major/)).toHaveValue('');

    // Between two free-text faculties there is nothing to reconcile: someone
    // correcting Arts to Science has not changed what they study.
    await user.type(screen.getByLabelText(/Program or major/), 'Philosophy');
    await user.selectOptions(screen.getByLabelText(/Faculty/), 'Science');
    expect(screen.getByLabelText(/Program or major/)).toHaveValue('Philosophy');
  });
});

describe('draft autosave', () => {
  const data = applyData([mechanicalPosting()]);

  it('restores what was written after a remount', async () => {
    const user = userEvent.setup();
    const first = render(<ApplyForm data={data} submit={succeeds()} />);

    await user.type(screen.getByLabelText(/Full name/), 'Sam Rivers');
    await chooseTeam(user, 'Mechanical');
    await user.type(screen.getByLabelText(/What is ballast/), 'Weight, low down.');

    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toContain('Sam Rivers'));
    first.unmount();

    render(<ApplyForm data={data} submit={succeeds()} />);

    expect(screen.getByLabelText(/Full name/)).toHaveValue('Sam Rivers');
    expect(screen.getByLabelText(/What is ballast/)).toHaveValue('Weight, low down.');
    expect(screen.getByText(/We restored what you had already written/)).toBeInTheDocument();
  });

  it('never persists a file answer or the resume', async () => {
    const user = userEvent.setup();
    const fileData = applyData([softwarePosting()]);
    const first = render(<ApplyForm data={fileData} submit={succeeds()} />);

    await user.type(screen.getByLabelText(/Full name/), 'Sam Rivers');
    await chooseTeam(user, 'Software');
    await user.upload(
      screen.getByLabelText(/Upload your technical quiz/),
      new File(['PK'], 'quiz.zip', { type: 'application/zip' }),
    );
    await screen.findByText(/Uploaded quiz.zip/);
    await uploadResume(user);

    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toContain('Sam Rivers'));
    // The paths reference objects the server issued for this session; a draft
    // opened next week would point at nothing.
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toContain(RESUME.path);
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toContain(QUIZ.path);
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toContain('quiz_zip');

    first.unmount();
    render(<ApplyForm data={fileData} submit={succeeds()} />);

    expect(screen.getByLabelText(/Full name/)).toHaveValue('Sam Rivers');
    // Neither file survived the remount: nothing names either upload on screen.
    expect(screen.queryByText(/Uploaded/)).not.toBeInTheDocument();
  });

  it('is cleared when the application is sent', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    await fillIdentity(user);
    await chooseTeam(user, 'Mechanical');
    await user.type(screen.getByLabelText(/What is ballast/), 'Weight, low down.');
    await uploadResume(user);

    await clickReview(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await screen.findByRole('heading', { name: 'Your application is in' });
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('errors', () => {
  const data = applyData([mechanicalPosting()]);

  it('summarises what is missing and focuses the first field', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    await clickReview(user);

    const summary = screen.getByRole('alert');
    expect(summary).toHaveTextContent('Full name: Enter your name');
    expect(summary).toHaveTextContent('Choose at least one team to apply to');
    expect(screen.getByLabelText(/Full name/)).toHaveFocus();
  });

  it('links each entry in the summary to its field', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    await clickReview(user);

    expect(screen.getByRole('link', { name: /Full name: Enter your name/ })).toHaveAttribute(
      'href',
      '#applicant-name',
    );
  });

  it('reports a required question that was left empty', async () => {
    const user = userEvent.setup();
    render(<ApplyForm data={data} submit={succeeds()} />);

    await fillIdentity(user);
    await chooseTeam(user, 'Mechanical');
    await uploadResume(user);
    await clickReview(user);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'What is ballast?: This question is required',
    );
    expect(screen.getByLabelText(/What is ballast/)).toHaveFocus();
  });

  it('names the team that already has an application when the server says so', async () => {
    const user = userEvent.setup();
    const submit = jest.fn<Promise<SubmitResult>, [unknown]>(async () => ({
      ok: false as const,
      code: 'duplicate' as const,
      message: 'You have already applied to Mechanical with this email address.',
      issues: [
        {
          posting: 'mech-2026',
          field: null,
          message: 'You have already applied to this team',
        },
      ],
      duplicateTeams: [{ teamSlug: 'mech', teamName: 'Mechanical', postingSlug: 'mech-2026' }],
    }));

    render(<ApplyForm data={data} submit={submit} />);

    await fillIdentity(user);
    await chooseTeam(user, 'Mechanical');
    await user.type(screen.getByLabelText(/What is ballast/), 'Weight, low down.');
    await uploadResume(user);
    await clickReview(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('You have already applied to Mechanical');
    expect(summary).toHaveTextContent('sam@student.ubc.ca');
    // Back on the form, not stuck on the review step with no way to change it.
    expect(screen.getByLabelText(/Full name/)).toBeInTheDocument();
  });
});

describe('submission', () => {
  it('sends core answers with every team and confirms each one by name', async () => {
    const user = userEvent.setup();
    const data = applyData([mechanicalPosting(), softwarePosting([])]);
    const submit = jest.fn<Promise<SubmitResult>, [unknown]>(async () => ({
      ok: true as const,
      submissionId: 'sub-1',
      teams: [
        { teamSlug: 'mech', teamName: 'Mechanical', postingSlug: 'mech-2026', applicationId: 'a' },
        { teamSlug: 'soft', teamName: 'Software', postingSlug: 'soft-2026', applicationId: 'b' },
      ],
    }));

    render(<ApplyForm data={data} submit={submit} />);

    await fillIdentity(user);
    await chooseTeam(user, 'Mechanical');
    await chooseTeam(user, 'Software');
    await user.type(screen.getByLabelText(/What is ballast/), 'Weight, low down.');
    await user.click(screen.getByRole('button', { name: /Add Pathfinding/ }));
    await uploadResume(user);

    await clickReview(user);
    await user.click(screen.getByRole('button', { name: 'Submit application' }));

    await screen.findByRole('heading', { name: 'Your application is in' });
    expect(screen.getByText('Mechanical')).toBeInTheDocument();
    expect(screen.getByText('Software')).toBeInTheDocument();

    const payload = submit.mock.calls[0][0] as {
      resumePath: string;
      teams: { postingSlug: string; answers: Record<string, unknown>; rankedSubteams: string[] }[];
    };

    expect(payload.resumePath).toBe(RESUME.path);
    expect(payload.teams).toHaveLength(2);
    // Answered once, submitted with both rows, because each row carries its own
    // snapshot of the core questions.
    expect(payload.teams[0].answers.why_sailbot).toBe('Boats.');
    expect(payload.teams[1].answers.why_sailbot).toBe('Boats.');
    // A team that does not rank subteams must send an empty list.
    expect(payload.teams[0].rankedSubteams).toEqual([]);
    expect(payload.teams[1].rankedSubteams).toEqual([subteams[0].id]);
  });

  it('shows a review of every answer before anything is sent', async () => {
    const user = userEvent.setup();
    const data = applyData([mechanicalPosting()]);
    const submit = succeeds();
    render(<ApplyForm data={data} submit={submit} />);

    await fillIdentity(user);
    await chooseTeam(user, 'Mechanical');
    await user.type(screen.getByLabelText(/What is ballast/), 'Weight, low down.');
    await uploadResume(user);
    await clickReview(user);

    expect(screen.getByRole('heading', { name: 'Review your application' })).toBeInTheDocument();
    expect(screen.getByText('Weight, low down.')).toBeInTheDocument();
    expect(screen.getByText('2nd')).toBeInTheDocument();
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
