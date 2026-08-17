-- Trim each posting description down to what is true of that team alone.
--
-- All three opened with the same account of the project, rewritten: "Our
-- current project, POLARIS, is an ocean-going, fixed-wing sailboat…", "Our
-- current project involves constructing and testing a 3m fully autonomous
-- sailboat…", "Our current project is an autonomous research vessel…". That was
-- right in the Google Form, where an applicant might only ever open one team's
-- section, so each had to stand alone. On one page it is the same paragraph
-- three times — roughly 700 of the 1,700 characters an applicant read before
-- they could answer a question about which teams to pick. It is now told once,
-- above the cards, in `TeamSelector`.
--
-- FIRST PARAGRAPH IS THE CARD FACE; the rest sits behind a disclosure. Keep the
-- first one to a sentence or two that distinguishes this team from the others —
-- it is the line someone chooses by.
--
-- Electrical and Software needed no new writing: their team paragraph already
-- existed further down and is promoted verbatim.

update postings
set description = $desc$The mechanical team designs and builds the boat itself — the rudder, sail, keel and hull.

Our current project, POLARIS, is an ocean-going, fixed-wing sailboat designed to support oceanic research by providing surface data to researchers. The long-term goal for this project is to be a flexible platform that will enable future improvements to our vessels through an iterative design process.$desc$
where slug = 'mech-2026';

update postings
set description = $desc$The electrical team is responsible for designing, implementing and testing hardware and low-level software that bring the boat to life and allow it to navigate the ocean.

There is a vast amount of work done in the electrical team spanning multiple interests.$desc$
where slug = 'elec-2026';

update postings
set description = $desc$Members of the software team are directly responsible for developing our codebases to push the boundaries of autonomous sailing.

The initial design phase is now complete, and implementation is well underway for our various software projects. As a new member, this is a great time to join, as you get to jump straight into hands-on software development within our much wider software project.$desc$
where slug = 'soft-2026';
