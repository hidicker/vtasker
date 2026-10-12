import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  XMarkIcon, CheckBadgeIcon, ClockIcon, UsersIcon, TrashIcon,
  UserPlusIcon, ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { QRCodeSVG } from 'qrcode.react';
import MapComponent from './MapComponent';
import EventResultsPanel from './EventResultsPanel';
import ResultsUploadModal from './ResultsUploadModal';
import {
  raceTypeLabel, raceTypeBlurb, startTimeLabel, utcToLocalHHMM,
  type EventRow, type Participant, type StartTimeProposal, type FlightResult,
} from '../lib/dbTypes';
import type { PendingAction } from '../lib/pendingAction';
import {
  getEvent, listParticipants, amIConfirmed, confirmParticipation, unconfirmParticipation,
  getOpenProposal, getProposalTally, getMyProposalVote, proposeStartTime, voteOnProposal,
  deleteEvent, listUpcomingEvents, getMyEventIds, saveEventXContestCode,
} from '../lib/eventsApi';
import { buildXctrackJson, buildXctskFile } from '../lib/xctrack';
import XContestCodeButton from './XContestCodeButton';
import { fingerprintFile, type XContestCode } from '../lib/xcontestShare';
import { listResults, haveISubmittedResult } from '../lib/resultsApi';
import { finalizeEventElo } from '../lib/leaderboardApi';

interface EventModalProps {
  eventId: string;
  onClose: () => void;
  requireAuth: (action: PendingAction) => boolean;
  isSignedIn: boolean;
  currentUserId?: string;
  onRequestAuth: () => void;
  /** Lets the fly-day list refresh after the event stops existing. */
  onDeleted?: () => void;
  /** Set when opened from an invite link — joins the pilot on arrival. */
  autoJoin?: boolean;
}

