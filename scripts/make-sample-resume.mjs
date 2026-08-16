import { writeFileSync, mkdirSync } from 'node:fs';

/**
 * Writes `supabase/fixtures/sample-resume.pdf`.
 *
 * A PDF is committed rather than generated at seed time, so every developer
 * sees the same two pages and nothing has to be installed to produce them. This
 * script exists so that file is reproducible and reviewable rather than an
 * opaque binary somebody once dropped in — run it only to change the fixture.
 *
 * Written by hand because a PDF library would be a dependency carried forever
 * for one fixture. The format needs little: objects, a cross-reference table of
 * their byte offsets, and a trailer pointing at it. The offsets are computed
 * rather than counted, which is the only part that is easy to get wrong.
 */

const FONT = 5;
const BOLD = 6;

function text(size, x, y, body, font = FONT) {
  // Parentheses and backslashes are PDF string delimiters and must be escaped.
  const escaped = body.replace(/([()\\])/g, '\\$1');
  return `BT /F${font === BOLD ? 'B' : '1'} ${size} Tf ${x} ${y} Td (${escaped}) Tj ET\n`;
}

const pageOne =
  text(26, 56, 720, 'Jane Chen', BOLD) +
  text(11, 56, 700, 'jane_chen@student.ubc.ca  ·  Vancouver, BC') +
  '0.85 g 56 688 500 1 re f 0 g\n' +
  text(14, 56, 656, 'Education', BOLD) +
  text(11, 56, 636, 'BASc Computer Engineering, University of British Columbia') +
  text(11, 56, 620, 'Second year  ·  Expected 2029') +
  text(14, 56, 580, 'Experience', BOLD) +
  text(11, 56, 560, 'Undergraduate Research Assistant, Robotics Lab') +
  text(10, 56, 544, 'Built a ROS node for logging sensor data at 200 Hz and wrote the') +
  text(10, 56, 530, 'replay tooling the team used to debug field tests.') +
  text(11, 56, 500, 'Teaching Assistant, Introduction to Programming') +
  text(10, 56, 484, 'Ran weekly labs for 40 students and marked project submissions.') +
  text(14, 56, 444, 'Projects', BOLD) +
  text(11, 56, 424, 'Campus energy dashboard') +
  text(10, 56, 408, 'Python collector writing to Postgres, React front end, deployed') +
  text(10, 56, 394, 'with Docker. Handled gaps in meter data explicitly rather than') +
  text(10, 56, 380, 'interpolating over them.') +
  text(14, 56, 340, 'Skills', BOLD) +
  text(10, 56, 320, 'Python  ·  TypeScript  ·  React  ·  ROS  ·  Docker  ·  Git  ·  Linux') +
  text(9, 56, 60, 'This is a development fixture, not a real person.');

const pageTwo =
  text(20, 56, 720, 'Page two', BOLD) +
  text(11, 56, 692, 'Two pages on purpose: a one-page fixture cannot show whether') +
  text(11, 56, 676, 'scrolling still works once the viewer chrome is suppressed.') +
  text(9, 56, 60, 'This is a development fixture, not a real person.');

/** Body objects. Streams are built from their own content length. */
function stream(content) {
  return `<</Length ${content.length}>>\nstream\n${content}endstream`;
}

const objects = [
  '<</Type/Catalog/Pages 2 0 R>>',
  '<</Type/Pages/Kids[3 0 R 7 0 R]/Count 2>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R' +
    `/Resources<</Font<</F1 ${FONT} 0 R/FB ${BOLD} 0 R>>>>>>`,
  stream(pageOne),
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>',
  '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 8 0 R' +
    `/Resources<</Font<</F1 ${FONT} 0 R/FB ${BOLD} 0 R>>>>>>`,
  stream(pageTwo),
];

let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, index) => {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefOffset = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

mkdirSync('supabase/fixtures', { recursive: true });
// `latin1`, so every byte written is the byte counted when computing offsets.
writeFileSync('supabase/fixtures/sample-resume.pdf', Buffer.from(pdf, 'latin1'));
console.log(`wrote supabase/fixtures/sample-resume.pdf (${pdf.length} bytes, 2 pages)`);
