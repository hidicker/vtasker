import L from 'leaflet';
import type { TaskPoint } from '../types';
import type { IgcFix } from './igcParser';
import { cumulativeOptimizedDistances } from './taskGeometry';

/**
 * Turns a task time of day ("0000", "0800") into the actual instant it means for
 * a given track.
 *
 * The header date can't be trusted on its own: an NZ afternoon flight starts
 * before UTC midnight and finishes after it, so a gate written as 0000 belongs
 * to the day *after* the HFDTE date. Picking the candidate nearest the middle of
 * the flight gets both the gate and the deadline right without needing to know
 * the site's timezone.
 */
export function resolveTaskTime(hhmm: string, fixes: IgcFix[], fallbackDate: Date): Date | null {
  const digits = (hhmm || '').replace(/[^\d]/g, '').padStart(4, '0');
  if (digits.length !== 4) return null;
  const hours = parseInt(digits.slice(0, 2), 10);
  const minutes = parseInt(digits.slice(2, 4), 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

  const valid = fixes.filter(f => f.valid);
  const anchor = valid.length > 0 ? valid[0].time : fallbackDate;
  const midpoint = valid.length > 0
    ? (valid[0].time.getTime() + valid[valid.length - 1].time.getTime()) / 2
    : fallbackDate.getTime();

  let best: Date | null = null;
  for (const offset of [-1, 0, 1]) {
    const candidate = new Date(Date.UTC(
      anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() + offset,
      hours, minutes, 0,
    ));
    if (!best || Math.abs(candidate.getTime() - midpoint) < Math.abs(best.getTime() - midpoint)) {
      best = candidate;
    }
  }
  return best;
}

export interface FlightWalkResult {
  sssTime: Date | null;
  essTime: Date | null;
  goalTime: Date | null;
  distanceKm: number;
}

/**
 * Walks a chronological list of GPS fixes against the task's cylinders in order,
 * advancing a "next required point" pointer only when the CURRENT point's cylinder
 * is satisfied — so a pilot can't skip ahead by clipping a later turnpoint early.
 * SSS/ESS respect each point's entry/exit TurnDirection and only count once the
 * gate has opened (fix time >= sssOpenAt).
 *
 * Pass `deadline` to stop the clock: the track is truncated there, so nothing
 * flown after it counts towards a gate or towards distance. A pilot still in the
 * air at the deadline is credited with where they had got to, which is what a
 * task deadline means.
 */
export function walkTaskCylinders(
  fixes: IgcFix[],
  taskPoints: TaskPoint[],
  sssOpenAt: Date,
  deadline?: Date | null,
): FlightWalkResult {
  const validFixes = fixes.filter(f => f.valid && (!deadline || f.time <= deadline));
  const result: FlightWalkResult = { sssTime: null, essTime: null, goalTime: null, distanceKm: 0 };
  if (validFixes.length === 0 || taskPoints.length === 0) return result;

  let pointerIndex = 0;
  let wasInside = false;
  const crossingTimes: (Date | null)[] = new Array(taskPoints.length).fill(null);

  for (const fix of validFixes) {
    if (pointerIndex >= taskPoints.length) break;
    const tp = taskPoints[pointerIndex];
    const center = L.latLng(tp.waypoint.lat, tp.waypoint.lng);
    const dist = center.distanceTo(L.latLng(fix.lat, fix.lng));
    const inside = dist <= tp.radius;

    const isGate = tp.type === 'sss' || tp.type === 'ess';
    const wantsExit = isGate && tp.direction === 'exit';
    const crossed = wantsExit ? (wasInside && !inside) : (!wasInside && inside);

    if (crossed) {
      const gateOk = tp.type === 'sss' ? fix.time >= sssOpenAt : true;
      if (gateOk) {
        crossingTimes[pointerIndex] = fix.time;
        pointerIndex++;
        wasInside = false;
        continue;
      }
    }
    wasInside = inside;
  }

  taskPoints.forEach((tp, i) => {
    if (tp.type === 'sss' && crossingTimes[i]) result.sssTime = crossingTimes[i];
    if (tp.type === 'ess' && crossingTimes[i]) result.essTime = crossingTimes[i];
    if (tp.type === 'goal' && crossingTimes[i]) result.goalTime = crossingTimes[i];
  });

  // Distance achieved, measured along the SAME optimized (cylinder-tangent) route
  // the builder advertises — so a pilot who completes a "55 km task" is credited
  // 55 km, not the longer centre-to-centre figure. For a pilot who lands out, we
  // add their closest approach to the next cylinder's edge on top of the last leg
  // they completed. Simplified vs true GAP distance-along-course, which projects
  // every fix onto the course line.
  const cumulative = cumulativeOptimizedDistances(taskPoints);
  const reached = pointerIndex; // task points satisfied, in order
  let distanceM = reached > 0 ? cumulative[Math.min(reached, taskPoints.length) - 1] : 0;

  if (reached > 0 && reached < taskPoints.length) {
    const next = taskPoints[reached];
    const nextCenter = L.latLng(next.waypoint.lat, next.waypoint.lng);
    let closest = Infinity;
    for (const fix of validFixes) {
      const d = nextCenter.distanceTo(L.latLng(fix.lat, fix.lng));
      if (d < closest) closest = d;
    }
    if (Number.isFinite(closest)) {
      const legLength = cumulative[reached] - cumulative[reached - 1];
      const gainedOnLeg = Math.max(0, closest - next.radius);
      // Never credit more than the leg is actually worth.
      distanceM += Math.min(legLength, Math.max(0, legLength - gainedOnLeg));
    }
  }

  result.distanceKm = Math.round((distanceM / 1000) * 100) / 100;
  return result;
}

export interface ScoreInput {
  userId: string;
  distanceKm: number;
  sssTime: Date | null;
  essTime: Date | null;
  goalTime: Date | null;
}

export interface ScoreOutput {
  userId: string;
  distancePoints: number;
  timePoints: number;
  goalBonusPoints: number;
  totalPoints: number;
}

const DISTANCE_POOL = 800;
const TIME_POOL = 150;
const GOAL_BONUS = 50;

/**
 * Simplified GAP-inspired scoring, normalized against the best pilot in THIS
 * event's field (no external day-quality/validity weighting — we have no
 * meteorological/task-validity inputs). Deliberately does not implement real
 * CIVL GAP's leading points, day quality, arrival points, or handicaps.
 *
 * NOT THE LIVE SCORER. Scoring moved into the `recompute_event_scores` Postgres
 * function so a new submission can rescore the whole field in one transaction —
 * see supabase/schema.sql. This is kept as the readable reference for what that
 * function does, and the two must be changed together. `walkTaskCylinders`
 * above IS live: it powers the upload preview.
 */
export function computeEventScores(results: ScoreInput[], gateOpensAt?: Date | null): ScoreOutput[] {
  const bestDistance = Math.max(0, ...results.map(r => r.distanceKm));

  /**
   * Race to Goal times everyone from the gate; Elapsed Time from their own
   * crossing. Pass `gateOpensAt` for a race — starting late then costs you
   * directly, which is the point of racing rather than flying a time trial.
   *
   * A pilot whose SSS somehow precedes the gate is measured from the gate
   * anyway: nobody can be credited with starting before the start.
   */
  const speedSeconds = (r: ScoreInput) => {
    // A valid start is required either way — you can't be timed on a speed
    // section you never entered — but a race is clocked from the gate.
    if (!r.sssTime || !r.essTime) return null;
    const from = gateOpensAt ?? r.sssTime;
    if (r.essTime <= from) return null;
    return (r.essTime.getTime() - from.getTime()) / 1000;
  };

  const finishTimes = results.map(speedSeconds).filter((t): t is number => t !== null);
  const bestTime = finishTimes.length > 0 ? Math.min(...finishTimes) : null;

  return results.map(r => {
    const distancePoints = bestDistance > 0 ? Math.min(DISTANCE_POOL, DISTANCE_POOL * r.distanceKm / bestDistance) : 0;
    const t = speedSeconds(r);
    const timePoints = (t !== null && bestTime !== null) ? Math.min(TIME_POOL, TIME_POOL * bestTime / t) : 0;
    const goalBonusPoints = r.goalTime ? GOAL_BONUS : 0;
    return {
      userId: r.userId,
      distancePoints: Math.round(distancePoints * 10) / 10,
      timePoints: Math.round(timePoints * 10) / 10,
      goalBonusPoints,
      totalPoints: Math.round((distancePoints + timePoints + goalBonusPoints) * 10) / 10,
    };
  });
}
