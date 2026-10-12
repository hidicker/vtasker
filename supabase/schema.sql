-- VTasker Supabase schema.
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query) for a fresh project.
-- Sections are appended phase by phase; each is safe to re-run (idempotent-ish via IF NOT EXISTS
-- / OR REPLACE), so you can paste the whole file again after later phases add more to it.

-- ============================================================================
-- PHASE 0 — profiles (1:1 with auth.users)
-- ============================================================================

create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles are publicly readable" on profiles;
create policy "profiles are publicly readable"
  on profiles for select
  using (true);

drop policy if exists "users can update their own profile" on profiles;
create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up. OAuth providers
-- (Google) hand us a real name in the user metadata, so prefer that; magic-link
-- signups only have an email, so fall back to its local part.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Pilot'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================================
-- PHASE 1 — tasks (shareable cylinder routes) + task_votes
-- ============================================================================

create table if not exists tasks (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references profiles(id),
  name                   text not null,
  points                 jsonb not null,
  sss_open_time          text not null,
  task_deadline          text not null,
  race_type              int not null default 1,
  distance_optimized_km  numeric,
  distance_center_km     numeric,
  is_published           boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists tasks_published_idx on tasks (is_published, created_at desc);

alter table tasks enable row level security;

drop policy if exists "published tasks are publicly readable, drafts owner-only" on tasks;
create policy "published tasks are publicly readable, drafts owner-only"
  on tasks for select
  using (is_published = true or owner_id = auth.uid());

drop policy if exists "users can create their own tasks" on tasks;
create policy "users can create their own tasks"
  on tasks for insert
  with check (owner_id = auth.uid());

drop policy if exists "owners can update their own tasks" on tasks;
create policy "owners can update their own tasks"
  on tasks for update
  using (owner_id = auth.uid());

-- Owners can delete a task until it has been scheduled (see migration_deletes.sql).
drop policy if exists "owners can delete unscheduled tasks" on tasks;
create policy "owners can delete unscheduled tasks"
  on tasks for delete
  using (
    auth.uid() = owner_id
    and not exists (select 1 from events e where e.task_id = tasks.id)
  );

create table if not exists task_votes (
  task_id    uuid not null references tasks(id) on delete cascade,
  user_id    uuid not null references profiles(id),
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table task_votes enable row level security;

drop policy if exists "votes are publicly readable" on task_votes;
create policy "votes are publicly readable"
  on task_votes for select
  using (true);

drop policy if exists "users can cast their own votes" on task_votes;
create policy "users can cast their own votes"
  on task_votes for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can change their own votes" on task_votes;
create policy "users can change their own votes"
  on task_votes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can remove their own votes" on task_votes;
create policy "users can remove their own votes"
  on task_votes for delete
  using (auth.uid() = user_id);

-- Convenience view: published tasks with aggregated vote score + owner name.
-- security_invoker so it respects the querying user's RLS grants rather than the view owner's.
create or replace view tasks_with_votes
  with (security_invoker = true) as
select
  t.*,
  coalesce(sum(v.value), 0)::int as vote_score,
  p.display_name as owner_display_name
from tasks t
left join task_votes v on v.task_id = t.id
left join profiles p on p.id = t.owner_id
where t.is_published = true
group by t.id, p.display_name;

-- ============================================================================
-- PHASE 2 — events, participation confirmation, start-time voting
-- ============================================================================

-- race_type belongs to the fly day, not the task: the same route can be flown
-- elapsed-time one weekend and race-to-goal the next.
--   1 = Race to Goal    everyone's clock starts at the gate
--   2 = Elapsed Time    your clock starts when you cross the start (default)
create table if not exists events (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references tasks(id),
  organizer_id uuid not null references profiles(id),
  event_date   date not null,
  start_time   text not null,
  race_type    int not null default 2 check (race_type in (1,2)),
  status       text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_at   timestamptz not null default now()
);
-- For databases created before race_type existed (see migration_event_race_type.sql).
alter table events add column if not exists race_type int not null default 2;

-- Optional competition banner a fly day can sit under (see migration_competitions.sql).
-- Most club flying is one-off, so this stays nullable.
create table if not exists competitions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists competitions_created_idx on competitions (created_at desc);
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

alter table events add column if not exists competition_id uuid references competitions(id);
create index if not exists events_competition_idx on events (competition_id);
-- XContest share for the fly day (migration_event_xcontest.sql).
alter table events add column if not exists xcontest_code    text;
alter table events add column if not exists xcontest_hash    text;
alter table events add column if not exists xcontest_code_at timestamptz;
alter table events add column if not exists xcontest_for     text;
create index if not exists events_task_idx on events (task_id);
create index if not exists events_date_idx on events (event_date desc);

alter table events enable row level security;

drop policy if exists "events are publicly readable" on events;
create policy "events are publicly readable"
  on events for select
  using (true);

drop policy if exists "authenticated users can create events" on events;
create policy "authenticated users can create events"
  on events for insert
  with check (auth.uid() = organizer_id);

drop policy if exists "organizers can update event status" on events;
create policy "organizers can update event status"
  on events for update
  using (auth.uid() = organizer_id);
  -- start_time is intentionally NOT settable this way in practice — the app only
  -- ever writes it via resolve_start_time_proposal() below, which runs as the
  -- table owner and bypasses this policy. This policy exists so an organizer can
  -- still flip `status` (e.g. cancel/complete) directly.

-- Organizers can delete a fly day until another pilot joins (see migration_deletes.sql).
drop policy if exists "organizers can delete unjoined events" on events;
create policy "organizers can delete unjoined events"
  on events for delete
  using (
    auth.uid() = organizer_id
    and not exists (
      select 1 from event_participants ep
      where ep.event_id = events.id and ep.user_id <> events.organizer_id
    )
  );

create table if not exists event_participants (
  event_id     uuid not null references events(id) on delete cascade,
  user_id      uuid not null references profiles(id),
  confirmed_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table event_participants enable row level security;

drop policy if exists "participation is publicly readable" on event_participants;
create policy "participation is publicly readable"
  on event_participants for select
  using (true);

drop policy if exists "users can confirm their own participation" on event_participants;
create policy "users can confirm their own participation"
  on event_participants for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can withdraw their own participation" on event_participants;
create policy "users can withdraw their own participation"
  on event_participants for delete
  using (auth.uid() = user_id);

create table if not exists start_time_proposals (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  proposed_by     uuid not null references profiles(id),
  proposed_time   text not null,
  voting_deadline timestamptz not null,
  status          text not null default 'open' check (status in ('open','passed','rejected','superseded')),
  created_at      timestamptz not null default now()
);
create index if not exists proposals_event_open_idx on start_time_proposals (event_id) where status = 'open';

alter table start_time_proposals enable row level security;

drop policy if exists "proposals are publicly readable" on start_time_proposals;
create policy "proposals are publicly readable"
  on start_time_proposals for select
  using (true);

drop policy if exists "confirmed participants can propose a new start time" on start_time_proposals;
create policy "confirmed participants can propose a new start time"
  on start_time_proposals for insert
  with check (
    auth.uid() = proposed_by
    and exists (
      select 1 from event_participants ep
      where ep.event_id = start_time_proposals.event_id and ep.user_id = auth.uid()
    )
  );

create table if not exists start_time_votes (
  proposal_id uuid not null references start_time_proposals(id) on delete cascade,
  user_id     uuid not null references profiles(id),
  value       boolean not null,
  voted_at    timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

alter table start_time_votes enable row level security;

drop policy if exists "votes are publicly readable" on start_time_votes;
create policy "votes are publicly readable"
  on start_time_votes for select
  using (true);

drop policy if exists "confirmed participants can vote on an open proposal" on start_time_votes;
create policy "confirmed participants can vote on an open proposal"
  on start_time_votes for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from start_time_proposals p
      join event_participants ep on ep.event_id = p.event_id and ep.user_id = auth.uid()
      where p.id = start_time_votes.proposal_id and p.status = 'open' and now() < p.voting_deadline
    )
  );

drop policy if exists "users can change their vote before the deadline" on start_time_votes;
create policy "users can change their vote before the deadline"
  on start_time_votes for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from start_time_proposals p
      where p.id = start_time_votes.proposal_id and p.status = 'open' and now() < p.voting_deadline
    )
  );

