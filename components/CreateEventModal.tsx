import React, { useEffect, useState } from 'react';
import { XMarkIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import {
  DEFAULT_RACE_TYPE, RaceType, raceTypeBlurb, defaultStartTime,
  localToUtcHHMM, localZoneLabel,
  type Competition, type SharedTask,
} from '../lib/dbTypes';
import type { PendingAction } from '../lib/pendingAction';
import { createEvent } from '../lib/eventsApi';
import { listCompetitions, createCompetition } from '../lib/competitionsApi';

interface CreateEventModalProps {
  task: SharedTask;
  onClose: () => void;
  requireAuth: (action: PendingAction) => boolean;
  onCreated: (eventId: string) => void;
  /**
   * Set when arriving straight from publishing, where scheduling is an offer
   * rather than the reason they're here — declining needs to be an obvious
   * button, not a close icon.
   */
  onSkip?: () => void;
}

function tomorrowISODate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Sentinel for the "add one" row, so it can't collide with a competition id. */
const ADD_NEW = '__add_new__';

const CreateEventModal: React.FC<CreateEventModalProps> = ({ task, onClose, requireAuth, onCreated, onSkip }) => {
  const [eventDate, setEventDate] = useState(tomorrowISODate());
  const [raceType, setRaceType] = useState<number>(DEFAULT_RACE_TYPE);
  // Local times in state; converted to UTC only on submit.
  const [startLocalTime, setStartLocalTime] = useState(defaultStartTime(DEFAULT_RACE_TYPE));
  const [deadlineLocalTime, setDeadlineLocalTime] = useState('2000');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [competitionId, setCompetitionId] = useState<string | null>(null);
  const [addingComp, setAddingComp] = useState(false);
  const [newCompName, setNewCompName] = useState('');
  const [savingComp, setSavingComp] = useState(false);

  const startUtc = localToUtcHHMM(eventDate, startLocalTime);
  const deadlineUtc = localToUtcHHMM(eventDate, deadlineLocalTime);
  const zoneLabel = localZoneLabel(eventDate);

  // Newest first, so a comp added moments ago is at the top of the list.
  useEffect(() => { listCompetitions().then(setCompetitions).catch(() => setCompetitions([])); }, []);

  const handleAddCompetition = async () => {
    if (!newCompName.trim()) return;
    setSavingComp(true);
    setError('');
    try {
      const comp = await createCompetition(newCompName);
      // Could be one that already existed under this name, so de-dupe rather
      // than blindly prepending.
      setCompetitions(prev => [comp, ...prev.filter(c => c.id !== comp.id)]);
      setCompetitionId(comp.id);
      setAddingComp(false);
      setNewCompName('');
    } catch (err: any) {
      setError(err?.message || 'Could not add that competition.');
    } finally {
      setSavingComp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startUtc) { setError('Enter a start time as 4 digits, e.g. 1300.'); return; }
    const startTime = startUtc;
    const deadline = deadlineUtc ?? undefined;
    if (!requireAuth({ type: 'createEvent', taskId: task.id, eventDate, startTime, raceType, competitionId, deadline })) return;
    setSubmitting(true);
    setError('');
    try {
      const event = await createEvent(task.id, eventDate, startTime, raceType, competitionId, deadline ?? null);
      onCreated(event.id);
    } catch (err: any) {
      setError(err?.message || 'Could not create the event.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Switching type resets the start time to that type's default. The two are
   * tied together — an elapsed-time gate at 06:00 makes no sense as a race gun,
   * and vice versa — so carrying the old value across would be the surprise.
   */
  const chooseType = (value: number) => {
    setRaceType(value);
    setStartLocalTime(defaultStartTime(value));
  };

  const typeOption = (value: number, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => chooseType(value)}
      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
        raceType === value
          ? 'border-blue-500 bg-blue-50 text-blue-700'
          : 'border-slate-200 text-slate-500 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden flex flex-col max-h-[92vh]">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Schedule a Fly Day</h3>
          <button onClick={onSkip ?? onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"><XMarkIcon className="w-6 h-6" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {onSkip ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <p className="text-sm font-medium text-emerald-900">"{task.name}" is published.</p>
              <p className="text-xs text-emerald-800 mt-0.5">Put a date on it now, or leave it in the library for later.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Pick a day to fly "{task.name}". Others can confirm they're competing, and upload a flight log afterwards.
            </p>
          )}
          <div>
            <label className="text-xs text-slate-400 block mb-1">Date</label>
            <input
              type="date"
              required
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Type</label>
            <div className="flex gap-2">
              {typeOption(RaceType.ELAPSED_TIME, 'Elapsed Time')}
              {typeOption(RaceType.RACE_TO_GOAL, 'Race to Goal')}
            </div>
            <p className="text-xs text-slate-400 mt-1.5 leading-snug">{raceTypeBlurb(raceType)}</p>
          </div>

          <div>
            <label htmlFor="competition" className="text-xs text-slate-400 block mb-1">Task in a competition?</label>
            <select
              id="competition"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400 bg-white"
              value={addingComp ? ADD_NEW : (competitionId ?? '')}
              onChange={(e) => {
                if (e.target.value === ADD_NEW) { setAddingComp(true); setCompetitionId(null); }
                else { setAddingComp(false); setCompetitionId(e.target.value || null); }
              }}
            >
              <option value="">No — one-off fly day</option>
              {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={ADD_NEW}>+ Add a competition…</option>
            </select>

            {addingComp && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  autoFocus
                  placeholder="Competition name"
                  className="flex-1 min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
                  value={newCompName}
                  onChange={(e) => setNewCompName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCompetition(); } }}
                />
                <button
                  type="button"
                  onClick={handleAddCompetition}
                  disabled={!newCompName.trim() || savingComp}
                  className="rounded-full bg-slate-900 hover:bg-slate-700 disabled:opacity-40 text-white px-4 py-2 text-xs font-medium transition shrink-0"
                >
                  {savingComp ? 'Adding…' : 'Add'}
                </button>
              </div>
            )}
          </div>

          {/* Entered in local time because that's how pilots decide when to
              meet; stored and exported as UTC because that's what XCTrack and
              comp scorers read. The UTC value is shown so there's no doubt what
              was saved. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Start Time (local)</label>
              <input
                type="text"
                maxLength={4}
                placeholder="1300"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                value={startLocalTime}
                onChange={(e) => setStartLocalTime(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              />
              <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                {startUtc ? <>= {startUtc} UTC</> : <span className="text-slate-400">4 digits, e.g. 1300</span>}
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Complete before (local)</label>
              <input
                type="text"
                maxLength={4}
                placeholder="2000"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-400"
                value={deadlineLocalTime}
                onChange={(e) => setDeadlineLocalTime(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
              />
              <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                {deadlineUtc ? <>= {deadlineUtc} UTC</> : <span className="text-slate-400">4 digits, e.g. 2000</span>}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500 -mt-1 leading-snug">
            Local times for <span className="font-medium">{zoneLabel}</span>, taken from this device.
          </p>

          {raceType === RaceType.RACE_TO_GOAL && (
            <p className="text-xs text-slate-500 -mt-1 leading-snug">
              Leave Start of Speed Section after Start Time.
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 text-sm font-medium transition"
          >
            <CalendarDaysIcon className="w-4 h-4" /> {submitting ? 'Scheduling…' : 'Schedule Fly Day'}
          </button>
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={submitting}
              className="w-full rounded-full py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50 transition"
            >
              Don't schedule a day
            </button>
          )}
        </form>
      </div>
    </div>
  );
};

export default CreateEventModal;
