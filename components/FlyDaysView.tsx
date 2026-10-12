import React, { useEffect, useMemo, useState } from 'react';
import type L from 'leaflet';
import {
  XMarkIcon, CalendarDaysIcon, UsersIcon, CheckCircleIcon, PlusIcon,
  MagnifyingGlassIcon, ArrowLeftIcon, ExclamationTriangleIcon, TrophyIcon, MapIcon, ListBulletIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import { formatEventDate, formatStartTime } from './ScheduledEventChip';
import TaskDiscoveryMap, { buildTaskRoutes } from './TaskDiscoveryMap';
import { raceTypeLabel, startTimeLabel, utcToLocalHHMM, type Competition, type EventRow, type SharedTask } from '../lib/dbTypes';
import type { PendingAction } from '../lib/pendingAction';
import { listUpcomingEvents, getMyEventIds, confirmParticipation, unconfirmParticipation } from '../lib/eventsApi';
import { listCompetitions } from '../lib/competitionsApi';
import { listPublishedTasks } from '../lib/tasksApi';
import { clashingDates } from '../lib/flyDayClashes';

const ALL_COMPS = '__all__';
const COMP_TASKS_ONLY = '__comp_only__';
const ONE_OFF_ONLY = '__one_off__';

interface FlyDaysViewProps {
  /** Back to the task builder. */
  onBack: () => void;
  requireAuth: (action: PendingAction) => boolean;
  onOpenEvent: (eventId: string) => void;
  onScheduleTask: (task: SharedTask) => void;
  onOpenStandings: (competition: Competition) => void;
}

/**
 * "Fly Days" — a full view, not a modal.
 *
 * For a good number of pilots this is the whole app: they want to fly what is
 * on, not author routes. Floating it over the builder framed it as a side trip
 * from task building, which is backwards for them. It has its own URL so it can
 * be linked to directly.
 *
 * Deliberately separate from Tasks: a fly day is perishable (it matters for
 * a few days, then never again) while a task is evergreen, so mixing them into
 * one list meant the time-critical thing competed with a permanent library.
 * Scheduling lives here too, because picking a date is the same job as joining
 * one.
 */
const FlyDaysView: React.FC<FlyDaysViewProps> = ({
  onBack, requireAuth, onOpenEvent, onScheduleTask, onOpenStandings,
}) => {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [myEventIds, setMyEventIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [competitionFilter, setCompetitionFilter] = useState<string>(ALL_COMPS);
  const [showMap, setShowMap] = useState(true);
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  const [areaOnly, setAreaOnly] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // Full competition rows (for drop_worst and ownership), not just the id/name
  // pairs the filter dropdown needs.
  const [competitions, setCompetitions] = useState<Competition[]>([]);

  // Second pane: picking which task to schedule.
  const [picking, setPicking] = useState(false);
  const [tasks, setTasks] = useState<SharedTask[]>([]);
  const [query, setQuery] = useState('');

  const refresh = () => {
    setLoading(true);
    setError('');
    Promise.all([listUpcomingEvents(), getMyEventIds(), listPublishedTasks()])
      .then(([evs, mine, published]) => { setEvents(evs); setMyEventIds(mine); setTasks(published); })
      .catch((err) => setError(err?.message || 'Failed to load fly days.'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  useEffect(() => { listCompetitions().then(setCompetitions).catch(() => setCompetitions([])); }, []);

  const openPicker = () => setPicking(true);

  const handleJoin = async (event: EventRow) => {
    if (!requireAuth({ type: 'confirmParticipation', eventId: event.id })) return;
    setJoiningId(event.id);
    try {
      await confirmParticipation(event.id);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not join this fly day.');
    } finally {
      setJoiningId(null);
    }
  };

  // No confirmation: withdrawing is one click to undo by joining again, so a
  // dialog costs more than the mistake does.
  const handleWithdraw = async (event: EventRow) => {
    setJoiningId(event.id);
    try {
      await unconfirmParticipation(event.id);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not withdraw.');
    } finally {
      setJoiningId(null);
    }
  };

  // Only draw tasks that have a fly day on them — this is the fly-day map, not
  // the whole library.
  const scheduledTasks = useMemo(() => {
    const ids = new Set(events.map(e => e.task_id));
    return tasks.filter(t => ids.has(t.id));
  }, [tasks, events]);

  const routes = useMemo(() => buildTaskRoutes(scheduledTasks), [scheduledTasks]);
  const startOf = useMemo(() => new Map(routes.map(r => [r.task.id, r.start])), [routes]);

  // Competitions actually represented in the upcoming list — no point offering a
  // filter for a comp with nothing scheduled.
  const compOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const ev of events) {
      if (ev.competition_id && ev.competition_name) seen.set(ev.competition_id, ev.competition_name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [events]);

  const filteredEvents = useMemo(() => {
    let list = events;
    if (competitionFilter === COMP_TASKS_ONLY) list = list.filter(e => !!e.competition_id);
    else if (competitionFilter === ONE_OFF_ONLY) list = list.filter(e => !e.competition_id);
    else if (competitionFilter !== ALL_COMPS) list = list.filter(e => e.competition_id === competitionFilter);

    // "Search this area": keep fly days whose task starts inside the map view.
    if (areaOnly && bounds) {
      list = list.filter(e => {
        const start = startOf.get(e.task_id);
        return start ? bounds.contains(start) : false;
      });
    }
    return list;
  }, [events, competitionFilter, areaOnly, bounds, startOf]);

  // Clashes are judged against everything joined, not the filtered view — hiding
  // a comp would otherwise hide the very clash worth warning about.
  const clashDates = useMemo(() => clashingDates(events, myEventIds), [events, myEventIds]);

  // Group by date so a weekend with three tasks reads as one heading.
  const byDate = useMemo(() => {
    const groups = new Map<string, EventRow[]>();
    for (const ev of filteredEvents) {
      if (!groups.has(ev.event_date)) groups.set(ev.event_date, []);
      groups.get(ev.event_date)!.push(ev);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEvents]);

  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.owner_display_name || '').toLowerCase().includes(q));
  }, [tasks, query]);

  const joinedCount = useMemo(
    () => events.filter(e => myEventIds.has(e.id)).length,
    [events, myEventIds],
  );

  // The competition currently filtered to, if the filter names a specific one.
  const selectedComp = useMemo(
    () => competitions.find(c => c.id === competitionFilter) ?? null,
    [competitions, competitionFilter],
  );

  return (
    <div className="flex-1 min-h-0 bg-slate-50 flex flex-col overflow-hidden">
      <div className="bg-white flex-1 min-h-0 max-w-5xl mx-auto w-full flex flex-col overflow-hidden border-x border-slate-200">

        <div className="px-6 py-4 flex justify-between items-center border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {picking && (
              <button
                onClick={() => setPicking(false)}
                className="rounded-full p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition shrink-0"
                aria-label="Back to fly days"
              >
                <ArrowLeftIcon className="w-5 h-5" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">
                {picking ? 'Pick a task to fly' : 'Fly Days'}
              </h2>
              <p className="text-xs text-slate-400">
                {picking
                  ? `${visibleTasks.length} shared task${visibleTasks.length === 1 ? '' : 's'}`
                  : events.length === 0
                    ? 'Nothing scheduled yet'
                    : `${events.length} coming up${joinedCount > 0 ? ` · you're in ${joinedCount}` : ''}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
          {!picking && (
            <div className="flex rounded-full bg-slate-100 p-0.5">
              <button
                onClick={() => setShowMap(true)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${showMap ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                <MapIcon className="w-3.5 h-3.5" /> Map
              </button>
              <button
                onClick={() => { setShowMap(false); setAreaOnly(false); }}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${!showMap ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                <ListBulletIcon className="w-3.5 h-3.5" /> List
              </button>
            </div>
          )}
          {/* Named, not an X: this is a view, and leaving it should say where
              it goes. */}
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 text-xs font-medium transition shrink-0"
          >
            <ArrowLeftIcon className="w-3.5 h-3.5" /> Task builder
          </button>
          </div>
        </div>

        {picking ? (
          <>
            <div className="p-4 border-b border-slate-100 shrink-0">
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search tasks or pilots…"
                  className="w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm outline-none focus:bg-white focus:border-blue-400 transition"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleTasks.length === 0 && (
                <p className="p-5 text-sm text-slate-400">
                  {tasks.length === 0 ? 'No tasks shared yet. Build one and hit Share.' : 'No tasks match.'}
                </p>
              )}
              {visibleTasks.map(task => (
                <button
                  key={task.id}
                  onClick={() => onScheduleTask(task)}
                  className="w-full text-left px-5 py-3 border-b border-slate-50 hover:bg-blue-50/50 transition group flex items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 truncate">{task.name}</span>
                    <span className="block text-xs text-slate-400">
                      {task.distance_optimized_km ?? '?'} km · {task.owner_display_name || 'Unknown'}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-slate-100 group-hover:bg-blue-600 group-hover:text-white text-slate-500 px-3 py-1.5 text-xs font-medium transition shrink-0">
                    <CalendarDaysIcon className="w-3.5 h-3.5" /> Schedule
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {compOptions.length > 0 && (
              <div className="px-5 py-2.5 border-b border-slate-100 shrink-0 flex items-center gap-2">
                <label htmlFor="comp-filter" className="text-xs text-slate-400 shrink-0">Show</label>
                <select
                  id="comp-filter"
                  className="flex-1 min-w-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-blue-400"
                  value={competitionFilter}
                  onChange={(e) => setCompetitionFilter(e.target.value)}
                >
                  <option value={ALL_COMPS}>All fly days</option>
                  <option value={COMP_TASKS_ONLY}>Competition tasks only</option>
                  <option value={ONE_OFF_ONLY}>One-off fly days only</option>
                  {compOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {/* Only once a single competition is selected — standings across
                    "all fly days" wouldn't mean anything. */}
                {selectedComp && (
                  <button
                    onClick={() => onOpenStandings(selectedComp)}
                    className="flex items-center gap-1.5 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 px-3 py-1.5 text-xs font-medium transition shrink-0"
                  >
                    <TrophyIcon className="w-3.5 h-3.5" /> Standings
                  </button>
                )}
              </div>
            )}

            {/* Its own row: this depends on the map being on, not on whether any
                fly day belongs to a competition. */}
            {routes.length > 0 && showMap && (
              <div className="px-5 py-2 border-b border-slate-100 shrink-0">
                <button
                  onClick={() => setAreaOnly(v => !v)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    areaOnly ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  {areaOnly ? 'Showing this area' : 'Search this area'}
                </button>
              </div>
            )}

            <div className="flex flex-1 min-h-0">
            <div className={`${showMap ? 'hidden md:block md:w-[380px] md:shrink-0 md:border-r border-slate-100' : 'flex-1'} overflow-y-auto`}>
              {loading && <p className="p-5 text-sm text-slate-400">Loading…</p>}
              {error && <p className="p-5 text-sm text-red-500">{error}</p>}

              {!loading && !error && events.length === 0 && (
                <div className="px-6 py-12 text-center">
                  <CalendarDaysIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No fly days scheduled.</p>
                  <p className="text-xs text-slate-400 mt-1">Pick a shared task and put a date on it.</p>
                </div>
              )}

              {!loading && !error && events.length > 0 && filteredEvents.length === 0 && (
                <p className="px-6 py-10 text-sm text-slate-400 text-center">
                  Nothing scheduled matches that filter.
                </p>
              )}

              {byDate.map(([date, dayEvents]) => (
                <div key={date}>
                  <p className="sticky top-0 bg-white/95 backdrop-blur px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    {formatEventDate(date)}
                  </p>

                  {clashDates.has(date) && (
                    <div className="flex items-start gap-2 bg-amber-50 border-b border-amber-200 px-5 py-2.5">
                      <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-900">
                        You're in more than one fly day on this date — you can only fly one.
                        Tap <span className="font-medium">You're in</span> to withdraw from the others.
                      </p>
                    </div>
                  )}
                  {dayEvents.map(ev => {
                    const joined = myEventIds.has(ev.id);
                    return (
                      <div
                        key={ev.id}
                        className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 hover:bg-slate-50 transition"
                      >
                        <button onClick={() => onOpenEvent(ev.id)} className="flex-1 min-w-0 text-left">
                          {ev.competition_name && (
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 truncate">
                              {ev.competition_name}
                            </p>
                          )}
                          <p className="text-sm font-medium text-slate-800 truncate">{ev.task_name || 'Task'}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {ev.distance_optimized_km ?? '?'} km
                            <span className="text-slate-300"> · </span>
                            {raceTypeLabel(ev.race_type)}
                            <span className="text-slate-300"> · </span>
                            {/* Local, matching the event page — a UTC time in a
                                list of dates would just mislead. */}
                            {startTimeLabel(ev.race_type).toLowerCase()}{' '}
                            {formatStartTime(utcToLocalHHMM(ev.event_date, ev.start_time) ?? ev.start_time)}
                          </p>
                          <p className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                            <UsersIcon className="w-3 h-3" />
                            {ev.participant_count ?? 0} {ev.participant_count === 1 ? 'pilot' : 'pilots'} in
                            <span className="text-slate-300">·</span>
                            {ev.organizer_display_name || 'Unknown'}
                          </p>
                        </button>

                        {joined ? (
                          // Click to withdraw. Amber when it clashes with another
                          // fly day that day, so the one to drop stands out.
                          <button
                            onClick={() => handleWithdraw(ev)}
                            disabled={joiningId === ev.id}
                            title="Withdraw from this fly day"
                            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 shrink-0 group/joined ${
                              clashDates.has(ev.event_date)
                                ? 'bg-amber-100 text-amber-800 hover:bg-red-100 hover:text-red-700'
                                : 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700'
                            }`}
                          >
                            {clashDates.has(ev.event_date)
                              ? <ExclamationTriangleIcon className="w-4 h-4" />
                              : <CheckCircleSolid className="w-4 h-4" />}
                            <span className="group-hover/joined:hidden">
                              {joiningId === ev.id ? 'Leaving…' : "You're in"}
                            </span>
                            <span className="hidden group-hover/joined:inline">Withdraw</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleJoin(ev)}
                            disabled={joiningId === ev.id}
                            className="flex items-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 text-xs font-medium transition shrink-0"
                          >
                            <CheckCircleIcon className="w-4 h-4" /> {joiningId === ev.id ? 'Joining…' : 'Join'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="px-5 py-3 border-t border-slate-100">
                <button
                  onClick={openPicker}
                  className="w-full flex items-center justify-center gap-2 rounded-full border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-600 hover:text-blue-700 py-2.5 text-sm font-medium transition"
                >
                  <PlusIcon className="w-4 h-4" /> Schedule a Fly Day
                </button>
              </div>
            </div>

            {/* The map only earns its place when there is something to draw. */}
            {showMap && routes.length > 0 && (
              <div className="flex-1 min-h-0">
                <TaskDiscoveryMap
                  routes={routes}
                  selectedId={selectedTaskId}
                  onSelect={(id) => setSelectedTaskId(id === selectedTaskId ? null : id)}
                  onBoundsChange={setBounds}
                  scheduledTaskIds={new Set(events.map(e => e.task_id))}
                />
              </div>
            )}
            </div>

          </>
        )}
      </div>
    </div>
  );
};

export default FlyDaysView;