-- Tallies votes cast so far and, once the deadline has passed, resolves the
-- proposal: majority of votes CAST (not all participants) wins. Safe to call
-- repeatedly/early — it's a no-op until the deadline passes and the proposal
-- is still open. security definer so it can write events.start_time even
-- though regular users have no direct UPDATE grant on that column's intent.
create or replace function resolve_start_time_proposal(p_proposal_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_proposal start_time_proposals%rowtype;
  v_yes int;
  v_no int;
begin
  select * into v_proposal from start_time_proposals where id = p_proposal_id for update;
  if not found or v_proposal.status <> 'open' or now() < v_proposal.voting_deadline then
    return;
  end if;

  select
    count(*) filter (where value = true),
    count(*) filter (where value = false)
    into v_yes, v_no
    from start_time_votes where proposal_id = p_proposal_id;

  if v_yes > v_no then
    update events set start_time = v_proposal.proposed_time where id = v_proposal.event_id;
    update start_time_proposals set status = 'passed' where id = p_proposal_id;
    update start_time_proposals set status = 'superseded'
      where event_id = v_proposal.event_id and id <> p_proposal_id and status = 'open';
  else
    update start_time_proposals set status = 'rejected' where id = p_proposal_id;
  end if;
end;
$$;

grant execute on function resolve_start_time_proposal(uuid) to authenticated, anon;

-- Convenience view: events joined with their task's route/name and a participant count.
-- Dropped rather than replaced: the view expands e.* into a fixed column list at
-- creation time, and CREATE OR REPLACE VIEW can only append columns at the end,
-- so a new events column added mid-list would make the replace fail.
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

-- Convenience view: participants with their display name (for the roster list in EventModal).
create or replace view event_participants_with_names
  with (security_invoker = true) as
select ep.*, pr.display_name
from event_participants ep
join profiles pr on pr.id = ep.user_id;

-- ============================================================================
-- PHASE 3 — IGC flight results + simplified GAP-inspired scoring
-- ============================================================================

create table if not exists flight_results (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references events(id) on delete cascade,
  user_id            uuid not null references profiles(id),
  igc_filename       text not null,
  igc_raw            text not null,
  sss_time           timestamptz,
  ess_time           timestamptz,
  goal_time          timestamptz,
  distance_km        numeric not null,
  distance_points    numeric not null default 0,
  time_points        numeric not null default 0,
  goal_bonus_points  numeric not null default 0,
  total_points       numeric not null default 0,
  created_at         timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table flight_results enable row level security;

drop policy if exists "results are publicly readable" on flight_results;
create policy "results are publicly readable"
  on flight_results for select
  using (true);

drop policy if exists "confirmed participants can submit one result" on flight_results;
create policy "confirmed participants can submit one result"
  on flight_results for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from event_participants ep
      where ep.event_id = flight_results.event_id and ep.user_id = auth.uid()
    )
  );
  -- No UPDATE/DELETE policy for regular users — results are immutable from the
  -- client once submitted. Points columns are only ever rewritten by
  -- recompute_event_scores() below (security definer), never by direct client
  -- UPDATE, so a pilot can't inflate their own score.

