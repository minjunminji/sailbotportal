import { render, screen } from '@testing-library/react';
import { QUESTION_TYPES, type Question } from '@/lib/questions/types';
import { readSnapshot } from '@/lib/applications/detail';
import { AnswerView } from '../answer-view';

/**
 * Reading back an answer of each of the nine types.
 *
 * The renderer's `switch` is exhaustive at compile time, but "compiles" and
 * "renders the answer rather than nothing" are different claims, so every type
 * gets a case here — including the last test, which fails if a ninth type is
 * ever added without one.
 */

function ask(overrides: Partial<Question> & Pick<Question, 'type'>): Question {
  return { id: 'q', label: 'A question', required: false, ...overrides } as Question;
}

describe('each question type renders its answer', () => {
  it('short_text as plain text', () => {
    render(<AnswerView question={ask({ type: 'short_text', config: {} })} answer="CPEN" />);
    expect(screen.getByText('CPEN')).toBeInTheDocument();
  });

  it('short_text with format url as a link that opens safely', () => {
    render(
      <AnswerView
        question={ask({ type: 'short_text', config: { format: 'url' } })}
        answer="https://github.com/example/quiz"
      />,
    );
    const link = screen.getByRole('link', { name: 'https://github.com/example/quiz' });
    expect(link).toHaveAttribute('href', 'https://github.com/example/quiz');
    // A candidate-supplied link must not hand the opener a window reference.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('long_text keeping the applicant’s paragraphs', () => {
    const { container } = render(
      <AnswerView
        question={ask({ type: 'long_text', config: {} })}
        answer={'First para.\n\nSecond para.'}
      />,
    );
    const paragraph = container.querySelector('p')!;
    // Collapsing the breaks would turn a structured answer into a wall.
    expect(paragraph).toHaveClass('whitespace-pre-wrap');
    expect(paragraph.textContent).toContain('Second para.');
  });

  it('select as the chosen option', () => {
    render(
      <AnswerView
        question={ask({ type: 'select', config: { options: ['Yes', 'No'] } })}
        answer="Yes"
      />,
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
  });

  it('multi_select as every chosen option', () => {
    render(
      <AnswerView
        question={ask({ type: 'multi_select', config: { options: ['A', 'B', 'C'] } })}
        answer={['A', 'C']}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
  });

  it('scale against its maximum, which is what makes the number mean anything', () => {
    render(
      <AnswerView
        question={ask({ type: 'scale', config: { min: 1, max: 5, maxLabel: 'Expert' } })}
        answer={4}
      />,
    );
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/of 5/)).toBeInTheDocument();
    expect(screen.getByText(/Expert/)).toBeInTheDocument();
  });

  it('matrix as only the rows that were ticked', () => {
    // The form shows twenty rows of checkboxes. Reproducing that here would
    // give a lead twenty lines to scan for the six that say anything.
    render(
      <AnswerView
        question={ask({
          type: 'matrix',
          config: {
            rows: ['Python', 'C++', 'Sailing'],
            columns: ['Have', 'Want'],
            mode: 'multi',
          },
        })}
        answer={{ Python: ['Have'], Sailing: ['Want'] }}
      />,
    );

    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('Sailing')).toBeInTheDocument();
    expect(screen.queryByText('C++')).not.toBeInTheDocument();
  });

  it('ranking as an ordered list, so the order is in the markup', () => {
    const { container } = render(
      <AnswerView
        question={ask({ type: 'ranking', config: { options: ['A', 'B', 'C'], maxChoices: 3 } })}
        answer={['C', 'A']}
      />,
    );
    const items = [...container.querySelectorAll('ol > li')].map((li) => li.textContent);
    expect(items).toEqual(['C', 'A']);
  });

  it('file as a name and a readable size', () => {
    render(
      <AnswerView
        question={ask({ type: 'file', config: { accept: ['.zip'], maxBytes: 5_000_000 } })}
        answer={{ path: 'uploads/x.zip', filename: 'Quiz Devon Marsh.zip', size: 1_468_006 }}
      />,
    );
    expect(screen.getByText(/Quiz Devon Marsh\.zip/)).toBeInTheDocument();
    expect(screen.getByText(/1\.4 MB/)).toBeInTheDocument();
  });
});

describe('a question with no answer', () => {
  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['an empty list', []],
  ])('says so for %s rather than rendering a blank', (_name, answer) => {
    // A gap under a question reads as a rendering bug. "No answer" is a fact,
    // and on an optional question a perfectly ordinary one.
    render(
      <AnswerView question={ask({ type: 'short_text', config: {} })} answer={answer as never} />,
    );
    expect(screen.getByText('No answer')).toBeInTheDocument();
  });

  it('says so for a matrix where every row was left blank', () => {
    render(
      <AnswerView
        question={ask({
          type: 'matrix',
          config: { rows: ['Python'], columns: ['Have'], mode: 'multi' },
        })}
        answer={{ Python: [] }}
      />,
    );
    expect(screen.getByText('No answer')).toBeInTheDocument();
  });
});

it('renders every question type the union declares', () => {
  // Fails the day a tenth type is added without a case above, which is the
  // moment it would otherwise start rendering as nothing.
  const covered = [
    'short_text',
    'long_text',
    'select',
    'multi_select',
    'scale',
    'matrix',
    'skills',
    'ranking',
    'file',
  ];
  expect([...QUESTION_TYPES].sort()).toEqual([...covered].sort());
});

/**
 * A snapshot is an archive: written by the code of its day, read by the code of
 * some later day. If the `Question` type gains a required field, every snapshot
 * written before it stops validating — and an application that could not be
 * opened at all would defeat the point of freezing it.
 */
describe('readSnapshot', () => {
  it('reads well-formed questions', () => {
    const entries = readSnapshot([
      { id: 'a', label: 'A', required: true, type: 'long_text', config: {} },
    ]);
    expect(entries).toEqual([
      {
        ok: true,
        question: { id: 'a', label: 'A', required: true, type: 'long_text', config: {} },
      },
    ]);
  });

  it('degrades one unreadable question instead of losing the page', () => {
    const entries = readSnapshot([
      { id: 'a', label: 'A', required: true, type: 'long_text', config: {} },
      { id: 'b', label: 'B', type: 'from_the_future', config: {} },
      { id: 'c', label: 'C', required: false, type: 'select', config: { options: ['x'] } },
    ]);

    expect(entries.map((e) => e.ok)).toEqual([true, false, true]);
    // Still named, so the page does not quietly show fewer questions than were
    // asked.
    expect(entries[1]).toEqual({ ok: false, id: 'b', label: 'B' });
  });

  it('treats a snapshot that is not an array as empty', () => {
    expect(readSnapshot(null)).toEqual([]);
    expect(readSnapshot({})).toEqual([]);
  });
});
