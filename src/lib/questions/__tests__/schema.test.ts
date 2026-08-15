import { buildAnswerSchema, isQuestionVisible } from '../schema';
import type {
  FileQuestion,
  LongTextQuestion,
  MatrixQuestion,
  MultiSelectQuestion,
  Question,
  RankingQuestion,
  ScaleQuestion,
  SelectQuestion,
  ShortTextQuestion,
} from '../types';

/**
 * These answers arrive from an anonymous browser, so every rule the lead
 * authored has to be re-checked here. The tests below are written from the
 * attacker's side as much as the applicant's: a value outside `options`, an
 * unknown key smuggled into the answers object, and a `javascript:` URL that
 * would later be rendered as a link in the admin UI.
 */

const NO_RANKING = { rankedSubteams: [] as string[] };

function longText(overrides: Partial<LongTextQuestion> = {}): LongTextQuestion {
  return {
    id: 'why',
    type: 'long_text',
    label: 'Why Sailbot?',
    required: true,
    config: {},
    ...overrides,
  };
}

function shortText(overrides: Partial<ShortTextQuestion> = {}): ShortTextQuestion {
  return {
    id: 'github',
    type: 'short_text',
    label: 'GitHub',
    required: true,
    config: {},
    ...overrides,
  };
}

function select(overrides: Partial<SelectQuestion> = {}): SelectQuestion {
  return {
    id: 'saturdays',
    type: 'select',
    label: 'Saturdays?',
    required: true,
    config: { options: ['Yes', 'No'] },
    ...overrides,
  };
}

function multiSelect(overrides: Partial<MultiSelectQuestion> = {}): MultiSelectQuestion {
  return {
    id: 'langs',
    type: 'multi_select',
    label: 'Languages',
    required: false,
    config: { options: ['C++', 'Python', 'TypeScript'] },
    ...overrides,
  };
}

function scale(overrides: Partial<ScaleQuestion> = {}): ScaleQuestion {
  return {
    id: 'git',
    type: 'scale',
    label: 'Git confidence',
    required: true,
    config: { min: 1, max: 5 },
    ...overrides,
  };
}

function matrix(overrides: Partial<MatrixQuestion> = {}): MatrixQuestion {
  return {
    id: 'skills',
    type: 'matrix',
    label: 'Skills',
    required: false,
    config: {
      rows: ['Python', 'C++'],
      columns: ['I have this skill', 'I want to learn or improve this skill'],
      mode: 'multi',
    },
    ...overrides,
  };
}

function ranking(overrides: Partial<RankingQuestion> = {}): RankingQuestion {
  return {
    id: 'interests',
    type: 'ranking',
    label: 'Rank these',
    required: true,
    config: { options: ['Sim', 'Controls', 'Web', 'DevOps'], maxChoices: 3 },
    ...overrides,
  };
}

function fileQuestion(overrides: Partial<FileQuestion> = {}): FileQuestion {
  return {
    id: 'quiz',
    type: 'file',
    label: 'Upload your solution',
    required: false,
    config: { accept: ['.zip'], maxBytes: 1000 },
    ...overrides,
  };
}

/** Parses and returns the issue paths, so a failure says *which* answer broke. */
function failures(questions: Question[], answers: unknown, ctx = NO_RANKING) {
  const result = buildAnswerSchema(questions, ctx).safeParse(answers);
  return result.success ? null : result.error.issues.map((issue) => issue.path.join('.'));
}

function accepts(questions: Question[], answers: unknown, ctx = NO_RANKING) {
  return buildAnswerSchema(questions, ctx).safeParse(answers).success;
}

describe('required and optional', () => {
  it('accepts undefined for an optional long_text', () => {
    const questions = [longText({ required: false })];
    expect(accepts(questions, {})).toBe(true);
    expect(accepts(questions, { why: undefined })).toBe(true);
    expect(accepts(questions, { why: '' })).toBe(true);
  });

  it('rejects a missing answer for a required long_text', () => {
    expect(failures([longText()], {})).toEqual(['why']);
  });

  it('rejects an empty or whitespace-only answer for a required long_text', () => {
    expect(failures([longText()], { why: '' })).toEqual(['why']);
    expect(failures([longText()], { why: '   \n\t  ' })).toEqual(['why']);
    expect(accepts([longText()], { why: 'Because I like boats' })).toBe(true);
  });

  it('builds an empty schema when there are no questions', () => {
    expect(buildAnswerSchema([], NO_RANKING).parse({})).toEqual({});
  });
});

