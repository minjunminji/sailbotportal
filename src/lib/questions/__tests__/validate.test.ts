import { validateQuestion, validateQuestions } from '../validate';
import { QUESTION_TYPES, type Question } from '../types';

/**
 * The point of these tests is the malformed cases. A validator that accepts
 * every well-formed question and also every broken one would pass a
 * happy-path-only suite, and would then wave through the hand-transcribed
 * migration it exists to check.
 */

const validByType: Record<string, Record<string, unknown>> = {
  short_text: {
    id: 'github_url',
    type: 'short_text',
    label: 'Paste your repository URL',
    required: false,
    config: { format: 'url', maxLength: 300 },
  },
  long_text: {
    id: 'ballast',
    type: 'long_text',
    label: 'What is ballast and what is its function on a boat?',
    help: 'In general 2-5 sentences should be sufficient.',
    required: true,
    config: { maxLength: 1500, minWords: 10 },
  },
  select: {
    id: 'quiz_language',
    type: 'select',
    label: 'Which programming language did you use?',
    required: true,
    config: { options: ['Python', 'C++'] },
  },
  multi_select: {
    id: 'interests',
    type: 'multi_select',
    label: 'Which areas interest you?',
    required: false,
    config: { options: ['Pathfinding', 'Controller', 'Simulator'], max: 2 },
  },
  scale: {
    id: 'confidence',
    type: 'scale',
    label: 'How confident are you with C++?',
    required: true,
    config: { min: 1, max: 5, minLabel: 'Never used it', maxLabel: 'Very confident' },
  },
  matrix: {
    id: 'availability_grid',
    type: 'matrix',
    label: 'When are you free?',
    required: false,
    config: {
      rows: ['Monday', 'Tuesday'],
      columns: ['Morning', 'Afternoon'],
      mode: 'multi',
    },
  },
  skills: {
    id: 'technical_skills',
    type: 'skills',
    label: 'What are your technical skills?',
    required: false,
    config: {
      skills: ['Python', 'C/C++'],
      maxLevel: 5,
      minLabel: 'No experience',
      maxLabel: 'Could teach it',
    },
  },
  ranking: {
    id: 'project_preference',
    type: 'ranking',
    label: 'Rank the projects you are most interested in',
    required: true,
    config: { options: ['Pathfinding', 'Controller', 'Simulator'], maxChoices: 3 },
  },
  file: {
    id: 'quiz_zip',
    type: 'file',
    label: 'Upload your technical quiz',
    required: false,
    config: { accept: ['.zip'], maxBytes: 10_485_760 },
  },
};

/** A shallow copy without `key`, for building "field is missing" cases. */
function omit(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

describe('validateQuestion accepts every well-formed type', () => {
  // Guards against a type joining the union with no validation branch: this
  // fails to enumerate before it fails to validate.
  it('covers all nine question types', () => {
    expect(Object.keys(validByType).sort()).toEqual([...QUESTION_TYPES].sort());
  });

  it.each(QUESTION_TYPES)('accepts a valid %s question', (type) => {
    const question = validateQuestion(validByType[type]);
    expect(question.type).toBe(type);
    expect(question.id).toBe(validByType[type].id);
  });

  it('returns a question that narrows on type', () => {
    const question: Question = validateQuestion(validByType.ranking);
    expect(question.type).toBe('ranking');
    if (question.type !== 'ranking') throw new Error('expected a ranking question');
    expect(question.config.maxChoices).toBe(3);
  });

  it('accepts a visibleIf clause', () => {
    const question = validateQuestion({
      ...validByType.long_text,
      visibleIf: { subteam: 'pathfinding', topN: 2 },
    });
    expect(question.visibleIf).toEqual({ subteam: 'pathfinding', topN: 2 });
  });

  it('accepts a stableKey, as core questions carry one', () => {
    const question = validateQuestion({ ...validByType.long_text, stableKey: 'why_sailbot' });
    expect(question.stableKey).toBe('why_sailbot');
  });
});

describe('shape and identity', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'long_text'],
    ['a number', 7],
  ])('rejects %s', (_name, value) => {
    expect(() => validateQuestion(value)).toThrow(/expected an object/);
  });

  it('rejects an unknown type', () => {
    expect(() => validateQuestion({ ...validByType.long_text, type: 'wordle' })).toThrow(
      /unknown question type/,
    );
  });

  it('rejects a missing type', () => {
    expect(() => validateQuestion(omit(validByType.long_text, 'type'))).toThrow(
      /unknown question type/,
    );
  });

  it('rejects an empty id', () => {
    expect(() => validateQuestion({ ...validByType.long_text, id: '' })).toThrow(/id/);
  });

  it.each(['has space', 'why.sailbot', 'why/sailbot', 'wh?y', 'ballast!'])(
    'rejects the non-URL-safe id %p',
    (id) => {
      expect(() => validateQuestion({ ...validByType.long_text, id })).toThrow(/URL-safe/);
    },
  );

  it('rejects a blank label', () => {
    expect(() => validateQuestion({ ...validByType.long_text, label: '   ' })).toThrow(/label/);
  });

  it('rejects a non-boolean required', () => {
    expect(() => validateQuestion({ ...validByType.long_text, required: 'yes' })).toThrow();
  });

  it('rejects an unknown top-level key, which is how a typo shows up', () => {
    expect(() => validateQuestion({ ...validByType.long_text, halp: 'Oops' })).toThrow(
      /Unrecognized|unrecognized/,
    );
  });

  it('rejects an unknown config key', () => {
    expect(() =>
      validateQuestion({
        ...validByType.select,
        config: { options: ['Yes', 'No'], maxChoices: 1 },
      }),
    ).toThrow(/Unrecognized|unrecognized/);
  });

  it('names the offending question in the error', () => {
    expect(() => validateQuestion({ ...validByType.select, config: { options: [] } })).toThrow(
      /quiz_language/,
    );
  });
});

