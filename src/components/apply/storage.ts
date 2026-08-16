import { isFile, type AnswerMap } from '@/lib/questions/types';
import { emptyFormState, emptyTeamState, type ApplyData, type FormState } from './types';

/**
 * Draft autosave.
 *
 * The quizzes here run to a dozen essay questions. A refresh, a closed laptop,
 * or a browser that reclaims a background tab must not cost twenty minutes of
 * writing, and an applicant has no account to save against — so the draft lives
 * in `localStorage` and nowhere else.
 *
 * Two things are deliberately NOT persisted:
 *
 * - The resume path and any `file` answer. Those name objects in storage that
 *   the server issued for this session; a path restored a week later may point
 *   at nothing, and the submission would then fail with an error about a file
 *   the applicant cannot see. Re-uploading is cheap; a mystery failure is not.
 * - Anything at all if the shape does not match this version. A draft written
 *   by an older form is discarded rather than half-restored.
 */

/**
 * Bump when the persisted shape changes. The key carries it, so an old draft is
 * simply never read rather than needing a migration.
 */
export const FORM_VERSION = 1;

export const DRAFT_KEY = `sailbot-apply-draft-v${FORM_VERSION}`;

type DraftTeam = {
  selected: boolean | null;
  answers: AnswerMap;
  rankedSubteams: string[];
};

type Draft = {
  version: number;
  savedAt: string;
  name: string;
  email: string;
  yearOfStudy: string;
  homeDepartment: string;
  coreAnswers: AnswerMap;
  teams: Record<string, DraftTeam>;
};

/** Question ids whose answers reference server state, keyed nowhere else. */
function fileQuestionIds(data: ApplyData): Set<string> {
  const ids = new Set<string>();
  for (const question of data.coreQuestions) if (isFile(question)) ids.add(question.id);
  for (const posting of data.postings) {
    for (const question of posting.questions) if (isFile(question)) ids.add(question.id);
  }
  return ids;
}

function withoutFiles(answers: AnswerMap, fileIds: Set<string>): AnswerMap {
  const out: AnswerMap = {};
  for (const [id, value] of Object.entries(answers)) {
    if (fileIds.has(id) || value === undefined) continue;
    out[id] = value;
  }
  return out;
}

function storage(): Storage | null {
  // Absent during SSR, and throws in Safari private mode rather than returning
  // null — a draft that cannot be saved must not take the form down with it.
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(data: ApplyData, state: FormState): void {
  const store = storage();
  if (!store) return;

  const fileIds = fileQuestionIds(data);

  const draft: Draft = {
    version: FORM_VERSION,
    savedAt: new Date().toISOString(),
    name: state.name,
    email: state.email,
    yearOfStudy: state.yearOfStudy,
    homeDepartment: state.homeDepartment,
    coreAnswers: withoutFiles(state.coreAnswers, fileIds),
    teams: Object.fromEntries(
      Object.entries(state.teams).map(([slug, team]) => [
        slug,
        {
          selected: team.selected,
          answers: withoutFiles(team.answers, fileIds),
          rankedSubteams: team.rankedSubteams,
        },
      ]),
    ),
  };

  try {
    store.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota exceeded, or storage disabled. The form still works; it just will
    // not survive a refresh, and saying so on every keystroke would be noise.
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do; the draft is already unreachable.
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asAnswerMap(value: unknown, fileIds: Set<string>): AnswerMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  // File answers are stripped on the way in as well as on the way out: a draft
  // from an older version, or one edited by hand, could still carry one.
  return withoutFiles(value as AnswerMap, fileIds);
}

/**
 * Reads a saved draft back onto the current form.
 *
 * Reconciled against `data` rather than trusted: a posting that closed since
 * the draft was written is dropped, so a restored draft can never select a team
 * the form is no longer showing. Returns null when there is nothing usable,
 * which the caller treats as "start empty".
 */
export function loadDraft(data: ApplyData): FormState | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft();
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const draft = parsed as Partial<Draft>;
  if (draft.version !== FORM_VERSION) return null;

  const fileIds = fileQuestionIds(data);
  const state = emptyFormState(data);

  state.name = asString(draft.name);
  state.email = asString(draft.email);
  state.yearOfStudy = asString(draft.yearOfStudy);
  state.homeDepartment = asString(draft.homeDepartment);
  state.coreAnswers = asAnswerMap(draft.coreAnswers, fileIds);

  const savedTeams =
    typeof draft.teams === 'object' && draft.teams !== null
      ? (draft.teams as Record<string, unknown>)
      : {};

  for (const posting of data.postings) {
    const saved = savedTeams[posting.slug];
    if (typeof saved !== 'object' || saved === null) continue;

    const team = saved as Partial<DraftTeam>;
    const known = new Set(posting.subteams.map((subteam) => subteam.id));

    state.teams[posting.slug] = {
      ...emptyTeamState(),
      selected: team.selected === true ? true : team.selected === false ? false : null,
      answers: asAnswerMap(team.answers, fileIds),
      // Subteams can be deactivated between sessions, and `maxChoices` can be
      // lowered; a stale or over-long list would be rejected by the server with
      // an error naming a subteam nobody can see.
      rankedSubteams: Array.isArray(team.rankedSubteams)
        ? [
            ...new Set(
              team.rankedSubteams.filter(
                (id): id is string => typeof id === 'string' && known.has(id),
              ),
            ),
          ].slice(0, posting.ranking.enabled ? posting.ranking.maxChoices : 0)
        : [],
    };
  }

  return state;
}
