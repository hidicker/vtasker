import React, { useEffect, useMemo, useState } from 'react';
import type L from 'leaflet';
import {
  XMarkIcon, HandThumbUpIcon, HandThumbDownIcon, LinkIcon, ArrowDownTrayIcon,
  CalendarDaysIcon, UsersIcon, MagnifyingGlassIcon, MapIcon, ListBulletIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { HandThumbUpIcon as HandThumbUpSolid, HandThumbDownIcon as HandThumbDownSolid } from '@heroicons/react/24/solid';
import TaskDiscoveryMap, { buildTaskRoutes } from './TaskDiscoveryMap';
import XContestCodeButton from './XContestCodeButton';
import { buildXctskFile } from '../lib/xctrack';
import { formatEventDate, formatStartTime } from './ScheduledEventChip';
import { raceTypeLabel, type SharedTask, type EventRow } from '../lib/dbTypes';
import type { PendingAction } from '../lib/pendingAction';
import { listPublishedTasks, getMyVotes, voteOnTask, removeVote, deleteTask } from '../lib/tasksApi';
import { listEventsForTask, listUpcomingEvents, getMyEventIds } from '../lib/eventsApi';

interface TaskBrowserModalProps {
  onClose: () => void;
  requireAuth: (action: PendingAction) => boolean;
  onLoadTask: (task: SharedTask) => void;
  onCreateEvent: (task: SharedTask) => void;
  onOpenEvent: (eventId: string) => void;
  onJoinTask: () => void;
  currentUserId?: string;
}

type SortKey = 'recent' | 'votes' | 'distance';

/**
 * "Tasks" — the route library.
 *
 * Scoped to the evergreen half of the app: browse published routes, vote on
 * whether they're any good, load one into the builder. Fly days live in
 * JoinTaskModal; a task that has one shows a link through rather than a Join
 * button, so the two jobs stay distinct.
 */
const TaskBrowserModal: React.FC<TaskBrowserModalProps> = ({ onClose, requireAuth, onLoadTask, onCreateEvent, onOpenEvent, onJoinTask, currentUserId }) => {
  const [tasks, setTasks] = useState<SharedTask[]>([]);
  const [myVotes, setMyVotes] = useState<Record<string, 1 | -1>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [showMap, setShowMap] = useState(true);
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);
  const [areaOnly, setAreaOnly] = useState(false);
  const [scheduledOnly, setScheduledOnly] = useState(false);
  const [upcoming, setUpcoming] = useState<EventRow[]>([]);
  const [myEventIds, setMyEventIds] = useState<Set<string>>(new Set());
  const [deletingTask, setDeletingTask] = useState(false);

  const refresh = () => {
    setLoading(true);
    setError('');
    Promise.all([listPublishedTasks(), listUpcomingEvents(), getMyEventIds()])
      .then(async ([data, events, mine]) => {
        setTasks(data);
        setUpcoming(events);
        setMyEventIds(mine);
        setMyVotes(await getMyVotes(data.map(t => t.id)));
      })
      .catch((err) => setError(err?.message || 'Failed to load shared tasks.'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  // Soonest upcoming fly day per task, so a row can show "Sat 9 Aug · 3 pilots in".
  const nextEventByTask = useMemo(() => {
    const map = new Map<string, EventRow>();
    for (const ev of upcoming) {
      const existing = map.get(ev.task_id);
      if (!existing || ev.event_date < existing.event_date) map.set(ev.task_id, ev);
    }
    return map;
  }, [upcoming]);

  const eventCountByTask = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ev of upcoming) counts.set(ev.task_id, (counts.get(ev.task_id) ?? 0) + 1);
    return counts;
  }, [upcoming]);

  const allRoutes = useMemo(() => buildTaskRoutes(tasks), [tasks]);

  // Single source of truth for colour, so the sidebar swatch always matches the
  // line drawn on the map (buildTaskRoutes resolves collisions, so we can't just
  // recompute per task here).
  const colorById = useMemo(
    () => new Map(allRoutes.map(r => [r.task.id, r.color])),
    [allRoutes],
  );
  const colorOf = (taskId: string) => colorById.get(taskId) ?? '#94a3b8';

  const visibleTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tasks;

    if (q) {
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.owner_display_name || '').toLowerCase().includes(q));
    }

    if (areaOnly && bounds) {
      const startOf = new Map(allRoutes.map(r => [r.task.id, r.start]));
      list = list.filter(t => {
        const start = startOf.get(t.id);
        return start ? bounds.contains(start) : false;
      });
    }

    if (scheduledOnly) {
      list = list.filter(t => nextEventByTask.has(t.id));
    }

    const sorted = [...list];
    if (sort === 'votes') sorted.sort((a, b) => (b.vote_score ?? 0) - (a.vote_score ?? 0));
    else if (sort === 'distance') sorted.sort((a, b) => (b.distance_optimized_km ?? 0) - (a.distance_optimized_km ?? 0));
    else sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return sorted;
  }, [tasks, query, sort, areaOnly, bounds, allRoutes, scheduledOnly, nextEventByTask]);

  // Only draw what the filters left visible, so the map and the list agree.
  const visibleRoutes = useMemo(() => {
    const ids = new Set(visibleTasks.map(t => t.id));
    return allRoutes.filter(r => ids.has(r.task.id));
  }, [allRoutes, visibleTasks]);

  const selected = useMemo(() => tasks.find(t => t.id === selectedId) || null, [tasks, selectedId]);

  useEffect(() => {
    if (!selected) { setEvents([]); return; }
    listEventsForTask(selected.id).then(setEvents).catch(() => setEvents([]));
  }, [selected]);

  const handleVote = async (task: SharedTask, value: 1 | -1) => {
    if (!requireAuth({ type: 'vote', taskId: task.id, value })) return;
    try {
      if (myVotes[task.id] === value) await removeVote(task.id);
      else await voteOnTask(task.id, value);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not save your vote.');
    }
  };

  const handleLoad = (task: SharedTask) => {
    if (!window.confirm(`Load "${task.name}" into your builder? This replaces your current task.`)) return;
    onLoadTask(task);
    onClose();
  };

  /**
   * Owners can withdraw a task they published, but only until someone puts a
   * date on it — after that pilots may have joined and results may follow.
   * `events` here is the selected task's fly days, already loaded above.
   */
  const canDeleteSelected =
    !!currentUserId && !!selected && selected.owner_id === currentUserId && events.length === 0;

  const handleDeleteTask = async (task: SharedTask) => {
    if (!window.confirm(`Delete "${task.name}"? This cannot be undone.`)) return;
    setDeletingTask(true);
    try {
      await deleteTask(task.id);
      setSelectedId(null);
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Could not delete this task.');
    } finally {
      setDeletingTask(false);
    }
  };

  const handleCopyLink = (task: SharedTask) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}?task=${task.id}`;
    navigator.clipboard.writeText(url).then(
      () => alert('Link copied to clipboard!'),
      () => alert(url),
    );
  };

  const sortPill = (key: SortKey, label: string) => (
    <button
      key={key}
      onClick={() => setSort(key)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${sort === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-100 border border-slate-200'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[3500] bg-slate-900/40 backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="bg-white h-[92vh] max-w-6xl mx-auto w-full mt-[4vh] rounded-2xl flex flex-col shadow-xl overflow-hidden border border-slate-200">

        <div className="px-6 py-4 flex justify-between items-center border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Task Library</h2>
            <p className="text-xs text-slate-400">
              {visibleTasks.length} of {tasks.length} task{tasks.length === 1 ? '' : 's'}
              {nextEventByTask.size > 0 && (
                <>
                  <span className="text-slate-300"> · </span>
                  <button onClick={onJoinTask} className="text-amber-600 font-medium hover:underline">
                    {nextEventByTask.size} with a fly day coming up
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className={`${showMap ? 'hidden md:flex md:w-[330px] shrink-0 border-r border-slate-100' : 'flex-1'} flex-col overflow-hidden`}>
            <div className="p-4 space-y-2.5 border-b border-slate-100 shrink-0">
              <div className="relative">
                <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search tasks or pilots…"
                  className="w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm outline-none focus:bg-white focus:border-blue-400 transition"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {sortPill('recent', 'Recent')}
                {sortPill('votes', 'Top voted')}
                {sortPill('distance', 'Longest')}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {nextEventByTask.size > 0 && (
                  <button
                    onClick={() => setScheduledOnly(v => !v)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition ${
                      scheduledOnly ? 'bg-amber-400 text-amber-950' : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50'
                    }`}
                  >
                    <CalendarDaysIcon className="w-3.5 h-3.5" />
                    {scheduledOnly ? 'Scheduled only' : `Scheduled (${nextEventByTask.size})`}
                  </button>
                )}
                {showMap && (
                  <button
                    onClick={() => setAreaOnly(v => !v)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${areaOnly ? 'bg-blue-600 text-white' : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-50'}`}
                  >
                    {areaOnly ? 'Showing this area' : 'Search this area'}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && <p className="p-5 text-sm text-slate-400">Loading…</p>}
              {error && <p className="p-5 text-sm text-red-500">{error}</p>}
              {!loading && !error && visibleTasks.length === 0 && (
                <p className="p-5 text-sm text-slate-400">
                  {tasks.length === 0
                    ? 'No tasks shared yet. Build one and hit Share.'
                    : 'No tasks match. Try clearing the search or panning the map.'}
                </p>
              )}

              {visibleTasks.map(task => {
                const myVote = myVotes[task.id];
                const isSelected = task.id === selectedId;
                const nextEvent = nextEventByTask.get(task.id);
                const extraEvents = (eventCountByTask.get(task.id) ?? 0) - 1;
                return (
                  <div
                    key={task.id}
                    onClick={() => setSelectedId(isSelected ? null : task.id)}
                    className={`px-4 py-3 border-b border-slate-50 cursor-pointer transition ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ring-2 ring-white"
                        style={{ backgroundColor: colorOf(task.id) }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{task.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {task.distance_optimized_km ?? '?'} km · {task.owner_display_name || 'Unknown'}
                        </p>

                        {/* Joining happens in Fly Days — this is just a pointer that a date exists. */}
                        {nextEvent && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenEvent(nextEvent.id); }}
                            className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 hover:underline"
                          >
                            <CalendarDaysIcon className="w-3.5 h-3.5 shrink-0" />
                            {formatEventDate(nextEvent.event_date)} · {formatStartTime(nextEvent.start_time)}
                            {myEventIds.has(nextEvent.id) && <span className="text-emerald-600">· you're in</span>}
                            {extraEvents > 0 && <span className="text-slate-400">+{extraEvents}</span>}
                          </button>
                        )}

                        <div className="flex items-center gap-2 mt-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleVote(task, 1); }}
                            className={`transition ${myVote === 1 ? 'text-emerald-600' : 'text-slate-300 hover:text-emerald-500'}`}
                            title="Good task"
                          >
                            {myVote === 1 ? <HandThumbUpSolid className="w-4 h-4" /> : <HandThumbUpIcon className="w-4 h-4" />}
                          </button>
                          <span className="text-xs font-medium text-slate-600 tabular-nums w-4 text-center">{task.vote_score ?? 0}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleVote(task, -1); }}
                            className={`transition ${myVote === -1 ? 'text-red-500' : 'text-slate-300 hover:text-red-400'}`}
                            title="Not for me"
                          >
                            {myVote === -1 ? <HandThumbDownSolid className="w-4 h-4" /> : <HandThumbDownIcon className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showMap && (
            <div className="flex-1 flex flex-col overflow-hidden relative">
              <div className="flex-1 min-h-0">
                <TaskDiscoveryMap
                  routes={visibleRoutes}
                  selectedId={selectedId}
                  onSelect={(id) => setSelectedId(id)}
                  onBoundsChange={setBounds}
                  scheduledTaskIds={new Set(nextEventByTask.keys())}
                />
              </div>

              {selected && (
                <div className="absolute bottom-0 left-0 right-0 z-[500] bg-white/95 backdrop-blur border-t border-slate-200 p-4 max-h-[46%] overflow-y-auto">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colorOf(selected.id) }} />
                        <p className="text-base font-semibold text-slate-900 truncate">{selected.name}</p>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        <span className="font-medium text-slate-700">{selected.distance_optimized_km ?? '?'} km</span> optimized
                        <span className="text-slate-300"> · </span>{selected.distance_center_km ?? '?'} km centre-to-centre
                        <span className="text-slate-300"> · </span>start {selected.sss_open_time}
                        <span className="text-slate-300"> · </span>deadline {selected.task_deadline}
                      </p>
                    </div>
                    <button onClick={() => setSelectedId(null)} className="rounded-full p-1.5 hover:bg-slate-100 text-slate-400 shrink-0">
                      <XMarkIcon className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <button onClick={() => handleLoad(selected)} className="flex items-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-xs font-medium transition">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Load Into Builder
                    </button>
                    <button onClick={() => handleCopyLink(selected)} className="flex items-center gap-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 text-xs font-medium transition">
                      <LinkIcon className="w-3.5 h-3.5" /> Copy Link
                    </button>
                    <button onClick={() => onCreateEvent(selected)} className="flex items-center gap-1.5 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 px-4 py-2 text-xs font-medium transition">
                      <CalendarDaysIcon className="w-3.5 h-3.5" /> Put a Date On It
                    </button>
                    <XContestCodeButton
                      buildFile={() => buildXctskFile(selected.points, selected.sss_open_time, selected.task_deadline, selected.race_type)}
                    />
                    {canDeleteSelected && (
                      <button
                        onClick={() => handleDeleteTask(selected)}
                        disabled={deletingTask}
                        title="Only possible until someone schedules a fly day for it"
                        className="flex items-center gap-1.5 rounded-full border border-slate-200 hover:border-red-300 hover:bg-red-50 text-slate-500 hover:text-red-600 disabled:opacity-50 px-4 py-2 text-xs font-medium transition"
                      >
                        <TrashIcon className="w-3.5 h-3.5" /> {deletingTask ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>

                  {events.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-400">
                        Scheduled — open in Fly Days to confirm you're flying
                      </p>
                      {events.map(ev => (
                        <button
                          key={ev.id}
                          onClick={() => onOpenEvent(ev.id)}
                          className="w-full flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40 transition text-left"
                        >
                          <CalendarDaysIcon className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-medium text-slate-700 truncate">
                              {formatEventDate(ev.event_date)} · {formatStartTime(ev.start_time)} · {raceTypeLabel(ev.race_type)}
                            </span>
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                              <UsersIcon className="w-3 h-3" /> {ev.participant_count ?? 0} in
                            </span>
                          </span>
                          {myEventIds.has(ev.id) && (
                            <span className="rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-1 text-[11px] font-medium shrink-0">You're in</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TaskBrowserModal;
