-- The skills question becomes a proficiency scale plus an interest flag.
--
-- It was a 20x2 grid of checkboxes: "I have this skill" against "I want to
-- learn/improve this skill". Two problems with that shape.
--
-- It could only say which bucket a skill fell in, and the two are different
-- axes — being good at Python says nothing about whether you want to spend a
-- year on it, and "I have it" flattens a first tutorial and three internships
-- into the same tick. And answering it meant tracing a column header across a
-- row to an unlabelled box, twenty times.
--
-- The new `skills` type stores `{ level, wantsToLearn }` per skill. THE SCALE
-- STARTS AT 1 AND 1 MEANS "NO EXPERIENCE": a range input always holds a value,
-- so the slider's resting position has to mean something, and that is the only
-- honest meaning for a row nobody has touched. Such a row is not stored at all,
-- so fifteen untouched sliders do not become fifteen claims of level 1.
--
-- The list drops five entries that were not telling a lead anything they act
-- on — HTML/CSS, Shell, Visual Studio Code, Web Development, Object-Oriented
-- Programming — and renames "Data Parsing/Analysis/Visualizing" to the broader
-- "Data engineering". ROS keeps its expansion: this question is answered by
-- first-years deciding whether they recognise a skill, and the bare acronym
-- reads as noise to someone who has never met it.

update postings
set question_schema = (
  select jsonb_agg(
    case
      when q ->> 'id' = 'technical_skills' then
        jsonb_build_object(
          'id', 'technical_skills',
          'type', 'skills',
          'label', 'What are your technical skills?',
          'help', 'Rate anything you have used, and tick whatever you want to work on at Sailbot. Leave the rest alone.',
          'required', false,
          'config', jsonb_build_object(
            'maxLevel', 5,
            'minLabel', 'No experience',
            'maxLabel', 'Could teach it',
            'skills', jsonb_build_array(
              'Python',
              'C/C++',
              'Javascript/Typescript',
              'Git/GitHub',
              'Robot Operating System (ROS)',
              'React',
              'MongoDB',
              'Linux',
              'Docker',
              'Testing (unit, integration, mocks)',
              'Data engineering',
              'Continuous Integration (CI/CD)',
              'Physics modelling',
              'Control theory',
              'Sailing'
            )
          )
        )
      else q
    end
    order by ordinality
  )
  from jsonb_array_elements(question_schema) with ordinality as t(q, ordinality)
)
where slug = 'soft-2026';