describe('text limits', () => {
  it('enforces maxLength', () => {
    const questions = [longText({ config: { maxLength: 10 } })];
    expect(accepts(questions, { why: 'ten chars.' })).toBe(true);
    expect(failures(questions, { why: 'eleven chars' })).toEqual(['why']);
  });

  it('enforces maxLength on short_text too', () => {
    const questions = [shortText({ config: { maxLength: 5 } })];
    expect(accepts(questions, { github: 'abcde' })).toBe(true);
    expect(failures(questions, { github: 'abcdef' })).toEqual(['github']);
  });

  it('counts words for minWords, not characters', () => {
    const questions = [longText({ config: { minWords: 5 } })];

    // Long in characters, one word: a character count would wave this through.
    expect(failures(questions, { why: 'a'.repeat(200) })).toEqual(['why']);
    expect(failures(questions, { why: 'one two three four' })).toEqual(['why']);
    expect(accepts(questions, { why: 'one two three four five' })).toBe(true);
    // Irregular spacing and newlines still count as five words.
    expect(accepts(questions, { why: ' one\ttwo\n\nthree   four  five ' })).toBe(true);
  });
});

describe('select', () => {
  it('accepts a value from options', () => {
    expect(accepts([select()], { saturdays: 'Yes' })).toBe(true);
  });

  it('rejects a value that is not in options', () => {
    // The client renders the options but does not decide them.
    expect(failures([select()], { saturdays: 'Maybe' })).toEqual(['saturdays']);
    expect(failures([select()], { saturdays: '' })).toEqual(['saturdays']);
    expect(failures([select()], { saturdays: 'yes' })).toEqual(['saturdays']);
    expect(failures([select()], { saturdays: 7 })).toEqual(['saturdays']);
  });

  it('rejects an out-of-options value even when the question is optional', () => {
    const questions = [select({ required: false })];
    expect(accepts(questions, {})).toBe(true);
    expect(failures(questions, { saturdays: 'Maybe' })).toEqual(['saturdays']);
  });
});

describe('multi_select', () => {
  it('accepts a subset of options', () => {
    expect(accepts([multiSelect()], { langs: ['C++', 'Python'] })).toBe(true);
    expect(accepts([multiSelect()], { langs: [] })).toBe(true);
  });

  it('rejects unknown options', () => {
    expect(failures([multiSelect()], { langs: ['C++', 'Malbolge'] })).toEqual(['langs.1']);
  });

  it('respects max', () => {
    const questions = [multiSelect({ config: { options: ['a', 'b', 'c'], max: 2 } })];
    expect(accepts(questions, { langs: ['a', 'b'] })).toBe(true);
    expect(failures(questions, { langs: ['a', 'b', 'c'] })).toEqual(['langs']);
  });

  it('rejects duplicates and non-arrays', () => {
    expect(failures([multiSelect()], { langs: ['C++', 'C++'] })).toEqual(['langs']);
    expect(failures([multiSelect()], { langs: 'C++' })).toEqual(['langs']);
  });

  it('requires at least one choice when required', () => {
    const questions = [multiSelect({ required: true })];
    expect(failures(questions, { langs: [] })).toEqual(['langs']);
    expect(failures(questions, {})).toEqual(['langs']);
    expect(accepts(questions, { langs: ['Python'] })).toBe(true);
  });
});

describe('scale', () => {
  it('accepts an integer inside the range', () => {
    expect(accepts([scale()], { git: 1 })).toBe(true);
    expect(accepts([scale()], { git: 5 })).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(failures([scale()], { git: 0 })).toEqual(['git']);
    expect(failures([scale()], { git: 6 })).toEqual(['git']);
  });

  it('rejects non-integers and non-numbers', () => {
    expect(failures([scale()], { git: 3.5 })).toEqual(['git']);
    expect(failures([scale()], { git: '3' })).toEqual(['git']);
    expect(failures([scale()], { git: Number.NaN })).toEqual(['git']);
  });

  it('is optional when the question is not required', () => {
    expect(accepts([scale({ required: false })], {})).toBe(true);
    expect(failures([scale()], {})).toEqual(['git']);
  });
});

