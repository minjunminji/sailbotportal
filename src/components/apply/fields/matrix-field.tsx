'use client';

import type { MatrixAnswer, MatrixQuestion } from '@/lib/questions/types';
import { asMatrixAnswer } from '../answers';
import { QuestionShell, describedBy, smallButtonClasses } from '../question-shell';
import type { FieldProps } from './field-props';

/**
 * A grid of rows against columns — the software skills question, twenty rows
 * deep.
 *
 * A real `<table>` with `scope`ed headers, because that is what lets a screen
 * reader say "Python, I have this skill" when focus lands on a box. A grid of
 * `<div>`s reads as forty unlabelled checkboxes. Each cell still carries its
 * own visually hidden `<label>`, since header association alone is advisory.
 *
 * `mode: 'single'` uses radios, which cannot be unticked, so a row that has an
 * answer also gets a Clear button — otherwise a misclick is permanent.
 */
export function MatrixField({
  question,
  fieldId,
  value,
  onChange,
  error,
  disabled,
}: FieldProps<MatrixQuestion>) {
  const answer = asMatrixAnswer(value);
  const { rows, columns, mode } = question.config;

  function write(next: MatrixAnswer) {
    // Rows with nothing selected are dropped rather than stored as empty
    // arrays: the answer is what gets exported, and a hundred empty rows is
    // noise in every cell of the sheet.
    const cleaned: MatrixAnswer = {};
    for (const [row, selected] of Object.entries(next)) {
      if (selected.length > 0) cleaned[row] = selected;
    }
    onChange(cleaned);
  }

  function toggle(row: string, column: string, checked: boolean) {
    const current = answer[row] ?? [];
    const selected =
      mode === 'single'
        ? checked
          ? [column]
          : []
        : checked
          ? current.includes(column)
            ? current
            : [...current, column]
          : current.filter((entry) => entry !== column);

    write({ ...answer, [row]: selected });
  }

  return (
    <QuestionShell question={question} fieldId={fieldId} error={error} group>
      <div className="overflow-x-auto" aria-describedby={describedBy(fieldId, question, error)}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th scope="col" className="border-b border-border py-2 pr-4 text-sm font-medium">
                {/* The row header column names itself through the legend. */}
                <span className="sr-only">Item</span>
              </th>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="border-b border-border px-3 py-2 text-sm font-medium"
                >
                  {column}
                </th>
              ))}
              {mode === 'single' ? (
                <th scope="col" className="border-b border-border px-3 py-2 text-sm font-medium">
                  <span className="sr-only">Clear the row</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const selected = answer[row] ?? [];
              return (
                <tr key={row}>
                  <th
                    scope="row"
                    className="border-b border-border py-2 pr-4 text-base font-normal"
                  >
                    {row}
                  </th>
                  {columns.map((column, columnIndex) => {
                    const cellId = `${fieldId}-r${rowIndex}c${columnIndex}`;
                    const checked = selected.includes(column);
                    return (
                      <td key={column} className="border-b border-border px-3 py-2 text-center">
                        <label htmlFor={cellId} className="sr-only">
                          {row}: {column}
                        </label>
                        <input
                          id={cellId}
                          type={mode === 'single' ? 'radio' : 'checkbox'}
                          name={mode === 'single' ? `${fieldId}-r${rowIndex}` : undefined}
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => toggle(row, column, event.target.checked)}
                          className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50"
                        />
                      </td>
                    );
                  })}
                  {mode === 'single' ? (
                    <td className="border-b border-border px-3 py-2">
                      <button
                        type="button"
                        disabled={disabled || selected.length === 0}
                        onClick={() => write({ ...answer, [row]: [] })}
                        className={smallButtonClasses}
                      >
                        Clear
                        <span className="sr-only"> {row}</span>
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </QuestionShell>
  );
}
