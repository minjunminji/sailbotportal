-- 'why_sailbot' is measured in words, same change as first_choice_reason.
--
-- 1. `help` removed. "Suggested under 50 words" restated a limit the word
--    counter under the box now states itself.
-- 2. `maxLength: 600` becomes `maxWords: 50`, so the counter reads "X of 50
--    words" instead of "X of 600 characters" — the unit the help text used to
--    name is now the one the counter enforces.

update core_questions
set definition = jsonb_build_object(
  'type', 'long_text',
  'label', 'Briefly, describe yourself and why you would like to join UBC Sailbot',
  'required', true,
  'config', jsonb_build_object('maxWords', 50)
)
where stable_key = 'why_sailbot';
