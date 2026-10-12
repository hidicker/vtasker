-- A deadline belongs to the fly day, like the start time and the race type.
--
-- The same route flown in December has more daylight than in April, so the task's
-- published deadline is a starting point rather than a rule. Null means "use the
-- task's own deadline", which keeps every existing fly day behaving as it did.
--
-- Safe to re-run.

alter table events
  add column if not exists deadline text;

drop view if exists events_with_details;

create view events_with_details
  with (security_invoker = true) as
select
  e.*,
  t.name as task_name,
  t.points as task_points,
  t.distance_optimized_km,
  -- The deadline actually in force for this day: the fly day's own if it set
  -- one, otherwise whatever the task was published with.
  coalesce(e.deadline, t.task_deadline) as task_deadline,
  c.name as competition_name,
  (select count(*) from event_participants ep where ep.event_id = e.id)::int as participant_count,
  p.display_name as organizer_display_name
from events e
join tasks t on t.id = e.task_id
left join profiles p on p.id = e.organizer_id
left join competitions c on c.id = e.competition_id;