describe('select, multi_select and ranking need real options', () => {
  it.each(['select', 'multi_select', 'ranking'])(
    'rejects %s with an empty options list',
    (type) => {
      const config = { ...(validByType[type].config as Record<string, unknown>), options: [] };
      expect(() => validateQuestion({ ...validByType[type], config })).toThrow(
        /options must not be empty/,
      );
    },
  );

  it.each(['select', 'multi_select', 'ranking'])(
    'rejects %s with a missing options list',
    (type) => {
      const config = omit(validByType[type].config as Record<string, unknown>, 'options');
      expect(() => validateQuestion({ ...validByType[type], config })).toThrow();
    },
  );

  it('rejects an option that is an empty string', () => {
    expect(() =>
      validateQuestion({ ...validByType.select, config: { options: ['Yes', '  '] } }),
    ).toThrow(/options must not contain an empty entry/);
  });

  it('rejects duplicate options, which make an answer ambiguous', () => {
    expect(() =>
      validateQuestion({ ...validByType.select, config: { options: ['Yes', 'No', 'Yes'] } }),
    ).toThrow(/options must not contain duplicates/);
  });

  it('rejects multi_select whose max exceeds the option count', () => {
    expect(() =>
      validateQuestion({
        ...validByType.multi_select,
        config: { options: ['A', 'B'], max: 3 },
      }),
    ).toThrow(/max must not exceed/);
  });
});

describe('ranking maxChoices', () => {
  it('rejects maxChoices of 0', () => {
    expect(() =>
      validateQuestion({
        ...validByType.ranking,
        config: { options: ['A', 'B', 'C'], maxChoices: 0 },
      }),
    ).toThrow();
  });

  it('rejects a negative maxChoices', () => {
    expect(() =>
      validateQuestion({
        ...validByType.ranking,
        config: { options: ['A', 'B', 'C'], maxChoices: -1 },
      }),
    ).toThrow();
  });

  it('rejects maxChoices larger than the option list', () => {
    expect(() =>
      validateQuestion({
        ...validByType.ranking,
        config: { options: ['A', 'B'], maxChoices: 3 },
      }),
    ).toThrow(/maxChoices must not exceed/);
  });

  it('accepts maxChoices equal to the option count', () => {
    const question = validateQuestion({
      ...validByType.ranking,
      config: { options: ['A', 'B'], maxChoices: 2 },
    });
    expect(question.type).toBe('ranking');
  });

  it('rejects a non-integer maxChoices', () => {
    expect(() =>
      validateQuestion({
        ...validByType.ranking,
        config: { options: ['A', 'B', 'C'], maxChoices: 1.5 },
      }),
    ).toThrow();
  });
});

