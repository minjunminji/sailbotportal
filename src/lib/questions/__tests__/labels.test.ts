import { FIRST_SUBTEAM_TOKEN, resolveLabel } from '../labels';

/**
 * A question label that names the applicant's own first choice.
 *
 * Question text is static — it is authored once and frozen onto every
 * application row at submission — so the one piece of it that has to change per
 * applicant arrives as a placeholder. The same substitution runs on the form and
 * in the admin view, which is the point: a lead reading the answer months later
 * must see the question the applicant was actually asked, not the template.
 */

it('puts the first choice into the label', () => {
  expect(resolveLabel(`Why is ${FIRST_SUBTEAM_TOKEN} your first choice?`, 'PATH')).toBe(
    'Why is PATH your first choice?',
  );
});

it('reads as a sentence before anything is chosen', () => {
  // The label is on screen from the moment the team is picked, which is before
  // the ranking below it has been touched.
  expect(resolveLabel(`Why is ${FIRST_SUBTEAM_TOKEN} your first choice?`, null)).toBe(
    'Why is that subteam your first choice?',
  );
});

it('falls back rather than printing a blank', () => {
  expect(resolveLabel(`Why is ${FIRST_SUBTEAM_TOKEN}?`, '   ')).toBe('Why is that subteam?');
  expect(resolveLabel(`Why is ${FIRST_SUBTEAM_TOKEN}?`, undefined)).toBe('Why is that subteam?');
});

it('leaves a label without the placeholder exactly as it is', () => {
  expect(resolveLabel('What is ballast?', 'PATH')).toBe('What is ballast?');
});

it('replaces every occurrence, not just the first', () => {
  expect(resolveLabel(`${FIRST_SUBTEAM_TOKEN} and ${FIRST_SUBTEAM_TOKEN}`, 'NET')).toBe(
    'NET and NET',
  );
});
