import { supabase } from './supabase';
import { requireUserId } from './authUtil';
import type { TaskPoint } from '../types';
import type { SharedTask } from './dbTypes';

export interface PublishTaskInput {
  name: string;
  points: TaskPoint[];
  sssOpenTime: string;
  taskDeadline: string;
  raceType: number;
  distanceOptimizedKm: number;
  distanceCenterKm: number;
}

export async function publishTask(input: PublishTaskInput): Promise<SharedTask> {
  const ownerId = await requireUserId();
  const { data, error } = await supabase!
    .from('tasks')
    .insert({
      owner_id: ownerId,
      name: input.name,
      points: input.points,
      sss_open_time: input.sssOpenTime,
      task_deadline: input.taskDeadline,
      race_type: input.raceType,
      distance_optimized_km: input.distanceOptimizedKm,
      distance_center_km: input.distanceCenterKm,
      is_published: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data as SharedTask;
}

/**
 * Delete a published task. Only permitted while nothing has been scheduled on
 * it — once a fly day exists, pilots may have joined and results may follow.
 * Enforced by RLS, so a refusal comes back as zero rows removed.
 */
export async function deleteTask(taskId: string): Promise<void> {
  const { data, error } = await supabase!
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Can't delete this task — it already has a fly day scheduled.");
  }
}

export async function listPublishedTasks(): Promise<SharedTask[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('tasks_with_votes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SharedTask[];
}

export async function getTask(taskId: string): Promise<SharedTask | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) throw error;
  return data as SharedTask | null;
}

export async function voteOnTask(taskId: string, value: 1 | -1): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase!
    .from('task_votes')
    .upsert({ task_id: taskId, user_id: userId, value }, { onConflict: 'task_id,user_id' });
  if (error) throw error;
}

export async function removeVote(taskId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase!
    .from('task_votes')
    .delete()
    .eq('task_id', taskId)
    .eq('user_id', userId);
  if (error) throw error;
}

/** Map of taskId -> the current user's vote value, for the given task ids. Empty if signed out. */
export async function getMyVotes(taskIds: string[]): Promise<Record<string, 1 | -1>> {
  if (!supabase || taskIds.length === 0) return {};
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data, error } = await supabase
    .from('task_votes')
    .select('task_id, value')
    .eq('user_id', user.id)
    .in('task_id', taskIds);
  if (error) throw error;
  const map: Record<string, 1 | -1> = {};
  for (const row of data ?? []) map[row.task_id] = row.value;
  return map;
}
