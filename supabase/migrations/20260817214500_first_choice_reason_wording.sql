-- The first-choice question names the subteam, and is measured in words.
--
-- Three changes to `first_choice_reason` on soft-2026:
--
-- 1. The label carries `{firstSubteam}`, substituted at render time by
--    `src/lib/questions/labels.ts`. Question text is frozen onto every
--    application row at submission and so cannot be written per applicant; the
--    placeholder is how one asks about an answer the applicant has just given.
--    It resolves to the subteam's code — PATH, NET — matching the badges in the
--    ranking directly above, and to "that subteam" before anything is ranked.
--    THE ADMIN VIEW SUBSTITUTES TOO, so a lead reads the question as asked
--    rather than the template it was stored as.
--
-- 2. `help` removed. "One sentence is plenty" restated the label, which already
--    says what is wanted, and the word counter under the box now says the rest.
--
-- 3. `maxLength: 300` becomes `maxWords: 30`. The question asks for one
--    sentence, so the counter should report the unit the instruction is in.
--    Nobody can picture 300 characters.

update postings
set question_schema = (
  select jsonb_agg(
    case
      when q ->> 'id' = 'first_choice_reason' then
        jsonb_build_object(
          'id', 'first_choice_reason',
          'type', 'long_text',
          'label', 'Why is {firstSubteam} your first choice?',
          'required', true,
          'config', jsonb_build_object('maxWords', 30)
        )
      else q
    end
    order by ordinality
  )
  from jsonb_array_elements(question_schema) with ordinality as t(q, ordinality)
)
where slug = 'soft-2026';
