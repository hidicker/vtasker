import L from 'leaflet';
import type { TaskPoint } from '../types';

/**
 * Cylinder-tangent relaxation: pulls each task point toward the line between its
 * neighbours by its own radius, approximating the shortest route that still
 * clips every cylinder. Extracted out of App.tsx's taskStats useMemo so the same
 * geometry backs the builder's readout, the publish snapshot, and IGC scoring.
 */
export function computeOptimizedPoints(taskPoints: TaskPoint[]): L.LatLng[] {
  let pts = taskPoints.map(tp => L.latLng(tp.waypoint.lat, tp.waypoint.lng));
  const iterations = 5;
  for (let iter = 0; iter < iterations; iter++) {
    const newPts = [...pts];
    for (let i = 0; i < taskPoints.length; i++) {
      const tp = taskPoints[i];
      const center = L.latLng(tp.waypoint.lat, tp.waypoint.lng);
      const target = i === 0
        ? pts[i + 1]
        : i === taskPoints.length - 1
          ? pts[i - 1]
          : L.latLng((pts[i - 1].lat + pts[i + 1].lat) / 2, (pts[i - 1].lng + pts[i + 1].lng) / 2);
      if (!target) continue;
      const dist = center.distanceTo(target);
      if (dist > 0) {
        const ratio = tp.radius / dist;
        newPts[i] = L.latLng(
          center.lat + (target.lat - center.lat) * ratio,
          center.lng + (target.lng - center.lng) * ratio,
        );
      }
    }
    pts = newPts;
  }
  return pts;
}

/** Cumulative optimized distance in metres from the first task point to each point. */
export function cumulativeOptimizedDistances(taskPoints: TaskPoint[]): number[] {
  const pts = computeOptimizedPoints(taskPoints);
  const cumulative: number[] = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    cumulative.push(cumulative[i] + pts[i].distanceTo(pts[i + 1]));
  }
  return cumulative;
}

export function computeTaskStats(taskPoints: TaskPoint[]): { center: string; optimized: string } {
  if (taskPoints.length < 2) return { center: '0.00', optimized: '0.00' };

  let centerDist = 0;
  for (let i = 0; i < taskPoints.length - 1; i++) {
    const p1 = L.latLng(taskPoints[i].waypoint.lat, taskPoints[i].waypoint.lng);
    const p2 = L.latLng(taskPoints[i + 1].waypoint.lat, taskPoints[i + 1].waypoint.lng);
    centerDist += p1.distanceTo(p2);
  }

  const cumulative = cumulativeOptimizedDistances(taskPoints);
  const optimizedDist = cumulative[cumulative.length - 1] ?? 0;

  return { center: (centerDist / 1000).toFixed(2), optimized: (optimizedDist / 1000).toFixed(2) };
}
