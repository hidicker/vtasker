import React, { useState, useCallback, useRef, useMemo, useEffect, lazy, Suspense } from 'react';
import { Waypoint, TaskPoint, TaskPointType, TurnDirection } from './types';
import { parseCSVWaypoints, parseGPXWaypoints, parseWPTWaypoints, parseCUPWaypoints } from './utils/parsers';
import MapComponent from './components/MapComponent';
import HeaderBar from './components/HeaderBar';
import WaypointLibraryPanel from './components/WaypointLibraryPanel';
import { WAYPOINT_REGIONS, findDataset } from './lib/waypointCatalogue';
import FlightPlanPanel from './components/FlightPlanPanel';
import WaypointSwapPopover from './components/WaypointSwapPopover';
import { swapTaskPointWaypoint } from './lib/waypointSwap';

// The community features (browsing, events, results, rankings) are a large slice
// of the bundle and none of them are needed to draw a task, so they load on first
// open rather than on first paint.
const AuthModal = lazy(() => import('./components/AuthModal'));
const TaskBrowserModal = lazy(() => import('./components/TaskBrowserModal'));
const FlyDaysView = lazy(() => import('./components/FlyDaysView'));
const CompetitionStandingsModal = lazy(() => import('./components/CompetitionStandingsModal'));
const WelcomeModal = lazy(() => import('./components/WelcomeModal'));
const CreateEventModal = lazy(() => import('./components/CreateEventModal'));
const EventModal = lazy(() => import('./components/EventModal'));
const LeaderboardPanel = lazy(() => import('./components/LeaderboardPanel'));
import { useAuth } from './lib/auth';
import { isSupabaseConfigured } from './lib/supabase';
import { computeTaskStats } from './lib/taskGeometry';
import { publishTask, getTask, voteOnTask } from './lib/tasksApi';
import { createEvent, confirmParticipation, proposeStartTime, voteOnProposal, listUpcomingEvents, getMyEventIds } from './lib/eventsApi';
import { findClashes, type FlyDayClash } from './lib/flyDayClashes';
import { buildXctrackJson } from './lib/xctrack';
import { formatEventDate } from './components/ScheduledEventChip';
import { savePendingAction, takePendingAction, PendingAction } from './lib/pendingAction';
import { isPlaceholderTaskName, suggestTaskName, NAME_REQUIRED_HINT } from './lib/taskNaming';
import type { Competition, SharedTask } from './lib/dbTypes';
import { QRCodeSVG } from 'qrcode.react';
import L from 'leaflet';
import { 
  PlusIcon, 
  TrashIcon, 
  MagnifyingGlassIcon,
  XMarkIcon,
  DocumentPlusIcon,
  EyeIcon,
  QrCodeIcon,
  ShareIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TagIcon,
  ArrowUpTrayIcon,
  ListBulletIcon,
  Bars2Icon,
  FolderIcon,
  GlobeAltIcon,
  PrinterIcon,
  NoSymbolIcon,
  FlagIcon,
  Cog6ToothIcon,
  MapPinIcon,
  PencilSquareIcon,
  SparklesIcon,
  CheckIcon,
  ArrowPathIcon,
  UserCircleIcon,
  Squares2X2Icon,
  TrophyIcon,
  ArrowUturnLeftIcon,
  ExclamationTriangleIcon,
  CalendarDaysIcon
} from '@heroicons/react/24/outline';

// --- DATASETS ---




const WELCOME_SEEN_KEY = 'vtasker_seen_welcome';

/** Brief placeholder while a lazily-loaded modal chunk arrives. */
const ModalLoading: React.FC = () => (
  <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-900/20 backdrop-blur-sm">
    <div className="rounded-full bg-white px-5 py-2.5 text-sm text-slate-500 shadow-lg border border-slate-200">
      Loading…
    </div>
  </div>
);