describe('matrix', () => {
  it('accepts known rows and columns', () => {
    expect(
      accepts([matrix()], {
        skills: {
          Python: ['I have this skill', 'I want to learn or improve this skill'],
          'C++': [],
        },
      }),
    ).toBe(true);
  });

  it('rejects unknown row keys', () => {
    expect(failures([matrix()], { skills: { Fortran: ['I have this skill'] } })).toEqual([
      'skills.Fortran',
    ]);
  });

  it('rejects unknown column values', () => {
    expect(failures([matrix()], { skills: { Python: ['I am an expert'] } })).toEqual([
      'skills.Python.0',
    ]);
  });

  it('allows at most one column per row in single mode', () => {
    const single = matrix({
      config: { rows: ['Python'], columns: ['Yes', 'No'], mode: 'single' },
    });
    expect(accepts([single], { skills: { Python: ['Yes'] } })).toBe(true);
    expect(failures([single], { skills: { Python: ['Yes', 'No'] } })).toEqual(['skills.Python']);
  });

  it('rejects a repeated column inside one row', () => {
    expect(
      failures([matrix()], { skills: { Python: ['I have this skill', 'I have this skill'] } }),
    ).toEqual(['skills.Python']);
  });

  it('requires at least one selection when required', () => {
    const questions = [matrix({ required: true })];
    expect(failures(questions, { skills: { Python: [], 'C++': [] } })).toEqual(['skills']);
    expect(failures(questions, {})).toEqual(['skills']);
    expect(accepts(questions, { skills: { 'C++': ['I have this skill'] } })).toBe(true);
  });
});

describe('ranking', () => {
  it('accepts an ordered subset and preserves the order', () => {
    const parsed = buildAnswerSchema([ranking()], NO_RANKING).parse({
      interests: ['Web', 'Sim', 'Controls'],
    }) as { interests: string[] };
    expect(parsed.interests).toEqual(['Web', 'Sim', 'Controls']);
  });

  it('rejects duplicates', () => {
    expect(failures([ranking()], { interests: ['Web', 'Web'] })).toEqual(['interests']);
  });

  it('rejects unknown options', () => {
    expect(failures([ranking()], { interests: ['Web', 'Kitchen'] })).toEqual(['interests.1']);
  });

  it('rejects more than maxChoices', () => {
    expect(failures([ranking()], { interests: ['Web', 'Sim', 'Controls', 'DevOps'] })).toEqual([
      'interests',
    ]);
  });

  it('requires at least one choice when required', () => {
    expect(failures([ranking()], { interests: [] })).toEqual(['interests']);
    expect(accepts([ranking({ required: false })], { interests: [] })).toBe(true);
  });
});

describe('short_text formats', () => {
  it('accepts http and https for format url', () => {
    const questions = [shortText({ config: { format: 'url' } })];
    expect(accepts(questions, { github: 'https://github.com/example' })).toBe(true);
    expect(accepts(questions, { github: 'http://example.com/x?y=1' })).toBe(true);
  });

  it('rejects javascript: and every other non-http scheme', () => {
    // This value is rendered as a link in the admin UI later, so a
    // javascript: URL here is a stored XSS aimed at whoever reviews it.
    const questions = [shortText({ config: { format: 'url' } })];
    expect(failures(questions, { github: 'javascript:alert(1)' })).toEqual(['github']);
    expect(failures(questions, { github: 'JavaScript:alert(1)' })).toEqual(['github']);
    expect(failures(questions, { github: 'data:text/html,<script>x</script>' })).toEqual([
      'github',
    ]);
    expect(failures(questions, { github: 'file:///etc/passwd' })).toEqual(['github']);
    expect(failures(questions, { github: 'ftp://example.com' })).toEqual(['github']);
    expect(failures(questions, { github: 'github.com/example' })).toEqual(['github']);
    expect(failures(questions, { github: '  javascript:alert(1)  ' })).toEqual(['github']);
  });

  it('checks format email', () => {
    const questions = [shortText({ config: { format: 'email' } })];
    expect(accepts(questions, { github: 'someone@student.ubc.ca' })).toBe(true);
    expect(failures(questions, { github: 'someone-at-example' })).toEqual(['github']);
  });

  it('skips the format check for an omitted optional value', () => {
    const questions = [shortText({ required: false, config: { format: 'url' } })];
    expect(accepts(questions, {})).toBe(true);
    expect(accepts(questions, { github: '' })).toBe(true);
    expect(failures(questions, { github: 'javascript:alert(1)' })).toEqual(['github']);
  });
});

