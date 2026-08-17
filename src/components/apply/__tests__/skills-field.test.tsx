import { render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { SkillsField } from '../fields/skills-field';
import type { SkillsAnswer, SkillsQuestion } from '@/lib/questions/types';

/**
 * Rate what you can do; tick what you want to do.
 *
 * The slider has no blank position — a range input always holds a value — so
 * the bottom of the scale has to MEAN something, and what it means is "no
 * experience". Everything here follows from that: an untouched row must not
 * become a claim, so it is not stored at all.
 */

const SKILLS = ['Python', 'Docker', 'Sailing'];

function question(overrides: Partial<SkillsQuestion> = {}): SkillsQuestion {
  return {
    id: 'technical_skills',
    type: 'skills',
    label: 'What are your technical skills?',
    required: false,
    config: {
      skills: SKILLS,
      maxLevel: 5,
      minLabel: 'No experience',
      maxLabel: 'Could teach it',
    },
    ...overrides,
  };
}

function setup(value: SkillsAnswer = {}) {
  const onChange = jest.fn();
  render(
    <SkillsField
      question={question()}
      fieldId="q-soft-technical_skills"
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange };
}

/** The slider for one skill, named after it. */
function slider(skill: string): HTMLInputElement {
  return screen.getByRole('slider', { name: new RegExp(skill) }) as HTMLInputElement;
}

describe('the scale', () => {
  it('rests at the bottom for a skill nobody has rated', () => {
    setup();
    expect(slider('Python')).toHaveValue('1');
  });

  it('explains both ends of the scale once, above the rows', () => {
    // "1" on an untouched row would otherwise invite the reading "I am a 1 at
    // this", which is a claim the applicant never made. Saying so per row cost
    // fifteen repetitions of the same two phrases.
    setup();

    expect(screen.getAllByText(/No experience/)).toHaveLength(1);
    expect(screen.getAllByText(/Could teach it/)).toHaveLength(1);
  });

  it('shows each row only its number', () => {
    setup({ Python: { level: 3, wantsToLearn: false } });

    expect(within(row('Python')).getByText('3')).toBeInTheDocument();
    expect(within(row('Python')).queryByText(/No experience/)).not.toBeInTheDocument();
  });

  it('shows the resting number too, rather than an empty cell', () => {
    setup();
    expect(within(row('Python')).getByText('1')).toBeInTheDocument();
  });

  it('spans 1 to the configured top', () => {
    setup();
    expect(slider('Docker')).toHaveAttribute('min', '1');
    expect(slider('Docker')).toHaveAttribute('max', '5');
  });
});

describe('what gets stored', () => {
  it('records a level once the slider moves', () => {
    const { onChange } = setup();

    fireEvent.change(slider('Python'), { target: { value: '4' } });

    expect(onChange).toHaveBeenCalledWith({ Python: { level: 4, wantsToLearn: false } });
  });

  it('records the wish to learn on its own', () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByRole('checkbox', { name: /Docker/ }));

    expect(onChange).toHaveBeenCalledWith({ Docker: { level: 1, wantsToLearn: true } });
  });

  it('drops a skill returned to the bottom and unticked', () => {
    // Fifteen untouched rows must not become fifteen stored claims of level 1.
    const { onChange } = setup({
      Python: { level: 4, wantsToLearn: false },
      Docker: { level: 2, wantsToLearn: false },
    });

    fireEvent.change(slider('Python'), { target: { value: '1' } });

    expect(onChange).toHaveBeenCalledWith({ Docker: { level: 2, wantsToLearn: false } });
  });

  it('keeps a skill at the bottom that is still ticked', () => {
    // "I have never used ROS and want to learn it" is the most useful answer
    // this question can collect, and it lives at the bottom of the scale.
    const { onChange } = setup({ Python: { level: 2, wantsToLearn: true } });

    fireEvent.change(slider('Python'), { target: { value: '1' } });

    expect(onChange).toHaveBeenCalledWith({ Python: { level: 1, wantsToLearn: true } });
  });

  it('leaves the other skills alone', () => {
    const { onChange } = setup({ Sailing: { level: 5, wantsToLearn: false } });

    fireEvent.change(slider('Python'), { target: { value: '2' } });

    expect(onChange).toHaveBeenCalledWith({
      Sailing: { level: 5, wantsToLearn: false },
      Python: { level: 2, wantsToLearn: false },
    });
  });
});

describe('without sight of it', () => {
  it('names every slider after its skill', () => {
    setup();
    for (const skill of SKILLS) expect(slider(skill)).toBeInTheDocument();
  });

  it('announces the level as words at the ends of the scale', () => {
    // A screen reader reads `aria-valuetext` in place of the raw number, so
    // the bottom announces as "No experience" and not as "1".
    setup();
    expect(slider('Python')).toHaveAttribute('aria-valuetext', 'No experience');
  });

  it('names each checkbox after its own skill', () => {
    setup();
    for (const skill of SKILLS) {
      expect(screen.getByRole('checkbox', { name: new RegExp(skill) })).toBeInTheDocument();
    }
  });

  it('heads the checkbox column once instead of labelling every row', () => {
    // The name still reaches a screen reader per checkbox; what is gone is the
    // same four words printed down the page fifteen times.
    setup();
    expect(screen.getAllByText(/Want to learn\/improve/)).toHaveLength(1);
  });
});

/**
 * The row a skill occupies, found through its slider.
 *
 * Not through its name: the checkbox's hidden label ends in the skill name too,
 * so matching on the text alone finds two nodes.
 */
function row(skill: string): HTMLElement {
  const node = slider(skill).closest('[data-skill-row]');
  if (!node) throw new Error(`no row for ${skill}`);
  return node as HTMLElement;
}
