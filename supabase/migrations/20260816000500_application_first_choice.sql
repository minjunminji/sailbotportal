-- The applicant's first-ranked subteam, as a column.
--
-- The board card shows first choice and the board filters on it ("show me
-- everyone who put PATH first"), and `ranked_subteams` is a uuid[] whose
-- ordering carries that meaning in element 1. PostgREST can ask whether an
-- array CONTAINS a value, but it has no way to ask about a specific position,
-- so without this the filter has to be either wrong (contains, which also
-- matches a second or third choice) or done in the application after fetching
-- rows it is about to throw away. Neither is acceptable on the query path that
-- runs every time a lead opens the board.
--
-- GENERATED ... STORED rather than a trigger or a denormalised column the
-- application maintains: `ranked_subteams[1]` is immutable, so Postgres keeps
-- the two in step itself and there is no way for them to disagree. It is
-- invisible to writers — `submit_application` and every INSERT keep writing
-- only `ranked_subteams`.
--
-- NULL for the teams that do not rank (Mechanical and Electrical assign a
-- subteam after the interview), because `ranked_subteams` is empty there and
-- subscripting an empty array yields NULL rather than an error.
alter table applications
  add column first_choice_subteam_id uuid
  generated always as (ranked_subteams[1]) stored;

-- Composite because the board is always one posting at a time, so the filter is
-- (posting, first choice) rather than first choice alone.
create index applications_first_choice_idx
  on applications(posting_id, first_choice_subteam_id);
