-- ===========================================================================
-- DEVELOPMENT FIXTURES. LOCAL ONLY. NEVER REACHES PRODUCTION.
-- ===========================================================================
--
-- `supabase db reset` runs this file after every migration; `supabase db push`
-- ignores it entirely. That asymmetry is the whole point of the file: anything
-- the application genuinely depends on belongs in a migration (see
-- reference_data and team_postings, which install teams, subteams, core
-- questions and the three real postings), and everything HERE is disposable
-- scaffolding that exists so a board can be built against something other than
-- an empty table.
--
-- The rule to keep: nothing in this file may become something the app depends
-- on. No reference data, no schema, no leftover objects.
--
-- WHAT THIS INSTALLS
--
--   * three local sign-in accounts, one lead per team
--   * 40 applications across the three real postings and all eight statuses
--   * notes and events on a handful of them
--
-- CONVENTIONS THAT ARE LOAD-BEARING, NOT DECORATIVE
--
--   * EVERY fixture email contains an underscore. An unescaped `_` in an
--     `ilike` pattern is a single-character wildcard, and that has already
--     produced one real bug here (the duplicate-email check matching
--     strangers). Fixtures that all contain `_` make the next instance of that
--     bug reproducible by hand rather than theoretical.
--   * `status_changed_at` is spread from a few hours to forty-five days back,
--     because days-in-column is the signal the board exists to surface. Some of
--     these cards are meant to look neglected.
--   * A few rows share a `submission_id` — one person, one submission, two
--     teams. That is the case the detail view's "also applied to" link depends
--     on, and it cannot be exercised against fixtures where every row is its
--     own submission.
--   * A couple of emails repeat across DIFFERENT submissions (someone applied
--     again later), which is legal: the unique index is per
--     (posting_id, lower(applicant_email)), not per email.
--
-- WHY THIS FILE IS ONE LONG STATEMENT INSTEAD OF A FEW READABLE ONES
--
-- The Supabase CLI sends the seed to Postgres as a pipelined batch, and every
-- statement in it is PARSED before the earlier ones have executed. Anything
-- this file creates — a temp table for the fixture list, a helper function for
-- the snapshot — does not exist yet when the statement that uses it is parsed,
-- and the seed dies with `relation "..." does not exist`. So the fixture list,
-- the snapshot resolution and the answer bodies are all CTEs of the single
-- INSERT that needs them. Verified the hard way, twice.
--
-- It is also re-runnable: fixture rows carry a recognisable `submission_id`
-- prefix and are deleted by it first, so `psql -f supabase/seed.sql` against a
-- database that already has them behaves the same as a fresh reset.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Clear the previous run
-- ---------------------------------------------------------------------------
-- Every fixture submission id is `fbfbfbfb-0000-4000-8000-<counter>`, which no
-- real submission can produce (the app calls crypto.randomUUID). That prefix is
-- the marker, so this delete cannot reach an application a developer submitted
-- through the form to look at the site. Notes and events cascade.
delete from applications
where submission_id::text like 'fbfbfbfb-0000-4000-8000-%';

-- Accounts go after applications: application_notes.author_id references
-- profiles with no ON DELETE, so a lead who has authored a note cannot be
-- removed until that note is gone.
delete from auth.users
where email in ('soft@sailbot.local', 'elec@sailbot.local', 'mech@sailbot.local');