const App: React.FC = () => {
  const [manualWaypoints, setManualWaypoints] = useState<Waypoint[]>([]);
  const [taskPoints, setTaskPoints] = useState<TaskPoint[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Placeholder until the pilot names it — see lib/taskNaming.ts, which blocks
  // publishing while the name is still one of these.
  const [taskName, setTaskName] = useState('Draft task');
  const [isTaskSummaryOpen, setIsTaskSummaryOpen] = useState(false);
  // Set when View & Publish is opened with a placeholder name, so the field is
  // highlighted and selected rather than silently rejecting the publish later.
  const [nameNeedsAttention, setNameNeedsAttention] = useState(false);
  // True when we filled the name in for them, so the hint can say so.
  const [nameWasSuggested, setNameWasSuggested] = useState(false);
  const [openPublishAfterFinish, setOpenPublishAfterFinish] = useState(false);
  const publishNameRef = useRef<HTMLInputElement>(null);
  const [isQuickTaskModalOpen, setIsQuickTaskModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isTaskBrowserOpen, setIsTaskBrowserOpen] = useState(false);
  /**
   * Which top-level view is on screen. Fly Days is a destination in its own
   * right — linkable, bookmarkable, and reachable without going through the
   * builder first — so it lives in the URL rather than in a modal flag.
   *
   * The Task Library stays a modal deliberately: it's somewhere you dip into
   * while building, not somewhere you send someone.
   */
  const [view, setView] = useState<'builder' | 'flydays'>(
    () => new URLSearchParams(window.location.search).get('view') === 'flydays' ? 'flydays' : 'builder',
  );

  const goToView = useCallback((next: 'builder' | 'flydays', replace = false) => {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'flydays') params.set('view', 'flydays');
    else params.delete('view');
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    // pushState so the browser Back button returns to wherever they came from.
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
  }, []);

  // Back/forward should move between views, not leave the app.
  useEffect(() => {
    const onPop = () => {
      const v = new URLSearchParams(window.location.search).get('view');
      setView(v === 'flydays' ? 'flydays' : 'builder');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [clashes, setClashes] = useState<FlyDayClash[]>([]);
  const [flyDayCount, setFlyDayCount] = useState(0);
  /**
   * Nudge toward Fly Days. Shown on every load for now rather than once — the
   * app is new and most visitors have never opened that screen.
   */
  const [showFlyDayHint, setShowFlyDayHint] = useState(true);
  const [clashDismissed, setClashDismissed] = useState(false);
  const [createEventForTask, setCreateEventForTask] = useState<SharedTask | null>(null);
  // Distinguishes "just published, scheduling is optional" from opening the
  // schedule form deliberately off an existing task.
  const [justPublished, setJustPublished] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [autoJoinEventId, setAutoJoinEventId] = useState<string | null>(null);
  const [isLeaderboardOpen, setIsLeaderboardOpen] = useState(false);
  const [standingsComp, setStandingsComp] = useState<Competition | null>(null);

  /**
   * Set once the task on screen exists in the shared library — either because
   * it was just published, or because it was loaded from there.
   *
   * Gates the XCTrack QR: handing over the code that loads the task onto an
   * instrument is the payoff for publishing, so it isn't given away to someone
   * who keeps the task to themselves.
   */
  const [publishedTaskId, setPublishedTaskId] = useState<string | null>(null);

  /**
   * First-visit explainer. The app opens onto an empty map already in drawing
   * mode, which only reads as an invitation if you know that tapping does
   * something. Skipped for ?task= / ?event= links: someone following a share or
   * an invite has a specific thing in mind, and a tour would be in the way.
   */
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('task') || params.get('event')) return false;
      return localStorage.getItem(WELCOME_SEEN_KEY) !== '1';
    } catch {
      return false; // private browsing with localStorage blocked — don't nag every load
    }
  });

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch { /* nothing to do */ }
  }, []);
  const [editingWaypoint, setEditingWaypoint] = useState<Waypoint | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);

  // --- Undo -----------------------------------------------------------------
  // Recorded by watching taskPoints rather than by wrapping setTaskPoints, so
  // every existing call site (add, delete, reorder, radius, type, quick task,
  // waypoint swap, loading a shared task) is covered without touching any of them.
  const [undoStack, setUndoStack] = useState<TaskPoint[][]>([]);
  // Seeded with the initial value so mounting doesn't count as a change.
  const previousTaskPoints = useRef<TaskPoint[]>(taskPoints);
  const isUndoing = useRef(false);

  useEffect(() => {
    if (previousTaskPoints.current === taskPoints) return;
    if (isUndoing.current) {
      isUndoing.current = false;
    } else {
      const snapshot = previousTaskPoints.current;
      setUndoStack(stack => [...stack.slice(-49), snapshot]);
    }
    previousTaskPoints.current = taskPoints;
  }, [taskPoints]);

  const undoTaskChange = useCallback(() => {
    if (undoStack.length === 0) return;
    isUndoing.current = true;
    setTaskPoints(undoStack[undoStack.length - 1]);
    setUndoStack(stack => stack.slice(0, -1));
  }, [undoStack]);

  const { user, profile, loading: authLoading, signInWithMagicLink, signInWithGoogle, signOut, setDisplayName } = useAuth();

  const handleSignOut = () => {
    if (window.confirm("Sign out?")) signOut();
  };

  const handleRenameProfile = () => {
    const next = window.prompt("Display name (shown to other pilots):", profile?.display_name || '');
    if (next && next.trim()) setDisplayName(next.trim());
  };

  // Quick Task State
  const [isQuickTaskDrawing, setIsQuickTaskDrawing] = useState(false);
  const [quickTaskPath, setQuickTaskPath] = useState<L.LatLng[]>([]);
  // Waypoints invented by the quick-task generator, so "Edit route" can remove them.
  const [generatedWaypointIds, setGeneratedWaypointIds] = useState<Set<string>>(new Set());
  const [autoLocateOnLoad] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return !params.get('task') && !params.get('event');
  });
  const [quickTaskSettings, setQuickTaskSettings] = useState({
    useExisting: false,
    newRadius: 10000,
    takeoffRadius: 500,
    sssRadius: 1000,
    essRadius: 2000,
    goalRadius: 500,
    targetIntermediateSize: 5000 // Added target size for existing waypoints
  });

  const [hasImportedWaypoints, setHasImportedWaypoints] = useState(false);
  const [activeDatasetIds, setActiveDatasetIds] = useState<string[]>([]);
  // Area folders start collapsed — there are enough of them that expanding all
  // would bury the search box.
  const [expandedRegions, setExpandedRegions] = useState<string[]>([]);
  // Countries start collapsed too: with three of them the panel was taller than
  // a phone screen before you had opened anything.
  const [expandedCountries, setExpandedCountries] = useState<string[]>([]);
  const [isBrowseExpanded, setIsBrowseExpanded] = useState(true);
  const [isManualFolderExpanded, setIsManualFolderExpanded] = useState(true);

  // Each dataset is its own file under data/, emitted by Vite as a separate
  // chunk, so nothing is fetched until it is switched on.
  const [predefinedWaypoints, setPredefinedWaypoints] = useState<Waypoint[]>([]);
  useEffect(() => {
    if (activeDatasetIds.length === 0) {
      setPredefinedWaypoints([]);
      return;
    }
    let cancelled = false;
    Promise.all(activeDatasetIds.map(id => findDataset(id)?.load() ?? Promise.resolve([])))
      .then(sets => { if (!cancelled) setPredefinedWaypoints(sets.flat()); })
      .catch(() => { if (!cancelled) setPredefinedWaypoints([]); });
    return () => { cancelled = true; };
  }, [activeDatasetIds]);

  const allWaypoints = useMemo(() => [...manualWaypoints, ...predefinedWaypoints], [manualWaypoints, predefinedWaypoints]);

  // True only when a real waypoint set is loaded — a dataset like Nelson 2026, or
  // an imported file. Drives whether snapping to existing waypoints is offered.
  const hasWaypointSet = predefinedWaypoints.length > 0 || (hasImportedWaypoints && manualWaypoints.length > 0);

  const [isLibraryVisible, setIsLibraryVisible] = useState(window.innerWidth > 1024);
  const [isTaskEditorVisible, setIsTaskEditorVisible] = useState(window.innerWidth > 768);
  const [libraryWidth, setLibraryWidth] = useState(240);
  const [taskEditorWidth, setTaskEditorWidth] = useState(320);
  const [isResizing, setIsResizing] = useState<null | 'library' | 'task'>(null);
  
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [sssOpenTime, setSssOpenTime] = useState('1200');
  const [taskDeadline, setTaskDeadline] = useState('2300');
  const [raceType, setRaceType] = useState(1);

  // Returns true if the user is already signed in (so the caller can proceed immediately).
  // Otherwise stashes `action` to replay after sign-in and opens the auth modal.
  const requireAuth = useCallback((action: PendingAction): boolean => {
    if (user) return true;
    savePendingAction(action);
    setIsAuthModalOpen(true);
    return false;
  }, [user]);

  const doPublish = useCallback(async (payload: { taskName: string; taskPoints: TaskPoint[]; sssOpenTime: string; taskDeadline: string; raceType: number; thenSchedule?: boolean }) => {
    try {
      const stats = computeTaskStats(payload.taskPoints);
      const result = await publishTask({
        name: payload.taskName,
        points: payload.taskPoints,
        sssOpenTime: payload.sssOpenTime,
        taskDeadline: payload.taskDeadline,
        raceType: payload.raceType,
        distanceOptimizedKm: parseFloat(stats.optimized),
        distanceCenterKm: parseFloat(stats.center),
      });
      // Publishing and putting a date on it are usually the same intent, so
      // this always leads into scheduling rather than making people choose up
      // front. "Don't schedule a day" is the way out, and hands over the share
      // link at that point.
      setPublishedTaskId(result.id);
      setIsTaskSummaryOpen(false);
      setJustPublished(true);
      setCreateEventForTask(result);
    } catch (err: any) {
      alert(err?.message || 'Could not publish this task.');
    }
  }, []);

  /** A freshly published task that the pilot chose not to put a date on. */
  const finishWithoutScheduling = useCallback((task: SharedTask) => {
    setCreateEventForTask(null);
    // Back to the task, which now has its QR unlocked.
    setIsTaskSummaryOpen(true);
    const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}?task=${task.id}`;
    navigator.clipboard.writeText(shareUrl).catch(() => {});
    alert(`"${task.name}" is published. Share link copied to clipboard:\n${shareUrl}`);
  }, []);

  const handleShareTask = () => {
    if (taskPoints.length === 0) { alert('Add some task points first.'); return; }
    const payload = { taskName, taskPoints, sssOpenTime, taskDeadline, raceType };
    if (!requireAuth({ type: 'publish', ...payload })) return;
    doPublish(payload);
  };

  /**
   * Publishing always goes through View & Publish, so a pilot sees the route and
   * gets a chance to name it before it lands in everyone else's library. The
   * side-panel button is a shortcut into this screen, not a second publish path.
   */
  const openViewAndPublish = () => {
    const stillADraft = isPlaceholderTaskName(taskName);
    setNameNeedsAttention(stillADraft);
    setNameWasSuggested(false);
    // Opened straight away — the launch list is a lazy chunk, and waiting on a
    // download before showing the task would be a worse trade than the name
    // arriving a moment later.
    setIsTaskSummaryOpen(true);

    if (!stillADraft) return;
    // Offer a name rather than just refusing to publish. It's pre-selected, so
    // accepting it costs nothing and replacing it costs one keystroke.
    suggestTaskName(
      taskPoints.map(tp => ({ id: tp.waypoint.id, lat: tp.waypoint.lat, lng: tp.waypoint.lng })),
      taskStats.optimized,
    ).then(suggestion => {
      if (!suggestion) return;
      // Don't stomp on a name the pilot has started typing in the meantime.
      setTaskName(current => (isPlaceholderTaskName(current) ? suggestion : current));
      setNameWasSuggested(true);
    }).catch(() => {});
  };

  const needsRename = isPlaceholderTaskName(taskName);

  // Drawing a route now ends on the View & Publish screen.
  useEffect(() => {
    if (!openPublishAfterFinish || taskPoints.length === 0) return;
    setOpenPublishAfterFinish(false);
    openViewAndPublish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPublishAfterFinish, taskPoints]);

  /**
   * Double-booking check, run on the builder screen so a pilot sees it without
   * having to open Fly Days. Re-checked whenever Fly Days closes, since that's
   * where joining and withdrawing happen.
   */
  useEffect(() => {
    if (!isSupabaseConfigured) { setClashes([]); setFlyDayCount(0); return; }
    let cancelled = false;

    // Upcoming fly days are public, so the count feeds the header badge whether
    // or not anyone is signed in. The clash check needs a session on top of it,
    // and reuses the same fetch rather than asking twice.
    listUpcomingEvents()
      .then(async (events) => {
        if (cancelled) return;
        setFlyDayCount(events.length);
        if (!user) { setClashes([]); return; }
        const mine = await getMyEventIds();
        if (!cancelled) setClashes(findClashes(events, mine));
      })
      .catch(() => { if (!cancelled) { setClashes([]); setFlyDayCount(0); } });

    return () => { cancelled = true; };
  }, [user, view]);

  // Put the cursor in the name field when the screen opens needing one, with the
  // placeholder selected so typing replaces it outright.
  useEffect(() => {
    if (!isTaskSummaryOpen || !nameNeedsAttention) return;
    const id = window.setTimeout(() => publishNameRef.current?.select(), 80);
    return () => window.clearTimeout(id);
  }, [isTaskSummaryOpen, nameNeedsAttention]);

  const handlePublishFromSummary = () => {
    if (!isSupabaseConfigured) { alert("Backend isn't set up yet — see SETUP.md."); return; }
    if (isPlaceholderTaskName(taskName)) { setNameNeedsAttention(true); publishNameRef.current?.select(); return; }
    handleShareTask();
  };

  const loadSharedTaskIntoBuilder = useCallback((shared: SharedTask) => {
    setManualWaypoints(prev => {
      const existingIds = new Set(prev.map(wp => wp.id));
      const newWps = shared.points.map(tp => tp.waypoint).filter(wp => !existingIds.has(wp.id));
      return [...prev, ...newWps];
    });
    setTaskPoints(shared.points);
    setTaskName(shared.name);
    setSssOpenTime(shared.sss_open_time);
    setTaskDeadline(shared.task_deadline);
    setRaceType(shared.race_type);
    setPublishedTaskId(shared.id);
  }, []);

  // Replay whatever the user was trying to do (publish/vote) once they finish signing in —
  // magic-link sign-in is a full page reload, so this fires on the fresh mount that follows it.
  const pendingReplayedRef = useRef(false);
  useEffect(() => {
    if (!user || pendingReplayedRef.current) return;
    pendingReplayedRef.current = true;
    const pending = takePendingAction();
    if (!pending) return;
    if (pending.type === 'publish') {
      setTaskName(pending.taskName);
      setTaskPoints(pending.taskPoints);
      setSssOpenTime(pending.sssOpenTime);
      setTaskDeadline(pending.taskDeadline);
      setRaceType(pending.raceType);
      doPublish(pending);
    } else if (pending.type === 'vote') {
      voteOnTask(pending.taskId, pending.value)
        .then(() => alert('Vote saved!'))
        .catch((err) => alert(err?.message || 'Could not save your vote.'));
    } else if (pending.type === 'createEvent') {
      createEvent(pending.taskId, pending.eventDate, pending.startTime, pending.raceType, pending.competitionId, pending.deadline ?? null)
        .then((ev) => setActiveEventId(ev.id))
        .catch((err) => alert(err?.message || 'Could not create the event.'));
    } else if (pending.type === 'confirmParticipation') {
      confirmParticipation(pending.eventId)
        .then(() => setActiveEventId(pending.eventId))
        .catch((err) => alert(err?.message || 'Could not confirm your participation.'));
    } else if (pending.type === 'proposeStartTime') {
      proposeStartTime(pending.eventId, pending.proposedTime)
        .then(() => setActiveEventId(pending.eventId))
        .catch((err) => alert(err?.message || 'Could not propose a new start time.'));
    } else if (pending.type === 'voteOnProposal') {
      voteOnProposal(pending.proposalId, pending.value)
        .then(() => setActiveEventId(pending.eventId))
        .catch((err) => alert(err?.message || 'Could not save your vote.'));
    }
  }, [user, doPublish]);

  // Load a task or event shared via a `?task=<id>` / `?event=<id>` link on first load.
  const urlLoadedRef = useRef(false);
  useEffect(() => {
    if (urlLoadedRef.current) return;
    urlLoadedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('task');
    const eventId = params.get('event');
    if (taskId) {
      getTask(taskId).then(shared => { if (shared) loadSharedTaskIntoBuilder(shared); }).catch(() => {});
    }
    if (eventId) {
      setActiveEventId(eventId);
      // `&join=1` marks an invite link: land on the fly day and join on arrival.
      if (params.get('join') === '1') setAutoJoinEventId(eventId);
    }
  }, [loadSharedTaskIntoBuilder]);

  // The optimized path is the whole point of the cylinder placement, so it's
  // always drawn — there was a toggle to hide it, which nobody needs.
  const showOptimized = true;
  const [showCenterLine, setShowCenterLine] = useState(false);
  // On by default: knowing where the launches are is useful while drawing, and
  // they only appear from zoom 9 in, so they never clutter a national view.
  const [showLaunchSites, setShowLaunchSites] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startResizing = useCallback((type: 'library' | 'task') => (e: React.MouseEvent) => { 
    setIsResizing(type); 
    e.preventDefault(); 
  }, []);

  const stopResizing = useCallback(() => setIsResizing(null), []);

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const minMapW = 100;
    if (isResizing === 'library') {
      const available = window.innerWidth - (isTaskEditorVisible ? taskEditorWidth : 0) - minMapW;
      const newWidth = Math.max(150, Math.min(available, e.clientX));
      setLibraryWidth(newWidth);
    } else if (isResizing === 'task') {
      const available = window.innerWidth - (isLibraryVisible ? libraryWidth : 0) - minMapW;
      const newWidth = Math.max(200, Math.min(available, window.innerWidth - e.clientX));
      setTaskEditorWidth(newWidth);
    }
  }, [isResizing, isLibraryVisible, libraryWidth, isTaskEditorVisible, taskEditorWidth]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  const taskStats = useMemo(() => computeTaskStats(taskPoints), [taskPoints]);

  const xctrackJson = useMemo(
    () => buildXctrackJson(taskPoints, sssOpenTime, taskDeadline, raceType),
    [taskPoints, sssOpenTime, taskDeadline, raceType],
  );

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const extension = file.name.split('.').pop()?.toLowerCase();
      let newWps: Waypoint[] = [];
      // Namespace by filename and import time so re-importing the same file, or
      // importing one that reuses codes from an active dataset, can't collide.
      const prefix = `import/${file.name}/${Date.now()}`;
      if (extension === 'csv') newWps = parseCSVWaypoints(text, prefix);
      else if (extension === 'gpx') newWps = parseGPXWaypoints(text, prefix);
      else if (extension === 'wpt') newWps = parseWPTWaypoints(text, prefix);
      else if (extension === 'cup') newWps = parseCUPWaypoints(text, prefix);
      if (newWps.length > 0) {
        setManualWaypoints(prev => [...prev, ...newWps]);
        setHasImportedWaypoints(true);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const createNewTask = () => {
    if (taskPoints.length > 0 && !window.confirm("Start a new task?")) return;
    setPublishedTaskId(null);
    setTaskName("Draft " + new Date().toLocaleDateString());
    setSssOpenTime('1200');
    setTaskDeadline('2300');
    setRaceType(1);

    // Waypoints the quick-task generator invented for a drawn route go with the
    // task — they were never places the pilot chose, and leaving them behind
    // litters the library with M1, M2, M3 from every task ever cleared. Anything
    // imported or picked from a dataset stays.
    if (generatedWaypointIds.size > 0) {
      setManualWaypoints(prev => prev.filter(wp => !generatedWaypointIds.has(wp.id)));
      setGeneratedWaypointIds(new Set());
    }

    // Drop straight back into drawing, the same as a fresh load — clearing a
    // task is nearly always the first half of starting the next one.
    // (startQuickTask empties taskPoints itself.)
    startQuickTask();
  };

  const addToTask = useCallback((wp: Waypoint) => {
    const newPoint: TaskPoint = { 
      id: `taskpt-${wp.id}-${Date.now()}-${Math.random()}`, 
      waypoint: wp, 
      type: TaskPointType.TURNPOINT, 
      radius: 400, 
      direction: TurnDirection.ENTRY 
    };
    setTaskPoints(prev => [...prev, newPoint]);
  }, []);

  const handleMapClick = (lat: number, lng: number) => {
    if (isQuickTaskDrawing) {
      setQuickTaskPath(prev => [...prev, L.latLng(lat, lng)]);
      return;
    }

    // With a finished task on screen, a stray tap should pan the map, not stitch
    // a new waypoint into the route. Long-press still offers "Add waypoint".
    if (taskPoints.length > 0) return;

    const newWp: Waypoint ={ id: `manual-${Date.now()}`, shortName: `M${manualWaypoints.length + 1}`, name: `Added Point ${manualWaypoints.length + 1}`, lat, lng, altM: 0 };
    setManualWaypoints(prev => [...prev, newWp]);
    addToTask(newWp);
  };

  const clearManualWaypoints = () => {
    if (manualWaypoints.length === 0) return;
    // Unlike a single delete this can't be undone — Undo only tracks the task —
    // and re-importing a file is a chore, so this one asks first.
    if (!window.confirm(`Delete all ${manualWaypoints.length} of your waypoints?`)) return;
    const ids = new Set(manualWaypoints.map(wp => wp.id));
    setManualWaypoints([]);
    setHasImportedWaypoints(false);
    setTaskPoints(prev => prev.filter(tp => !ids.has(tp.waypoint.id)));
  };

  const deleteManualWaypoint = (id: string) => {
    setManualWaypoints(prev => prev.filter(wp => wp.id !== id));
    setTaskPoints(prev => prev.filter(tp => tp.waypoint.id !== id));
  };

  const saveEditedWaypoint = () => {
    if (!editingWaypoint) return;
    const updated = { ...editingWaypoint };
    setManualWaypoints(prev => prev.map(wp => wp.id === updated.id ? updated : wp));
    setTaskPoints(prev => prev.map(tp => tp.waypoint.id === updated.id ? { ...tp, waypoint: updated } : tp));
    setEditingWaypoint(null);
  };

  const startQuickTask = useCallback(() => {
    setIsQuickTaskModalOpen(false);
    setIsQuickTaskDrawing(true);
    setQuickTaskPath([]);
    setTaskPoints([]);
    // If a waypoint file or dataset is already loaded, snapping to those
    // waypoints is almost always what's wanted; with an empty library it can't
    // work at all, so default it off.
    setQuickTaskSettings(s => ({ ...s, useExisting: hasWaypointSet }));
  }, [hasWaypointSet]);

  /** Moves one point of the drawn route, after it is dragged on the map. */
  const moveDrawnPoint = useCallback((index: number, lat: number, lng: number) => {
    setQuickTaskPath(prev => prev.map((p, i) => (i === index ? L.latLng(lat, lng) : p)));
  }, []);

  /** Removes the last point placed while drawing a quick-task route. */
  const undoDrawnPoint = useCallback(() => {
    setQuickTaskPath(prev => prev.slice(0, -1));
  }, []);

  // Loading waypoints is a strong signal you want to snap to them, whether that
  // happens before starting a task or part-way through drawing one. Only fires
  // on the empty -> loaded transition, so switching it off by hand afterwards sticks.
  const hadWaypointSetRef = useRef(hasWaypointSet);
  useEffect(() => {
    if (hasWaypointSet && !hadWaypointSetRef.current) {
      setQuickTaskSettings(s => ({ ...s, useExisting: true }));
    }
    hadWaypointSetRef.current = hasWaypointSet;
  }, [hasWaypointSet]);

  // Land ready to draw. Skipped when arriving on a shared link, where the point
  // is to look at that task rather than start a new one.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('task') || params.get('event')) return;
    startQuickTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishQuickTaskRoute = () => {
    if (quickTaskPath.length < 2) {
      alert("Please draw at least 2 points on the map.");
      return;
    }

    const newPoints: TaskPoint[] = [];
    const newWaypointsToAdd: Waypoint[] = [];
    const usedExisting = quickTaskSettings.useExisting && allWaypoints.length > 0;

    if (usedExisting) {
      // 1. FIRST POINT: TO and SSS (shared waypoint, closest to start of route)
      const startP = quickTaskPath[0];
      let startWp = allWaypoints[0];
      let minDist = Infinity;
      for (const wp of allWaypoints) {
        const d = L.latLng(wp.lat, wp.lng).distanceTo(startP);
        if (d < minDist) { minDist = d; startWp = wp; }
      }
      const sssRadius = Math.max(1000, L.latLng(startWp.lat, startWp.lng).distanceTo(startP));
      newPoints.push({
        id: `qt-tp-ex-tkoff-${Date.now()}`,
        waypoint: startWp,
        type: TaskPointType.TAKEOFF,
        radius: quickTaskSettings.takeoffRadius,
        direction: TurnDirection.ENTRY
      });
      newPoints.push({
        id: `qt-tp-ex-sss-${Date.now()}`,
        waypoint: startWp,
        type: TaskPointType.SSS,
        radius: Math.round(sssRadius),
        direction: TurnDirection.ENTRY
      });

      // 2. INTERMEDIATE POINTS
      for (let i = 1; i < quickTaskPath.length - 1; i++) {
        const A = quickTaskPath[i - 1];
        const B = quickTaskPath[i];
        const C = quickTaskPath[i + 1];
        
        // Find outside bisector direction
        const v1 = { lat: A.lat - B.lat, lng: A.lng - B.lng };
        const v2 = { lat: C.lat - B.lat, lng: C.lng - B.lng };
        const d1 = Math.sqrt(v1.lat * v1.lat + v1.lng * v1.lng);
        const d2 = Math.sqrt(v2.lat * v2.lat + v2.lng * v2.lng);
        const u1 = { lat: v1.lat / d1, lng: v1.lng / d1 };
        const u2 = { lat: v2.lat / d2, lng: v2.lng / d2 };
        let bisect = { lat: u1.lat + u2.lat, lng: u1.lng + u2.lng };
        let bd = Math.sqrt(bisect.lat * bisect.lat + bisect.lng * bisect.lng);
        if (bd < 0.000001) { bisect = { lat: -u1.lng, lng: u1.lat }; bd = 1; }
        const unitBisect = { lat: bisect.lat / bd, lng: bisect.lng / bd };
        
        // Score waypoints based on alignment with unitBisect and proximity to targetIntermediateSize
        let bestWp = allWaypoints[0];
        let bestScore = Infinity;
        for (const wp of allWaypoints) {
          const wpVec = { lat: wp.lat - B.lat, lng: wp.lng - B.lng };
          const wpDist = L.latLng(wp.lat, wp.lng).distanceTo(B);
          const wpUnit = { lat: wpVec.lat / (wpDist / 111320), lng: wpVec.lng / (wpDist / (111320 * Math.cos(B.lat * Math.PI / 180))) };
          const dot = wpUnit.lat * (-unitBisect.lat) + wpUnit.lng * (-unitBisect.lng);
          const angleDiff = Math.acos(Math.max(-1, Math.min(1, dot)));
          const distDiff = Math.abs(wpDist - quickTaskSettings.targetIntermediateSize);
          const score = (angleDiff * 5000) + distDiff;
          if (score < bestScore) { bestScore = score; bestWp = wp; }
        }
        
        newPoints.push({
          id: `qt-tp-ex-${Date.now()}-${i}`,
          waypoint: bestWp,
          type: TaskPointType.TURNPOINT,
          radius: Math.round(L.latLng(bestWp.lat, bestWp.lng).distanceTo(B)),
          direction: TurnDirection.ENTRY
        });
      }

      // 3. LAST POINT: ESS and Goal
      const prevP = quickTaskPath[quickTaskPath.length - 2];
      const endP = quickTaskPath[quickTaskPath.length - 1];

      // Find closest waypoint overall to endP
      let closestWp = allWaypoints[0];
      let minClosestDist = Infinity;
      for (const wp of allWaypoints) {
        const d = L.latLng(wp.lat, wp.lng).distanceTo(endP);
        if (d < minClosestDist) { minClosestDist = d; closestWp = wp; }
      }

      let finalWp: Waypoint = closestWp;
      let essRad: number;
      let goalRad: number;

      if (minClosestDist <= quickTaskSettings.essRadius) {
        // Condition 1: Closest waypoint is within ESS default cylinder size
        essRad = quickTaskSettings.essRadius;
        goalRad = quickTaskSettings.goalRadius;
      } else {
        // Condition 2: Search in 45 degree arc
        const legVec = { lat: endP.lat - prevP.lat, lng: endP.lng - prevP.lng };
        const legDist = Math.sqrt(legVec.lat * legVec.lat + legVec.lng * legVec.lng);
        const legUnit = { lat: legVec.lat / legDist, lng: legVec.lng / legDist };
        
        let bestWp = closestWp; 
        let bestEndScore = Infinity;
        for (const wp of allWaypoints) {
          const wpDist = L.latLng(wp.lat, wp.lng).distanceTo(endP);
          if (wpDist === 0) continue;
          const wpVec = { lat: wp.lat - endP.lat, lng: wp.lng - endP.lng };
          const wpUnit = { lat: wpVec.lat / (wpDist / 111320), lng: wpVec.lng / (wpDist / (111320 * Math.cos(endP.lat * Math.PI / 180))) };
          const dot = wpUnit.lat * legUnit.lat + wpUnit.lng * legUnit.lng;
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (angle < (22.5 * Math.PI / 180)) { 
            // Pick nearest, but prioritize >= 4km if possible
            const distPref = wpDist >= 4000 ? 0 : 4000 - wpDist;
            const score = wpDist + (distPref * 2); 
            if (score < bestEndScore) { bestEndScore = score; bestWp = wp; }
          }
        }
        finalWp = bestWp;
        // Edge of GOAL touches end of route
        goalRad = Math.round(L.latLng(finalWp.lat, finalWp.lng).distanceTo(endP));
        
        // ESS logic intersection: G = E - 1000 or G = 0.6 * E (at E = 1700, G = 700 or 1020)
        // If Goal Rad >= 700, we can use the 1km offset rule and still have ESS >= 1700
        if (goalRad >= 700) {
           essRad = goalRad + 1000;
        } else {
           essRad = Math.round(goalRad / 0.6);
        }
      }

      newPoints.push({
        id: `qt-tp-ex-ess-${Date.now()}`,
        waypoint: finalWp,
        type: TaskPointType.ESS,
        radius: essRad,
        direction: TurnDirection.ENTRY
      });
      newPoints.push({
        id: `qt-tp-ex-goal-${Date.now()}`,
        waypoint: finalWp,
        type: TaskPointType.GOAL,
        radius: goalRad,
        direction: TurnDirection.ENTRY
      });

    } else {
      // NEW WAYPOINTS LOGIC (Maintain previous logic)
      const startP = quickTaskPath[0];
      const startWp: Waypoint = {
        id: `qt-wp-start-${Date.now()}`,
        shortName: 'START',
        name: 'Quick Task Start',
        lat: startP.lat,
        lng: startP.lng,
        altM: 0
      };
      newWaypointsToAdd.push(startWp);
      newPoints.push({
        id: `qt-tp-tkoff-${Date.now()}`,
        waypoint: startWp,
        type: TaskPointType.TAKEOFF,
        radius: quickTaskSettings.takeoffRadius,
        direction: TurnDirection.ENTRY
      });
      newPoints.push({
        id: `qt-tp-sss-${Date.now()}`,
        waypoint: startWp,
        type: TaskPointType.SSS,
        radius: quickTaskSettings.sssRadius,
        direction: TurnDirection.ENTRY
      });
      for (let i = 1; i < quickTaskPath.length - 1; i++) {
        const A = quickTaskPath[i - 1];
        const B = quickTaskPath[i];
        const C = quickTaskPath[i + 1];
        const radius = quickTaskSettings.newRadius;
        const v1 = { lat: A.lat - B.lat, lng: A.lng - B.lng };
        const v2 = { lat: C.lat - B.lat, lng: C.lng - B.lng };
        const d1 = Math.sqrt(v1.lat * v1.lat + v1.lng * v1.lng);
        const d2 = Math.sqrt(v2.lat * v2.lat + v2.lng * v2.lng);
        const u1 = { lat: v1.lat / d1, lng: v1.lng / d1 };
        const u2 = { lat: v2.lat / d2, lng: v2.lng / d2 };
        let bisect = { lat: u1.lat + u2.lat, lng: u1.lng + u2.lng };
        let bd = Math.sqrt(bisect.lat * bisect.lat + bisect.lng * bisect.lng);
        if (bd < 0.000001) { bisect = { lat: -u1.lng, lng: u1.lat }; bd = 1; }
        const unitBisect = { lat: bisect.lat / bd, lng: bisect.lng / bd };
        const latOffset = (unitBisect.lat * radius) / 111320;
        const lngOffset = (unitBisect.lng * radius) / (111320 * Math.cos(B.lat * Math.PI / 180));
        const waypoint: Waypoint = {
          id: `qt-wp-${Date.now()}-${i}`,
          shortName: `QTP${i}`,
          name: `Quick Turnpoint ${i}`,
          lat: B.lat - latOffset,
          lng: B.lng - lngOffset,
          altM: 0
        };
        newWaypointsToAdd.push(waypoint);
        newPoints.push({
          id: `qt-tp-${Date.now()}-${i}`,
          waypoint,
          type: TaskPointType.TURNPOINT,
          radius,
          direction: TurnDirection.ENTRY
        });
      }
      const endP = quickTaskPath[quickTaskPath.length - 1];
      const endWp: Waypoint = {
        id: `qt-wp-end-${Date.now()}`,
        shortName: 'GOAL',
        name: 'Quick Task Goal',
        lat: endP.lat,
        lng: endP.lng,
        altM: 0
      };
      newWaypointsToAdd.push(endWp);
      newPoints.push({
        id: `qt-tp-ess-${Date.now()}`,
        waypoint: endWp,
        type: TaskPointType.ESS,
        radius: quickTaskSettings.essRadius,
        direction: TurnDirection.ENTRY
      });
      newPoints.push({
        id: `qt-tp-goal-${Date.now()}`,
        waypoint: endWp,
        type: TaskPointType.GOAL,
        radius: quickTaskSettings.goalRadius,
        direction: TurnDirection.ENTRY
      });
      setManualWaypoints(prev => [...prev, ...newWaypointsToAdd]);
    }

    setTaskPoints(newPoints);
    setIsQuickTaskDrawing(false);
    // The drawn path is deliberately kept so "Edit route" can drop straight back
    // into drawing with it, rather than starting from scratch.
    setGeneratedWaypointIds(new Set(newWaypointsToAdd.map(wp => wp.id)));
    setTaskName("Quick Task " + new Date().toLocaleTimeString());
    // Deferred to an effect rather than opened here: the name suggestion and the
    // distance both read state this call is still in the middle of setting.
    setOpenPublishAfterFinish(true);
  };

  /**
   * Back to the drawing stage with the route intact. The generated task and the
   * waypoints the generator invented are discarded — regenerating would only
   * recreate them, and leaving them behind litters the library.
   */
  const editDrawnRoute = () => {
    if (quickTaskPath.length < 2) return;
    setPublishedTaskId(null);
    setTaskPoints([]);
    setManualWaypoints(prev => prev.filter(wp => !generatedWaypointIds.has(wp.id)));
    setGeneratedWaypointIds(new Set());
    setIsQuickTaskDrawing(true);
  };

  const filteredWaypoints = allWaypoints.filter(wp => wp.shortName.toLowerCase().includes(searchQuery.toLowerCase()) || wp.name.toLowerCase().includes(searchQuery.toLowerCase()));
  const toggleDataset = (id: string) => setActiveDatasetIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const handleDragStart = (idx: number) => setDraggedIndex(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === idx) return;
    const newList = [...taskPoints];
    const item = newList[draggedIndex];
    newList.splice(draggedIndex, 1);
    newList.splice(idx, 0, item);
    setDraggedIndex(idx);
    setTaskPoints(newList);
  };
  const handleDragEnd = () => setDraggedIndex(null);

  return (
    <div className="flex flex-col h-screen font-sans text-slate-900 overflow-hidden bg-slate-50">
      <HeaderBar
        isSupabaseConfigured={isSupabaseConfigured}
        authLoading={authLoading}
        isSignedIn={!!user}
        displayName={profile?.display_name}
        onQuickTask={() => { goToView('builder'); setIsQuickTaskModalOpen(true); }}
        isDrawing={isQuickTaskDrawing}
        activeView={view}
        onBrowseTasks={() => setIsTaskBrowserOpen(true)}
        onJoinTask={() => { setShowFlyDayHint(false); goToView('flydays'); }}
        flyDayCount={flyDayCount}
        // Pointless while they're already looking at it.
        showFlyDayHint={showFlyDayHint && !showWelcome && view === 'builder'}
        onDismissFlyDayHint={() => setShowFlyDayHint(false)}
        onLeaderboard={() => setIsLeaderboardOpen(true)}
        onHowItWorks={() => setShowWelcome(true)}
        onGoHome={() => goToView('builder')}
        onSignIn={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
        onRenameProfile={handleRenameProfile}
      />

      {/* You can only fly one task a day, so being in two is always a mistake.
          Surfaced here as well as in Fly Days because most time is spent on
          this screen, not in the fly-day list. */}
      {clashes.length > 0 && !clashDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-4 py-2 flex items-center gap-2 shrink-0 z-40">
          <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 shrink-0" />
          <p className="text-xs text-amber-900 min-w-0 flex-1 truncate">
            {clashes.length === 1
              ? `You're in ${clashes[0].eventIds.length} fly days on ${formatEventDate(clashes[0].date)}.`
              : `You're double-booked on ${clashes.length} days.`}
            <span className="hidden sm:inline"> You can only fly one.</span>
          </p>
          <button
            onClick={() => goToView('flydays')}
            className="rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 px-3 py-1 text-xs font-medium transition shrink-0"
          >
            Review
          </button>
          <button
            onClick={() => setClashDismissed(true)}
            aria-label="Dismiss"
            className="rounded-full p-1 text-amber-600 hover:bg-amber-100 transition shrink-0"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      {view === 'flydays' && (
        <Suspense fallback={<div className="flex-1 grid place-items-center text-sm text-slate-400">Loading…</div>}>
          <FlyDaysView
            onBack={() => goToView('builder')}
            requireAuth={requireAuth}
            onOpenEvent={(eventId) => setActiveEventId(eventId)}
            onScheduleTask={(task) => setCreateEventForTask(task)}
            onOpenStandings={(comp) => setStandingsComp(comp)}
          />
        </Suspense>
      )}

      {/* Hidden rather than unmounted: tearing down Leaflet would throw away
          the map instance and whatever task is part-drawn, so switching to Fly
          Days and back would lose work. */}
      <main
        className={`flex flex-1 overflow-hidden relative w-full ${view === 'flydays' ? 'hidden' : ''}`}
      >
        <WaypointLibraryPanel
          visible={isLibraryVisible}
          width={libraryWidth}
          isResizing={!!isResizing}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filteredWaypoints={filteredWaypoints}
          manualWaypoints={manualWaypoints}
          regions={WAYPOINT_REGIONS}
          activeDatasetIds={activeDatasetIds}
          onToggleDataset={toggleDataset}
          isBrowseExpanded={isBrowseExpanded}
          onToggleBrowse={() => setIsBrowseExpanded(!isBrowseExpanded)}
          isManualFolderExpanded={isManualFolderExpanded}
          onToggleManualFolder={() => setIsManualFolderExpanded(!isManualFolderExpanded)}
          expandedCountries={expandedCountries}
          onToggleCountry={(name) => setExpandedCountries(prev =>
            prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])}
          expandedRegions={expandedRegions}
          onToggleRegion={(name) => setExpandedRegions(prev =>
            prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])}
          onAddToTask={addToTask}
          onEditWaypoint={setEditingWaypoint}
          onDeleteWaypoint={deleteManualWaypoint}
          onClearWaypoints={clearManualWaypoints}
          onImportFile={handleFileUpload}
        />

        <section className="flex-1 bg-gray-200 relative min-w-[100px]">
          <MapComponent 
            waypoints={allWaypoints} 
            taskPoints={taskPoints} 
            onWaypointSelect={addToTask} 
            onMapClick={handleMapClick} 
            showOptimized={showOptimized} 
            showCenterLine={showCenterLine} 
            showLabels={showLabels}
            showLaunchSites={showLaunchSites}
            onToggleLabels={() => setShowLabels(v => !v)}
            onToggleLaunchSites={() => setShowLaunchSites(v => !v)}
            isLibraryVisible={isLibraryVisible}
            isTaskEditorVisible={isTaskEditorVisible}
            isHidden={view !== 'builder'}
            isQuickTaskMode={isQuickTaskDrawing}
            quickTaskPath={quickTaskPath}
            onMoveQuickTaskPoint={moveDrawnPoint}
            autoLocate={autoLocateOnLoad}
          />
          {/* The two things to do with a finished task, kept together on the map
              rather than up in the header — this is where you're looking when
              the route is done. Sits above the Streets/Topo/Satellite switcher,
              which is also centred at the bottom. */}
          {!isQuickTaskDrawing && taskPoints.length > 0 && (
            <div
              style={{ bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }}
              className="absolute left-1/2 -translate-x-1/2 z-[1500] flex items-center gap-2"
            >
              {quickTaskPath.length >= 2 && (
                <button
                  onClick={editDrawnRoute}
                  className="flex items-center gap-2 rounded-full bg-white border border-slate-200 shadow-lg px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition whitespace-nowrap"
                >
                  <PencilSquareIcon className="w-4 h-4 text-blue-600 shrink-0" /> Edit route
                </button>
              )}
              <button
                onClick={openViewAndPublish}
                className="flex items-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg px-4 py-2.5 text-sm font-medium transition whitespace-nowrap"
              >
                <ShareIcon className="w-4 h-4 shrink-0" /> View &amp; Publish
              </button>
            </div>
          )}


          {isQuickTaskDrawing && (
            <div style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
              className="absolute left-1/2 -translate-x-1/2 z-[2000] w-[min(94vw,22rem)] bg-white/95 backdrop-blur px-4 py-3 rounded-2xl shadow-xl border border-slate-200 flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Drawing route</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-slate-400">
                    {quickTaskPath.length === 0 ? 'Click the map' : `${quickTaskPath.length} point${quickTaskPath.length === 1 ? '' : 's'}`}
                  </p>
                  <button
                    onClick={() => setIsQuickTaskModalOpen(true)}
                    title="Cylinder sizes"
                    className="rounded-full p-1.5 -mr-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition"
                  >
                    <Cog6ToothIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-600">Use existing waypoints?</span>
                <button
                  onClick={() => setQuickTaskSettings(s => ({ ...s, useExisting: !s.useExisting }))}
                  disabled={!hasWaypointSet}
                  title={!hasWaypointSet ? 'Switch on a dataset or import a waypoint file first' : `${allWaypoints.length} waypoints loaded`}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition shrink-0 disabled:opacity-40 ${
                    quickTaskSettings.useExisting && hasWaypointSet ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {quickTaskSettings.useExisting && hasWaypointSet ? 'Yes' : 'No'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Drops the drawn points but stays in drawing mode, so a bad
                    line restarts here instead of dumping you out of the task. */}
                <button
                  onClick={() => setQuickTaskPath([])}
                  disabled={quickTaskPath.length === 0}
                  title="Start this route again"
                  className="rounded-full px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent transition"
                >
                  Clear
                </button>
                <button
                  onClick={undoDrawnPoint}
                  disabled={quickTaskPath.length === 0}
                  title="Remove the last point"
                  className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent transition"
                >
                  <ArrowUturnLeftIcon className="w-3.5 h-3.5" /> Undo
                </button>
                {/* Finishing the route and reviewing it were two separate steps
                    for no reason — drawing always ends with wanting to see the
                    task, so this goes straight there. */}
                <button
                  onClick={finishQuickTaskRoute}
                  disabled={quickTaskPath.length < 2}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2 text-sm font-medium transition whitespace-nowrap"
                >
                  <ShareIcon className="w-3.5 h-3.5 shrink-0" /> View &amp; Publish
                </button>
              </div>
            </div>
          )}
        </section>

        <FlightPlanPanel
          visible={isTaskEditorVisible}
          width={taskEditorWidth}
          isResizing={!!isResizing}
          taskName={taskName}
          onTaskNameChange={setTaskName}
          taskStats={taskStats}
          sssOpenTime={sssOpenTime}
          onSssOpenTimeChange={setSssOpenTime}
          taskDeadline={taskDeadline}
          onTaskDeadlineChange={setTaskDeadline}
          taskPoints={taskPoints}
          onTaskPointsChange={setTaskPoints}
          onNewTask={createNewTask}
          onPublish={openViewAndPublish}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onChangeWaypoint={(idx) => setSwapIndex(idx)}
          onUndo={undoTaskChange}
          canUndo={undoStack.length > 0}
        />

        <div className="absolute top-4 left-4 z-[2000]">
          <button
            onClick={() => setIsLibraryVisible(!isLibraryVisible)}
            title={isLibraryVisible ? 'Hide waypoints' : 'Show waypoints'}
            className="rounded-full p-3 bg-white border border-slate-200 shadow-md text-slate-600 hover:bg-slate-50 transition active:scale-95"
          >
            {isLibraryVisible ? <XMarkIcon className="w-5 h-5" /> : <FlagIcon className="w-5 h-5" />}
          </button>
        </div>
        {/* Nothing to show until the task has points, so the button only appears
            once there is a flight plan worth opening — or while the panel is
            already open, so it can still be collapsed. */}
        {(taskPoints.length > 0 || isTaskEditorVisible) && (
          <div className="absolute top-4 right-4 z-[2000]">
            <button
              onClick={() => setIsTaskEditorVisible(!isTaskEditorVisible)}
              title={isTaskEditorVisible ? 'Hide flight plan' : `Show flight plan (${taskPoints.length} points)`}
              className="relative rounded-full p-3 bg-white border border-slate-200 shadow-md text-slate-600 hover:bg-slate-50 transition active:scale-95"
            >
              {/* Same icon as View & Publish: this panel is where a task gets
                  finished and published, so the two should read as one place. */}
              {isTaskEditorVisible ? <XMarkIcon className="w-5 h-5" /> : <ShareIcon className="w-5 h-5" />}
              {!isTaskEditorVisible && taskPoints.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center">
                  {taskPoints.length}
                </span>
              )}
            </button>
          </div>
        )}
      </main>

      {/* Quick Task Settings Modal */}
      {isQuickTaskModalOpen && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-300">
            <div className="p-6 border-b flex justify-between items-center bg-amber-50">
              <div className="flex items-center gap-3">
                <SparklesIcon className="w-8 h-8 text-amber-600" />
                <h3 className="text-lg font-semibold text-slate-900">Quick Task Generator</h3>
              </div>
              <button onClick={() => setIsQuickTaskModalOpen(false)} className="text-amber-900/40 hover:text-amber-900 transition"><XMarkIcon className="w-6 h-6" /></button>
            </div>
            
            <div className="p-8 space-y-6 overflow-y-auto max-h-[60vh]">
              <div className={`p-5 rounded-2xl border transition ${!hasWaypointSet ? 'bg-slate-50 border-slate-100 opacity-50 grayscale' : 'bg-white border-amber-100 hover:border-amber-300'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Use existing waypoints?</span>
                  <button 
                    disabled={!hasWaypointSet}
                    onClick={() => setQuickTaskSettings(s => ({ ...s, useExisting: !s.useExisting }))}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${quickTaskSettings.useExisting ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                  >
                    {quickTaskSettings.useExisting ? 'Yes' : 'No'}
                  </button>
                </div>
                <p className="text-xs text-slate-400">If enabled, the task will automatically pick the best waypoints from your library to fit your drawn route.</p>
              </div>

              <div className="space-y-4 animate-in fade-in duration-300">
                 {quickTaskSettings.useExisting ? (
                    <div className="p-5 rounded-2xl border bg-white border-amber-100">
                      <label className="text-sm font-medium text-slate-700 block mb-3">Target Intermediate Size (m)</label>
                      <div className="flex items-center gap-4">
                        <input 
                          type="range" min="1000" max="15000" step="500"
                          value={quickTaskSettings.targetIntermediateSize}
                          onChange={(e) => setQuickTaskSettings(s => ({ ...s, targetIntermediateSize: parseInt(e.target.value) }))}
                          className="flex-1 accent-blue-600"
                        />
                        <span className="w-20 text-center font-medium text-blue-700 text-sm bg-blue-50 py-1 rounded-lg">{(quickTaskSettings.targetIntermediateSize / 1000).toFixed(1)} km</span>
                      </div>
                    </div>
                 ) : (
                    <div className="p-5 rounded-2xl border bg-white border-amber-100">
                      <label className="text-sm font-medium text-slate-700 block mb-3">Intermediate Turnpoint Size (m)</label>
                      <div className="flex items-center gap-4">
                        <input 
                          type="range" min="1000" max="50000" step="1000"
                          value={quickTaskSettings.newRadius}
                          onChange={(e) => setQuickTaskSettings(s => ({ ...s, newRadius: parseInt(e.target.value) }))}
                          className="flex-1 accent-blue-600"
                        />
                        <span className="w-20 text-center font-medium text-blue-700 text-sm bg-blue-50 py-1 rounded-lg">{(quickTaskSettings.newRadius / 1000).toFixed(0)} km</span>
                      </div>
                    </div>
                 )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-2xl border bg-white border-amber-50">
                      <label className="text-xs text-slate-400 block mb-2">Takeoff Radius (m)</label>
                      <input 
                        type="number" step="100"
                        value={quickTaskSettings.takeoffRadius}
                        onChange={(e) => setQuickTaskSettings(s => ({ ...s, takeoffRadius: parseInt(e.target.value) || 0 }))}
                        className="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="p-4 rounded-2xl border bg-white border-amber-50">
                      <label className="text-xs text-slate-400 block mb-2">SSS Radius (m)</label>
                      <input 
                        type="number" step="100"
                        value={quickTaskSettings.sssRadius}
                        onChange={(e) => setQuickTaskSettings(s => ({ ...s, sssRadius: parseInt(e.target.value) || 0 }))}
                        className="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="p-4 rounded-2xl border bg-white border-amber-50">
                      <label className="text-xs text-slate-400 block mb-2">ESS Radius (m)</label>
                      <input 
                        type="number" step="100"
                        value={quickTaskSettings.essRadius}
                        onChange={(e) => setQuickTaskSettings(s => ({ ...s, essRadius: parseInt(e.target.value) || 0 }))}
                        className="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="p-4 rounded-2xl border bg-white border-amber-50">
                      <label className="text-xs text-slate-400 block mb-2">Goal Radius (m)</label>
                      <input 
                        type="number" step="100"
                        value={quickTaskSettings.goalRadius}
                        onChange={(e) => setQuickTaskSettings(s => ({ ...s, goalRadius: parseInt(e.target.value) || 0 }))}
                        className="w-full border rounded-lg p-2 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>
              </div>
            </div>

            <div className="p-8 pt-4 flex gap-3 border-t bg-slate-50">
              <button onClick={() => setIsQuickTaskModalOpen(false)} className="flex-1 py-3 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100 transition">
                {isQuickTaskDrawing ? 'Close' : 'Cancel'}
              </button>
              <button
                onClick={() => (isQuickTaskDrawing ? setIsQuickTaskModalOpen(false) : startQuickTask())}
                className="flex-1 py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
              >
                {isQuickTaskDrawing ? 'Apply' : 'Start Drawing'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingWaypoint && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col animate-in fade-in zoom-in duration-300">
            <div className="p-5 border-b flex justify-between items-center bg-slate-50">
              <h3 className="text-base font-semibold text-slate-900">Edit Waypoint</h3>
              <button onClick={() => setEditingWaypoint(null)} className="text-slate-400 hover:text-slate-600 transition"><XMarkIcon className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Short Name</label>
                <input 
                  type="text" 
                  className="w-full border rounded-lg p-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none bg-white" 
                  value={editingWaypoint.shortName} 
                  onChange={(e) => setEditingWaypoint({...editingWaypoint, shortName: e.target.value})} 
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Full Name</label>
                <input 
                  type="text" 
                  className="w-full border rounded-lg p-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none bg-white" 
                  value={editingWaypoint.name} 
                  onChange={(e) => setEditingWaypoint({...editingWaypoint, name: e.target.value})} 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Latitude</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    className="w-full border rounded-lg p-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none bg-white" 
                    value={editingWaypoint.lat} 
                    onChange={(e) => setEditingWaypoint({...editingWaypoint, lat: parseFloat(e.target.value) || 0})} 
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 mb-1 block">Longitude</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    className="w-full border rounded-lg p-2 text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none bg-white" 
                    value={editingWaypoint.lng} 
                    onChange={(e) => setEditingWaypoint({...editingWaypoint, lng: parseFloat(e.target.value) || 0})} 
                  />
                </div>
              </div>
            </div>
            <div className="p-6 pt-0 flex gap-2">
              <button onClick={() => setEditingWaypoint(null)} className="flex-1 py-3 rounded-full text-sm font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={saveEditedWaypoint} className="flex-1 py-3 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition">Save</button>
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={<ModalLoading />}>
        {swapIndex !== null && taskPoints[swapIndex] && (
        <WaypointSwapPopover
          taskPoints={taskPoints}
          index={swapIndex}
          library={allWaypoints}
          onClose={() => setSwapIndex(null)}
          onSwap={(replacement, preserveTurn) => {
            setTaskPoints(prev => swapTaskPointWaypoint(prev, swapIndex, replacement, preserveTurn));
            setSwapIndex(null);
          }}
        />
      )}

      {isAuthModalOpen && (
          <AuthModal
            onClose={() => setIsAuthModalOpen(false)}
            signInWithMagicLink={signInWithMagicLink}
            signInWithGoogle={signInWithGoogle}
          />
        )}

        {isTaskBrowserOpen && (
          <TaskBrowserModal
            onClose={() => setIsTaskBrowserOpen(false)}
            requireAuth={requireAuth}
            onLoadTask={loadSharedTaskIntoBuilder}
            onCreateEvent={(task) => setCreateEventForTask(task)}
            onOpenEvent={(eventId) => setActiveEventId(eventId)}
            onJoinTask={() => { setIsTaskBrowserOpen(false); goToView('flydays'); }}
            currentUserId={user?.id}
          />
        )}

        {standingsComp && (
          <CompetitionStandingsModal
            competition={standingsComp}
            onClose={() => setStandingsComp(null)}
            currentUserId={user?.id}
          />
        )}

        {createEventForTask && (
          <CreateEventModal
            task={createEventForTask}
            onClose={() => { setCreateEventForTask(null); setJustPublished(false); }}
            onSkip={justPublished ? () => { setJustPublished(false); finishWithoutScheduling(createEventForTask); } : undefined}
            requireAuth={requireAuth}
            onCreated={(eventId) => {
              setCreateEventForTask(null);
              setJustPublished(false);
              setActiveEventId(eventId);
            }}
          />
        )}

        {activeEventId && (
          <EventModal
            eventId={activeEventId}
            onClose={() => setActiveEventId(null)}
            requireAuth={requireAuth}
            isSignedIn={!!user}
            currentUserId={user?.id}
            onRequestAuth={() => setIsAuthModalOpen(true)}
            onDeleted={() => setClashDismissed(false)}
            autoJoin={autoJoinEventId === activeEventId}
          />
        )}

        {showWelcome && <WelcomeModal onClose={dismissWelcome} />}

        {isLeaderboardOpen && (
          <LeaderboardPanel onClose={() => setIsLeaderboardOpen(false)} currentUserId={user?.id} />
        )}
      </Suspense>

      {isTaskSummaryOpen && (
        <div className="fixed inset-0 z-[3000] bg-slate-900/50 backdrop-blur-sm flex flex-col overflow-hidden animate-in fade-in duration-500">
          <div className="bg-white h-[95vh] max-w-6xl mx-auto w-full mt-[2.5vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden border border-slate-200">
            {/* Stacks on a phone: with the name and the action side by side the
                name was squeezed to a couple of characters. */}
            <div className="bg-blue-600 text-white p-4 sm:p-5 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-4 shrink-0">
              <div className="min-w-0 flex-1 order-2 sm:order-1">
                {/* Editable here as well as in the side panel: this is the last
                    stop before publishing, so it's where a placeholder name
                    actually matters. */}
                <input
                  ref={publishNameRef}
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="Name this task…"
                  aria-label="Task name"
                  className={`w-full bg-transparent text-2xl font-semibold tracking-tight leading-tight outline-none rounded-lg px-2 py-1 -mx-2 transition placeholder:text-white/50 ${
                    nameNeedsAttention && needsRename
                      ? 'ring-2 ring-amber-300 bg-white/10'
                      : 'hover:bg-white/10 focus:bg-white/10'
                  }`}
                />
                {needsRename ? (
                  <p className="text-xs text-amber-200 mt-1.5 px-0.5">{NAME_REQUIRED_HINT}</p>
                ) : nameWasSuggested ? (
                  <p className="text-xs text-blue-100 mt-1.5 px-0.5">Suggested name — type over it if you'd rather.</p>
                ) : (
                  <p className="text-xs text-blue-100 mt-1.5 px-0.5">Tap the name to rename this task.</p>
                )}
              </div>
              {/* One action, not two. Publishing then leads into scheduling,
                  where "Don't schedule a day" is an explicit way out — cheaper
                  than making people choose up front, and it leaves room for the
                  name on a phone. */}
              <div className="flex items-center gap-2 shrink-0 order-1 sm:order-2 self-end sm:self-auto">
                {/* The X alone didn't say where it went. This names the
                    destination: back to the map with the task still loaded. */}
                <button
                  onClick={() => setIsTaskSummaryOpen(false)}
                  title="Back to the map to keep editing this task"
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-white/20 text-white hover:bg-white/30 transition whitespace-nowrap"
                >
                  <PencilSquareIcon className="w-4 h-4 shrink-0" /> Edit
                </button>
                <button
                  onClick={handlePublishFromSummary}
                  disabled={needsRename}
                  title={needsRename ? NAME_REQUIRED_HINT : undefined}
                  className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition whitespace-nowrap ${
                    needsRename || !isSupabaseConfigured
                      ? 'bg-white/30 text-white/60 cursor-not-allowed'
                      : 'bg-white text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  <ShareIcon className="w-4 h-4 shrink-0" /> Publish
                </button>
                <button onClick={() => setIsTaskSummaryOpen(false)} className="rounded-full p-2 bg-white/15 hover:bg-white/25 transition"><XMarkIcon className="w-6 h-6"/></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 flex flex-col">
              <div className="flex-1 min-h-[400px] rounded-2xl overflow-hidden border shadow-inner">
                <MapComponent 
                  waypoints={allWaypoints} 
                  taskPoints={taskPoints} 
                  showOptimized={true} 
                  showCenterLine={true} 
                  showLabels={true} 
                  isShareMode={true} 
                  isLibraryVisible={false}
                  isTaskEditorVisible={false}
                />
              </div>
              <div className="mt-8 flex flex-col md:flex-row gap-8 items-start">
                 <div className="flex-1 grid grid-cols-2 gap-4 w-full">
                   <div className="p-4 bg-slate-50 rounded-2xl border">
                     <p className="text-xs text-slate-400">Distance (Optimized)</p>
                     <p className="text-xl font-semibold text-slate-900">{taskStats.optimized} km</p>
                   </div>
                   <div className="p-4 bg-slate-50 rounded-2xl border">
                     <p className="text-xs text-slate-400">Distance (C-to-C)</p>
                     <p className="text-xl font-semibold text-slate-900">{taskStats.center} km</p>
                   </div>
                   <div className="p-4 bg-slate-50 rounded-2xl border col-span-2">
                     <p className="text-xs text-slate-400">Task Timing</p>
                     <p className="text-sm text-slate-700">SSS Open: {sssOpenTime} | Deadline: {taskDeadline}</p>
                   </div>
                 </div>
                 
                 {publishedTaskId ? (
                   <div className="flex flex-col items-center bg-white p-6 rounded-2xl border border-indigo-100 shadow-xl">
                     <p className="text-xs text-slate-500 mb-3">Scan to XCTrack</p>
                     <div className="p-2 border rounded-xl">
                      <QRCodeSVG value={xctrackJson} size={160} level="M" />
                     </div>
                   </div>
                 ) : (
                   /* The QR is what gets the task onto an instrument, so it's
                      the natural reward for publishing rather than something to
                      hand over first. */
                   <div className="flex flex-col items-center justify-center bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-300 w-full md:w-[212px] shrink-0">
                     <QrCodeIcon className="w-10 h-10 text-slate-300" />
                     <p className="text-sm font-medium text-slate-700 mt-3 text-center">XCTrack QR code</p>
                     <p className="text-xs text-slate-500 mt-1 text-center leading-snug">
                       Publish this task to get the code that loads it onto your instrument.
                     </p>
                   </div>
                 )}
              </div>
              
              <div className="mt-8 space-y-2 pb-12">
                <h3 className="text-xs text-slate-400">Waypoints List</h3>
                {taskPoints.map((tp, i) => (
                  <div key={tp.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-3">
                      <span className="w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center text-[10px] font-semibold">{i+1}</span>
                      <span className="text-sm font-medium text-slate-800">{tp.waypoint.shortName}</span>
                      <span className="text-xs text-slate-500">{tp.type}</span>
                    </div>
                    <span className="text-xs text-slate-400">{tp.radius}m</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;