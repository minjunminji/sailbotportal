import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

/**
 * The half of the development fixtures that SQL cannot write.
 *
 * `seed.sql` runs inside Postgres, and a resume is bytes in a storage bucket —
 * so it deliberately leaves `resume_path` NULL rather than name an object that
 * does not exist. This script supplies both halves together: it uploads the
 * committed sample PDF and then points named applications at it, so the path
 * and the object can never disagree.
 *
 * LOCAL ONLY. It refuses to run against anything but a loopback Supabase URL,
 * because it writes to storage and rewrites application rows with the service
 * role — exactly the two things that must never happen to a real recruiting
 * cycle by way of a mistyped environment.
 *
 * Re-runnable: the upload upserts to a fixed path and the update is idempotent.
 * Run it after `supabase db reset`, which clears the rows but not the bucket.
 */

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  throw new Error('.env.local must define NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url)) {
  throw new Error(
    `Refusing to seed storage against ${url}. This script is for a local Supabase only.`,
  );
}

const supabase = createClient(url, serviceRole);
const BUCKET = 'resumes';
/** Fixed, so re-running replaces the object instead of littering the bucket. */
const OBJECT_PATH = 'dev-fixtures/sample-resume.pdf';

/**
 * Who gets a resume. Named rather than "the first row", so the same people have
 * one on every developer's machine and a screenshot means the same thing twice.
 * One per team, so each board has a resume to open.
 */
const RECIPIENTS = [
  { posting: 'soft-2026', applicant: 'Jane Chen' },
  { posting: 'mech-2026', applicant: 'Rachel Kim' },
  { posting: 'elec-2026', applicant: 'Priya Raman' },
];

const pdf = readFileSync('supabase/fixtures/sample-resume.pdf');

const { error: uploadError } = await supabase.storage
  .from(BUCKET)
  .upload(OBJECT_PATH, pdf, { contentType: 'application/pdf', upsert: true });
if (uploadError) throw uploadError;
console.log(`uploaded ${OBJECT_PATH} (${pdf.length} bytes)`);

for (const { posting, applicant } of RECIPIENTS) {
  const { data: postingRow, error: postingError } = await supabase
    .from('postings')
    .select('id')
    .eq('slug', posting)
    .maybeSingle();
  if (postingError) throw postingError;
  if (!postingRow) throw new Error(`No posting '${posting}'. Run \`supabase db reset\` first.`);

  const { data: updated, error: updateError } = await supabase
    .from('applications')
    .update({ resume_path: OBJECT_PATH })
    .eq('posting_id', postingRow.id)
    .eq('applicant_name', applicant)
    .select('id');
  if (updateError) throw updateError;

  // Loud rather than silent: a rename in seed.sql would otherwise leave this
  // script quietly attaching nothing, and the viewer looking broken.
  if (!updated || updated.length === 0) {
    throw new Error(
      `No application for '${applicant}' on '${posting}'. ` +
        'The name may have changed in supabase/seed.sql — update RECIPIENTS here to match.',
    );
  }
  console.log(`attached to ${applicant} (${posting}) — /admin/${posting.split('-')[0]}`);
}

console.log('\nOpen a board, click one of those applicants, and the resume pane will show the PDF.');
