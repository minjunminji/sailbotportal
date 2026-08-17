'use client';

import type { SkillsAnswer, SkillsQuestion } from '@/lib/questions/types';
import { asSkillsAnswer } from '../answers';
import { QuestionShell } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * The four columns, shared by the header and every row so they line up.
 *
 * The name column may shrink before the slider does, because a truncated skill
 * name is still recognisable where a 40px slider is not usable at all. The last
 * column is wide enough for the wrapped heading above it, with the checkbox
 * centred under that rather than under itself.
 */
const GRID = 'grid grid-cols-[minmax(4rem,9rem)_minmax(5rem,1fr)_1.5rem_4.5rem] gap-x-3';

/**
 * A proficiency scale per skill, plus a box for wanting to work on it.
 *
 * This replaced a matrix of "I have this skill" / "I want to learn this skill"
 * checkboxes. That grid could only put a skill in one bucket or the other, and
 * answering it meant tracing a column header across a row to an unlabelled box.
 * Level and interest are separate axes: being good at Python says nothing about
 * whether you want to spend a year on it.
 *
 * THE BOTTOM OF THE SCALE MEANS "NO EXPERIENCE". A range input always holds a
 * value — there is no blank — so the resting position has to mean something,
 * and the only honest meaning for a row nobody has touched is "nothing here".
 * That is also why such a row is not stored: fifteen untouched sliders must not
 * become fifteen claims of level 1 in the export.
 */
export function SkillsField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<SkillsQuestion>) {
  const answer = asSkillsAnswer(value);
  const { skills, maxLevel, minLabel, maxLabel } = question.config;

  /**
   * What a screen reader hears in place of the raw number.
   *
   * The ends are named because "1" and "5" mean nothing on their own; sighted
   * readers get the same two phrases from the header above the rows.
   */
  function levelText(level: number): string {
    if (level <= 1) return minLabel;
    if (level >= maxLevel) return maxLabel;
    return String(level);
  }

  function write(skill: string, level: number, wantsToLearn: boolean) {
    const next: SkillsAnswer = { ...answer };
    // Back at the bottom and unticked is indistinguishable from never having
    // been touched, so it is stored the same way: not at all.
    if (level <= 1 && !wantsToLearn) delete next[skill];
    else next[skill] = { level, wantsToLearn };
    onChange(next);
  }

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error} group>
      {/*
        A GRID, so the header lines up with what it heads. The rows used to be
        independent flex lines carrying "Want to learn/improve" each, which is
        four words printed fifteen times down the page to label a single column.

        The columns are shared by the header and every row, so the scale's two
        ends and the checkbox caption are each said once. `grid-cols-subgrid`
        is not used: it is the rows themselves that repeat the definition, and
        one shared class string is easier to keep honest than a parent-child
        pair that must agree.
      */}
      <div className={`${GRID} items-end gap-y-1 pb-1 text-xs text-muted-foreground`}>
        <span />
        <span className="flex justify-between">
          <span>1 · {minLabel}</span>
          <span className="text-right">
            {maxLevel} · {maxLabel}
          </span>
        </span>
        <span />
        <span className="text-center leading-tight">Want to learn/improve</span>
      </div>

      <div className="flex flex-col gap-4">
        {skills.map((skill, index) => {
          const entry = answer[skill];
          const level = entry?.level ?? 1;
          const wantsToLearn = entry?.wantsToLearn ?? false;

          const nameId = `${fieldId}-s${index}-name`;
          const sliderId = `${fieldId}-s${index}-level`;
          const learnId = `${fieldId}-s${index}-learn`;

          return (
            <div key={skill} data-skill-row className={`${GRID} items-center`}>
              <span id={nameId} className="min-w-0 text-base">
                {skill}
              </span>

              <input
                id={sliderId}
                type="range"
                min={1}
                max={maxLevel}
                step={1}
                value={level}
                disabled={disabled}
                // Named by the skill, because the visible text beside it is a
                // span rather than a label — a `<label>` would steal the click
                // and drag from the slider it sits next to.
                aria-labelledby={nameId}
                // Read instead of the raw number, so the bottom announces as
                // "No experience" rather than as "1", which is what the header
                // does for everyone else.
                aria-valuetext={levelText(level)}
                onChange={(event) => write(skill, Number(event.target.value), wantsToLearn)}
                className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
              />

              <span className="text-right text-sm tabular-nums text-muted-foreground">{level}</span>

              <input
                id={learnId}
                type="checkbox"
                checked={wantsToLearn}
                disabled={disabled}
                onChange={(event) => write(skill, level, event.target.checked)}
                // The column heading says this once for anyone who can see it.
                // A checkbox still has to name itself, so the name is here and
                // not in visible text repeated down the page.
                aria-label={`Want to learn/improve ${skill}`}
                className="justify-self-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
              />
            </div>
          );
        })}
      </div>
    </QuestionShell>
  );
}
