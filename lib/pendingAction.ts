// Magic-link sign-in causes a full page reload (the link opens window.location.href
// with an auth token in the URL), which wipes all in-memory React state — including
// whatever the user was trying to do (publish a task, cast a vote, confirm they're
// flying, propose a start time) when they were prompted to sign in. This stashes
// that intent in localStorage so it can be replayed once the fresh page load
// detects a session.
import type { TaskPoint } from '../types';

export type PendingAction =
  | { type: 'publish'; taskName: string; taskPoints: TaskPoint[]; sssOpenTime: string; taskDeadline: string; raceType: number; thenSchedule?: boolean }
  | { type: 'vote'; taskId: string; value: 1 | -1 }
  | { type: 'createEvent'; taskId: string; eventDate: string; startTime: string; raceType: number; competitionId: string | null; deadline?: string }
  | { type: 'confirmParticipation'; eventId: string }
  | { type: 'proposeStartTime'; eventId: string; proposedTime: string }
  | { type: 'voteOnProposal'; eventId: string; proposalId: string; value: boolean };

const KEY = 'vtasker_pending_action';

export function savePendingAction(action: PendingAction) {
  try {
    localStorage.setItem(KEY, JSON.stringify(action));
  } catch {
    // localStorage unavailable (private browsing etc) — pending-action replay just won't happen, non-fatal.
  }
}

export function takePendingAction(): PendingAction | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    return JSON.parse(raw) as PendingAction;
  } catch {
    return null;
  }
}
