-- Every status change writes an `application_events` row. No exceptions.
--
-- WHY A TRIGGER RATHER THAN A FUNCTION THE APP CALLS
--
-- The obvious design is an RPC that updates the row and inserts the event
-- together, and it would be atomic. It would also be optional. The RLS policy
-- "leads update own team applications" grants UPDATE on `applications` to
-- `authenticated`, and every table in `public` is a PostgREST endpoint — so a
-- lead holding nothing but the anon key and their own session can
--
--   PATCH /rest/v1/applications?id=eq.<id>  {"status": "rejected"}
--
-- and move a candidate with no audit row behind it. Nothing in the application
-- can prevent that, because the bypass does not go through the application.
--
-- A status change with no event is worse than having no audit trail at all: the
-- history still looks complete, so the gap is invisible exactly when someone is
-- relying on it. Moving the write into a trigger makes the event a property of
-- the UPDATE itself. The server action, a direct PATCH, a psql session and a
-- future admin screen all produce the same audit row, because none of them can
-- avoid firing it.
--
-- This also removes the need for a move RPC entirely. A single UPDATE statement
-- is already one transaction, and the trigger runs inside it: the row and its
-- event commit together or not at all.

create or replace function public.log_status_change()
returns trigger
language plpgsql
-- SECURITY DEFINER so the audit row is written whatever the caller's own INSERT
-- rights on `application_events` happen to be. Leads do have an insert policy
-- for their team today, but an audit trail that a future policy edit could
-- silently switch off is not an audit trail. The function cannot be abused to
-- forge history: it takes no arguments, is reachable only as a trigger, and can
-- only describe an UPDATE that has already passed RLS on its own merits.
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into application_events (application_id, actor_id, type, from_status, to_status)
    values (
      new.id,
      -- `actor_id` references profiles, and a service-role script or a database
      -- migration has no profile. Resolving through the table rather than using
      -- auth.uid() directly yields NULL in that case instead of failing the
      -- foreign key and taking the whole UPDATE down with it. An unattributed
      -- event is a true record; a blocked status change is an outage.
      (select p.id from profiles p where p.id = auth.uid()),
      'status_change',
      old.status,
      new.status
    );
  end if;
  return new;
end;
$$;

-- AFTER, not BEFORE: by the time this runs the UPDATE has passed the check
-- constraint and both RLS policies, so an event is never written for a change
-- that then fails. It also runs after `applications_status_changed`, the BEFORE
-- trigger that advances `status_changed_at`.
create trigger applications_log_status_change
  after update on applications
  for each row execute function public.log_status_change();

-- A function returning `trigger` is not callable over PostgREST, so these
-- revokes are belt and braces rather than the load-bearing control they are on
-- `submit_application`. They are here because "every SECURITY DEFINER function
-- in public is locked down" is a rule worth being able to check mechanically,
-- without anyone having to re-derive which exceptions were safe.
revoke all on function public.log_status_change() from public;
revoke all on function public.log_status_change() from anon;
revoke all on function public.log_status_change() from authenticated;
