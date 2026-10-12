-- Race type moves onto the fly day, not the task.
--
-- The same route can be flown elapsed-time one weekend and race-to-goal the
-- next, so the type belongs to the scheduled day rather than the reusable task.
-- Elapsed Time (2) is the default: it is what the scoring engine already
-- computes (each pilot's own ESS - SSS, with sss_open_time acting as a gate
-- that opens), and it suits club flying where people launch when they're ready.
--
--   1 = Race to Goal    everyone's clock starts at the gate
--   2 = Elapsed Time    your clock starts when you cross the start
--
-- Safe to re-run.

alter table events
  add column if not exists race_type int not null default 2;

alter table events
  drop constraint if exists events_race_type_check;
alter table events
  add constraint events_race_type_check check (race_type in (1, 2));

-- events_with_details selects e.*, which Postgres expanded into a fixed column
-- list when the view was created. A new events column lands in the middle of
-- that list, and CREATE OR REPLACE VIEW can only append columns at the end, so
-- the view has to be dropped and rebuilt rather than replaced.
drop view if exists events_with_details;

create view events_with_details
  with (security_invoker = true) as
select
  e.*,
  t.name as task_name,
  t.points as task_points,
  t.distance_optimized_km,
  (select count(*) from event_participants ep where ep.event_id = e.id)::int as participant_count,
  p.display_name as organizer_display_name
from events e
join tasks t on t.id = e.task_id
left join profiles p on p.id = e.organizer_id;
