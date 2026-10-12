// Chess-style Elo, adapted to a multi-pilot task field via pairwise round-robin.
// The canonical implementation lives in the recompute_event_elo() Postgres
// function (schema.sql) — this TS twin exists so the client can preview "what
// would this event do to my rating" without a round trip, and so the algorithm
// is unit-testable outside the database. Keep the two in sync.

export const INITIAL_RATING = 1200;
export const K_FACTOR = 32;

export interface EloEntry {
  userId: string;
  totalPoints: number;
}

/** Probability that a player rated `a` beats one rated `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/**
 * Every unordered pair in the field is one match: higher total_points wins,
 * equal is a draw. Expected scores all use the PRE-EVENT ratings and deltas are
 * summed before being applied, so the result is independent of iteration order.
 */
export function computeEloDeltas(
  entries: EloEntry[],
  currentRatings: Map<string, number>,
): Map<string, number> {
  const deltas = new Map<string, number>();
  if (entries.length < 2) return deltas;

  const ratingOf = (id: string) => currentRatings.get(id) ?? INITIAL_RATING;
  for (const e of entries) deltas.set(e.userId, 0);

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      const ra = ratingOf(a.userId);
      const rb = ratingOf(b.userId);

      const actualA = a.totalPoints > b.totalPoints ? 1 : a.totalPoints === b.totalPoints ? 0.5 : 0;
      const deltaA = K_FACTOR * (actualA - expectedScore(ra, rb));
      const deltaB = K_FACTOR * ((1 - actualA) - expectedScore(rb, ra));

      deltas.set(a.userId, (deltas.get(a.userId) ?? 0) + deltaA);
      deltas.set(b.userId, (deltas.get(b.userId) ?? 0) + deltaB);
    }
  }
  return deltas;
}
