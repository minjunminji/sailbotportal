import type { Question } from '@/lib/questions/types';
import type { ApplyData, ApplyPosting, ApplySubteam } from '@/components/apply/types';

/**
 * A form covering all eight question types, a ranked posting, and an unranked
 * one — the shapes the real postings take, small enough to assert against.
 */

export const subteams: ApplySubteam[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'pathfinding',
    name: 'Pathfinding',
    code: 'PATH',
    description: 'Works out an efficient route from start to finish.',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'network-systems',
    name: 'Network Systems',
    code: 'NET',
    description: 'The bridge between software and hardware.',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    slug: 'boat-simulator',
    name: 'Boat Simulator',
    code: 'SIM',
    description: 'Mimics the real world so software can be tested on land.',
  },
];

export const coreQuestion: Question = {
  id: 'why_sailbot',
  stableKey: 'why_sailbot',
  type: 'long_text',
  label: 'Why do you want to join UBC Sailbot?',
  required: true,
  config: { maxLength: 600 },
};

/** One of each type, so the dispatcher is exercised end to end. */
export const everyQuestionType: Question[] = [
  {
    id: 'github_url',
    type: 'short_text',
    label: 'Link to your GitHub',
    required: false,
    config: { format: 'url', maxLength: 200 },
  },
  {
    id: 'project',
    type: 'long_text',
    label: 'Tell us about a project',
    required: true,
    config: { minWords: 3, maxLength: 500 },
  },
  {
    id: 'saturday',
    type: 'select',
    label: 'Are you free on Saturdays?',
    required: true,
    config: { options: ['Yes', 'No'] },
  },
  {
    id: 'languages',
    type: 'multi_select',
    label: 'Which languages do you know?',
    required: false,
    config: { options: ['Python', 'C++', 'TypeScript'], max: 2 },
  },
  {
    id: 'confidence',
    type: 'scale',
    label: 'How confident are you with Git?',
    required: false,
    config: { min: 1, max: 5, minLabel: 'Never used it', maxLabel: 'Very confident' },
  },
  {
    id: 'skills',
    type: 'matrix',
    label: 'Which skills do you have?',
    required: false,
    config: {
      rows: ['Python', 'Docker'],
      columns: ['I have this skill', 'I want to learn it'],
      mode: 'multi',
    },
  },
  {
    id: 'priorities',
    type: 'ranking',
    label: 'Rank what you want to work on',
    required: false,
    config: { options: ['Firmware', 'Simulation', 'Web'], maxChoices: 2 },
  },
  {
    id: 'quiz_zip',
    type: 'file',
    label: 'Upload your technical quiz',
    required: false,
    config: { accept: ['.zip'], maxBytes: 1024 },
  },
];

/** Asked only of someone who put pathfinding in their top two. */
export const pathOnlyQuestion: Question = {
  id: 'path_question',
  type: 'short_text',
  label: 'What is a heuristic?',
  required: true,
  visibleIf: { subteam: 'pathfinding', topN: 2 },
  config: {},
};

export function softwarePosting(questions: Question[] = everyQuestionType): ApplyPosting {
  return {
    slug: 'soft-2026',
    title: 'Software Team',
    teamName: 'Software',
    description: 'We build the autonomy stack.',
    questions,
    ranking: { enabled: true, minChoices: 1, maxChoices: 3 },
    subteams,
  };
}

export function mechanicalPosting(): ApplyPosting {
  return {
    slug: 'mech-2026',
    title: 'Mechanical Team',
    teamName: 'Mechanical',
    description: 'We build the boat.',
    questions: [
      {
        id: 'ballast',
        type: 'long_text',
        label: 'What is ballast?',
        required: true,
        config: { maxLength: 1500 },
      },
    ],
    ranking: { enabled: false, minChoices: 0, maxChoices: 3 },
    subteams: [],
  };
}

export function applyData(postings: ApplyPosting[] = [softwarePosting()]): ApplyData {
  return { coreQuestions: [coreQuestion], postings };
}
