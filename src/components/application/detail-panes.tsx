'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * Answers on the left, resume on the right.
 *
 * Side by side once there is room for both, because the reason a lead opens an
 * application is to read an answer against the resume — putting one behind the
 * other turns every comparison into two navigations.
 *
 * Below `lg` there is no such room, so the two become tabs. Real tabs, with
 * `role="tablist"` and `aria-controls`, rather than two buttons that toggle a
 * class: the panels are alternatives to each other and that is what tab
 * semantics say. Both panels stay mounted and are hidden with `hidden`, so
 * switching tabs never re-fetches or re-renders the resume — and at `lg` the
 * `lg:block` override shows both regardless of which tab is selected.
 */
export function DetailPanes({ answers, resume }: { answers: ReactNode; resume: ReactNode }) {
  const [tab, setTab] = useState<'answers' | 'resume'>('answers');
  const base = useId();
  const ids = {
    answersTab: `${base}-answers-tab`,
    answersPanel: `${base}-answers-panel`,
    resumeTab: `${base}-resume-tab`,
    resumePanel: `${base}-resume-panel`,
  };

  const tabClasses = (active: boolean) =>
    `rounded-md px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
      active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div role="tablist" aria-label="Application sections" className="flex gap-2 lg:hidden">
        <button
          type="button"
          role="tab"
          id={ids.answersTab}
          aria-selected={tab === 'answers'}
          aria-controls={ids.answersPanel}
          onClick={() => setTab('answers')}
          className={tabClasses(tab === 'answers')}
        >
          Answers
        </button>
        <button
          type="button"
          role="tab"
          id={ids.resumeTab}
          aria-selected={tab === 'resume'}
          aria-controls={ids.resumePanel}
          onClick={() => setTab('resume')}
          className={tabClasses(tab === 'resume')}
        >
          Resume
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        <div
          role="tabpanel"
          id={ids.answersPanel}
          aria-labelledby={ids.answersTab}
          // `min-w-0` or a long unbroken answer widens the pane instead of
          // wrapping inside it.
          className={`min-w-0 flex-1 overflow-y-auto ${tab === 'answers' ? '' : 'hidden'} lg:block`}
        >
          {answers}
        </div>

        {/* No width cap. Extra room goes to the resume rather than to the
            answers, which are capped at a readable measure instead — a line of
            prose 900px long is harder to read than one at 600px, while a PDF
            only gets better with the space. */}
        <div
          role="tabpanel"
          id={ids.resumePanel}
          aria-labelledby={ids.resumeTab}
          // `min-h-0` so the viewer inside can own its own scrolling rather
          // than stretching this panel to the height of a zoomed-in page.
          className={`flex min-h-0 min-w-0 flex-1 ${tab === 'resume' ? '' : 'hidden'} lg:flex`}
        >
          {resume}
        </div>
      </div>
    </div>
  );
}
