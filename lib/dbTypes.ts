// Types for rows coming back from Supabase. Kept separate from types.ts,
// which stays the source of truth for the pure client-side task-builder domain
// (Waypoint/TaskPoint/etc) — those get embedded verbatim into SharedTask.points.

import { TaskPoint } from '../types';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface SharedTask {
  id: string;
  owner_id: string;
  name: string;
  points: TaskPoint[];
  sss_open_time: string;
  task_deadline: string;
  race_type: number;
  distance_optimized_km: number | null;
  distance_center_km: number | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  vote_score?: number;
  owner_display_name?: string;
}

/** An optional banner a fly day sits under. Null on a one-off, which is normal. */
export interface Competition {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  /** How many of a pilot's worst tasks are discarded from their total. */
  drop_worst: number;
}

export type EventStatus = 'scheduled' | 'completed' | 'cancelled';

/**
 * How the clock runs on a fly day. Matches XCTrack's `sss.t` so the value can be
 * exported verbatim.
 *
 * ELAPSED_TIME is the default: it's what lib/scoring.ts actually computes (each
 * pilot's own ESS - SSS, with start_time acting as a gate that opens), and it
 * suits club flying where pilots launch when they're ready.
 */
export const RaceType = { RACE_TO_GOAL: 1, ELAPSED_TIME: 2 } as const;
export const DEFAULT_RACE_TYPE = RaceType.ELAPSED_TIME;

export const raceTypeLabel = (t?: number) =>
  t === RaceType.RACE_TO_GOAL ? 'Race to Goal' : 'Elapsed Time';

/** What the start_time means, which differs between the two types. */
export const startTimeLabel = (t?: number) =>
  t === RaceType.RACE_TO_GOAL ? 'Start time' : 'Start opens';

export const raceTypeBlurb = (t?: number) =>
  t === RaceType.RACE_TO_GOAL
    ? "Everyone's clock starts at the Start Time."
    : 'Default — you can fly the task anytime after Start Time.';

/**
 * Sensible start times per type. Elapsed Time opens early because the gate is
 * just "the task is on from here"; Race to Goal is a real gun everyone waits
 * for, so it wants the middle of the day.
 */
export const defaultStartTime = (t: number) =>
  t === RaceType.RACE_TO_GOAL ? '1200' : '0600';

/**
 * Task times are stored and exported in UTC — XCTrack tasks carry UTC
 * (`12:00:00Z`) and comp scorers work in it. Real example: NZ PG Open task 4 had
 * a 13:00 local start and its task file says `timeGates: ["00:00:00Z"]`.
 *
 * But nobody thinks in UTC when deciding what time to meet at launch, and in New
 * Zealand the offset is +12/+13 — so pilots enter LOCAL and these convert.
 *
 * The zone comes from the device (`Intl`), which is more reliable than an IP
 * lookup and needs no network call; a pilot travelling with their phone gets the
 * zone they're actually in.
 */
const HHMM = /^\d{1,4}$/;

function splitHHMM(hhmm: string): { h: number; m: number } | null {
  if (!HHMM.test(hhmm || '')) return null;
  const p = hhmm.padStart(4, '0');
  const h = parseInt(p.slice(0, 2), 10);
  const m = parseInt(p.slice(2, 4), 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  return { h, m };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local "1300" on the fly day -> stored UTC "0000". */
export function localToUtcHHMM(eventDate: string, localHHMM: string): string | null {
  const t = splitHHMM(localHHMM);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const [y, mo, d] = eventDate.split('-').map(Number);
  // Local components, so the engine applies that date's DST rules for this zone.
  const at = new Date(y, mo - 1, d, t.h, t.m, 0);
  if (Number.isNaN(at.getTime())) return null;
  return `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
}

/** Stored UTC "0000" -> local "1300" for editing. */
export function utcToLocalHHMM(eventDate: string, utcHHMM: string): string | null {
  const t = splitHHMM(utcHHMM);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const at = new Date(`${eventDate}T${pad(t.h)}:${pad(t.m)}:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  return `${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** "Pacific/Auckland · NZDT" — where these local times are being read as. */
export function localZoneLabel(eventDate?: string): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  let abbreviation = '';
  try {
    const at = eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      ? new Date(`${eventDate}T12:00:00`)
      : new Date();
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(at);
    abbreviation = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    // Older engines without timeZoneName support — the zone alone is enough.
  }
  return abbreviation ? `${zone.replace(/_/g, ' ')} · ${abbreviation}` : zone.replace(/_/g, ' ');
}

export interface EventRow {
  id: string;
  task_id: string;
  organizer_id: string;
  event_date: string; // YYYY-MM-DD
  start_time: string; // HHMM, seeded from the task, may diverge via a passed proposal
  race_type: number;
  competition_id: string | null;
  status: EventStatus;
  created_at: string;
  /** XContest share, made when the day is scheduled — see migration_event_xcontest.sql. */
  xcontest_code?: string | null;
  xcontest_hash?: string | null;
  xcontest_code_at?: string | null;
  xcontest_for?: string | null;
  // from events_with_details
  competition_name?: string | null;
  task_name?: string;
  task_points?: TaskPoint[];
  task_deadline?: string;
  distance_optimized_km?: number | null;
  participant_count?: number;
  organizer_display_name?: string;
}

export type ProposalStatus = 'open' | 'passed' | 'rejected' | 'superseded';

export interface StartTimeProposal {
  id: string;
  event_id: string;
  proposed_by: string;
  proposed_time: string;
  voting_deadline: string;
  status: ProposalStatus;
  created_at: string;
}

export interface Participant {
  event_id: string;
  user_id: string;
  confirmed_at: string;
  display_name?: string;
}

export interface LeaderboardRow {
  user_id: string;
  display_name: string;
  rating: number;
  matches: number;
  events: number;
  updated_at: string;
}

export interface FlightResult {
  id: string;
  event_id: string;
  user_id: string;
  igc_filename: string;
  igc_path: string | null;
  sss_time: string | null;
  ess_time: string | null;
  goal_time: string | null;
  distance_km: number;
  distance_points: number;
  time_points: number;
  goal_bonus_points: number;
  total_points: number;
  created_at: string;
  display_name?: string;
}
