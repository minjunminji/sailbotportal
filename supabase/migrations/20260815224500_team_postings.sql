-- The three team postings, carrying the real 2025 question sets.
--
-- Reference data, not fixtures, for the same reason as the teams migration:
-- seed.sql runs only on a local `db reset` and is ignored by `db push`, so
-- anything the form genuinely needs has to converge on production by itself.
-- Every statement is idempotent, so this is safe to re-run.
--
-- All three land as `status = 'draft'`. Nothing goes live until a lead has read
-- their own posting back in Studio; opening recruiting is a deliberate act, not
-- a side effect of deploying a migration.
--
-- Wording is transcribed VERBATIM from the 2025 form. Leads recognise these
-- questions, so any drift reads as a bug. `postings.integration.test.ts` runs
-- every question below through `validateQuestion`, because a typo in several
-- hundred lines of hand-written JSON is otherwise completely silent.
--
-- Descriptions come from the intros in docs/*Team Posting.txt.

-- --------------------------------------------------------------------------
-- Mechanical
-- --------------------------------------------------------------------------
-- No subteam ranking: mech assigns Sail / Rudder / Hull after the interview.
--
-- The quiz preamble is repeated as `help` on all eleven questions. There is no
-- section or preamble construct in the question model — `help` is per-question
-- and nothing else carries prose — so attaching it once to the first question
-- would lose it for anyone who scrolls past, or for any future paginated
-- rendering. The renderer is free to collapse consecutive identical help text.

insert into postings (team_id, title, slug, description, status, position, question_schema, subteam_ranking)
select
  t.id,
  'Mechanical Team',
  'mech-2026',
  $desc$Our current project, POLARIS, is an ocean-going, fixed-wing sailboat designed to support oceanic research by providing surface data to researchers. The long-term goal for this project is to be a flexible platform that will enable future improvements to our vessels through an iterative design process involving the rudder, sail, keel, and hull.$desc$,
  'draft',
  0,
  $questions$[
    {
      "id": "ballast",
      "type": "long_text",
      "label": "What is ballast and what is its function on a boat?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "ballast_alternative",
      "type": "long_text",
      "label": "What do most sailboats use instead of ballast?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "dissimilar_metals",
      "type": "long_text",
      "label": "Why is putting dissimilar metals like aluminum and stainless steel together a problem in a wet environment?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "erf_paint",
      "type": "long_text",
      "label": "Why do you need to paint ERF (epoxy reinforced fiber) surfaces when they will be exposed to sunlight?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "buoyancy_vs_mass",
      "type": "long_text",
      "label": "What is the difference between the center of buoyancy and the center of mass?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "points_of_sail",
      "type": "long_text",
      "label": "What are the names of the different points of sail, and what is the approximate angle between the boat and the wind direction for each?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "sailing_upwind",
      "type": "long_text",
      "label": "How does a sailboat sail upwind, and what limits its ability to do so?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "faster_than_wind",
      "type": "long_text",
      "label": "Why would a sailboat be able to sail faster than the wind observed from shore?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "tack_vs_gybe",
      "type": "long_text",
      "label": "What is the difference between a tack and a gybe in the context of sailing?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "wingsail",
      "type": "long_text",
      "label": "Can you briefly describe what a wingsail is and how it works?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    },
    {
      "id": "autonomous_challenges",
      "type": "long_text",
      "label": "Can you list 2-3 challenges of autonomous sailing operation (versus a crewed sailboat)?",
      "help": "Answer using your own knowledge and/or personal research. If you researched an answer that is completely acceptable, but please include your sources. In general 2-5 sentences should be sufficient.",
      "required": true,
      "config": {"maxLength": 1500}
    }
  ]$questions$::jsonb,
  '{"enabled": false, "maxChoices": 3}'::jsonb
from teams t
where t.slug = 'mech'
on conflict (slug) do nothing;

-- --------------------------------------------------------------------------
-- Electrical
-- --------------------------------------------------------------------------
-- No subteam ranking: elec places applicants into COM / DRV / PWR after the
-- interview rather than asking for a preference on the form.
--
-- INCOMPLETE — six technical questions are missing.
--
-- The 2025 electrical quiz had six further required `long_text` questions after
-- `proud_project`, covering:
--
--   1. measuring current with a multimeter
--   2. wiring batteries in series versus in parallel
--   3. connecting two sensors to one microcontroller
--   4. an I2C e-compass returning all zeros
--   5. methods for reducing noise in a circuit
--   6. verifying reliability in a harsh, remote environment
--
-- Their verbatim wording is NOT in this repository. The implementation plan
-- points at "the 2025 form transcript in the design doc", but
-- docs/plans/2026-08-15-hiring-portal-design.md contains no transcript, and
-- docs/Electrical Team Posting.txt is the role description only. Paraphrasing
-- from the topic list above would produce six questions the elec leads would
-- recognise as not theirs, which is worse than six questions that are visibly
-- absent, so they are omitted rather than invented.
--
-- TO FINISH: paste the six questions into the array below, after
-- `proud_project`, as `long_text` / `"required": true` with ids
-- `multimeter_current`, `batteries_series_parallel`, `two_sensors_one_mcu`,
-- `i2c_compass_zeros`, `reducing_noise`, `harsh_environment_reliability`.
-- The posting is `draft`, so it cannot reach an applicant half-finished.

insert into postings (team_id, title, slug, description, status, position, question_schema, subteam_ranking)
select
  t.id,
  'Electrical Team',
  'elec-2026',
  $desc$Our current project involves constructing and testing a 3m fully autonomous sailboat, capable of collecting oceanic and atmospheric data in the Pacific Ocean. Our goals are to raise awareness of global warming on the ocean’s surface waters, autonomously collect data in the Pacific over multiple weeks and provide a modular design that can integrate various scientific sensors, which showcases the potential use case of these vehicles.

The electrical team is responsible for designing, implementing and testing hardware and low-level software that bring the boat to life and allow it to navigate the ocean. There is a vast amount of work done in the electrical team spanning multiple interests.$desc$,
  'draft',
  1,
  $questions$[
    {
      "id": "saturday_availability",
      "type": "select",
      "label": "I confirm that I am available to meet in-person every Saturday.",
      "required": true,
      "config": {"options": ["Yes", "No"]}
    },
    {
      "id": "proud_project",
      "type": "long_text",
      "label": "Describe a project you've worked on that you're most proud of.",
      "help": "1. Explain what you learned. 2. Describe the difficulties you encountered. 3. How would you improve it if you were to do it again. Please write your response as if you were explaining it to a first year engineering student.",
      "required": true,
      "config": {"maxLength": 4000}
    }
  ]$questions$::jsonb,
  '{"enabled": false, "maxChoices": 3}'::jsonb
from teams t
where t.slug = 'elec'
on conflict (slug) do nothing;

-- --------------------------------------------------------------------------
-- Software
-- --------------------------------------------------------------------------
-- The only team that ranks subteams on the form: six projects, top three.
-- `ranked_subteams` is what the board filters and what waitlist pulls query,
-- which is why it is a posting setting rather than a `ranking` question.
--
-- The technical quiz can be submitted as a public GitHub repository OR as a ZIP
-- upload, so `github_url` and `quiz_zip` are both optional and an applicant is
-- expected to use exactly one. `quiz_language` is the required question that
-- records which route they took.

insert into postings (team_id, title, slug, description, status, position, question_schema, subteam_ranking)
select
  t.id,
  'Software Team',
  'soft-2026',
  $desc$Our current project is an autonomous research vessel capable of collecting oceanic and atmospheric data. With our expertise in autonomous sailing, the goal is to monitor the health of our oceans while collaborating with stakeholders and researchers involved in climate science and oceanography.

The initial design phase is now complete, and implementation is well underway for our various software projects. As a new member, this is a great time to join, as you get to jump straight into hands-on software development within our much wider software project. Members of the software team are directly responsible for developing our codebases to push the boundaries of autonomous sailing.$desc$,
  'draft',
  2,
  $questions$[
    {
      "id": "saturday_availability",
      "type": "select",
      "label": "I confirm that I am available to meet in-person every Saturday.",
      "required": true,
      "config": {"options": ["Yes", "No"]}
    },
    {
      "id": "technical_skills",
      "type": "matrix",
      "label": "What relevant technical skills do you have? What skills are you interested in learning or further developing?",
      "required": false,
      "config": {
        "mode": "multi",
        "columns": ["I have this skill", "I want to learn/improve this skill"],
        "rows": [
          "Python",
          "C/C++",
          "Javascript/Typescript",
          "HTML/CSS",
          "Shell",
          "Visual Studio Code",
          "Git/GitHub",
          "Robot Operating System (ROS)",
          "React",
          "MongoDB",
          "Linux",
          "Docker",
          "Testing (unit, integration, mocks)",
          "Data Parsing/Analysis/Visualizing",
          "Web Development",
          "Object-Oriented Programming",
          "Continuous Integration (CI/CD)",
          "Physics Modeling",
          "Control Theory",
          "Sailing"
        ]
      }
    },
    {
      "id": "software_project",
      "type": "long_text",
      "label": "Tell us about a software related project you worked on. What did it do? What were the challenges?",
      "required": true,
      "config": {"minWords": 50, "maxLength": 6000}
    },
    {
      "id": "github_url",
      "type": "short_text",
      "label": "If you chose the GitHub repository submission option, please double check that it is public then paste its URL below",
      "required": false,
      "config": {"format": "url", "maxLength": 500}
    },
    {
      "id": "quiz_zip",
      "type": "file",
      "label": "If you chose the ZIP file submission option, please upload it",
      "required": false,
      "config": {"accept": [".zip"], "maxBytes": 10485760}
    },
    {
      "id": "quiz_language",
      "type": "select",
      "label": "Which programming language did you use for the technical quiz?",
      "required": true,
      "config": {"options": ["Python", "C++", "I opted to answer the projects question"]}
    },
    {
      "id": "anything_else",
      "type": "long_text",
      "label": "Is there anything else we should know about your application?",
      "required": false,
      "config": {"maxLength": 2000}
    }
  ]$questions$::jsonb,
  '{"enabled": true, "maxChoices": 3}'::jsonb
from teams t
where t.slug = 'soft'
on conflict (slug) do nothing;
