-- The write half of a submission: N applications rows, one transaction.
--
-- An applicant fills ONE form covering every open team and gets one row per
-- team they selected, so mechanical can reject someone while software still
-- interviews them. The rows share a `submission_id` and a `resume_path` and
-- each carries its own frozen `question_schema_snapshot`.
--
-- WHY A FUNCTION RATHER THAN A LOOP IN THE ACTION
--
-- PostgREST gives every request its own transaction, so N inserts from the
-- server action are N transactions. The second one failing — a duplicate email
-- on that team is the realistic way — leaves the applicant applied to
-- mechanical, not applied to software, and with no way to discover it: the
-- action returned an error, so they believe nothing was written, and the unique
-- index then blocks the retry for the team that did succeed. A single RPC makes
-- the whole submission atomic, which is the only outcome a person can reason
-- about.
--
-- The rows arrive as one jsonb array rather than as parallel arrays, because
-- `jsonb_to_recordset` gives the insert a typed row source in one statement and
-- keeps each row's fields together on the way in.
--
-- WHAT THIS FUNCTION DELIBERATELY DOES NOT CHECK
--
-- It does not verify that a posting is open, that the subteams belong to the
-- team, or that the storage paths exist. Those are the server action's job and
-- splitting them across two languages would leave two half-authorities that
-- drift. This is a transaction primitive: it writes what it is given, or it
-- writes nothing. The one rule the database keeps to itself is the unique index
-- on (posting_id, lower(applicant_email)), which is the backstop for two
-- submissions racing past the action's own duplicate check.

create or replace function public.submit_application(p_rows jsonb)
returns jsonb
language plpgsql
volatile
-- SECURITY INVOKER on purpose. The caller is the service role, which has
-- BYPASSRLS, so this needs no elevation of its own; a DEFINER function would
-- instead become a permanent RLS hole if the grants below were ever loosened.
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    -- 22023 invalid_parameter_value. A submission selecting zero teams is
    -- refused by the action long before this; this is the guard that stops a
    -- malformed call writing nothing and reporting success.
    raise exception 'submit_application expects a non-empty JSON array of rows'
      using errcode = '22023';
  end if;

  with input as (
    select *
    from jsonb_to_recordset(p_rows) as r(
      posting_id               uuid,
      submission_id            uuid,
      applicant_name           text,
      applicant_email          text,
      year_of_study            text,
      home_department          text,
      resume_path              text,
      ranked_subteams          uuid[],
      answers                  jsonb,
      question_schema_snapshot jsonb
    )
  ),
  inserted as (
    insert into applications (
      posting_id, submission_id, applicant_name, applicant_email,
      year_of_study, home_department, resume_path, ranked_subteams,
      answers, question_schema_snapshot
    )
    select
      posting_id, submission_id, applicant_name, applicant_email,
      year_of_study, home_department, resume_path,
      coalesce(ranked_subteams, '{}'::uuid[]),
      coalesce(answers, '{}'::jsonb),
      question_schema_snapshot
    from input
    returning id, posting_id
  )
  -- Paired with the posting rather than returned as a bare id list: the order
  -- rows come back from an INSERT ... SELECT is not something the caller should
  -- have to assume matches the order it sent.
  select jsonb_agg(jsonb_build_object('id', id, 'posting_id', posting_id))
  into v_result
  from inserted;

  return v_result;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default, and everything
-- in `public` is exposed over PostgREST. Without this revoke, an anonymous
-- caller could POST to /rest/v1/rpc/submit_application and write applications
-- directly, skipping every check the server action exists to perform.
revoke all on function public.submit_application(jsonb) from public;
revoke all on function public.submit_application(jsonb) from anon;
revoke all on function public.submit_application(jsonb) from authenticated;
grant execute on function public.submit_application(jsonb) to service_role;
