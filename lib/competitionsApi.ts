import { supabase } from './supabase';
import { requireUserId } from './authUtil';
import type { Competition } from './dbTypes';

/** Newest first — the comp you just added is the one you're scheduling for. */
export async function listCompetitions(): Promise<Competition[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('competitions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Competition[];
}

/**
 * Create a competition, or hand back the existing one if the name is already
 * taken. Pilots add these ad hoc while scheduling, so two people typing
 * "Nelson Open" a minute apart should land on the same competition rather than
 * see an error — the unique index on lower(trim(name)) enforces that, and this
 * turns the collision into the sensible outcome.
 */
export async function createCompetition(name: string): Promise<Competition> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Give the competition a name.');
  const createdBy = await requireUserId();

  const { data, error } = await supabase!
    .from('competitions')
    .insert({ name: trimmed, created_by: createdBy })
    .select()
    .single();

  if (!error) return data as Competition;

  // 23505 = unique_violation: someone already made this one.
  if (error.code === '23505') {
    const existing = await findCompetitionByName(trimmed);
    if (existing) return existing;
  }
  throw error;
}

export async function setDropWorst(competitionId: string, dropWorst: number): Promise<void> {
  const { error } = await supabase!
    .from('competitions')
    .update({ drop_worst: dropWorst })
    .eq('id', competitionId)
    .select('id');
  if (error) throw error;
}

export interface CompetitionTask {
  eventId: string;
  eventDate: string;
  taskName: string;
}

export interface StandingsRow {
  userId: string;
  displayName: string;
  /** One entry per task, in the same order as `tasks`. */
  scores: { points: number; flown: boolean; dropped: boolean }[];
  total: number;
}

export interface CompetitionStandings {
  tasks: CompetitionTask[];
  rows: StandingsRow[];
  dropWorst: number;
}

/**
 * Marks a pilot's `dropWorst` lowest scores as dropped and totals the rest.
 *
 * Never drops every task — with one task and "drop 1" a pilot would score
 * nothing, which is not what anyone means by dropping their worst day. Ties are
 * broken by position, so exactly `dropWorst` tasks go regardless of duplicates.
 */
export function applyDropWorst(
  points: number[],
  dropWorst: number,
): { dropped: boolean[]; total: number } {
  const dropped = points.map(() => false);
  const droppable = Math.max(0, Math.min(dropWorst, points.length - 1));

  [...points.keys()]
    .sort((a, b) => points[a] - points[b] || a - b)
    .slice(0, droppable)
    .forEach(i => { dropped[i] = true; });

  const total = points.reduce((sum, p, i) => (dropped[i] ? sum : sum + p), 0);
  return { dropped, total: Math.round(total * 10) / 10 };
}

/**
 * Standings for a competition: each pilot's task points added up, with their
 * worst `drop_worst` tasks discarded.
 *
 * A pilot who didn't fly a task scores zero for it, which is the standard rule —
 * and because a missed task is a pilot's worst by definition, dropping is what
 * stops one weekend away from wrecking a series.
 */
export async function getCompetitionStandings(
  competitionId: string,
  dropWorst: number,
): Promise<CompetitionStandings> {
  if (!supabase) return { tasks: [], rows: [], dropWorst };

  // Every scheduled fly day in the comp, so a task nobody has flown yet still
  // shows as a column rather than vanishing.
  const [{ data: events, error: evErr }, { data: results, error: resErr }] = await Promise.all([
    supabase.from('events').select('id, event_date, task_id, tasks(name)').eq('competition_id', competitionId).order('event_date'),
    supabase.from('competition_results').select('*').eq('competition_id', competitionId),
  ]);
  if (evErr) throw evErr;
  if (resErr) throw resErr;

  const tasks: CompetitionTask[] = (events ?? []).map((e: any) => ({
    eventId: e.id,
    eventDate: e.event_date,
    taskName: e.tasks?.name ?? 'Task',
  }));

  const byPilot = new Map<string, { name: string; points: Map<string, number> }>();
  for (const r of (results ?? []) as any[]) {
    if (!byPilot.has(r.user_id)) byPilot.set(r.user_id, { name: r.display_name || 'Pilot', points: new Map() });
    byPilot.get(r.user_id)!.points.set(r.event_id, Number(r.total_points) || 0);
  }

  const rows: StandingsRow[] = [...byPilot.entries()].map(([userId, pilot]) => {
    const points = tasks.map(t => pilot.points.get(t.eventId) ?? 0);
    const { dropped, total } = applyDropWorst(points, dropWorst);

    return {
      userId,
      displayName: pilot.name,
      scores: tasks.map((t, i) => ({
        points: points[i],
        flown: pilot.points.has(t.eventId),
        dropped: dropped[i],
      })),
      total,
    };
  });

  rows.sort((a, b) => b.total - a.total || a.displayName.localeCompare(b.displayName));
  return { tasks, rows, dropWorst };
}

async function findCompetitionByName(name: string): Promise<Competition | null> {
  const { data, error } = await supabase!
    .from('competitions')
    .select('*')
    .ilike('name', name.trim())
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as Competition) ?? null;
}
