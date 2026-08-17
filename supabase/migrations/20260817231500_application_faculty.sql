-- Faculty, alongside the program the applicant is in.
--
-- `home_department` already held a program code — MECH, CPSC, APSC — and that is
-- all it holds now. What it never held is the faculty around it: 'Biology' and
-- 'Commerce' are a program each, and grouping applicants by faculty meant
-- guessing from a string that only engineering codes made guessable.
--
-- The two are asked separately on the form, and the faculty decides how the
-- program is asked: Applied Science offers its twelve program codes as a closed
-- list, every other faculty takes free text, because nobody outside engineering
-- shares a four-letter vocabulary.
--
-- NOT NULL with a default of '' rather than a nullable column: the form requires
-- both fields, so the only rows that can carry an empty faculty are the ones
-- written before this column existed. The default is dropped immediately after,
-- so a row written from here on must say which faculty it means.
alter table applications add column faculty text not null default '';
alter table applications alter column faculty drop default;

comment on column applications.home_department is
  'Program or major. An APSC code (MECH, CPEN, ...) when faculty is Applied Science, free text otherwise.';
comment on column applications.faculty is
  'UBC faculty: Applied Science, Science, Arts, Business, Law, Forestry.';

-- The write path takes its rows as one jsonb array, so a new column means a new
-- field in the recordset definition. Replaced in full rather than patched; see
-- the original migration for why this is a function at all.
create or replace function public.submit_application(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
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
      faculty                  text,
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
      year_of_study, faculty, home_department, resume_path, ranked_subteams,
      answers, question_schema_snapshot
    )
    select
      posting_id, submission_id, applicant_name, applicant_email,
      year_of_study, coalesce(faculty, ''), home_department, resume_path,
      coalesce(ranked_subteams, '{}'::uuid[]),
      coalesce(answers, '{}'::jsonb),
      question_schema_snapshot
    from input
    returning id, posting_id
  )
  select jsonb_agg(jsonb_build_object('id', id, 'posting_id', posting_id))
  into v_result
  from inserted;

  return v_result;
end;
$$;

-- The grants are attached to the function, and `create or replace` keeps them,
-- but they are restated so a future replacement copied from this file cannot
-- leave the function executable by anon.
revoke all on function public.submit_application(jsonb) from public;
revoke all on function public.submit_application(jsonb) from anon;
revoke all on function public.submit_application(jsonb) from authenticated;
grant execute on function public.submit_application(jsonb) to service_role;