const formatDeadline = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const EventModal: React.FC<EventModalProps> = ({ eventId, onClose, requireAuth, isSignedIn, currentUserId, onRequestAuth, onDeleted, autoJoin }) => {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [amConfirmed, setAmConfirmed] = useState(false);
  const [openProposal, setOpenProposal] = useState<StartTimeProposal | null>(null);
  const [tally, setTally] = useState({ yes: 0, no: 0 });
  const [myVote, setMyVote] = useState<boolean | null>(null);
  const [proposedTimeInput, setProposedTimeInput] = useState('');
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [results, setResults] = useState<FlightResult[]>([]);
  const [haveSubmitted, setHaveSubmitted] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sameDayClashes, setSameDayClashes] = useState<EventRow[]>([]);
  const [inviteCopied, setInviteCopied] = useState(false);
  const autoJoinAttempted = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const proposal = await getOpenProposal(eventId); // resolves passed proposals as a side effect
      const [ev, parts, confirmed, res, submitted, upcoming, mine] = await Promise.all([
        getEvent(eventId),
        listParticipants(eventId),
        amIConfirmed(eventId),
        listResults(eventId),
        haveISubmittedResult(eventId),
        listUpcomingEvents(),
        getMyEventIds(),
      ]);

      // Other fly days this pilot has joined on the same date. Worth surfacing
      // here because an invite link drops them straight onto this page, where
      // they'd otherwise never see the list that warns about it.
      setSameDayClashes(
        ev ? upcoming.filter(o => o.id !== ev.id && o.event_date === ev.event_date && mine.has(o.id)) : [],
      );

      setEvent(ev);
      setParticipants(parts);
      setAmConfirmed(confirmed);
      setOpenProposal(proposal);
      setResults(res);
      setHaveSubmitted(submitted);
      if (proposal) {
        const [t, mv] = await Promise.all([getProposalTally(proposal.id), getMyProposalVote(proposal.id)]);
        setTally(t);
        setMyVote(mv);
      } else {
        setTally({ yes: 0, no: 0 });
        setMyVote(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load this event.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Arriving from an invite link, which is meant to be one click: land here and
   * be in. Only fires once, and never when already confirmed. Signed-out pilots
   * go through requireAuth, which stashes the join and replays it after
   * sign-in — so the invite still works for someone without an account.
   */
  useEffect(() => {
    if (!autoJoin || loading || !event || autoJoinAttempted.current) return;
    autoJoinAttempted.current = true;
    if (amConfirmed) return;
    if (!requireAuth({ type: 'confirmParticipation', eventId })) return;
    confirmParticipation(eventId)
      .then(refresh)
      .catch((err) => alert(err?.message || 'Could not join this fly day.'));
  }, [autoJoin, loading, event, amConfirmed, eventId, requireAuth, refresh]);

  const handleCopyInvite = () => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}?event=${eventId}&join=1`;
    navigator.clipboard.writeText(url).then(
      () => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2500); },
      () => window.prompt('Copy this invite link:', url),
    );
  };

  const handleConfirm = async () => {
    if (!requireAuth({ type: 'confirmParticipation', eventId })) return;
    try {
      await confirmParticipation(eventId);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not confirm your participation.');
    }
  };

  const handleWithdraw = async () => {
    if (!window.confirm("Withdraw from this event? You'll lose your ability to vote or submit results until you confirm again.")) return;
    try {
      await unconfirmParticipation(eventId);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not withdraw.');
    }
  };

  const handlePropose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (proposedTimeInput.length !== 4) { alert('Enter a 4-digit time, e.g. 1330.'); return; }
    if (!requireAuth({ type: 'proposeStartTime', eventId, proposedTime: proposedTimeInput })) return;
    try {
      await proposeStartTime(eventId, proposedTimeInput);
      setProposedTimeInput('');
      setShowProposeForm(false);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not propose a new start time.');
    }
  };

  const handleFinalize = async () => {
    if (!window.confirm('Score this event and update pilot rankings? You can re-run this later if more results come in.')) return;
    setFinalizing(true);
    try {
      await finalizeEventElo(eventId);
      alert('Event scored — pilot rankings updated.');
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not finalize this event.');
    } finally {
      setFinalizing(false);
    }
  };

  /**
   * Only the organizer sees this, and only while they're the sole participant —
   * once someone else has joined, the fly day is the group's. The database
   * enforces the same rule, so a stale screen can't slip past it.
   */
  // Built from the event, so the QR carries this day's start time and race type
  // rather than whatever the task was originally published with.
  const isOrganizer = !!currentUserId && event?.organizer_id === currentUserId;

  const buildEventXctsk = useCallback(() => (
    event?.task_points
      ? buildXctskFile(event.task_points, event.start_time, event.task_deadline || '2300', event.race_type)
      : null
  ), [event]);

  // Only trust the stored code if it was made from the task as it stands now.
  const storedXContest = useMemo<XContestCode | null>(() => {
    const file = buildEventXctsk();
    if (!event?.xcontest_code || !event.xcontest_code_at || !file) return null;
    if (event.xcontest_for !== fingerprintFile(file)) return null;
    return { code: event.xcontest_code, hash: event.xcontest_hash ?? '', savedAt: Date.parse(event.xcontest_code_at) };
  }, [event, buildEventXctsk]);

  const xctrackJson = useMemo(() => {
    if (!event?.task_points || event.task_points.length === 0) return null;
    return buildXctrackJson(event.task_points, event.start_time, event.task_deadline || '2300', event.race_type);
  }, [event]);

  const startLocal = event ? utcToLocalHHMM(event.event_date, event.start_time) : null;
  const deadlineLocal = event?.task_deadline ? utcToLocalHHMM(event.event_date, event.task_deadline) : null;

  const othersHaveJoined = participants.some(p => p.user_id !== event?.organizer_id);
  const canDelete = !!currentUserId && currentUserId === event?.organizer_id && !othersHaveJoined;

  const handleDelete = async () => {
    if (!window.confirm('Delete this fly day? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteEvent(eventId);
      onDeleted?.();
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Could not delete this fly day.');
      refresh();
    } finally {
      setDeleting(false);
    }
  };

  const handleVote = async (value: boolean) => {
    if (!openProposal) return;
    if (!requireAuth({ type: 'voteOnProposal', eventId, proposalId: openProposal.id, value })) return;
    try {
      await voteOnProposal(openProposal.id, value);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not save your vote.');
    }
  };

  return (
    <div className="fixed inset-0 z-[3800] bg-slate-900/50 backdrop-blur-sm flex flex-col overflow-hidden animate-in fade-in duration-300">
      <div className="bg-white h-[92vh] max-w-4xl mx-auto w-full mt-[4vh] rounded-2xl flex flex-col shadow-xl overflow-hidden border border-slate-200">
        <div className="bg-blue-600 text-white p-5 flex justify-between items-center shrink-0">
          <div className="min-w-0">
            {event?.competition_name && (
              <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-100/90 mb-1 truncate">
                {event.competition_name}
              </p>
            )}
            <h2 className="text-lg font-semibold tracking-tight leading-none truncate">{event?.task_name || 'Loading…'}</h2>
            {event && <p className="text-xs text-blue-100 mt-1">{event.event_date} · Organized by {event.organizer_display_name || 'Unknown'}</p>}
          </div>
          <button onClick={onClose} className="rounded-full p-2 bg-white/15 hover:bg-white/25 transition shrink-0"><XMarkIcon className="w-6 h-6" /></button>
        </div>

        {loading && <p className="p-8 text-sm text-slate-400">Loading…</p>}
        {error && <p className="p-8 text-sm text-red-500">{error}</p>}

        {event && !loading && (
          <div className="flex-1 overflow-y-auto">
            <div className="h-[260px] relative border-b">
              <MapComponent
                waypoints={(event.task_points || []).map(tp => tp.waypoint)}
                taskPoints={event.task_points || []}
                showOptimized={true}
                showCenterLine={false}
                showLabels={true}
                isShareMode={true}
                isLibraryVisible={false}
                isTaskEditorVisible={false}
              />
            </div>

            <div className="p-6 space-y-5">
              {sameDayClashes.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-900">
                      You're already in {sameDayClashes.length === 1 ? 'another fly day' : `${sameDayClashes.length} other fly days`} that day
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      {sameDayClashes.map(c => c.task_name || 'Untitled').join(', ')} — you can only fly one.
                      Withdraw from the others in Fly Days.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-xs text-slate-400">Distance</p>
                  <p className="text-sm font-semibold text-slate-900">{event.distance_optimized_km ?? '?'} km</p>
                </div>
                {/* Local first, since that's the time a pilot acts on; UTC
                    underneath because that's what their instrument wants. */}
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-xs text-slate-400">{startTimeLabel(event.race_type)}</p>
                  <p className="text-sm font-semibold text-slate-900">{startLocal ?? event.start_time}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{event.start_time} UTC</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-xs text-slate-400">Complete before</p>
                  <p className="text-sm font-semibold text-slate-900">{deadlineLocal ?? event.task_deadline ?? '—'}</p>
                  {event.task_deadline && <p className="text-[11px] text-slate-500 mt-0.5">{event.task_deadline} UTC</p>}
                </div>
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-xs text-slate-400">Pilots In</p>
                  <p className="text-sm font-semibold text-slate-900">{event.participant_count ?? participants.length}</p>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <p className="text-sm font-medium text-slate-700">{raceTypeLabel(event.race_type)}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{raceTypeBlurb(event.race_type)}</p>
              </div>

              {/*
                Start-time changes are a fallback, not the main event: with Elapsed
                Time each pilot starts their own clock, so the gate rarely needs
                moving. An open proposal still takes over the space, because then
                it genuinely is the thing to deal with.
              */}
              {openProposal ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                    <ClockIcon className="w-4 h-4" /> Change to {openProposal.proposed_time}?
                  </p>
                  <p className="text-sm text-slate-700">Voting ends {formatDeadline(openProposal.voting_deadline)}.</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleVote(true)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${myVote === true ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-emerald-50'}`}
                    >
                      Yes ({tally.yes})
                    </button>
                    <button
                      onClick={() => handleVote(false)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${myVote === false ? 'bg-red-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-red-50'}`}
                    >
                      No ({tally.no})
                    </button>
                    {!amConfirmed && <span className="text-xs text-amber-700">Confirm you're competing to vote</span>}
                  </div>
                </div>
              ) : amConfirmed && (
                showProposeForm ? (
                  <form onSubmit={handlePropose} className="flex items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      maxLength={4}
                      placeholder="New time e.g. 1330"
                      className="flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
                      value={proposedTimeInput}
                      onChange={(e) => setProposedTimeInput(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
                    />
                    <button type="submit" className="rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 px-4 py-2 text-sm font-medium transition shrink-0">Propose</button>
                    <button
                      type="button"
                      onClick={() => { setShowProposeForm(false); setProposedTimeInput(''); }}
                      className="rounded-full px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 transition shrink-0"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowProposeForm(true)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition"
                  >
                    <ClockIcon className="w-3.5 h-3.5" /> Propose a different start time
                  </button>
                )
              )}

              {/* Confirm participation — deliberately separate from the vote/discuss section above */}
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-emerald-900 flex items-center gap-1.5"><CheckBadgeIcon className="w-4 h-4" /> Competing</p>
                  <p className="text-xs text-slate-600 mt-0.5">{amConfirmed ? "You're confirmed for this event." : "Let others know you're flying this task."}</p>
                </div>
                {amConfirmed ? (
                  <button onClick={handleWithdraw} className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition shrink-0">Withdraw</button>
                ) : (
                  <button onClick={handleConfirm} className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-sm font-medium transition shrink-0">Confirm You're Competing</button>
                )}
              </div>

              {/*
                Two things sit side by side here that are easy to confuse: the
                invite LINK, which brings a pilot to this fly day, and the QR,
                which only loads the task onto an instrument. Someone sharing
                the QR expecting it to invite people would silently get nobody,
                so the invite is given the weight and the QR says what it isn't.
              */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 rounded-2xl border-2 border-blue-200 bg-blue-50/60 p-4">
                  <p className="text-sm font-semibold text-blue-900">Invite pilots to fly this day!</p>
                  <p className="text-xs text-blue-800/80 mt-0.5 leading-snug">
                    Anyone opening this link lands here and joins the day automatically.
                  </p>
                  <button
                    onClick={handleCopyInvite}
                    className="mt-3 flex items-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-medium transition"
                  >
                    <UserPlusIcon className="w-4 h-4" />
                    {inviteCopied ? 'Link copied — share this' : 'Copy invite link'}
                  </button>
                </div>

                {xctrackJson && (
                  <div className="flex flex-col items-center rounded-2xl border border-slate-200 p-4 shrink-0 sm:max-w-[190px]">
                    {/* The warning sits above the code, not under it: by the time
                        someone has scrolled past a QR they have already decided
                        it is the thing to send. */}
                    <p className="text-xs font-medium text-slate-700">Scan to XCTrack</p>
                    <p className="text-[11px] font-semibold text-amber-700 text-center leading-snug mt-0.5 mb-2">
                      Share the invite link, not this
                    </p>
                    <div className="p-2 bg-white border rounded-xl">
                      <QRCodeSVG value={xctrackJson} size={132} level="M" />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-2 text-center leading-snug">
                      Loads the task onto your instrument.
                    </p>
                    {/* Same rule as the QR: a code loads the task, it doesn't
                        put anyone on this fly day — the invite link does that. */}
                    <XContestCodeButton
                      compact
                      buildFile={buildEventXctsk}
                      initial={storedXContest}
                      // The organizer's page fills in a missing or stale code
                      // (days scheduled before codes existed, or a passed
                      // start-time change); everyone else gets the button.
                      autoGenerate={isOrganizer}
                      onGenerated={(result, fp) => {
                        if (isOrganizer) saveEventXContestCode(eventId, result, fp).catch(() => {});
                      }}
                    />
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-1.5"><UsersIcon className="w-4 h-4" /> Pilots ({participants.length})</p>
                <div className="flex flex-wrap gap-2">
                  {participants.length === 0 && <p className="text-sm text-slate-400">No one has confirmed yet.</p>}
                  {participants.map(p => (
                    <span key={p.user_id} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">{p.display_name || 'Pilot'}</span>
                  ))}
                </div>
              </div>

              {canDelete && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-600 disabled:opacity-50 transition"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  {deleting ? 'Deleting…' : 'Delete this fly day'}
                </button>
              )}

              <EventResultsPanel
                results={results}
                canUpload={amConfirmed}
                haveSubmitted={haveSubmitted}
                onUploadClick={() => (isSignedIn ? setIsUploadOpen(true) : onRequestAuth())}
                canFinalize={!!currentUserId && currentUserId === event.organizer_id && results.length >= 2}
                finalizing={finalizing}
                onFinalize={handleFinalize}
              />
            </div>
          </div>
        )}
      </div>

      {isUploadOpen && event && (
        <ResultsUploadModal
          event={event}
          onClose={() => setIsUploadOpen(false)}
          isSignedIn={isSignedIn}
          onRequestAuth={onRequestAuth}
          onSubmitted={refresh}
        />
      )}
    </div>
  );
};

export default EventModal;