-- ---------------------------------------------------------------------------
-- Local sign-in accounts
-- ---------------------------------------------------------------------------
-- LOCAL ONLY. The password below is committed on purpose so a new developer can
-- sign in without asking anyone. It is worthless: these rows exist only in a
-- database that `db reset` throws away, and this file never runs against a
-- deployed project.
--
--   soft@sailbot.local  lead, Software     password: test
--   elec@sailbot.local  lead, Electrical   password: test
--   mech@sailbot.local  lead, Mechanical   password: test
--
-- Written straight into auth.users because GoTrue has no SQL API. The empty
-- strings on the token columns are not decoration: GoTrue scans them into Go
-- strings and a NULL there fails at sign-in with an error that says nothing
-- about the real cause. `crypt`/`gen_salt` are schema-qualified because
-- pgcrypto lives in `extensions` here and the seed's search_path does not
-- include it.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('test', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('name', u.name),
  now(), now(),
  '', '', '', '', '', ''
from (values
  ('soft@sailbot.local', 'Sam Okonkwo'),
  ('elec@sailbot.local', 'Jordan Voss'),
  ('mech@sailbot.local', 'Dana Whitfield')
) as u(email, name);

-- Password sign-in needs an identity row alongside the user. Without it GoTrue
-- reports invalid credentials for a password that is perfectly correct.
insert into auth.identities (
  user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id,
  u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  now(), now(), now()
from auth.users u
where u.email in ('soft@sailbot.local', 'elec@sailbot.local', 'mech@sailbot.local');

-- The on_auth_user_created trigger has already inserted a profile row for each
-- of these with the default role and no team. This gives them their real ones.
update profiles p
set role = f.role, team_id = t.id, name = f.name
from (values
  ('soft@sailbot.local', 'Sam Okonkwo',    'lead', 'soft'),
  ('elec@sailbot.local', 'Jordan Voss',    'lead', 'elec'),
  ('mech@sailbot.local', 'Dana Whitfield', 'lead', 'mech')
) as f(email, name, role, team_slug)
left join teams t on t.slug = f.team_slug
where p.email = f.email;

-- ---------------------------------------------------------------------------
-- The applications
-- ---------------------------------------------------------------------------
-- `resume_path` stays NULL here. A path written by this file would name an
-- object that does not exist in the local `resumes` bucket — SQL cannot put
-- bytes in a bucket — and a signed URL onto nothing is harder to debug than an
-- obviously absent resume.
--
-- Run `npm run db:seed-storage` after a reset to attach a real one. That script
-- uploads the committed sample PDF and sets `resume_path` in the same pass, so
-- the path and the object cannot disagree. It gives a resume to Jane Chen
-- (soft), Rachel Kim (mech) and Priya Raman (elec); if those names change
-- below, change them there too — the script fails loudly rather than silently
-- attaching nothing.
with fixture (
  posting_slug, sub_no, name, email, year, dept, status,
  submitted_days, status_days, ranked_slugs, assigned_slug, interview_days
) as (
  -- `sub_no` is the submission counter: two rows sharing it are one person who
  -- ticked two teams on one form, so they share a `submission_id`. Days are
  -- counted backwards from now, except `interview_days`, which is forwards
  -- (negative for an interview that has already happened).
  values
    -- --- Software: the only posting that ranks subteams on the form ---------
    ('soft-2026',  1, 'Jane Chen',        'jane_chen@student.ubc.ca',        '2',       'CPSC', 'applied',               2,  2, array['pathfinding','simulator'],               null::text,       null::int),
    ('soft-2026',  2, 'Marcus Webb',      'marcus_webb@student.ubc.ca',      '3',       'CPEN', 'applied',               4,  4, array['network-systems','devops','controller'], null,             null),
    ('soft-2026',  3, 'Priya Raman',      'priya_raman@student.ubc.ca',      '1',       'APSC', 'applied',               5,  5, array['website','devops'],                      null,             null),
    ('soft-2026',  4, 'Daniel Okafor',    'daniel_okafor@student.ubc.ca',    '4',       'CPSC', 'reviewing',            12,  6, array['pathfinding','controller','simulator'],  null,             null),
    ('soft-2026',  5, 'Emily Zhao',       'emily_zhao@student.ubc.ca',       '2',       'ELEC', 'reviewing',            14,  9, array['network-systems'],                       null,             null),
    ('soft-2026',  6, 'Tom Rutledge',     'tom_rutledge@student.ubc.ca',     '5',       'MECH', 'applied',              30, 30, array['simulator','website'],                   null,             null),
    ('soft-2026',  7, 'Aisha Karim',      'aisha_karim@student.ubc.ca',      '3',       'CPSC', 'interview_email_sent', 21, 16, array['website','pathfinding'],                 null,             null),
    ('soft-2026',  8, 'Leo Fernandes',    'leo_fernandes@student.ubc.ca',    'masters', 'CPSC', 'interview_scheduled',  24,  5, array['pathfinding','devops'],                  null,                3),
    ('soft-2026',  9, 'Nina Petrov',      'nina_petrov@student.ubc.ca',      '4',       'CPEN', 'interview_completed',  28,  2, array['controller','simulator'],                'controller',       -2),
    ('soft-2026', 10, 'Hugo Lindqvist',   'hugo_lindqvist@student.ubc.ca',   '2',       'IGEN', 'waitlisted',           33, 18, array['devops','website'],                      null,             null),
    ('soft-2026', 11, 'Sara Ahmadi',      'sara_ahmadi@student.ubc.ca',      '3',       'CPSC', 'offered',              35,  1, array['pathfinding','network-systems'],         'pathfinding',      -6),
    ('soft-2026', 12, 'Ben Carter',       'ben_carter@student.ubc.ca',       '1',       'APSC', 'rejected',             40, 22, array['website'],                               null,             null),
    ('soft-2026', 13, 'Yuki Tanaka',      'yuki_tanaka@student.ubc.ca',      '2',       'PHYS', 'applied',               1,  1, array['simulator','pathfinding','controller'],  null,             null),
    ('soft-2026', 14, 'Omar Haddad',      'omar_haddad@student.ubc.ca',      '3',       'ELEC', 'reviewing',             9,  8, array['network-systems','devops'],              null,             null),
    ('soft-2026', 15, 'Grace Liu',        'grace_liu@student.ubc.ca',        '4',       'CPSC', 'applied',              45, 45, array['website'],                               null,             null),
    ('soft-2026', 16, 'Alex Tran',        'alex_tran@student.ubc.ca',        '2',       'ENPH', 'applied',               7,  7, array['simulator'],                             null,             null),
    ('soft-2026', 17, 'Fatima Noor',      'fatima_noor@student.ubc.ca',      'masters', 'CPSC', 'interview_scheduled',  26,  4, array['pathfinding','website'],                 null,                5),
    ('soft-2026', 18, 'Chris Bell',       'chris_bell@student.ubc.ca',       '5',       'IGEN', 'reviewing',            16, 11, array['devops','network-systems'],              null,             null),

    -- --- Mechanical: no ranking, subteam is assigned after the interview ----
    -- sub_no 2 is Marcus Webb again: one submission, two teams.
    ('mech-2026',  2, 'Marcus Webb',      'marcus_webb@student.ubc.ca',      '3',       'CPEN', 'applied',               4,  4, '{}',                                           null,             null),
    ('mech-2026', 19, 'Sofia Almeida',    'sofia_almeida@student.ubc.ca',    '2',       'MECH', 'applied',               6,  6, '{}',                                           null,             null),
    ('mech-2026', 20, 'Kevin Park',       'kevin_park@student.ubc.ca',       '4',       'MECH', 'reviewing',            13, 10, '{}',                                           null,             null),
    ('mech-2026', 21, 'Laila Hassan',     'laila_hassan@student.ubc.ca',     '3',       'ENPH', 'interview_email_sent', 20, 15, '{}',                                           null,             null),
    ('mech-2026', 22, 'Jonas Meier',      'jonas_meier@student.ubc.ca',      '5',       'MECH', 'interview_scheduled',  25,  6, '{}',                                           null,                2),
    ('mech-2026', 23, 'Rachel Kim',       'rachel_kim@student.ubc.ca',       '2',       'APSC', 'interview_completed',  27,  3, '{}',                                           'rudder',           -3),
    ('mech-2026', 24, 'Ibrahim Diallo',   'ibrahim_diallo@student.ubc.ca',   '1',       'APSC', 'applied',              38, 38, '{}',                                           null,             null),
    ('mech-2026', 25, 'Chloe Dubois',     'chloe_dubois@student.ubc.ca',     'masters', 'MECH', 'offered',              32,  2, '{}',                                           'sail',             -8),
    ('mech-2026', 26, 'Nathan Cole',      'nathan_cole@student.ubc.ca',      '3',       'MECH', 'rejected',             41, 25, '{}',                                           null,             null),
    ('mech-2026', 27, 'Maya Sundaram',    'maya_sundaram@student.ubc.ca',    '4',       'IGEN', 'waitlisted',           36, 19, '{}',                                           null,             null),
    ('mech-2026', 28, 'Ryan Doucette',    'ryan_doucette@student.ubc.ca',    '2',       'MECH', 'reviewing',            11,  7, '{}',                                           null,             null),

    -- --- Electrical: no ranking either --------------------------------------
    -- sub_no 3 (Priya Raman) and 5 (Emily Zhao) are shared with Software.
    -- sub_no 29 is Alex Tran applying a second time, weeks after sub_no 16 —
    -- same email, different submission, which the unique index allows.
    -- sub_no 36 is Tom Rutledge doing the same thing in the other direction.
    ('elec-2026',  3, 'Priya Raman',      'priya_raman@student.ubc.ca',      '1',       'APSC', 'applied',               5,  5, '{}',                                           null,             null),
    ('elec-2026', 29, 'Alex Tran',        'alex_tran@student.ubc.ca',        '2',       'ENPH', 'applied',               2,  2, '{}',                                           null,             null),
    ('elec-2026', 30, 'Hannah Weiss',     'hannah_weiss@student.ubc.ca',     '3',       'ELEC', 'reviewing',            15, 12, '{}',                                           null,             null),
    ('elec-2026', 31, 'Diego Morales',    'diego_morales@student.ubc.ca',    '4',       'ELEC', 'interview_email_sent', 22, 17, '{}',                                           null,             null),
    ('elec-2026', 32, 'Ingrid Olsen',     'ingrid_olsen@student.ubc.ca',     'masters', 'ELEC', 'interview_scheduled',  23,  4, '{}',                                           null,                4),
    ('elec-2026', 33, 'Samuel Boateng',   'samuel_boateng@student.ubc.ca',   '3',       'CPEN', 'interview_completed',  29,  6, '{}',                                           'power',            -6),
    ('elec-2026', 34, 'Elena Rossi',      'elena_rossi@student.ubc.ca',      '2',       'ENPH', 'offered',              34,  1, '{}',                                           'communications',   -9),
    ('elec-2026', 35, 'Wei Zhang',        'wei_zhang@student.ubc.ca',        '5',       'ELEC', 'rejected',             39, 24, '{}',                                           null,             null),
    ('elec-2026', 36, 'Tom Rutledge',     'tom_rutledge@student.ubc.ca',     '5',       'MECH', 'applied',              44, 44, '{}',                                           null,             null),
    ('elec-2026', 37, 'Patrick Sullivan', 'patrick_sullivan@student.ubc.ca', '4',       'CPEN', 'waitlisted',           37, 20, '{}',                                           null,             null),
    ('elec-2026',  5, 'Emily Zhao',       'emily_zhao@student.ubc.ca',       '2',       'ELEC', 'applied',              14, 14, '{}',                                           null,             null)
),

-- The resolved question snapshot, per posting.
--
-- `question_schema_snapshot` is the single most important invariant in the
-- schema: the detail view and the export read it INSTEAD of the live posting,
-- so a posting reworded in October cannot change how a September application
-- renders. Fixtures storing `[]` would leave the detail view with nothing to
-- draw and the invariant unexercised, so this reproduces exactly what
-- `resolveQuestions` in src/lib/questions/snapshot.ts does — core questions
-- ordered by `position` with their id and stableKey set to `stable_key`, then
-- the posting's own questions in authored order.
snapshot as (
  select
    p.id as posting_id,
    coalesce(jsonb_agg(q.item order by q.grp, q.ord), '[]'::jsonb) as questions
  from postings p
  cross join lateral (
    select
      0 as grp,
      cq.position::bigint as ord,
      cq.definition || jsonb_build_object('id', cq.stable_key, 'stableKey', cq.stable_key) as item
    from core_questions cq
    union all
    select
      1,
      e.ord::bigint,
      e.value
    from jsonb_array_elements(p.question_schema) with ordinality as e(value, ord)
  ) q
  group by p.id
),

-- The one core question, answered four different ways so forty cards do not
-- read as one person filling the form forty times.
why (n, body) as (
  values
    (0, $a$I am a second-year student who has wanted to work on something that actually goes in the water since I built a remote-controlled catamaran in high school. Sailbot is the only team on campus doing autonomous ocean work and I want in.$a$),
    (1, $a$I want to spend my degree on hardware that has to survive somewhere real. A boat that has to stay alive alone in the Pacific for weeks is a much harder brief than anything I have built in a course, and that is the appeal.$a$),
    (2, $a$I care about ocean data and climate work, and Sailbot is the rare project where that overlaps with engineering I can contribute to now rather than after graduation.$a$),
    (3, $a$A friend on the team showed me the boat during a build weekend and I have thought about it since. I want to be on a team where the deadline is a sea trial rather than a submission portal.$a$)
),

-- Answers, hand-written per posting rather than generated per question type,
-- because the detail view is about to render these and lorem ipsum against a
-- question about ballast is not something anyone can judge a layout with.
--
-- Shapes follow buildAnswerSchema in src/lib/questions/schema.ts: text
-- questions are strings, a `select` answer must be one of the offered options,
-- and `matrix` is Record<row, selected columns>. The `file` question on
-- Software (`quiz_zip`) is absent rather than null — an applicant who chose the
-- GitHub route never produced a key for it. The verification block at the
-- bottom asserts every key here is a question in that row's own snapshot, which
-- is what catches these drifting after a posting is edited.
answer_base (posting_slug, payload) as (
  values
    ('mech-2026', $json$
      {
        "ballast_alternative": "Most small sailboats use crew weight and hull form stability instead, with the crew hiking out to windward, or a centreboard or daggerboard that provides lateral resistance without carrying much weight. Dinghies rely almost entirely on movable crew weight.",
        "erf_paint": "The epoxy matrix degrades under UV. It chalks, yellows and loses surface strength, which eventually exposes the fibres and lets water into the laminate. Paint or a UV-stable gelcoat is a sacrificial barrier that takes the UV instead of the resin.",
        "buoyancy_vs_mass": "The centre of mass is the weighted average position of the boat's mass. The centre of buoyancy is the centroid of the displaced volume of water. They sit on the same vertical line when the boat is upright, but as it heels the centre of buoyancy shifts to leeward, and the horizontal offset between the two is what produces the righting moment.",
        "points_of_sail": "Roughly: in irons or head to wind from 0 to about 45 degrees, close hauled near 45, close reach around 60 to 80, beam reach at 90, broad reach around 120 to 150, and running dead downwind at 180 degrees off the wind.",
        "faster_than_wind": "Because the sail responds to apparent wind rather than true wind. As the boat accelerates on a reach the apparent wind moves forward and increases, which increases the driving force, and the boat settles where drag balances it. On a low-drag platform that equilibrium can sit above true wind speed.",
        "tack_vs_gybe": "Both change which side the wind comes from. In a tack the bow passes through the wind, so the boat slows briefly and the sail crosses under control. In a gybe the stern passes through the wind, and because the sail stays loaded the whole way across, an uncontrolled gybe is the dangerous one.",
        "wingsail": "A wingsail is a rigid or semi-rigid aerofoil used in place of a soft sail. It holds a proper section across a range of angles of attack, so it makes more lift for the same area and is far less prone to luffing. On an autonomous boat the trim tab lets a very small actuator set the angle of the whole wing, which is a large power saving.",
        "autonomous_challenges": "Power budget, since there is no crew and everything runs off solar. Fault recovery, because nobody can go on deck to clear a fouled line or reset a controller. And sensing, because a person reads gusts and traffic instantly whereas the boat has to infer both from a handful of noisy sensors."
      }
    $json$::jsonb),

    ('elec-2026', $json$
      {
        "saturday_availability": "Yes",
        "multimeter_current": "In current mode the meter is close to a short circuit, so probing straight across the terminals puts the battery into a dead short through the meter. On a pack that can deliver hundreds of amps that blows the fuse at best and causes an arc, a burn or a thermal event at worst. Current has to be measured in series with the load, or non-invasively with a clamp meter, or across a shunt with a differential amplifier.",
        "batteries_series_parallel": "Series raises pack voltage, which lowers current and conduction losses for the same power, but one weak cell limits the whole string and balancing gets harder. Parallel raises capacity and gives redundancy, but cells at different states of charge push large circulating currents into each other at the moment they are connected, and one failed cell can be fed by every other cell in the group.",
        "two_sensors_one_mcu": "Do not block. Either give each sensor its own peripheral and interrupt, or poll on a fixed schedule from a timer and buffer the results, so a slow sensor cannot starve the other. Bus arbitration matters if they share a bus, and each stream needs its own ring buffer with an overflow policy that is deliberate rather than accidental. Timestamping on arrival keeps the two streams alignable afterwards.",
        "i2c_compass_zeros": "Check the physical layer first: pull-ups present and the right value, correct address, and the device actually out of reset and past its power-on time. Then confirm the bus is alive with a scan, put a scope on SDA and SCL to see whether the device acknowledges at all, and check whether the part needs a mode register written before it produces data. A lot of compasses power up in standby and read as zeros until they are told to start.",
        "reducing_noise": "Decoupling close to every supply pin, a continuous ground plane, keeping high current return paths short and away from the analogue section, differential routing for long signals, shielding and twisted pairs on cabling, filtering at the connector, and averaging or oversampling in firmware once the hardware has done what it can.",
        "harsh_environment_reliability": "Define the environment first - temperature range, humidity, salt, vibration, shock - then test to it rather than to room conditions: thermal cycling, a salt fog or immersion test on the enclosure, vibration on a shaker, and a long soak run at load. Derate parts, add margin, and run the whole system continuously for far longer than a mission before trusting it. Log everything, so a failure in the middle of a two-week run is diagnosable afterwards."
      }
    $json$::jsonb),

    -- Empty on purpose: every one of Software's own questions varies per
    -- applicant, so all of them are supplied by the merge below rather than
    -- being written here and immediately overwritten.
    ('soft-2026', $json$ {} $json$::jsonb)
),

-- The Software skills grid, three plausible profiles.
skills (n, payload) as (
  values
    (0, $json$
      {
        "Python": ["I have this skill"],
        "C/C++": ["I want to learn/improve this skill"],
        "Git/GitHub": ["I have this skill", "I want to learn/improve this skill"],
        "Linux": ["I have this skill"],
        "Robot Operating System (ROS)": ["I want to learn/improve this skill"],
        "Testing (unit, integration, mocks)": ["I want to learn/improve this skill"]
      }
    $json$::jsonb),
    (1, $json$
      {
        "Javascript/Typescript": ["I have this skill"],
        "HTML/CSS": ["I have this skill"],
        "React": ["I have this skill", "I want to learn/improve this skill"],
        "Web Development": ["I have this skill"],
        "Docker": ["I want to learn/improve this skill"],
        "Continuous Integration (CI/CD)": ["I want to learn/improve this skill"]
      }
    $json$::jsonb),
    (2, $json$
      {
        "Python": ["I have this skill"],
        "Physics Modeling": ["I have this skill", "I want to learn/improve this skill"],
        "Control Theory": ["I want to learn/improve this skill"],
        "Object-Oriented Programming": ["I have this skill"],
        "Data Parsing/Analysis/Visualizing": ["I have this skill"],
        "Sailing": ["I want to learn/improve this skill"]
      }
    $json$::jsonb)
)

insert into applications (
  posting_id, submission_id, applicant_name, applicant_email, year_of_study,
  faculty, home_department, resume_path, ranked_subteams, answers, question_schema_snapshot,
  status, assigned_subteam_id, interview_at, status_changed_at, submitted_at
)
select
  p.id,
  ('fbfbfbfb-0000-4000-8000-' || lpad(f.sub_no::text, 12, '0'))::uuid,
  f.name,
  f.email,
  f.year,
  -- Derived from the program rather than carried as a fiftieth column in the
  -- fixture: every code above is an engineering one except the two science
  -- ones, and a faculty nobody reads is not worth fifty hand-written strings.
  case when f.dept in ('CPSC', 'PHYS', 'MATH', 'STAT') then 'Science' else 'Applied Science' end,
  f.dept,
  null,
  -- Ranked subteams resolved from slug to id IN PREFERENCE ORDER, and scoped to
  -- the posting's own team so a Software applicant cannot end up ranking a
  -- Mechanical subteam.
  coalesce(
    (select array_agg(s.id order by r.ord)
     from unnest(f.ranked_slugs) with ordinality as r(slug, ord)
     join subteams s on s.slug = r.slug and s.team_id = p.team_id),
    '{}'::uuid[]
  ),
  ab.payload
    || jsonb_build_object('why_sailbot', w.body)
    || case f.posting_slug
         when 'mech-2026' then jsonb_build_object(
           'ballast',
             (array[
               $a$Ballast is weight carried low in the hull, usually below the waterline, to lower the centre of mass. Its function is to generate a righting moment that opposes the heeling moment from the sail, so the boat resists capsizing and can carry sail in stronger wind.$a$,
               $a$Ballast is dead weight placed as low as possible in the boat. Because it sits below the centre of buoyancy it produces a restoring torque when the boat heels, which is what keeps a keelboat upright without crew sitting out on the rail.$a$
             ])[1 + (f.sub_no % 2)],
           'dissimilar_metals',
             (array[
               $a$Galvanic corrosion. In the presence of an electrolyte such as seawater the two metals form a cell, and the more anodic metal (the aluminium) corrodes preferentially at the joint. It is managed by isolating the metals, coating the interface, or fitting a sacrificial anode.$a$,
               $a$Aluminium and stainless steel sit far apart on the galvanic series, so wet contact makes a battery out of the joint and the aluminium dissolves. Isolation washers, a barrier coating, or a zinc anode are the usual fixes.$a$
             ])[1 + ((f.sub_no + 1) % 2)],
           'sailing_upwind',
             (array[
               $a$The sail acts as an aerofoil, generating lift roughly perpendicular to the apparent wind. The keel resists the sideways component, so the resultant force has a forward component and the boat moves upwind at an angle. It cannot sail directly into the wind because inside roughly 30 to 45 degrees the sail stalls and the lift collapses, so progress upwind is made by tacking.$a$,
               $a$Lift from the sail plus lateral resistance from the keel leaves a net forward force even when the wind is ahead of the beam. The limit is the no-go zone: inside about 40 degrees the flow separates, so the boat has to beat upwind in a zigzag instead.$a$
             ])[1 + (f.sub_no % 2)]
         )
         when 'elec-2026' then jsonb_build_object(
           'saturday_availability', case when (f.sub_no % 7) = 3 then $a$No$a$ else $a$Yes$a$ end,
           'proud_project',
             (array[
               $a$I built a battery management board for a solar go-kart in a design course. I learned how much of the work is layout rather than schematic capture: the first revision had the current shunt somewhere that picked up switching noise and the readings were useless. The hardest part was debugging a board that failed only under load, which taught me to instrument before guessing. If I did it again I would design the test points in from the start instead of soldering wires onto pads.$a$,
               $a$A datalogger for a weather balloon payload. It read a pressure sensor and an IMU and wrote to an SD card. The difficulty was that it worked perfectly on the bench and stopped at altitude, which turned out to be a brownout once the regulator got cold. I learned to test at the environmental limits rather than in a warm room. Next time I would add a watchdog and log its resets, so the failure would explain itself.$a$,
               $a$A motor driver for a first-year robot. Explaining it to a first year: it takes a small signal from the microcontroller and uses it to switch a much bigger current to the motor. The difficulty was heat, because we sized the MOSFETs from the average current and the stall current melted one. I would measure the real current profile before choosing parts if I did it again.$a$
             ])[1 + (f.sub_no % 3)]
         )
         else jsonb_build_object(
           'saturday_availability', case when (f.sub_no % 9) = 4 then $a$No$a$ else $a$Yes$a$ end,
           'technical_skills', sk.payload,
           'software_project',
             (array[
               $a$I wrote a route planner for a hobby drone project that took a start and a goal on a grid with no-fly zones and returned a path. It began as a plain breadth-first search and became A* with a distance heuristic once the maps got large enough that the wait was noticeable. The hard part was not the search: the planner produced technically valid paths that hugged the edge of every no-fly zone, so I had to add a clearance cost and tune it. The second hard part was testing, because a path is not a single expected value, so I ended up asserting properties - the path is connected, never enters a zone, and is no longer than a known bound - instead of exact routes.$a$,
               $a$A dashboard for a campus energy monitoring project. A Python service pulled readings from a set of meters every minute and wrote them to a database, and a React front end drew them. What it did was simple. What was difficult was that meters dropped offline constantly, so naive charts drew a straight line through a six-hour gap as if nothing had happened. I ended up making gaps explicit in the data model rather than papering over them in the chart, which meant reworking the API. I also learned to write integration tests against a real database, because every bug I actually shipped was in a boundary my mocks had assumed away.$a$,
               $a$I built a small physics simulator to test a balancing robot controller without the robot, because the robot kept breaking. It integrated the equations of motion and fed the controller synthetic sensor readings with noise added. The challenge was that the controller worked beautifully in simulation and badly in reality, which turned out to be because I had simulated the sensors as perfect but delayed reality by a control loop. Adding realistic latency and quantisation to the fake sensors made the simulator useful and made the tuning transfer.$a$
             ])[1 + (f.sub_no % 3)],
           'quiz_language',
             (array[$a$Python$a$, $a$C++$a$, $a$I opted to answer the projects question$a$])[1 + (f.sub_no % 3)],
           -- Someone who answered the projects question instead has no repo to
           -- link, which is the shape the detail view has to render.
           'github_url',
             case when (f.sub_no % 3) = 2 then $a$$a$
                  else $a$https://github.com/$a$ || replace(split_part(f.email, '@', 1), '_', '-') || $a$/sailbot-quiz$a$
             end,
           'anything_else',
             (array[
               $a$I am also applying to the electrical team. Software is my first choice.$a$,
               $a$I am on co-op next term but I am staying in Vancouver and can keep my Saturdays clear.$a$,
               $a$$a$
             ])[1 + ((f.sub_no + 2) % 3)]
         )
       end,
  sn.questions,
  f.status,
  (select s.id from subteams s where s.slug = f.assigned_slug and s.team_id = p.team_id),
  case when f.interview_days is null then null else now() + make_interval(days => f.interview_days) end,
  now() - make_interval(days => f.status_days),
  now() - make_interval(days => f.submitted_days)
from fixture f
join postings p on p.slug = f.posting_slug
join snapshot sn on sn.posting_id = p.id
join answer_base ab on ab.posting_slug = f.posting_slug
join why w on w.n = f.sub_no % 4
join skills sk on sk.n = f.sub_no % 3;

-- ---------------------------------------------------------------------------
-- Notes on a handful
-- ---------------------------------------------------------------------------
-- Attributed to the lead of the owning team — every team has exactly one now.
-- Notes are append-only at the database level — no policy grants UPDATE or
-- DELETE — so there is no fixture for an edited note, because an edited note
-- cannot exist.
insert into application_notes (application_id, author_id, body, created_at)
select a.id, author.id, n.body, a.status_changed_at + make_interval(hours => n.hours_after)
from (values
  ('daniel_okafor@student.ubc.ca', 'soft-2026', 'soft@sailbot.local', 'Strong pathfinding answer, clearly written. Worth a look from whoever runs the CTRL interview too.',  2),
  ('daniel_okafor@student.ubc.ca', 'soft-2026', 'soft@sailbot.local', 'Agreed. Second choice is controller so either interview works.',                                    30),
  ('nina_petrov@student.ubc.ca',   'soft-2026', 'soft@sailbot.local', 'Interview went well. Confident on control theory, less so on Git. Recommend controller.',            4),
  ('sara_ahmadi@student.ubc.ca',   'soft-2026', 'soft@sailbot.local', 'Best technical quiz in the pile. Offer sent, waiting on a reply.',                                   1),
  ('sara_ahmadi@student.ubc.ca',   'soft-2026', 'soft@sailbot.local', 'Flagging that she also asked about DevOps. Keep that open if PATH fills up.',                        6),
  ('grace_liu@student.ubc.ca',     'soft-2026', 'soft@sailbot.local', 'This one has been sitting since the form opened. Needs a first read.',                              -1),
  ('rachel_kim@student.ubc.ca',    'mech-2026', 'mech@sailbot.local', 'Good composites background from the concrete toboggan team. Rudder is the right fit.',               5),
  ('chloe_dubois@student.ubc.ca',  'mech-2026', 'mech@sailbot.local', 'Offered sail. She has done wet layup before, which nobody else in this round has.',                   2),
  ('elena_rossi@student.ubc.ca',   'elec-2026', 'elec@sailbot.local', 'Offer out for COM. Strong on the noise question.',                                                   3),
  ('elena_rossi@student.ubc.ca',   'elec-2026', 'elec@sailbot.local', 'Following up Friday if there is no reply.',                                                         20)
) as n(email, posting_slug, author_email, body, hours_after)
join postings p on p.slug = n.posting_slug
join applications a on a.posting_id = p.id and a.applicant_email = n.email
join profiles author on author.email = n.author_email;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
-- Every application gets its submission, and everything that has moved gets the
-- status change that moved it. The actor is null on submission because the
-- applicant is not a user of this system.
insert into application_events (application_id, actor_id, type, from_status, to_status, created_at)
select a.id, null, 'submitted', null, 'applied', a.submitted_at
from applications a
where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%';

insert into application_events (application_id, actor_id, type, from_status, to_status, created_at)
select
  a.id,
  -- The team's own lead. A scalar subquery rather than a join: a developer who
  -- has created a second lead for the same team would otherwise get two event
  -- rows per application.
  (select l.id from profiles l
   where l.team_id = p.team_id and l.role = 'lead'
   order by l.created_at
   limit 1),
  'status_changed',
  'applied',
  a.status,
  a.status_changed_at
from applications a
join postings p on p.id = a.posting_id
where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
  and a.status <> 'applied';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Assertions, not just a printout. A seed that half-applies and says nothing is
-- worse than one that fails loudly: the board would then be built against a
-- shape nobody intended.
do $verify$
declare
  v_total          int;
  v_soft           int;
  v_mech           int;
  v_elec           int;
  v_statuses       int;
  v_empty_snapshot int;
  v_no_underscore  int;
  v_shared_subs    int;
  v_repeat_emails  int;
  v_notes          int;
  v_events         int;
  v_accounts       int;
  v_bad_keys       int;
  r                record;
begin
  select count(*) into v_total
  from applications
  where submission_id::text like 'fbfbfbfb-0000-4000-8000-%';

  if v_total <> 40 then
    raise exception 'expected 40 fixture applications, found %', v_total;
  end if;

  select
    count(*) filter (where p.slug = 'soft-2026'),
    count(*) filter (where p.slug = 'mech-2026'),
    count(*) filter (where p.slug = 'elec-2026')
  into v_soft, v_mech, v_elec
  from applications a
  join postings p on p.id = a.posting_id
  where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%';

  if v_soft <> 18 or v_mech <> 11 or v_elec <> 11 then
    raise exception 'per-posting counts wrong: soft=% mech=% elec=%', v_soft, v_mech, v_elec;
  end if;

  -- All eight statuses on EVERY posting. A board where two of three postings
  -- leave a column empty hides exactly the layout problems it should surface.
  for r in
    select p.slug, count(distinct a.status) as statuses
    from applications a
    join postings p on p.id = a.posting_id
    where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    group by p.slug
  loop
    if r.statuses <> 8 then
      raise exception 'posting % covers only % of the 8 statuses', r.slug, r.statuses;
    end if;
  end loop;

  select count(distinct status) into v_statuses
  from applications
  where submission_id::text like 'fbfbfbfb-0000-4000-8000-%';
  if v_statuses <> 8 then
    raise exception 'expected all 8 statuses, found %', v_statuses;
  end if;

  -- The snapshot invariant. `[]` here would leave the detail view blank and the
  -- whole point of the column unexercised.
  select count(*) into v_empty_snapshot
  from applications
  where submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    and coalesce(jsonb_array_length(question_schema_snapshot), 0) = 0;
  if v_empty_snapshot <> 0 then
    raise exception '% fixture applications have an empty question_schema_snapshot', v_empty_snapshot;
  end if;

  -- Every answer key must be a question in that row's own snapshot. This is
  -- what catches the fixture answers drifting away from the real question sets
  -- after a posting is edited.
  select count(*) into v_bad_keys
  from applications a
  cross join lateral jsonb_object_keys(a.answers) as k(key)
  where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    and not exists (
      select 1
      from jsonb_array_elements(a.question_schema_snapshot) as q
      where q->>'id' = k.key
    );
  if v_bad_keys <> 0 then
    raise exception '% fixture answers use a key that is not in the snapshot', v_bad_keys;
  end if;

  select count(*) into v_no_underscore
  from applications
  where submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    and position('_' in applicant_email) = 0;
  if v_no_underscore <> 0 then
    raise exception '% fixture emails have no underscore; the ilike-escaping case needs them', v_no_underscore;
  end if;

  -- One submission, two teams. The detail view's "also applied to" link has
  -- nothing to point at without these.
  select count(*) into v_shared_subs
  from (
    select submission_id
    from applications
    where submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    group by submission_id
    having count(*) > 1
  ) s;
  if v_shared_subs < 2 then
    raise exception 'expected several submissions spanning two teams, found %', v_shared_subs;
  end if;

  -- Same person, two separate submissions weeks apart.
  select count(*) into v_repeat_emails
  from (
    select lower(applicant_email) as email
    from applications
    where submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    group by lower(applicant_email)
    having count(distinct submission_id) > 1
  ) e;
  if v_repeat_emails < 2 then
    raise exception 'expected repeat applicants across submissions, found %', v_repeat_emails;
  end if;

  select count(*) into v_notes
  from application_notes n
  join applications a on a.id = n.application_id
  where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%';

  select count(*) into v_events
  from application_events e
  join applications a on a.id = e.application_id
  where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%';

  if v_notes < 8 or v_events < 40 then
    raise exception 'expected notes and events on the fixtures, found % notes and % events', v_notes, v_events;
  end if;

  -- Roles and teams as well as existence: a profile whose team_id never got set
  -- signs in fine and then sees an empty board, which reads as a bug in the
  -- query layer rather than as a bad fixture.
  select count(*) into v_accounts
  from profiles p
  join teams t on t.id = p.team_id
  where (p.email = 'soft@sailbot.local' and p.role = 'lead' and t.slug = 'soft')
     or (p.email = 'elec@sailbot.local' and p.role = 'lead' and t.slug = 'elec')
     or (p.email = 'mech@sailbot.local' and p.role = 'lead' and t.slug = 'mech');
  if v_accounts <> 3 then
    raise exception 'expected 3 local accounts with the right roles and teams, found %', v_accounts;
  end if;

  raise notice '--- dev fixtures ------------------------------------------';
  raise notice 'applications: % (soft %, mech %, elec %)', v_total, v_soft, v_mech, v_elec;
  for r in
    select a.status, count(*) as n
    from applications a
    where a.submission_id::text like 'fbfbfbfb-0000-4000-8000-%'
    group by a.status
    order by count(*) desc, a.status
  loop
    raise notice '  % %', rpad(r.status, 22), r.n;
  end loop;
  raise notice 'notes: %  events: %', v_notes, v_events;
  raise notice 'submissions spanning two teams: %  repeat applicants: %', v_shared_subs, v_repeat_emails;
  raise notice 'sign in as soft@ / elec@ / mech@sailbot.local, password test';
  raise notice '-----------------------------------------------------------';
end;
$verify$;
