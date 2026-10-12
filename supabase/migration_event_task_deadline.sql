-- The fly-day page shows the XCTrack QR, which needs the task's deadline as well
-- as its points. The event already carries its own start_time and race_type, so
-- the QR a pilot scans matches the day they joined rather than whatever the task
-- was published with.
--
-- Safe to re-run.

drop view if exists events_with_details;

create view events_with_details
  with (security_invoker = true) as
select
  e.*,
  t.name as task_name,
  t.points as task_points,
  t.distance_optimized_km,
  t.task_deadline,
  c.name as competition_name,
  (select count(*) from event_participants ep where ep.event_id = e.id)::int as participant_count,
  p.display_name as organizer_display_name
from events e
join tasks t on t.id = e.task_id
left join profiles p on p.id = e.organizer_id
left join competitions c on c.id = e.competition_id;