-- Recomputes distance/time/goal points for EVERY result in an event, normalized
-- against the best distance and fastest speed-section time in that same event's
-- field. Called after every new submission since a new pilot's result can move
-- D_best/T_best and change everyone else's points too.
create or replace function recompute_event_scores(p_event_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_d_best numeric;
  v_t_best numeric; -- seconds, fastest speed section among finishers
  v_race   int;
  v_gate   timestamptz;
begin
  select max(distance_km) into v_d_best from flight_results where event_id = p_event_id;

  -- Race to Goal (race_type 1) times the whole field from one gate; Elapsed
  -- Time from each pilot's own crossing. See migration_race_to_goal_scoring.sql.
  select
    e.race_type,
    (e.event_date::text || ' '
      || substr(lpad(e.start_time, 4, '0'), 1, 2) || ':'
      || substr(lpad(e.start_time, 4, '0'), 3, 2) || ':00+00')::timestamptz
  into v_race, v_gate
  from events e where e.id = p_event_id;

  if v_race is distinct from 1 then
    v_gate := null;
  end if;

  select min(extract(epoch from (ess_time - coalesce(v_gate, sss_time))))
    into v_t_best
    from flight_results
    where event_id = p_event_id and sss_time is not null and ess_time is not null
      and ess_time > coalesce(v_gate, sss_time);

  update flight_results r set
    distance_points = case when v_d_best > 0 then round(least(800, 800.0 * r.distance_km / v_d_best), 1) else 0 end,
    time_points = case
      when r.sss_time is not null and r.ess_time is not null
       and r.ess_time > coalesce(v_gate, r.sss_time) and v_t_best is not null
      then round(least(150, 150.0 * v_t_best / extract(epoch from (r.ess_time - coalesce(v_gate, r.sss_time)))), 1)
      else 0
    end,
    goal_bonus_points = case when r.goal_time is not null then 50 else 0 end
  where r.event_id = p_event_id;

  update flight_results set total_points = distance_points + time_points + goal_bonus_points
  where event_id = p_event_id;
end;
$$;

-- authenticated only: an anonymous visitor has no reason to trigger a rescore.
revoke execute on function recompute_event_scores(uuid) from anon, public;
grant execute on function recompute_event_scores(uuid) to authenticated;

-- Convenience view: results with pilot display names, for the leaderboard table.
create or replace view flight_results_with_names
  with (security_invoker = true) as
select fr.id, fr.event_id, fr.user_id, fr.igc_filename, fr.sss_time, fr.ess_time, fr.goal_time,
       fr.distance_km, fr.distance_points, fr.time_points, fr.goal_bonus_points, fr.total_points,
       fr.created_at, pr.display_name
from flight_results fr
join profiles pr on pr.id = fr.user_id;

-- ============================================================================
-- PHASE 4 — chess-style Elo ratings (BETA)
-- ============================================================================

create table if not exists pilot_ratings (
  user_id    uuid primary key references profiles(id) on delete cascade,
  rating     numeric not null default 1200,
  matches    int not null default 0,
  events     int not null default 0,
  updated_at timestamptz not null default now()
);

alter table pilot_ratings enable row level security;

drop policy if exists "ratings are publicly readable" on pilot_ratings;
create policy "ratings are publicly readable"
  on pilot_ratings for select using (true);
  -- No client INSERT/UPDATE/DELETE at all: ratings are only ever written by
  -- recompute_event_elo() below, which is security definer.

create table if not exists elo_history (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  rating_before numeric not null,
  rating_after  numeric not null,
  created_at    timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table elo_history enable row level security;

drop policy if exists "elo history is publicly readable" on elo_history;
create policy "elo history is publicly readable"
  on elo_history for select using (true);

-- Pairwise round-robin Elo for one event: every pair of pilots with a result is
-- one mini match (higher total_points wins, equal = draw). All expected scores
-- are computed from ratings SNAPSHOTTED BEFORE the batch, and deltas are only
-- applied at the end, so the outcome does not depend on pair iteration order.
-- Re-running for the same event first rewinds that event's previous deltas via
-- elo_history, so it is idempotent rather than compounding.
create or replace function recompute_event_elo(p_event_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  k_factor constant numeric := 32;
  v_field_size int;
begin
  select count(*) into v_field_size from flight_results where event_id = p_event_id;
  if v_field_size < 2 then
    return; -- need at least one pair to have a match
  end if;

  -- Rewind any previous run of this event so re-running is idempotent.
  update pilot_ratings pr
     set rating = pr.rating - (eh.rating_after - eh.rating_before),
         matches = greatest(0, pr.matches - (v_field_size - 1)),
         events  = greatest(0, pr.events - 1)
    from elo_history eh
   where eh.event_id = p_event_id and eh.user_id = pr.user_id;
  delete from elo_history where event_id = p_event_id;

  -- Make sure every pilot in this event has a rating row at the 1200 default.
  insert into pilot_ratings (user_id)
  select fr.user_id from flight_results fr where fr.event_id = p_event_id
  on conflict (user_id) do nothing;

  with field as (
    select fr.user_id, fr.total_points, pr.rating as rating_before
      from flight_results fr
      join pilot_ratings pr on pr.user_id = fr.user_id
     where fr.event_id = p_event_id
  ),
  pairs as (
    -- every unordered pair, scored from a's perspective and mirrored for b
    select a.user_id,
           sum(
             k_factor * (
               case when a.total_points > b.total_points then 1.0
                    when a.total_points = b.total_points then 0.5
                    else 0.0 end
               - 1.0 / (1.0 + power(10.0, (b.rating_before - a.rating_before) / 400.0))
             )
           ) as delta
      from field a
      join field b on b.user_id <> a.user_id
     group by a.user_id
  ),
  applied as (
    update pilot_ratings pr
       set rating = f.rating_before + p.delta,
           matches = pr.matches + (v_field_size - 1),
           events = pr.events + 1,
           updated_at = now()
      from pairs p
      join field f on f.user_id = p.user_id
     where pr.user_id = p.user_id
    returning pr.user_id, f.rating_before, pr.rating as rating_after
  )
  insert into elo_history (event_id, user_id, rating_before, rating_after)
  select p_event_id, user_id, rating_before, rating_after from applied;
end;
$$;

-- authenticated only. Combined with the idempotent rewind above, the worst a
-- signed-in user can do by calling this is recompute the same numbers again.
revoke execute on function recompute_event_elo(uuid) from anon, public;
grant execute on function recompute_event_elo(uuid) to authenticated;

-- Convenience view: the leaderboard itself.
create or replace view leaderboard
  with (security_invoker = true) as
select pr.user_id,
       p.display_name,
       round(pr.rating, 1) as rating,
       pr.matches,
       pr.events,
       pr.updated_at
from pilot_ratings pr
join profiles p on p.id = pr.user_id
order by pr.rating desc;
