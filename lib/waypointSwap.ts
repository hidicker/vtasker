import L from 'leaflet';
import type { TaskPoint, Waypoint } from '../types';
import { computeOptimizedPoints } from './taskGeometry';

export interface SwapCandidate {
  waypoint: Waypoint;
  /** Distance from the current cylinder centre, metres. */
  distanceFromCurrentM: number;
  /** Radius this waypoint would need to keep the route through the same point. */
  suggestedRadiusM: number;
}

/**
 * The point on (or near) a cylinder that the optimised route actually turns at.
 * This is what we try to preserve when re-anchoring a turnpoint to a different
 * waypoint — keep this fixed and the task keeps its shape.
 */
export function turnPointFor(taskPoints: TaskPoint[], index: number): L.LatLng | null {
  if (index < 0 || index >= taskPoints.length) return null;
  const optimized = computeOptimizedPoints(taskPoints);
  return optimized[index] ?? null;
}

/**
 * Radius that makes a cylinder centred on `waypoint` pass through `throughPoint`.
 * Rounded to the nearest 100 m because task sheets are written in round numbers
 * and nobody sets a 4,317 m cylinder.
 */
export function radiusToPreserveTurn(waypoint: Waypoint, throughPoint: L.LatLng): number {
  const metres = L.latLng(waypoint.lat, waypoint.lng).distanceTo(throughPoint);
  return Math.max(100, Math.round(metres / 100) * 100);
}

/**
 * Waypoints worth offering as a replacement centre for task point `index`,
 * nearest first. Excludes the one already in use, and anything so far away that
 * the resulting cylinder would be absurd.
 */
export function findSwapCandidates(
  taskPoints: TaskPoint[],
  index: number,
  library: Waypoint[],
  maxDistanceM = 30000,
): SwapCandidate[] {
  const target = taskPoints[index];
  if (!target) return [];

  const currentCentre = L.latLng(target.waypoint.lat, target.waypoint.lng);
  const turn = turnPointFor(taskPoints, index) ?? currentCentre;

  const seen = new Set<string>();
  const candidates: SwapCandidate[] = [];

  for (const wp of library) {
    if (wp.id === target.waypoint.id) continue;
    // Library datasets overlap, and the same site can appear twice under
    // different ids — dedupe on position so the list isn't full of pairs.
    const key = `${wp.lat.toFixed(5)},${wp.lng.toFixed(5)}`;
    if (seen.has(key)) continue;

    const distanceFromCurrentM = currentCentre.distanceTo(L.latLng(wp.lat, wp.lng));
    if (distanceFromCurrentM > maxDistanceM) continue;

    seen.add(key);
    candidates.push({
      waypoint: wp,
      distanceFromCurrentM,
      suggestedRadiusM: radiusToPreserveTurn(wp, turn),
    });
  }

  candidates.sort((a, b) => a.distanceFromCurrentM - b.distanceFromCurrentM);
  return candidates;
}

/**
 * Re-anchors one task point onto a different waypoint.
 *
 * `preserveTurn` (the default) resizes the cylinder so the optimised route still
 * turns at the same place — the task keeps its shape and distance, it is just
 * described relative to a different waypoint. Turning it off keeps the original
 * radius instead, which moves the cylinder bodily with the new centre.
 */
export function swapTaskPointWaypoint(
  taskPoints: TaskPoint[],
  index: number,
  replacement: Waypoint,
  preserveTurn = true,
): TaskPoint[] {
  const target = taskPoints[index];
  if (!target) return taskPoints;

  const turn = preserveTurn ? turnPointFor(taskPoints, index) : null;
  const radius = turn ? radiusToPreserveTurn(replacement, turn) : target.radius;

  return taskPoints.map((tp, i) =>
    i === index ? { ...tp, waypoint: replacement, radius } : tp,
  );
}
