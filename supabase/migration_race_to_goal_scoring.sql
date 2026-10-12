-- Race to Goal: time everyone from the gate, not from their own start.
--
-- Elapsed Time (race_type 2) keeps measuring each pilot's own SSS -> ESS, which
-- is what a time trial means. Race to Goal (race_type 1) measures gate -> ESS
-- for the whole field, so starting late costs you directly. That is the only
-- difference between the two, and until now there wasn't one.
--
-- The gate is event_date + start_time read as UTC, matching how the upload path
-- already interprets start_time (see combineDateAndTime in ResultsUploadModal)
-- and how the XCTrack export writes it (HH:MM:00Z).
--
-- A valid SSS is still required either way: you cannot be timed on a speed
-- section you never entered, however fast you reached ESS.
--
-- Safe to re-run.

create or replace function recompute_event_scores(p_event_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_d_best   numeric;
  v_t_best   numeric;  -- seconds, fastest speed section among finishers
  v_race     int;
  v_gate     timestamptz;
begin
  select
    e.race_type,
    (e.event_date::text || ' '
      || substr(lpad(e.start_time, 4, '0'), 1, 2) || ':'
      || substr(lpad(e.start_time, 4, '0'), 3, 2) || ':00+00')::timestamptz
  into v_race, v_gate
  from events e
  where e.id = p_event_id;

  -- Null gate = "measure from each pilot's own crossing", which is what the
  -- coalesce below then falls back to.
  if v_race is distinct from 1 then
    v_gate := null;
  end if;

  select max(distance_km) into v_d_best
  from flight_results where event_id = p_event_id;

  select min(extract(epoch from (ess_time - coalesce(v_gate, sss_time))))
  into v_t_best
  from flight_results
  where event_id = p_event_id
    and sss_time is not null
    and ess_time is not null
    and ess_time > coalesce(v_gate, sss_time);

  update flight_results r set
    distance_points = case
      when v_d_best > 0 then round(least(800, 800.0 * r.distance_km / v_d_best), 1)
      else 0
    end,
    time_points = case
      when r.sss_time is not null
       and r.ess_time is not null
       and r.ess_time > coalesce(v_gate, r.sss_time)
       and v_t_best is not null
      then round(least(150, 150.0 * v_t_best / extract(epoch from (r.ess_time - coalesce(v_gate, r.sss_time)))), 1)
      else 0
    end,
    goal_bonus_points = case when r.goal_time is not null then 50 else 0 end
  where r.event_id = p_event_id;

  update flight_results set total_points = distance_points + time_points + goal_bonus_points
  where event_id = p_event_id;
end;
$$;

revoke execute on function recompute_event_scores(uuid) from anon, public;
grant execute on function recompute_event_scores(uuid) to authenticated;
