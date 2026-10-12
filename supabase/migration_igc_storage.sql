-- ============================================================================
-- Move IGC flight logs out of the flight_results table into Supabase Storage.
-- ============================================================================
-- Real IGC files run 100KB–2MB. Held in a text column they get pulled into the
-- planner's row storage, so every results query drags them along and a season's
-- worth bloats the table badly. Storage keeps the bytes on object storage and
-- leaves only a short path behind.
--
-- Run once, after schema.sql. Safe to re-run.
--
-- NOTE: this DROPS flight_results.igc_raw. Existing uploads are test data only
-- (a synthetic track kept at testdata/test-flight.igc, plus seeded placeholders),
-- so nothing of value is lost. Results keep their scores — only the raw file goes.
-- ============================================================================

-- Private bucket: an IGC is a precise GPS trace of someone's day, so it is not
-- world-readable even though the scores derived from it are.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flight-logs', 'flight-logs', false, 10485760, null)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760;

-- Files live at  flight-logs/<user_id>/<event_id>.igc  so ownership is provable
-- from the path itself.
drop policy if exists "pilots upload their own flight logs" on storage.objects;
create policy "pilots upload their own flight logs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'flight-logs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "signed-in pilots can read flight logs" on storage.objects;
create policy "signed-in pilots can read flight logs"
  on storage.objects for select to authenticated
  using (bucket_id = 'flight-logs');

drop policy if exists "pilots can replace their own flight logs" on storage.objects;
create policy "pilots can replace their own flight logs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'flight-logs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Swap the column: path in, blob out.
alter table flight_results add column if not exists igc_path text;
alter table flight_results drop column if exists igc_raw;

-- flight_results_with_names selected igc_raw implicitly? No — it lists columns
-- explicitly, but it still has to be rebuilt to expose the new column.
drop view if exists flight_results_with_names;
create view flight_results_with_names
  with (security_invoker = true) as
select fr.id, fr.event_id, fr.user_id, fr.igc_filename, fr.igc_path,
       fr.sss_time, fr.ess_time, fr.goal_time,
       fr.distance_km, fr.distance_points, fr.time_points, fr.goal_bonus_points,
       fr.total_points, fr.created_at, pr.display_name
from flight_results fr
join profiles pr on pr.id = fr.user_id;
