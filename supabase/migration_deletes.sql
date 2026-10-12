-- Let people undo their own mistakes, but not out from under anyone else.
--
--   Fly day: the organizer can delete it until another pilot joins. After that
--            it belongs to the group, not to them.
--   Task:    the owner can delete it until it has been scheduled. Once a fly day
--            exists, pilots may have joined and results may follow.
--
-- Both are enforced in the database rather than the UI, so a stale screen can't
-- delete something that has since been joined.
--
-- Safe to re-run.

-- --------------------------------------------------------------------------
-- Fly days
-- --------------------------------------------------------------------------
-- The organizer is auto-confirmed when they create the event, so "nobody else
-- has joined" means no participant row belongs to anyone but them.
drop policy if exists "organizers can delete unjoined events" on events;
create policy "organizers can delete unjoined events"
  on events for delete
  using (
    auth.uid() = organizer_id
    and not exists (
      select 1 from event_participants ep
      where ep.event_id = events.id
        and ep.user_id <> events.organizer_id
    )
  );

-- --------------------------------------------------------------------------
-- Tasks
-- --------------------------------------------------------------------------
-- events.task_id has no ON DELETE CASCADE, so the foreign key already refuses to
-- drop a scheduled task. This policy makes the same rule explicit, and means the
-- client gets a clean "not permitted" rather than a foreign-key error.
drop policy if exists "owners can delete unscheduled tasks" on tasks;
create policy "owners can delete unscheduled tasks"
  on tasks for delete
  using (
    auth.uid() = owner_id
    and not exists (
      select 1 from events e where e.task_id = tasks.id
    )
  );
