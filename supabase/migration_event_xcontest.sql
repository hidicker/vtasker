-- XContest task code for a fly day, generated when the day is scheduled so
-- every pilot sees the same code without pressing anything.
--
--   xcontest_code    short code typed into XCTrack (XContest expires it after a month)
--   xcontest_hash    permanent id; https://tools.xcontest.org/api/xctsk/load/<hash>
--                    serves the .xctsk file, which is what the "Open in XCTrack" link uses
--   xcontest_code_at when the code was issued, to know when it has lapsed
--   xcontest_for     fingerprint of the task file it was made from — a passed
--                    start-time proposal changes the file, which makes the code stale
alter table events add column if not exists xcontest_code    text;
alter table events add column if not exists xcontest_hash    text;
alter table events add column if not exists xcontest_code_at timestamptz;
alter table events add column if not exists xcontest_for     text;

-- events_with_details selects e.*, which Postgres expands when the view is
-- created, so it has to be rebuilt to pick the new columns up. No data lives
-- in a view; this is the definition from schema.sql unchanged.
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

grant select on events_with_details to anon, authenticated, service_role;
