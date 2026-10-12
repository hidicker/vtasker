import type { EventRow } from './dbTypes';

/**
 * A pilot can only fly one task on a given day, so being confirmed for two fly
 * days on the same date is always a mistake — usually joining a second one
 * without remembering the first. Worth flagging rather than silently letting
 * them no-show and skew someone else's results.
 */
export interface FlyDayClash {
  date: string;
  eventIds: string[];
}

export function findClashes(events: EventRow[], myEventIds: Set<string>): FlyDayClash[] {
  const byDate = new Map<string, string[]>();

  for (const ev of events) {
    if (!myEventIds.has(ev.id)) continue;
    if (!byDate.has(ev.event_date)) byDate.set(ev.event_date, []);
    byDate.get(ev.event_date)!.push(ev.id);
  }

  return [...byDate.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([date, eventIds]) => ({ date, eventIds }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Dates the pilot is double-booked on, for cheap per-row lookups. */
export function clashingDates(events: EventRow[], myEventIds: Set<string>): Set<string> {
  return new Set(findClashes(events, myEventIds).map(c => c.date));
}
