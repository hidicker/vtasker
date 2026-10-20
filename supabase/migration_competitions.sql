-- Competitions: an optional banner a fly day can sit under.
--
-- Most club flying is one-off, so this is nullable — a fly day with no
-- competition is the normal case, not an incomplete one. Pilots create
-- competitions ad hoc from the Schedule a Fly Day form rather than an admin
-- screen, which is why any signed-in pilot may add one.
--
-- Safe to re-run.

create table if not exists competitions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- Newest first is what the dropdown wants, and it's the order pilots think in:
-- the comp you just added is the one you're scheduling for.
create index if not exists competitions_created_idx on competitions (created_at desc);

-- Case-insensitive uniqueness stops "Nelson Open" and "nelson open" becoming two
-- competitions. The API turns a collision into "use the existing one".
create unique index if not exists competitions_name_unique on competitions (lower(trim(name)));

alter table competitions enable row level security;

drop policy if exists "competitions are publicly readable" on competitions;
create policy "competitions are publicly readable"
  on competitions for select
  using (true);

drop policy if exists "authenticated users can create competitions" on competitions;
create policy "authenticated users can create competitions"
  on competitions for insert
  with check (auth.uid() = created_by);

-- Link the fly day to it. Null = a one-off, which stays the default.
alter table events
  add column if not exists competition_id uuid references competitions(id);

create index if not exists events_competition_idx on events (competition_id);

-- events_with_details expands e.* into a fixed column list, so a new events
-- column has to be picked up by rebuilding the view, not replacing it.
drop view if exists events_with_details;

create view events_with_details
  with (security_invoker = true) as
select
  e.*,
  t.name as task_name,
  t.points as task_points,
  t.distance_optimized_km,
  c.name as competition_name,
  (select count(*) from event_participants ep where ep.event_id = e.id)::int as participant_count,
  p.display_name as organizer_display_name
from events e
join tasks t on t.id = e.task_id
left join profiles p on p.id = e.organizer_id
left join competitions c on c.id = e.competition_id;

-- Supabase stops granting API access to new tables and views automatically on
-- 30 Oct 2026; row level security above still decides which rows.
grant select on competitions to anon;
grant select, insert, update, delete on competitions to authenticated, service_role;
grant select on events_with_details to anon, authenticated, service_role;
