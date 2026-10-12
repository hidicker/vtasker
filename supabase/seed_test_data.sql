-- ============================================================================
-- VTasker — SYNTHETIC TEST DATA (development only, safe to delete)
-- ============================================================================
-- Creates 3 fake pilots and their flight results on the first event, so the
-- results table and Elo leaderboard have a realistic multi-pilot field to show.
--
-- These accounts have NO usable password and NO real mailbox — they exist purely
-- as test fixtures and cannot be logged into. Emails use the reserved-for-testing
-- example.com domain.
--
-- The flight times/distances below were computed by running the app's real
-- lib/igcParser.ts + lib/scoring.ts over synthetic tracks flying the actual task
-- route, so the numbers are genuinely consistent with the scoring engine.
--
-- TO REMOVE ALL OF THIS LATER, run:
--     delete from auth.users where email like '%@example.com';
--   (cascades to profiles, participants, results, ratings and elo history)
-- ============================================================================

do $$
declare
  v_event_id uuid;
  v_sam  uuid := '11111111-1111-4111-8111-111111111111';
  v_tui  uuid := '22222222-2222-4222-8222-222222222222';
  v_marco uuid := '33333333-3333-4333-8333-333333333333';
begin
  -- Target the earliest event that has at least one real result.
  select e.id into v_event_id
    from events e
    join flight_results fr on fr.event_id = e.id
   order by e.created_at
   limit 1;

  if v_event_id is null then
    raise notice 'No event with results found — upload your own flight first, then re-run this seed.';
    return;
  end if;

  -- --- fake auth users (no password set => cannot sign in) -------------------
  -- encrypted_password is deliberately an empty string: no bcrypt hash can ever
  -- match it, so these fixtures cannot be signed into.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_sam,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sam.whitwell@example.com',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    (v_tui,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tui.ngata@example.com',      '', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    (v_marco, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marco.beaufort@example.com', '', now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;

  -- The on_auth_user_created trigger already made profiles from the email local
  -- part; give them properly formatted display names.
  insert into profiles (id, display_name) values
    (v_sam, 'Sam Whitwell'), (v_tui, 'Tui Ngata'), (v_marco, 'Marco Beaufort')
  on conflict (id) do update set display_name = excluded.display_name;

  -- --- confirmed participation ---------------------------------------------
  insert into event_participants (event_id, user_id) values
    (v_event_id, v_sam), (v_event_id, v_tui), (v_event_id, v_marco)
  on conflict do nothing;

  -- --- flight results -------------------------------------------------------
  -- Sam: full course but slowest (118.5 min).  Tui: landed out on leg 3, no ESS.
  -- Marco: full course, mid pace (94.8 min). Your own upload was the fastest (79 min).
  insert into flight_results (event_id, user_id, igc_filename, igc_raw, sss_time, ess_time, goal_time, distance_km) values
    (v_event_id, v_sam,   'sam-whitwell.igc',   '[synthetic seed data — no original IGC retained]',
       '2026-08-08T13:02:45Z', '2026-08-08T15:01:15Z', '2026-08-08T15:03:30Z', 55.31),
    (v_event_id, v_tui,   'tui-ngata.igc',      '[synthetic seed data — no original IGC retained]',
       '2026-08-08T13:00:35Z', null,                   null,                   36.97),
    (v_event_id, v_marco, 'marco-beaufort.igc', '[synthetic seed data — no original IGC retained]',
       '2026-08-08T13:08:36Z', '2026-08-08T14:43:24Z', '2026-08-08T14:45:12Z', 55.31)
  on conflict (event_id, user_id) do nothing;

  -- Your first upload was scored before the distance fix (it credited the longer
  -- centre-to-centre route, and double-counted the final leg). Restate it on the
  -- same optimized basis the app now uses so the field is comparable.
  update flight_results
     set distance_km = 55.31
   where event_id = v_event_id
     and distance_km > 100
     and goal_time is not null;

  -- Rescore the whole field now that D_best / T_best may have moved.
  perform recompute_event_scores(v_event_id);
  -- Seed the Elo ratings from this event (defined in schema.sql, Phase 4).
  perform recompute_event_elo(v_event_id);

  raise notice 'Seeded 3 test pilots into event %', v_event_id;
end $$;


-- ============================================================================
-- Sample published tasks, so the discovery map has real routes to draw.
-- Built from genuine Nelson-region CUP waypoints and spread across the top of
-- the South Island (Nelson, 88 Valley, Tapawera, Takaka, Marlborough) so the
-- "search this area" filter has something meaningful to filter.
-- Distances were computed with the app's own computeTaskStats().
-- ============================================================================

do $$
declare
  v_sam   uuid := '11111111-1111-4111-8111-111111111111';
  v_tui   uuid := '22222222-2222-4222-8222-222222222222';
  v_marco uuid := '33333333-3333-4333-8333-333333333333';
begin
  if not exists (select 1 from profiles where id = v_sam) then
    raise notice 'Run the pilot seed block above first.';
    return;
  end if;

  insert into tasks (id, owner_id, name, points, sss_open_time, task_deadline, race_type,
                     distance_optimized_km, distance_center_km, is_published)
  values
  ('aaaa1111-0000-4000-8000-000000000001', v_sam, 'Barnicoat Classic Triangle',
   '[{"id":"seed-tp-0-100BAR","type":"takeoff","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-100BAR","shortName":"100BAR","name":"100 BARNCO TKOFF","lat":-41.34165,"lng":173.25215,"altM":600}},{"id":"seed-tp-1-100BAR","type":"sss","radius":2000,"direction":"entry","waypoint":{"id":"seed-wp-100BAR","shortName":"100BAR","name":"100 BARNCO TKOFF","lat":-41.34165,"lng":173.25215,"altM":600}},{"id":"seed-tp-2-120FRI","type":"turnpoint","radius":3000,"direction":"entry","waypoint":{"id":"seed-wp-120FRI","shortName":"120FRI","name":"120 FRINGED HILL","lat":-41.31078333333333,"lng":173.31101666666666,"altM":700}},{"id":"seed-tp-3-126MAL","type":"turnpoint","radius":4000,"direction":"entry","waypoint":{"id":"seed-wp-126MAL","shortName":"126MAL","name":"126 MT MALITA","lat":-41.37896666666666,"lng":173.27206666666666,"altM":950}},{"id":"seed-tp-4-132GOA","type":"turnpoint","radius":3000,"direction":"entry","waypoint":{"id":"seed-wp-132GOA","shortName":"132GOA","name":"132 GOAT HILL","lat":-41.41035,"lng":173.18268333333333,"altM":549}},{"id":"seed-tp-5-015SAX","type":"ess","radius":2000,"direction":"entry","waypoint":{"id":"seed-wp-015SAX","shortName":"015SAX","name":"015 SAXTON FIELD","lat":-41.32885,"lng":173.21541666666667,"altM":10}},{"id":"seed-tp-6-015SAX","type":"goal","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-015SAX","shortName":"015SAX","name":"015 SAXTON FIELD","lat":-41.32885,"lng":173.21541666666667,"altM":10}}]'::jsonb,
   '1230', '1900', 1, 18.35, 31.94, true),

  ('aaaa1111-0000-4000-8000-000000000002', v_marco, 'Nelson to 88 Valley Race',
   '[{"id":"seed-tp-0-100BAR","type":"takeoff","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-100BAR","shortName":"100BAR","name":"100 BARNCO TKOFF","lat":-41.34165,"lng":173.25215,"altM":600}},{"id":"seed-tp-1-110GEC","type":"sss","radius":1500,"direction":"entry","waypoint":{"id":"seed-wp-110GEC","shortName":"110GEC","name":"110 GECKO UPPER","lat":-41.33905,"lng":173.26216666666667,"altM":575}},{"id":"seed-tp-2-126MAL","type":"turnpoint","radius":5000,"direction":"entry","waypoint":{"id":"seed-wp-126MAL","shortName":"126MAL","name":"126 MT MALITA","lat":-41.37896666666666,"lng":173.27206666666666,"altM":950}},{"id":"seed-tp-3-136LIB","type":"turnpoint","radius":6000,"direction":"entry","waypoint":{"id":"seed-wp-136LIB","shortName":"136LIB","name":"136 LITTLE BEN","lat":-41.47335,"lng":173.10816666666668,"altM":883}},{"id":"seed-tp-4-140V88","type":"ess","radius":2000,"direction":"entry","waypoint":{"id":"seed-wp-140V88","shortName":"140V88","name":"140 88 VALLEY","lat":-41.48455,"lng":172.98295,"altM":220}},{"id":"seed-tp-5-140V88","type":"goal","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-140V88","shortName":"140V88","name":"140 88 VALLEY","lat":-41.48455,"lng":172.98295,"altM":220}}]'::jsonb,
   '1300', '1930', 1, 27.22, 33.14, true),

  ('aaaa1111-0000-4000-8000-000000000003', v_tui, 'Sherry Ridge Run',
   '[{"id":"seed-tp-0-600SHE","type":"takeoff","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-600SHE","shortName":"600SHE","name":"600 SHERRY LAUNC","lat":-41.42595,"lng":172.674,"altM":940}},{"id":"seed-tp-1-600SHE","type":"sss","radius":1000,"direction":"entry","waypoint":{"id":"seed-wp-600SHE","shortName":"600SHE","name":"600 SHERRY LAUNC","lat":-41.42595,"lng":172.674,"altM":940}},{"id":"seed-tp-2-610JON","type":"turnpoint","radius":4000,"direction":"entry","waypoint":{"id":"seed-wp-610JON","shortName":"610JON","name":"610 JONES RIDGE","lat":-41.38121666666667,"lng":172.69286666666667,"altM":650}},{"id":"seed-tp-3-616TTW","type":"turnpoint","radius":5000,"direction":"entry","waypoint":{"id":"seed-wp-616TTW","shortName":"616TTW","name":"616 TAPAWER TOWN","lat":-41.388616666666664,"lng":172.82103333333333,"altM":145}},{"id":"seed-tp-4-620TAD","type":"ess","radius":2000,"direction":"entry","waypoint":{"id":"seed-wp-620TAD","shortName":"620TAD","name":"620 TADMOR JUNCT","lat":-41.43776666666667,"lng":172.75301666666667,"altM":210}},{"id":"seed-tp-5-602ORC","type":"goal","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-602ORC","shortName":"602ORC","name":"602 ORCHARD ROAD","lat":-41.410583333333335,"lng":172.71443333333335,"altM":206}}]'::jsonb,
   '1215', '1830', 1, 12.42, 28.23, true),

  ('aaaa1111-0000-4000-8000-000000000004', v_sam, 'Takaka Hill Out & Return',
   '[{"id":"seed-tp-0-500TAK","type":"takeoff","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-500TAK","shortName":"500TAK","name":"500 TAKAKA TKOFF","lat":-41.02645,"lng":172.86153333333334,"altM":890}},{"id":"seed-tp-1-500TAK","type":"sss","radius":1500,"direction":"entry","waypoint":{"id":"seed-wp-500TAK","shortName":"500TAK","name":"500 TAKAKA TKOFF","lat":-41.02645,"lng":172.86153333333334,"altM":890}},{"id":"seed-tp-2-512EAS","type":"turnpoint","radius":5000,"direction":"entry","waypoint":{"id":"seed-wp-512EAS","shortName":"512EAS","name":"512 EAST TAKAKA","lat":-40.93998333333333,"lng":172.82946666666666,"altM":55}},{"id":"seed-tp-3-507TRG","type":"turnpoint","radius":3000,"direction":"entry","waypoint":{"id":"seed-wp-507TRG","shortName":"507TRG","name":"507 TRIG PT 382","lat":-41.035,"lng":172.7932,"altM":385}},{"id":"seed-tp-4-510BRI","type":"ess","radius":2000,"direction":"entry","waypoint":{"id":"seed-wp-510BRI","shortName":"510BRI","name":"510 LINDSAY BRDG","lat":-40.98758333333333,"lng":172.8193,"altM":70}},{"id":"seed-tp-5-510BRI","type":"goal","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-510BRI","shortName":"510BRI","name":"510 LINDSAY BRDG","lat":-40.98758333333333,"lng":172.8193,"altM":70}}]'::jsonb,
   '1245', '1830', 1, 10.62, 26.69, true),

  ('aaaa1111-0000-4000-8000-000000000005', v_marco, 'Marlborough Sounds Dash',
   '[{"id":"seed-tp-0-700FOT","type":"takeoff","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-700FOT","shortName":"700FOT","name":"700 FOOTES HILL","lat":-41.33035,"lng":173.75078333333335,"altM":418}},{"id":"seed-tp-1-700FOT","type":"sss","radius":1200,"direction":"entry","waypoint":{"id":"seed-wp-700FOT","shortName":"700FOT","name":"700 FOOTES HILL","lat":-41.33035,"lng":173.75078333333335,"altM":418}},{"id":"seed-tp-2-704CNW","type":"turnpoint","radius":3000,"direction":"entry","waypoint":{"id":"seed-wp-704CNW","shortName":"704CNW","name":"704 CULLEN NORW","lat":-41.32698333333333,"lng":173.80113333333333,"altM":829}},{"id":"seed-tp-3-715OKA","type":"turnpoint","radius":4000,"direction":"entry","waypoint":{"id":"seed-wp-715OKA","shortName":"715OKA","name":"715 OKARAMIO PAD","lat":-41.42211666666667,"lng":173.76301666666666,"altM":58}},{"id":"seed-tp-4-719TUA","type":"ess","radius":2000,"direction":"entry","waypoint":{"id":"seed-wp-719TUA","shortName":"719TUA","name":"719 TUAMARINA","lat":-41.42733333333334,"lng":173.95346666666666,"altM":8}},{"id":"seed-tp-5-719TUA","type":"goal","radius":400,"direction":"entry","waypoint":{"id":"seed-wp-719TUA","shortName":"719TUA","name":"719 TUAMARINA","lat":-41.42733333333334,"lng":173.95346666666666,"altM":8}}]'::jsonb,
   '1330', '1900', 1, 22.03, 31.16, true)
  on conflict (id) do nothing;

  -- A few votes so "Top voted" sorting has something to order by.
  insert into task_votes (task_id, user_id, value) values
    ('aaaa1111-0000-4000-8000-000000000001', v_marco, 1),
    ('aaaa1111-0000-4000-8000-000000000001', v_tui,   1),
    ('aaaa1111-0000-4000-8000-000000000002', v_sam,   1),
    ('aaaa1111-0000-4000-8000-000000000002', v_tui,   1),
    ('aaaa1111-0000-4000-8000-000000000003', v_sam,   1),
    ('aaaa1111-0000-4000-8000-000000000005', v_tui,   -1)
  on conflict do nothing;

  raise notice 'Seeded 5 sample tasks across the top of the South Island.';
end $$;


-- ============================================================================
-- Upcoming fly days, so the "Find a Task" screen has scheduled events to show.
-- Dates are relative to when this is run, so they never go stale.
-- ============================================================================

do $$
declare
  v_sam   uuid := '11111111-1111-4111-8111-111111111111';
  v_tui   uuid := '22222222-2222-4222-8222-222222222222';
  v_marco uuid := '33333333-3333-4333-8333-333333333333';
  v_ev1 uuid := 'bbbb2222-0000-4000-8000-000000000001';
  v_ev2 uuid := 'bbbb2222-0000-4000-8000-000000000002';
  v_ev3 uuid := 'bbbb2222-0000-4000-8000-000000000003';
begin
  if not exists (select 1 from profiles where id = v_sam) then
    raise notice 'Run the pilot seed block first.';
    return;
  end if;

  insert into events (id, task_id, organizer_id, event_date, start_time, status) values
    (v_ev1, 'aaaa1111-0000-4000-8000-000000000001', v_sam,   current_date + 1,  '1230', 'scheduled'),
    (v_ev2, 'aaaa1111-0000-4000-8000-000000000002', v_marco, current_date + 6,  '1300', 'scheduled'),
    (v_ev3, 'aaaa1111-0000-4000-8000-000000000005', v_tui,   current_date + 13, '1330', 'scheduled')
  on conflict (id) do nothing;

  -- Varying turnout so the pilot counts aren't all identical.
  insert into event_participants (event_id, user_id) values
    (v_ev1, v_sam), (v_ev1, v_marco), (v_ev1, v_tui),
    (v_ev2, v_marco), (v_ev2, v_sam),
    (v_ev3, v_tui)
  on conflict do nothing;

  raise notice 'Seeded 3 upcoming fly days.';
end $$;
