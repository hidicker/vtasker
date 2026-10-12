import { supabase } from './supabase';
import type { LeaderboardRow } from './dbTypes';

export async function listLeaderboard(): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('rating', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

/** Recomputes ratings for an event once its results are in. Organizer action. */
export async function finalizeEventElo(eventId: string): Promise<void> {
  if (!supabase) throw new Error('Backend not configured');
  const { error } = await supabase.rpc('recompute_event_elo', { p_event_id: eventId });
  if (error) throw error;
}
