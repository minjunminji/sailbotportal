import { buildAnswerSchema } from '../schema';
import type { SkillsQuestion } from '../types';

/**
 * The skills question: a proficiency level per skill, and a flag for wanting to
 * work on it.
 *
 * It replaced a matrix of "I have this skill" / "I want to learn this skill"
 * checkboxes, which could only say whether a skill was in one bucket or the
 * other. Level and interest are different axes — someone can be good at Python
 * and still want to spend their time on it — and a grid of bare checkboxes made
 * an applicant map a column header across the row to work out which box was
 * which.
 *
 * These answers arrive from an anonymous browser, so every bound the lead
 * authored is re-checked here: a skill nobody listed, a level above the top of
 * the scale, a level that is not a whole number.
 */

function skills(overrides: Partial<SkillsQuestion> = {}): SkillsQuestion {
  return {
    id: 'technical_skills',
    type: 'skills',
    label: 'What are your technical skills?',
    required: false,
    config: {
      skills: ['Python', 'Docker', 'Sailing'],
      maxLevel: 5,
      minLabel: 'No experience',
      maxLabel: 'Could teach it',
    },
    ...overrides,
  };
}

function accepts(answer: unknown, question = skills()): boolean {
  return buildAnswerSchema([question], { rankedSubteams: [] }).safeParse({
    technical_skills: answer,
  }).success;
}

function failures(answer: unknown, question = skills()): string[] {
  const result = buildAnswerSchema([question], { rankedSubteams: [] }).safeParse({
    technical_skills: answer,
  });
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('what a valid answer looks like', () => {
  it('takes a level and a learning flag per skill', () => {
    expect(accepts({ Python: { level: 4, wantsToLearn: false } })).toBe(true);
    expect(
      accepts({
        Python: { level: 4, wantsToLearn: true },
        Docker: { level: 1, wantsToLearn: true },
      }),
    ).toBe(true);
  });

  it('accepts an empty object, since every skill is optional', () => {
    // Most applicants will have nothing to say about most of fifteen skills.
    expect(accepts({})).toBe(true);
  });
});

describe('bounds', () => {
  it('refuses a skill the question never listed', () => {
    expect(failures({ Fortran: { level: 3, wantsToLearn: false } })).toEqual([
      'technical_skills.Fortran',
    ]);
  });

  it('refuses a level above the top of the scale', () => {
    expect(failures({ Python: { level: 6, wantsToLearn: false } })).toEqual([
      'technical_skills.Python.level',
    ]);
  });

  it('refuses a level below the bottom of the scale', () => {
    expect(failures({ Python: { level: 0, wantsToLearn: false } })).toEqual([
      'technical_skills.Python.level',
    ]);
  });

  it('refuses a level between the stops', () => {
    expect(failures({ Python: { level: 3.5, wantsToLearn: false } })).toEqual([
      'technical_skills.Python.level',
    ]);
  });

  it('refuses a flag that is not a boolean', () => {
    expect(failures({ Python: { level: 3, wantsToLearn: 'yes' } })).toEqual([
      'technical_skills.Python.wantsToLearn',
    ]);
  });

  it('refuses an entry missing either half', () => {
    expect(failures({ Python: { level: 3 } })).toEqual(['technical_skills.Python.wantsToLearn']);
    expect(failures({ Python: { wantsToLearn: true } })).toEqual(['technical_skills.Python.level']);
  });
});

describe('required', () => {
  it('wants at least one skill said something about', () => {
    const question = skills({ required: true });
    expect(accepts({}, question)).toBe(false);
    expect(accepts({ Python: { level: 2, wantsToLearn: false } }, question)).toBe(true);
  });
});
