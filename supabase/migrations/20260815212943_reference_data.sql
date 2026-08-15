-- Reference data: teams, subteams, and core questions.
--
-- This lives in a migration rather than seed.sql because seed files run only on
-- a local 'supabase db reset'; 'supabase db push' ignores them. The application
-- form cannot render without these rows, and the subteam descriptions are copy
-- rather than fixtures, so local and production have to converge automatically.
-- Every statement is idempotent, so this is safe to re-run.

insert into teams (name, slug) values
  ('Mechanical', 'mech'),
  ('Electrical', 'elec'),
  ('Software', 'soft')
on conflict (slug) do nothing;

-- Taken from the real team postings in docs/. Operations is intentionally
-- absent: it is a ~6-person group that hires personally with no application
-- form, so it is out of scope for this portal entirely.
insert into subteams (team_id, name, code, slug, position, description)
select t.id, s.name, s.code, s.slug, s.position, s.description
from teams t
join (values
  ('soft', 'Pathfinding', 'PATH', 'pathfinding', 0,
   'The brain of the boat, responsible for determining an efficient route from start to finish using vector math, calculus, and path planning algorithms.'),
  ('soft', 'Rudder and Wingsail Controller', 'CTRL', 'controller', 1,
   'The virtual helmsman: turns abstract objectives such as a desired heading into commands for the rudder and sails, using control theory and physical modelling.'),
  ('soft', 'Boat Simulator', 'SIM', 'simulator', 2,
   'Mimics the real-world environment so software can be tested without a physical vessel, including a physics model of the boat and artificial sensor noise.'),
  ('soft', 'Network Systems', 'NET', 'network-systems', 3,
   'The software-hardware interface: a bridge for data and commands to travel between the two, working with the Electrical firmware team as much as the software team.'),
  ('soft', 'Website', 'WEB', 'website', 4,
   'The platform for data interactions to and from the vessel, serving team members, vessel operations, researchers, and the general public.'),
  ('soft', 'DevOps', 'DevOps', 'devops', 5,
   'Infrastructure as Code: development environments, CI/CD pipelines, and the docs site, so software deploys quickly, correctly, and consistently.'),

  ('elec', 'Communications', 'COM', 'communications', 0,
   'A robust communication network transmitting data, commands, and errors, spanning transmission lines, network interface PCBs, firmware, sensors, and message formats.'),
  ('elec', 'Drive', 'DRV', 'drive', 1,
   'The boat''s control systems: hardware and firmware controlling the rudder and wingsail, including PID control algorithms and critical pathfinding sensors.'),
  ('elec', 'Power', 'PWR', 'power', 2,
   'The boat''s power system: solar panels, power tracking, battery management, and the power budget that allocates a finite resource across every device.'),

  ('mech', 'Sail', null, 'sail', 0,
   'Construction of the wingsail, including the composite shell, the trim tab, and the internal structure.'),
  ('mech', 'Rudder', null, 'rudder', 1,
   'The rudder body and actuation mechanism, from CNC milling and composite layups through structural validation and integration with Hull and Electrical.'),
  ('mech', 'Hull', null, 'hull', 2,
   'Design and construction of the hull and keel using Maxsurf, SolidWorks, and Ansys, with heavy focus on composite fabrication and cross-team integration.')
) as s(team_slug, name, code, slug, position, description) on s.team_slug = t.slug
on conflict (team_id, slug) do nothing;

-- Wording taken verbatim from the 2025 form. Note how SMALL the genuinely
-- shared set is: name, email, year, and home department are built-in columns,
-- which leaves exactly one shared question. Everything else on that form was
-- team-specific. Resist padding this out - every key added here becomes a
-- permanent export column for all three teams.
insert into core_questions (stable_key, position, definition) values
  ('why_sailbot', 0, '{
     "type": "long_text",
     "label": "Briefly, describe yourself and why you would like to join UBC Sailbot",
     "help": "Suggested under 50 words",
     "required": true,
     "config": {"maxLength": 600}
   }'::jsonb)
on conflict (stable_key) do nothing;
