-- 'saturday_availability' becomes a checkbox, on both postings that ask it.
--
-- The label was already a statement to agree with ("I confirm that I am
-- available..."), not a genuine two-way choice — a dropdown offering "Yes" or
-- "No" was more control than the question needed. `config.confirm` tells
-- `SelectField` to render a single checkbox instead: checking it answers
-- "Yes", and leaving it unchecked answers nothing, which a required question
-- refuses to submit. The stored answer shape is unchanged (still the string
-- "Yes"), so this is UI-only — no snapshot, export, or admin-view change.

update postings
set question_schema = (
  select jsonb_agg(
    case
      when q ->> 'id' = 'saturday_availability' then
        jsonb_set(q, '{config,confirm}', 'true'::jsonb)
      else q
    end
    order by ordinality
  )
  from jsonb_array_elements(question_schema) with ordinality as t(q, ordinality)
)
where slug in ('elec-2026', 'soft-2026');
