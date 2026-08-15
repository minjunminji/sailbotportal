import {
  QUESTION_TYPES,
  assertNeverQuestion,
  isFile,
  isLongText,
  isMatrix,
  isMultiSelect,
  isQuestionOfType,
  isQuestionType,
  isRanking,
  isScale,
  isSelect,
  isShortText,
  type AnswerFor,
  type FileQuestion,
  type MatrixQuestion,
  type Question,
  type RankingQuestion,
  type ScaleQuestion,
  type SelectQuestion,
  type ShortTextQuestion,
} from '../types';

/**
 * Half of what this file checks is invisible at runtime: that narrowing a
 * `Question` narrows its `config` and its answer shape with it, and that a
 * malformed config fails to compile. Those assertions are enforced by
 * `npm run typecheck`, not by Jest — an unused `@ts-expect-error` is itself a
 * compile error, so a directive that stops being true fails the build.
 */

const shortText: ShortTextQuestion = {
  id: 'github',
  type: 'short_text',
  label: 'GitHub profile',
  required: false,
  config: { format: 'url', maxLength: 200 },
};

const select: SelectQuestion = {
  id: 'saturdays',
  type: 'select',
  label: 'Are you available on Saturdays?',
  required: true,
  config: { options: ['Yes', 'No', 'Sometimes'] },
};

const matrix: MatrixQuestion = {
  id: 'skills',
  type: 'matrix',
  label: 'Skills',
  required: false,
  config: {
    rows: ['Python', 'C++'],
    columns: ['I have this skill', 'I want to learn or improve this skill'],
    mode: 'multi',
  },
};

const ranking: RankingQuestion = {
  id: 'interests',
  type: 'ranking',
  label: 'Rank these interests',
  required: true,
  config: { options: ['Sim', 'Controls', 'Web'], maxChoices: 3 },
};

const scale: ScaleQuestion = {
  id: 'confidence',
  type: 'scale',
  label: 'How confident are you with Git?',
  required: true,
  config: { min: 1, max: 5, minLabel: 'Never used it', maxLabel: 'Daily' },
};

const file: FileQuestion = {
  id: 'quiz-zip',
  type: 'file',
  label: 'Upload your solution',
  required: false,
  config: { accept: ['.zip'], maxBytes: 10_000_000 },
};

describe('question type union', () => {
  it('lists all eight types exactly once', () => {
    expect(QUESTION_TYPES).toHaveLength(8);
    expect(new Set(QUESTION_TYPES).size).toBe(8);
    expect([...QUESTION_TYPES].sort()).toEqual(
      [
        'file',
        'long_text',
        'matrix',
        'multi_select',
        'ranking',
        'scale',
        'select',
        'short_text',
      ].sort(),
    );
  });

  it('recognises known type names and rejects unknown ones', () => {
    expect(isQuestionType('matrix')).toBe(true);
    expect(isQuestionType('checkbox')).toBe(false);
    expect(isQuestionType(null)).toBe(false);
    expect(isQuestionType(7)).toBe(false);
  });
});

describe('type guards narrow the config', () => {
  it('narrows short_text', () => {
    const question: Question = shortText;
    expect(isShortText(question)).toBe(true);
    expect(isLongText(question)).toBe(false);
    if (!isShortText(question)) throw new Error('expected short_text');
    // Reading `format` only compiles because the union narrowed.
    expect(question.config.format).toBe('url');
  });

  it('narrows select', () => {
    const question: Question = select;
    if (!isSelect(question)) throw new Error('expected select');
    expect(question.config.options).toContain('Sometimes');
  });

  it('narrows matrix', () => {
    const question: Question = matrix;
    if (!isMatrix(question)) throw new Error('expected matrix');
    expect(question.config.mode).toBe('multi');
    expect(question.config.rows).toHaveLength(2);
  });

  it('narrows ranking, scale and file', () => {
    const questions: Question[] = [ranking, scale, file];
    const seen: string[] = [];

    for (const question of questions) {
      if (isRanking(question)) seen.push(`ranking:${question.config.maxChoices}`);
      else if (isScale(question)) seen.push(`scale:${question.config.min}-${question.config.max}`);
      else if (isFile(question)) seen.push(`file:${question.config.accept.join()}`);
    }

    expect(seen).toEqual(['ranking:3', 'scale:1-5', 'file:.zip']);
  });

  it('reports false for the wrong guard', () => {
    expect(isMultiSelect(select)).toBe(false);
    expect(isSelect(matrix)).toBe(false);
    expect(isScale(file)).toBe(false);
  });

  it('narrows through the generic guard', () => {
    const question: Question = ranking;
    expect(isQuestionOfType(question, 'ranking')).toBe(true);
    expect(isQuestionOfType(question, 'select')).toBe(false);
    if (!isQuestionOfType(question, 'ranking')) throw new Error('expected ranking');
    expect(question.config.options).toHaveLength(3);
  });
});

