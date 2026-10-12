-- Competition standings: add up each pilot's task points across the fly days in
-- a competition, optionally dropping their worst tasks.
--
-- Deliberately not a new scoring engine — each fly day already scores every
-- pilot out of 1000. This is only the aggregation, which is what FAI comps do:
-- highest total wins.
--
-- A pilot with no result for a task scores zero for it. That's the standard rule
-- and it means turning up counts; `drop_worst` is the relief valve for the day
-- someone was working or got skunked.
--
-- Safe to re-run.

alter table competitions
  add column if not exists drop_worst int not null default 0;

alter table competitions
  drop constraint if exists competitions_drop_worst_check;
alter table competitions
  add constraint competitions_drop_worst_check check (drop_worst between 0 and 5);

-- Whoever created the competition can change its settings. Nobody else needs to,
-- and a competition is cheap to recreate if it lands with the wrong person.
drop policy if exists "creators can update their competitions" on competitions;
create policy "creators can update their competitions"
  on competitions for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Every scored flight that belongs to a competition, flattened for the standings
-- table. The drop-worst arithmetic happens in the client, which needs to show
-- which task was dropped rather than just a total.
create or replace view competition_results
  with (security_invoker = true) as
select
  e.competition_id,
  e.id           as event_id,
  e.event_date,
  t.name         as task_name,
  fr.user_id,
  pr.display_name,
  fr.total_points
from flight_results fr
join events e   on e.id = fr.event_id
join tasks t    on t.id = e.task_id
left join profiles pr on pr.id = fr.user_id
where e.competition_id is not null;
