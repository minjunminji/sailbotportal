'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import {
  BOARD_FILTER_PARAMS,
  EMPTY_BOARD_FILTERS,
  serialiseBoardFilters,
  type BoardFilters,
  type BoardSubteam,
} from '@/lib/applications/queries';
import { controlClasses, smallButtonClasses } from '@/components/apply/question-shell';

/**
 * The board's filter controls.
 *
 * A REAL `<form method="get">` with named inputs, wrapped in a submit handler
 * rather than replaced by one. The handler is what produces a clean shareable
 * URL — `serialiseBoardFilters` omits the filters that are not set, so a search
 * for one name gives `?q=jane` and not `?subteam=&from=&to=&q=jane`. If the
 * handler never runs the browser still submits the form to the same page and
 * `parseBoardFilters` discards the empty values, so the filters work either way.
 *
 * The values are held in local state rather than read back from the URL on
 * every keystroke, so typing does not navigate. One submit, one navigation, one
 * history entry — which is what makes the back button walk back through
 * searches the way a lead expects.
 */
export function BoardFilterBar({
  filters,
  subteams,
  showSubteamFilter,
  basePath,
}: {
  /** From the URL, so the controls show what the board is actually showing. */
  filters: BoardFilters;
  subteams: BoardSubteam[];
  /**
   * Only Software ranks subteams. On a board where every first choice is null
   * the control could do nothing but empty the board, so it is not offered.
   */
  showSubteamFilter: boolean;
  basePath: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BoardFilters>(filters);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = serialiseBoardFilters(draft).toString();
    router.push(query === '' ? basePath : `${basePath}?${query}`);
  }

  function clear() {
    setDraft(EMPTY_BOARD_FILTERS);
    router.push(basePath);
  }

  // `value=''` for "not filtering", because a select cannot hold null and an
  // empty string is what an untouched text input submits anyway.
  const set = <K extends keyof BoardFilters>(key: K, value: string) =>
    setDraft((current) => ({ ...current, [key]: value === '' ? null : value }));

  return (
    <form
      method="get"
      action={basePath}
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-56 flex-1">
        <label htmlFor="board-search" className="block text-sm font-medium">
          Search
        </label>
        <input
          id="board-search"
          name={BOARD_FILTER_PARAMS.search}
          type="search"
          value={draft.search ?? ''}
          onChange={(event) => set('search', event.target.value)}
          placeholder="Name or email"
          className={`mt-1 ${controlClasses}`}
        />
      </div>

      {showSubteamFilter ? (
        <div>
          <label htmlFor="board-subteam" className="block text-sm font-medium">
            First choice
          </label>
          <select
            id="board-subteam"
            name={BOARD_FILTER_PARAMS.firstChoiceSubteamId}
            value={draft.firstChoiceSubteamId ?? ''}
            onChange={(event) => set('firstChoiceSubteamId', event.target.value)}
            className={`mt-1 ${controlClasses}`}
          >
            <option value="">Any subteam</option>
            {subteams.map((subteam) => (
              <option key={subteam.id} value={subteam.id}>
                {subteam.code ? `${subteam.code} — ${subteam.name}` : subteam.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label htmlFor="board-from" className="block text-sm font-medium">
          Submitted from
        </label>
        <input
          id="board-from"
          name={BOARD_FILTER_PARAMS.submittedFrom}
          type="date"
          value={draft.submittedFrom ?? ''}
          onChange={(event) => set('submittedFrom', event.target.value)}
          className={`mt-1 ${controlClasses}`}
        />
      </div>

      <div>
        <label htmlFor="board-to" className="block text-sm font-medium">
          Submitted to
        </label>
        <input
          id="board-to"
          name={BOARD_FILTER_PARAMS.submittedTo}
          type="date"
          value={draft.submittedTo ?? ''}
          onChange={(event) => set('submittedTo', event.target.value)}
          className={`mt-1 ${controlClasses}`}
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" className={smallButtonClasses}>
          Apply filters
        </button>
        <button type="button" onClick={clear} className={smallButtonClasses}>
          Clear
        </button>
      </div>
    </form>
  );
}
