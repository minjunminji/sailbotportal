import { resolveQuestions, type CoreQuestionRow } from '../snapshot';
import type { Question } from '../types';

/**
 * `resolveQuestions` produces the array that gets frozen onto every
 * application row. Two properties matter more than anything else here:
 * the merge is ordered and total, and the result shares no references with
 * its sources — see snapshot.integration.test.ts for why.
 */

function coreRow(stableKey: string, position: number, label: string): CoreQuestionRow {
  return {
    stable_key: stableKey,
    position,
    definition: { type: 'long_text', label, required: true, config: { maxLength: 600 } },
  };
}

const whySailbot = coreRow('why_sailbot', 0, 'Why would you like to join UBC Sailbot?');
const commitment = coreRow('commitment', 1, 'How many hours a week can you commit?');

function postingQuestion(id: string, label: string): Question {
  return { id, type: 'long_text', label, required: false, config: {} };
}

describe('resolveQuestions', () => {
  it('puts core questions first, ordered by position', () => {
    const resolved = resolveQuestions([commitment, whySailbot], {
      question_schema: [postingQuestion('ballast', 'Why is ballast needed?')],
    });

    expect(resolved.map((q) => q.id)).toEqual(['why_sailbot', 'commitment', 'ballast']);
  });

  it('keeps the posting questions in their authored order', () => {
    const resolved = resolveQuestions([], {
      question_schema: [
        postingQuestion('c', 'Third'),
        postingQuestion('a', 'First'),
        postingQuestion('b', 'Second'),
      ],
    });

    expect(resolved.map((q) => q.id)).toEqual(['c', 'a', 'b']);
  });

  it('carries the stable key onto core questions and leaves it off posting ones', () => {
    const resolved = resolveQuestions([whySailbot], {
      question_schema: [postingQuestion('ballast', 'Why is ballast needed?')],
    });

    expect(resolved[0]).toMatchObject({
      id: 'why_sailbot',
      stableKey: 'why_sailbot',
      type: 'long_text',
      label: 'Why would you like to join UBC Sailbot?',
      required: true,
      config: { maxLength: 600 },
    });
    expect(resolved[1].stableKey).toBeUndefined();
  });

  it('yields just the core set for a posting with no questions', () => {
    expect(resolveQuestions([whySailbot, commitment], { question_schema: [] }).map((q) => q.id)) //
      .toEqual(['why_sailbot', 'commitment']);
  });

  it('yields just the posting set when there are no core questions', () => {
    expect(resolveQuestions([], { question_schema: [postingQuestion('a', 'A')] })).toHaveLength(1);
  });

  it('yields an empty array when neither side has questions', () => {
    expect(resolveQuestions([], { question_schema: [] })).toEqual([]);
  });

  it('surfaces a collision between a core id and a posting id', () => {
    // Shadowing here would drop the core question from the snapshot, and the
    // export column keyed by its stable key would quietly go empty.
    expect(() =>
      resolveQuestions([whySailbot], {
        question_schema: [postingQuestion('why_sailbot', 'A team question wearing a core id')],
      }),
    ).toThrow(/why_sailbot/);
  });

  it('surfaces a collision between two posting questions', () => {
    expect(() =>
      resolveQuestions([], {
        question_schema: [postingQuestion('ballast', 'First'), postingQuestion('ballast', 'Copy')],
      }),
    ).toThrow(/ballast/);
  });

  it('surfaces a collision between two core questions', () => {
    expect(() =>
      resolveQuestions([whySailbot, coreRow('why_sailbot', 3, 'Duplicate')], {}),
    ).toThrow(/why_sailbot/);
  });

  it('rejects a question_schema that is not an array of questions', () => {
    expect(() => resolveQuestions([], { question_schema: { a: 1 } })).toThrow();
    expect(() => resolveQuestions([], { question_schema: ['not an object'] })).toThrow();
    expect(() =>
      resolveQuestions([], { question_schema: [{ id: '', type: 'long_text' }] }),
    ).toThrow(/id/);
    expect(() => resolveQuestions([], { question_schema: [{ id: 'x', type: 'wordle' }] })).toThrow(
      /wordle/,
    );
  });

  it('treats a null or missing question_schema as no questions', () => {
    expect(resolveQuestions([whySailbot], {}).map((q) => q.id)).toEqual(['why_sailbot']);
    expect(resolveQuestions([whySailbot], { question_schema: null }).map((q) => q.id)) //
      .toEqual(['why_sailbot']);
  });
});

describe('the resolved array is a deep copy', () => {
  it('does not change when the posting is edited afterwards', () => {
    const postingQuestions = [postingQuestion('ballast', 'Original wording')];
    const posting = { question_schema: postingQuestions };

    const resolved = resolveQuestions([whySailbot], posting);

    postingQuestions[0].label = 'Reworded later';
    postingQuestions.push(postingQuestion('new', 'Added later'));

    expect(resolved).toHaveLength(2);
    expect(resolved[1].label).toBe('Original wording');
  });

  it('does not change when the core definition is mutated afterwards', () => {
    const core = coreRow('why_sailbot', 0, 'Original core wording');
    const resolved = resolveQuestions([core], { question_schema: [] });

    (core.definition as { label: string }).label = 'Reworded later';
    (core.definition as { config: { maxLength: number } }).config.maxLength = 1;

    expect(resolved[0].label).toBe('Original core wording');
    expect(resolved[0].config).toEqual({ maxLength: 600 });
  });

  it('does not write back into the posting when the result is mutated', () => {
    const original = postingQuestion('ballast', 'Original wording');
    const posting = { question_schema: [original] };

    const resolved = resolveQuestions([], posting);
    resolved[0].label = 'Mutated after resolution';
    (resolved[0].config as { maxLength?: number }).maxLength = 5;

    expect(original.label).toBe('Original wording');
    expect(original.config).toEqual({});
  });

  it('shares no nested references at all', () => {
    const posting = {
      question_schema: [
        {
          id: 'langs',
          type: 'multi_select',
          label: 'Languages',
          required: false,
          config: { options: ['C++', 'Python'] },
        },
      ],
    };

    const resolved = resolveQuestions([], posting);
    const source = posting.question_schema[0];

    expect(resolved[0]).not.toBe(source);
    expect(resolved[0].config).not.toBe(source.config);
    expect((resolved[0].config as { options: string[] }).options).not.toBe(source.config.options);
    expect(resolved[0]).toEqual(source);
  });
});