describe('scale bounds', () => {
  it('rejects min equal to max', () => {
    expect(() => validateQuestion({ ...validByType.scale, config: { min: 3, max: 3 } })).toThrow(
      /min must be less than max/,
    );
  });

  it('rejects min greater than max', () => {
    expect(() => validateQuestion({ ...validByType.scale, config: { min: 5, max: 1 } })).toThrow(
      /min must be less than max/,
    );
  });

  it('rejects non-integer bounds', () => {
    expect(() =>
      validateQuestion({ ...validByType.scale, config: { min: 0.5, max: 5 } }),
    ).toThrow();
  });

  it('rejects a missing bound', () => {
    expect(() => validateQuestion({ ...validByType.scale, config: { min: 1 } })).toThrow();
  });
});

describe('matrix rows, columns and mode', () => {
  it('rejects empty rows', () => {
    expect(() =>
      validateQuestion({
        ...validByType.matrix,
        config: { rows: [], columns: ['Have'], mode: 'multi' },
      }),
    ).toThrow(/rows must not be empty/);
  });

  it('rejects empty columns', () => {
    expect(() =>
      validateQuestion({
        ...validByType.matrix,
        config: { rows: ['Python'], columns: [], mode: 'multi' },
      }),
    ).toThrow(/columns must not be empty/);
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      validateQuestion({
        ...validByType.matrix,
        config: { rows: ['Python'], columns: ['Have'], mode: 'many' },
      }),
    ).toThrow();
  });

  it('rejects a missing mode', () => {
    expect(() =>
      validateQuestion({
        ...validByType.matrix,
        config: { rows: ['Python'], columns: ['Have'] },
      }),
    ).toThrow();
  });

  it('rejects duplicate rows, which collide as answer keys', () => {
    expect(() =>
      validateQuestion({
        ...validByType.matrix,
        config: { rows: ['Python', 'Python'], columns: ['Have'], mode: 'multi' },
      }),
    ).toThrow(/rows must not contain duplicates/);
  });
});

describe('file accept and maxBytes', () => {
  it('rejects an empty accept list', () => {
    expect(() =>
      validateQuestion({ ...validByType.file, config: { accept: [], maxBytes: 1000 } }),
    ).toThrow(/accept must not be empty/);
  });

  it('rejects maxBytes of 0', () => {
    expect(() =>
      validateQuestion({ ...validByType.file, config: { accept: ['.zip'], maxBytes: 0 } }),
    ).toThrow();
  });

  it('rejects a negative maxBytes', () => {
    expect(() =>
      validateQuestion({ ...validByType.file, config: { accept: ['.zip'], maxBytes: -1 } }),
    ).toThrow();
  });

  it('rejects a missing maxBytes', () => {
    expect(() => validateQuestion({ ...validByType.file, config: { accept: ['.zip'] } })).toThrow();
  });
});

describe('visibleIf', () => {
  it('rejects topN of 0, which would hide the question from everyone', () => {
    expect(() =>
      validateQuestion({
        ...validByType.long_text,
        visibleIf: { subteam: 'pathfinding', topN: 0 },
      }),
    ).toThrow();
  });

  it('rejects an empty subteam', () => {
    expect(() =>
      validateQuestion({ ...validByType.long_text, visibleIf: { subteam: '', topN: 1 } }),
    ).toThrow();
  });

  it('rejects an unknown key inside visibleIf', () => {
    expect(() =>
      validateQuestion({
        ...validByType.long_text,
        visibleIf: { subteam: 'pathfinding', topN: 1, unless: 'x' },
      }),
    ).toThrow(/Unrecognized|unrecognized/);
  });
});

describe('validateQuestions over a set', () => {
  it('accepts a well-formed set and returns it in order', () => {
    const questions = validateQuestions([validByType.select, validByType.long_text]);
    expect(questions.map((q) => q.id)).toEqual(['quiz_language', 'ballast']);
  });

  it('accepts an empty set — a posting may lean on core questions alone', () => {
    expect(validateQuestions([])).toEqual([]);
  });

  it('rejects a non-array', () => {
    expect(() => validateQuestions({ id: 'x' })).toThrow(/expected an array/);
  });

  it('rejects duplicate ids', () => {
    expect(() => validateQuestions([validByType.select, { ...validByType.select }])).toThrow(
      /duplicate question id 'quiz_language'/,
    );
  });

  it('reports the first malformed member', () => {
    expect(() =>
      validateQuestions([validByType.select, { ...validByType.scale, config: { min: 9, max: 1 } }]),
    ).toThrow(/confidence/);
  });
});