describe('exhaustiveness', () => {
  /** A switch that handles all eight compiles; the default branch is unreachable. */
  function describeConfig(question: Question): string {
    switch (question.type) {
      case 'short_text':
        return `short_text:${question.config.format ?? 'plain'}`;
      case 'long_text':
        return `long_text:${question.config.minWords ?? 0}`;
      case 'select':
        return `select:${question.config.options.length}`;
      case 'multi_select':
        return `multi_select:${question.config.max ?? 'unbounded'}`;
      case 'scale':
        return `scale:${question.config.max}`;
      case 'matrix':
        return `matrix:${question.config.mode}`;
      case 'ranking':
        return `ranking:${question.config.maxChoices}`;
      case 'file':
        return `file:${question.config.maxBytes}`;
      default:
        return assertNeverQuestion(question);
    }
  }

  it('describes each variant through its own config', () => {
    expect(describeConfig(shortText)).toBe('short_text:url');
    expect(describeConfig(select)).toBe('select:3');
    expect(describeConfig(matrix)).toBe('matrix:multi');
    expect(describeConfig(scale)).toBe('scale:5');
    expect(describeConfig(file)).toBe('file:10000000');
  });

  it('throws if an unknown type reaches the default branch at runtime', () => {
    const smuggled = { id: 'x', type: 'wordle', label: 'x', required: true, config: {} };
    expect(() => describeConfig(smuggled as unknown as Question)).toThrow(
      /Unhandled question type/,
    );
  });
});

describe('answer shapes follow the question type', () => {
  it('accepts the right answer per type', () => {
    const shortTextAnswer: AnswerFor<ShortTextQuestion> = 'https://github.com/example';
    const rankingAnswer: AnswerFor<RankingQuestion> = ['Web', 'Sim'];
    const scaleAnswer: AnswerFor<ScaleQuestion> = 4;
    const matrixAnswer: AnswerFor<MatrixQuestion> = { Python: ['I have this skill'], 'C++': [] };
    const fileAnswer: AnswerFor<FileQuestion> = {
      path: 'uploads/8f1c.zip',
      filename: 'solution.zip',
      size: 1024,
    };

    expect(shortTextAnswer.startsWith('https://')).toBe(true);
    expect(rankingAnswer).toHaveLength(2);
    expect(scaleAnswer).toBe(4);
    expect(matrixAnswer.Python).toEqual(['I have this skill']);
    expect(fileAnswer.filename).toBe('solution.zip');
  });
});

describe('invalid shapes do not compile', () => {
  it('is enforced by typecheck, not at runtime', () => {
    const missingOptions: SelectQuestion = {
      id: 'a',
      type: 'select',
      label: 'A',
      required: true,
      // @ts-expect-error select requires `options` in its config
      config: {},
    };

    const halfScale: ScaleQuestion = {
      id: 'b',
      type: 'scale',
      label: 'B',
      required: true,
      // @ts-expect-error a scale needs both bounds
      config: { min: 1 },
    };

    const badMode: MatrixQuestion = {
      id: 'c',
      type: 'matrix',
      label: 'C',
      required: true,
      config: {
        rows: ['r'],
        columns: ['c'],
        // @ts-expect-error mode is a closed set
        mode: 'triple',
      },
    };

    const notAType: Question = {
      id: 'd',
      // @ts-expect-error 'wordle' is not one of the eight types
      type: 'wordle',
      label: 'D',
      required: true,
      config: {},
    };

    const wrongConfigForType: SelectQuestion = {
      id: 'e',
      type: 'select',
      label: 'E',
      required: true,
      config: {
        options: ['x'],
        // @ts-expect-error `max` belongs to multi_select, not select
        max: 2,
      },
    };

    // @ts-expect-error a ranking answer is a list, not a single string
    const wrongAnswer: AnswerFor<RankingQuestion> = 'Web';

    // @ts-expect-error a matrix answer maps rows to arrays, not to bare strings
    const wrongMatrixAnswer: AnswerFor<MatrixQuestion> = { Python: 'I have this skill' };

    expect([
      missingOptions,
      halfScale,
      badMode,
      notAType,
      wrongConfigForType,
      wrongAnswer,
      wrongMatrixAnswer,
    ]).toHaveLength(7);
  });
});
