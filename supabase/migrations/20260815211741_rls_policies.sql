-- teams and subteams: world-readable, admin-writable.
-- The public application form needs these before anyone authenticates.
create policy "teams are public" on teams for select using (true);
create policy "admins write teams" on teams for all
  using (is_admin()) with check (is_admin());

create policy "subteams are public" on subteams for select using (true);
create policy "admins write subteams" on subteams for all
  using (is_admin()) with check (is_admin());

-- core_questions: world-readable so the form renders, admin-owned.
create policy "core questions are public" on core_questions for select using (true);
create policy "admins write core questions" on core_questions for all
  using (is_admin()) with check (is_admin());

-- profiles: any authenticated user may read profiles, so note attribution can
-- resolve author names. Users update only their own row; admins update any.
create policy "authenticated read profiles" on profiles for select
  to authenticated using (true);
create policy "update own profile" on profiles for update
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- postings: open ones are public; leads own their team's.
create policy "open postings are public" on postings for select
  using (status = 'open' or is_admin() or team_id = current_profile_team());
create policy "leads write own team postings" on postings for all
  to authenticated
  using (is_admin() or team_id = current_profile_team())
  with check (is_admin() or team_id = current_profile_team());

-- applications: NO anon policy at all. Applicant submissions go through
-- server-side code holding the service role, which bypasses RLS entirely.
-- That server code is therefore responsible for checking the posting is open.
create policy "leads read own team applications" on applications for select
  to authenticated
  using (
    is_admin() or exists (
      select 1 from postings p
      where p.id = applications.posting_id and p.team_id = current_profile_team()
    )
  );
create policy "leads update own team applications" on applications for update
  to authenticated
  using (
    is_admin() or exists (
      select 1 from postings p
      where p.id = applications.posting_id and p.team_id = current_profile_team()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from postings p
      where p.id = applications.posting_id and p.team_id = current_profile_team()
    )
  );

-- notes: readable and insertable within team. No update or delete policy
-- exists, which is what makes them append-only at the database level.
create policy "leads read own team notes" on application_notes for select
  to authenticated
  using (
    is_admin() or exists (
      select 1 from applications a
      join postings p on p.id = a.posting_id
      where a.id = application_notes.application_id and p.team_id = current_profile_team()
    )
  );
create policy "leads insert own team notes" on application_notes for insert
  to authenticated
  with check (
    author_id = auth.uid() and (
      is_admin() or exists (
        select 1 from applications a
        join postings p on p.id = a.posting_id
        where a.id = application_notes.application_id and p.team_id = current_profile_team()
      )
    )
  );

-- events: same shape, also append-only.
create policy "leads read own team events" on application_events for select
  to authenticated
  using (
    is_admin() or exists (
      select 1 from applications a
      join postings p on p.id = a.posting_id
      where a.id = application_events.application_id and p.team_id = current_profile_team()
    )
  );
create policy "leads insert own team events" on application_events for insert
  to authenticated
  with check (
    is_admin() or exists (
      select 1 from applications a
      join postings p on p.id = a.posting_id
      where a.id = application_events.application_id and p.team_id = current_profile_team()
    )
  );
