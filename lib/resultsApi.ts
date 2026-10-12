import { supabase } from './supabase';
import { requireUserId } from './authUtil';
import type { FlightResult } from './dbTypes';
import type { FlightWalkResult } from './scoring';

const BUCKET = 'flight-logs';

export interface SubmitResultInput {
  eventId: string;
  igcFile: File;
  walk: FlightWalkResult;
}

export async function submitFlightResult(input: SubmitResultInput): Promise<FlightResult> {
  const userId = await requireUserId();

  // Path encodes ownership — storage RLS checks the first folder against auth.uid().
  const path = `${userId}/${input.eventId}.igc`;
  const { error: uploadError } = await supabase!.storage
    .from(BUCKET)
    .upload(path, input.igcFile, { contentType: 'text/plain', upsert: true });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase!
    .from('flight_results')
    .insert({
      event_id: input.eventId,
      user_id: userId,
      igc_filename: input.igcFile.name,
      igc_path: path,
      sss_time: input.walk.sssTime ? input.walk.sssTime.toISOString() : null,
      ess_time: input.walk.essTime ? input.walk.essTime.toISOString() : null,
      goal_time: input.walk.goalTime ? input.walk.goalTime.toISOString() : null,
      distance_km: input.walk.distanceKm,
    })
    .select('id, event_id, user_id, igc_filename, igc_path, sss_time, ess_time, goal_time, distance_km, distance_points, time_points, goal_bonus_points, total_points, created_at')
    .single();

  if (error) {
    // Don't leave an orphaned file behind if the row insert was rejected
    // (duplicate submission, lost participation, etc).
    await supabase!.storage.from(BUCKET).remove([path]);
    throw error;
  }

  // Recompute everyone's points in this event now that D_best/T_best may have moved.
  await supabase!.rpc('recompute_event_scores', { p_event_id: input.eventId });
  return data as FlightResult;
}

/** Short-lived download URL for a stored flight log. The bucket is private. */
export async function getFlightLogUrl(igcPath: string): Promise<string | null> {
  if (!supabase || !igcPath) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(igcPath, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function listResults(eventId: string): Promise<FlightResult[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('flight_results_with_names')
    .select('*')
    .eq('event_id', eventId)
    .order('total_points', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FlightResult[];
}

export async function haveISubmittedResult(eventId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('flight_results')
    .select('id')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data;
}