describe('file answers', () => {
  it('accepts a completed upload within maxBytes', () => {
    expect(
      accepts([fileQuestion()], {
        quiz: { path: 'quiz/8f1c.zip', filename: 'solution.zip', size: 999 },
      }),
    ).toBe(true);
  });

  it('rejects an oversize upload and an unaccepted extension', () => {
    expect(
      failures([fileQuestion()], {
        quiz: { path: 'quiz/8f1c.zip', filename: 'solution.zip', size: 1001 },
      }),
    ).toEqual(['quiz.size']);

    expect(
      failures([fileQuestion()], {
        quiz: { path: 'quiz/8f1c.exe', filename: 'solution.exe', size: 10 },
      }),
    ).toEqual(['quiz.filename']);
  });

  it('rejects a half-formed upload object', () => {
    expect(failures([fileQuestion()], { quiz: { path: 'quiz/8f1c.zip' } })).not.toBeNull();
    expect(failures([fileQuestion({ required: true })], {})).toEqual(['quiz']);
  });
});

describe('unknown keys', () => {
  it('strips keys that no question declares', () => {
    const parsed = buildAnswerSchema([longText()], NO_RANKING).parse({
      why: 'Because I like boats',
      // A crafted submission would otherwise write arbitrary JSON straight
      // into applications.answers.
      injected: { admin: true },
      'why; drop table': 'x',
    });

    expect(parsed).toEqual({ why: 'Because I like boats' });
    expect(Object.keys(parsed)).toEqual(['why']);
    expect(parsed).not.toHaveProperty('injected');
  });

  it('rejects an answers payload that is not an object', () => {
    expect(accepts([longText()], 'nope')).toBe(false);
    expect(accepts([longText()], null)).toBe(false);
    expect(accepts([longText()], [])).toBe(false);
  });
});

describe('visibleIf', () => {
  const conditional = longText({
    id: 'pathfinding-extra',
    required: true,
    visibleIf: { subteam: 'pathfinding', topN: 2 },
  });

  it('is optional when the subteam is outside the top N', () => {
    const ctx = { rankedSubteams: ['website', 'devops', 'pathfinding'] };
    expect(accepts([conditional], {}, ctx)).toBe(true);
    expect(accepts([conditional], { 'pathfinding-extra': '' }, ctx)).toBe(true);
  });

  it('is optional when the subteam was not ranked at all', () => {
    expect(accepts([conditional], {}, { rankedSubteams: [] })).toBe(true);
    expect(accepts([conditional], {}, { rankedSubteams: ['website'] })).toBe(true);
  });

  it('is required when the subteam is inside the top N', () => {
    const ctx = { rankedSubteams: ['website', 'pathfinding', 'devops'] };
    expect(failures([conditional], {}, ctx)).toEqual(['pathfinding-extra']);
    expect(failures([conditional], { 'pathfinding-extra': '  ' }, ctx)).toEqual([
      'pathfinding-extra',
    ]);
    expect(accepts([conditional], { 'pathfinding-extra': 'A* with a heuristic' }, ctx)).toBe(true);
  });

  it('still validates the value of a hidden question that was answered anyway', () => {
    const hidden = select({
      id: 'hidden-select',
      required: false,
      visibleIf: { subteam: 'pathfinding', topN: 1 },
    });
    const ctx = { rankedSubteams: ['website'] };
    expect(failures([hidden], { 'hidden-select': 'Maybe' }, ctx)).toEqual(['hidden-select']);
  });

  it('exposes the visibility rule on its own', () => {
    expect(isQuestionVisible(conditional, ['pathfinding'])).toBe(true);
    expect(isQuestionVisible(conditional, ['website', 'pathfinding'])).toBe(true);
    expect(isQuestionVisible(conditional, ['website', 'devops', 'pathfinding'])).toBe(false);
    expect(isQuestionVisible(conditional, [])).toBe(false);
    // No clause at all means always visible.
    expect(isQuestionVisible(longText(), [])).toBe(true);
  });
});

describe('a whole form', () => {
  it('validates every question together and reports each failure once', () => {
    const questions: Question[] = [
      longText(),
      select(),
      multiSelect({ required: true }),
      scale(),
      ranking(),
    ];

    expect(
      accepts(questions, {
        why: 'Because I like boats',
        saturdays: 'Yes',
        langs: ['Python'],
        git: 4,
        interests: ['Web'],
      }),
    ).toBe(true);

    expect(
      failures(questions, {
        why: '',
        saturdays: 'Maybe',
        langs: [],
        git: 9,
        interests: ['Web', 'Web'],
      }),
    ).toEqual(['why', 'saturdays', 'langs', 'git', 'interests']);
  });
});
