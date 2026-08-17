-- 'help' removed from 'technical_skills'. "Rate anything you have used, and
-- tick whatever you want to work on at Sailbot. Leave the rest alone." said
-- what the slider and checkbox beside each skill already show once you touch
-- one — the label asks the question, the rest is discoverable.

update postings
set question_schema = (
  select jsonb_agg(
    case
      when q ->> 'id' = 'technical_skills' then q - 'help'
      else q
    end
    order by ordinality
  )
  from jsonb_array_elements(question_schema) with ordinality as t(q, ordinality)
)
where slug = 'soft-2026';
