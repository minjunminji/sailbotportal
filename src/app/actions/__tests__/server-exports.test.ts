/**
 * @jest-environment node
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every `'use server'` file may export async functions and nothing else.
 *
 * This is a rule with no compile-time enforcement and no lint rule behind it.
 * TypeScript is happy, `next build` is happy, the unit suite is happy — and the
 * page throws the first time a browser asks for it:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * Which is how it actually shipped: `set-posting-status.ts` exported its list
 * of statuses as a `const`, and nothing said so until the postings screen was
 * clicked. Type exports are fine because they are erased before any of this
 * exists; a `const` array is not.
 *
 * Directory-driven on purpose. A test naming today's four action files would
 * pass forever while the fifth one, written next term by someone who has never
 * read this comment, breaks the same way.
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn() }));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ adminClient: jest.fn() }));

const ACTIONS_DIR = path.join(__dirname, '..');

const actionFiles = readdirSync(ACTIONS_DIR).filter((entry) => entry.endsWith('.ts'));

it('finds the action files at all', () => {
  // Without this, a rename of the directory would turn the suite below into
  // zero tests and report success.
  expect(actionFiles.length).toBeGreaterThan(0);
});

describe.each(actionFiles)('%s', (file) => {
  it('exports only functions', async () => {
    const loaded: Record<string, unknown> = await import(path.join(ACTIONS_DIR, file));

    const offenders = Object.entries(loaded)
      .filter(([, value]) => typeof value !== 'function')
      .map(([name, value]) => `${name} (${typeof value})`);

    expect(offenders).toEqual([]);
  });
});
