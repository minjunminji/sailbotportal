-- Software asks for a top two, and why the first one is first.
--
-- The ranking was "up to 3 of 6, and nothing checked that you picked any". Two
-- changes, in one migration because they only make sense together:
--
-- 1. `minChoices` = `maxChoices` = 2. The floor is new; before it, the rail
--    counted the ranking as a required item while neither the form nor the
--    server refused an empty list, so the rail asked for something nobody had
--    to give. Equal floor and ceiling means exactly two, and the ranking
--    control says "Choose 2" rather than "Choose up to 2" — wording that
--    invites one and then gets refused on submit.
--
-- 2. A required one-sentence reason for the first choice, added at the FRONT of
--    the question array so it renders directly beneath the ranking it refers
--    to. Its label says "that subteam" rather than naming one: questions are
--    static text, and the ranking sits immediately above it.
--
-- Nothing here uses `visibleIf`, so lowering the cap from 3 strands no question.

update postings
set subteam_ranking = jsonb_build_object('enabled', true, 'minChoices', 2, 'maxChoices', 2)
where slug = 'soft-2026';

update postings
set question_schema =
  jsonb_build_array(
    jsonb_build_object(
      'id', 'first_choice_reason',
      'type', 'long_text',
      'label', 'In one sentence, why is that subteam your first choice?',
      'help', 'One sentence is plenty. We are asking what draws you to it, not for a pitch.',
      'required', true,
      'config', jsonb_build_object('maxLength', 300)
    )
  ) || question_schema
where slug = 'soft-2026'
  and not exists (
    select 1
    from jsonb_array_elements(question_schema) q
    where q ->> 'id' = 'first_choice_reason'
  );
