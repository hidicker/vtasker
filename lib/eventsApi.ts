import { supabase } from './supabase';
import { buildXctskFile } from './xctrack';
import { getXContestCode, fingerprintFile, type XContestCode } from './xcontestShare';
import { requireUserId } from './authUtil';
import { DEFAULT_RACE_TYPE, type EventRow, type StartTimeProposal, type Participant } from './dbTypes';

export async function createEvent(
  taskId: string,
  eventDate: string,
  startTime: string,
  raceType: number = DEFAULT_RACE_TYPE,
  competitionId: string | null = null,
  deadline: string | null = null,
): Promise<EventRow> {
  const organizerId = await requireUserId();
  const { data, error } = await supabase!
    .from('events')
    .insert({
      task_id: taskId, organizer_id: organizerId, event_date: eventDate,
      start_time: startTime, race_type: raceType, competition_id: competitionId,
      // Null falls back to the task's own deadline in events_with_details.
      deadline: deadline || null,
    })
    .select()
    .single();
  if (error) throw error;
  // Auto-confirm the organizer as a participant — they're presumably flying it too.
  await supabase!.from('event_participants').insert({ event_id: data.id, user_id: organizerId }).select();
  // So the fly-day page opens with a code already on it. Never allowed to
  // fail the scheduling itself: if XContest is down, the page offers a button.
  await attachXContestCode(data.id).catch(() => {});
  return data as EventRow;
}

/**
 * Upload the fly day's task to XContest and keep the code on the event. Built
 * from events_with_details so it carries this day's start time, deadline and
 * race type. Only the organizer can store it (the events update policy).
 */
export async function attachXContestCode(eventId: string): Promise<EventRow | null> {
  const ev = await getEvent(eventId);
  if (!ev?.task_points?.length) return ev;
  const file = buildXctskFile(ev.task_points, ev.start_time, ev.task_deadline || '2300', ev.race_type);
  const result = await getXContestCode(file);
  await saveEventXContestCode(eventId, result, fingerprintFile(file));
  return { ...ev, xcontest_code: result.code, xcontest_hash: result.hash, xcontest_code_at: new Date(result.savedAt).toISOString(), xcontest_for: fingerprintFile(file) };
}

export async function saveEventXContestCode(eventId: string, result: XContestCode, forFingerprint: string): Promise<void> {
  const { error } = await supabase!
    .from('events')
    .update({
      xcontest_code: result.code,
      xcontest_hash: result.hash || null,
      xcontest_code_at: new Date(result.savedAt).toISOString(),
      xcontest_for: forFingerprint,
    })
    .eq('id', eventId);
  if (error) throw error;
}

/**
 * Delete a fly day. The database only permits this while the organizer is the
 * sole participant, so a stale screen can't delete something another pilot has
 * since joined — a refused delete comes back as zero rows removed.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const { data, error } = await supabase!
    .from('events')
    .delete()
    .eq('id', eventId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Can't delete this fly day — someone else has already joined it.");
  }
}

export async function listEventsForTask(taskId: string): Promise<EventRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('events_with_details')
    .select('*')
    .eq('task_id', taskId)
    .order('event_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

/**
 * Every event from today onwards, for the task browser. Fetched in one go so the
 * list can show which tasks are actually scheduled without a request per row.
 * Excludes the task route geometry — the browser already has it from the tasks
 * query, and it's the heaviest column.
 */
export async function listUpcomingEvents(): Promise<EventRow[]> {
  if (!supabase) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('events_with_details')
    .select('id, task_id, organizer_id, event_date, start_time, race_type, competition_id, competition_name, status, created_at, task_name, distance_optimized_km, participant_count, organizer_display_name')
    .gte('event_date', today)
    .neq('status', 'cancelled')
    .order('event_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

/** Event ids the signed-in pilot has confirmed for. Empty when signed out. */
export async function getMyEventIds(): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('event_participants')
    .select('event_id')
    .eq('user_id', user.id);
  if (error) return new Set();
  return new Set((data ?? []).map(r => r.event_id as string));
}

export async function getEvent(eventId: string): Promise<EventRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('events_with_details').select('*').eq('id', eventId).maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}

export async function confirmParticipation(eventId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase!.from('event_participants').insert({ event_id: eventId, user_id: userId });
  if (error) throw error;
}

export async function unconfirmParticipation(eventId: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase!.from('event_participants').delete().eq('event_id', eventId).eq('user_id', userId);
  if (error) throw error;
}

export async function listParticipants(eventId: string): Promise<Participant[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('event_participants_with_names')
    .select('*')
    .eq('event_id', eventId)
    .order('confirmed_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Participant[];
}

export async function amIConfirmed(eventId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from('event_participants')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('user_id', user.id)
    .maybeSingle();
  return !!data;
}

const DEFAULT_VOTING_WINDOW_HOURS = 24;

export async function proposeStartTime(eventId: string, proposedTime: string): Promise<StartTimeProposal> {
  const userId = await requireUserId();
  const votingDeadline = new Date(Date.now() + DEFAULT_VOTING_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase!
    .from('start_time_proposals')
    .insert({ event_id: eventId, proposed_by: userId, proposed_time: proposedTime, voting_deadline: votingDeadline })
    .select()
    .single();
  if (error) throw error;
  return data as StartTimeProposal;
}

/** The most recent open proposal for an event, resolving it first if its deadline has passed. */
export async function getOpenProposal(eventId: string): Promise<StartTimeProposal | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('start_time_proposals')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const proposal = data as StartTimeProposal | null;
  if (proposal && new Date(proposal.voting_deadline) <= new Date()) {
    await supabase.rpc('resolve_start_time_proposal', { p_proposal_id: proposal.id });
    return null; // caller should re-fetch the event; this proposal is no longer open
  }
  return proposal;
}

export async function getProposalTally(proposalId: string): Promise<{ yes: number; no: number }> {
  if (!supabase) return { yes: 0, no: 0 };
  const { data, error } = await supabase.from('start_time_votes').select('value').eq('proposal_id', proposalId);
  if (error) throw error;
  const yes = (data ?? []).filter(v => v.value === true).length;
  const no = (data ?? []).filter(v => v.value === false).length;
  return { yes, no };
}

export async function getMyProposalVote(proposalId: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('start_time_votes')
    .select('value')
    .eq('proposal_id', proposalId)
    .eq('user_id', user.id)
    .maybeSingle();
  return data ? data.value : null;
}

export async function voteOnProposal(proposalId: string, value: boolean): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase!
    .from('start_time_votes')
    .upsert({ proposal_id: proposalId, user_id: userId, value }, { onConflict: 'proposal_id,user_id' });
  if (error) throw error;
}
