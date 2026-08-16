import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QUESTION_TYPES, type Answer, type Question } from '@/lib/questions/types';
import { QuestionField } from '../question-field';
import { everyQuestionType } from '@/test/apply-fixtures';

/**
 * Every question type must render, be labelled, and report what was entered.
 *
 * A type the dispatcher forgets is silent: the applicant sees a gap where a
 * question should be, the schema still requires an answer, and the submission
 * is refused with no field to point at.
 */

function setup(question: Question, value?: Answer) {
  const onChange = jest.fn();
  render(
    <QuestionField
      question={question}
      fieldId={`q-${question.id}`}
      value={value}
      onChange={onChange}
      uploadPostingSlug="soft-2026"
    />,
  );
  return onChange;
}

const byId = new Map(everyQuestionType.map((question) => [question.type, question]));

it('covers every question type in the union', () => {
  // Guards the fixture rather than the component: a ninth type must arrive here
  // with a case of its own, not quietly go untested.
  expect([...byId.keys()].sort()).toEqual([...QUESTION_TYPES].sort());
});

describe('short_text', () => {
  it('renders a labelled input and reports what is typed', async () => {
    const onChange = setup(byId.get('short_text')!);
    const input = screen.getByLabelText(/Link to your GitHub/);

    await userEvent.type(input, 'h');

    expect(input).toHaveAttribute('type', 'url');
    expect(onChange).toHaveBeenCalledWith('h');
  });

  it('counts characters against the limit', () => {
    setup(byId.get('short_text')!, 'https://example.com');
    expect(screen.getByText('19 of 200 characters')).toBeInTheDocument();
  });
});

describe('long_text', () => {
  it('renders a textarea and reports what is typed', async () => {
    const onChange = setup(byId.get('long_text')!);
    await userEvent.type(screen.getByLabelText(/Tell us about a project/), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('counts words against the minimum', () => {
    setup(byId.get('long_text')!, 'one two');
    expect(screen.getByText(/2 of at least 3 words/)).toBeInTheDocument();
  });
});

describe('select', () => {
  it('reports the chosen option', async () => {
    const onChange = setup(byId.get('select')!);
    await userEvent.selectOptions(screen.getByLabelText(/Are you free on Saturdays/), 'Yes');
    expect(onChange).toHaveBeenCalledWith('Yes');
  });

  it('reports undefined when the choice is cleared', async () => {
    const onChange = setup(byId.get('select')!, 'Yes');
    await userEvent.selectOptions(screen.getByLabelText(/Are you free on Saturdays/), '');
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe('multi_select', () => {
  it('appends the chosen option', async () => {
    const onChange = setup(byId.get('multi_select')!, ['Python']);
    await userEvent.click(screen.getByLabelText('C++'));
    expect(onChange).toHaveBeenCalledWith(['Python', 'C++']);
  });

  it('removes an option that is unticked', async () => {
    const onChange = setup(byId.get('multi_select')!, ['Python']);
    await userEvent.click(screen.getByLabelText('Python'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('disables the rest at the cap rather than ignoring the click', () => {
    setup(byId.get('multi_select')!, ['Python', 'C++']);
    expect(screen.getByLabelText('TypeScript')).toBeDisabled();
    // The already-chosen ones stay operable, so a choice can be swapped.
    expect(screen.getByLabelText('Python')).toBeEnabled();
  });
});

describe('scale', () => {
  it('reports the point as a number, not a string', async () => {
    const onChange = setup(byId.get('scale')!);
    await userEvent.click(screen.getByLabelText('4'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('names both ends of the scale', () => {
    setup(byId.get('scale')!);
    expect(screen.getByText(/Never used it/)).toBeInTheDocument();
    expect(screen.getByText(/Very confident/)).toBeInTheDocument();
  });
});

describe('matrix', () => {
  it('reports a row against its column', async () => {
    const onChange = setup(byId.get('matrix')!);
    await userEvent.click(screen.getByLabelText('Python: I have this skill'));
    expect(onChange).toHaveBeenCalledWith({ Python: ['I have this skill'] });
  });

  it('keeps both columns of a row in multi mode', async () => {
    const onChange = setup(byId.get('matrix')!, { Python: ['I have this skill'] });
    await userEvent.click(screen.getByLabelText('Python: I want to learn it'));
    expect(onChange).toHaveBeenCalledWith({
      Python: ['I have this skill', 'I want to learn it'],
    });
  });

  it('drops rows with nothing selected', async () => {
    const onChange = setup(byId.get('matrix')!, { Python: ['I have this skill'] });
    await userEvent.click(screen.getByLabelText('Python: I have this skill'));
    expect(onChange).toHaveBeenCalledWith({});
  });
});

describe('ranking', () => {
  it('reports the options in the order they were added', async () => {
    const onChange = setup(byId.get('ranking')!, ['Firmware']);
    await userEvent.click(screen.getByRole('button', { name: /Add Web/ }));
    expect(onChange).toHaveBeenCalledWith(['Firmware', 'Web']);
  });
});

describe('file', () => {
  it('renders a file input that accepts what the question allows', () => {
    setup(byId.get('file')!);
    const input = screen.getByLabelText(/Upload your technical quiz/);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', '.zip');
  });

  it('reports an already-uploaded file rather than the bytes', () => {
    setup(byId.get('file')!, { path: 'question/abc.zip', filename: 'quiz.zip', size: 512 });
    expect(screen.getByText(/Uploaded quiz.zip/)).toBeInTheDocument();
  });
});

describe('required questions', () => {
  it('marks a required question for assistive technology, not just visually', () => {
    setup(byId.get('long_text')!);
    expect(screen.getByLabelText(/Tell us about a project/)).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  it('says so when a question is optional', () => {
    setup(byId.get('short_text')!);
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });
});

describe('descriptions', () => {
  it('attaches help text to a single control', () => {
    setup({ ...byId.get('long_text')!, help: 'Two to five sentences.' });
    expect(screen.getByLabelText(/Tell us about a project/)).toHaveAccessibleDescription(
      /Two to five sentences/,
    );
  });

  it('attaches help text to the group, not to a wrapper with no role', () => {
    // `aria-describedby` on a bare `div` describes nothing. Several controls
    // answering one question are wrapped in a `fieldset`, and the description
    // belongs on that.
    setup({ ...byId.get('scale')!, help: 'Be honest.' });
    expect(screen.getByRole('group', { name: /How confident/ })).toHaveAccessibleDescription(
      /Be honest/,
    );
  });

  it('attaches an error to the group as well as showing it', () => {
    const question = byId.get('multi_select')!;
    render(
      <QuestionField
        question={question}
        fieldId={`q-${question.id}`}
        value={undefined}
        onChange={jest.fn()}
        error="Choose at least one option"
        uploadPostingSlug="soft-2026"
      />,
    );
    expect(screen.getByRole('group', { name: /Which languages/ })).toHaveAccessibleDescription(
      /Choose at least one option/,
    );
  });
});
