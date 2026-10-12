import React, { useEffect, useRef, useState } from 'react';
import {
  SparklesIcon, MagnifyingGlassIcon, CalendarDaysIcon, QuestionMarkCircleIcon, XMarkIcon,
  TrophyIcon, UserCircleIcon, ArrowRightStartOnRectangleIcon, EllipsisHorizontalIcon,
} from '@heroicons/react/24/outline';

interface HeaderBarProps {
  isSupabaseConfigured: boolean;
  authLoading: boolean;
  isSignedIn: boolean;
  displayName?: string;
  onQuickTask: () => void;
  /** Drawing a route — the builder's own "you are here". */
  isDrawing: boolean;
  /** Which top-level view is on screen, so the header can show it. */
  activeView: 'builder' | 'flydays';
  onBrowseTasks: () => void;
  onJoinTask: () => void;
  /** Upcoming fly days, for the badge. 0 hides it. */
  flyDayCount: number;
  showFlyDayHint: boolean;
  onDismissFlyDayHint: () => void;
  onLeaderboard: () => void;
  onHowItWorks: () => void;
  /** The wordmark doubles as a way back to the builder. */
  onGoHome: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onRenameProfile: () => void;
}

const backendMessage = "Backend isn't set up yet — see SETUP.md.";

// Hover text, because a two-word label can't carry everything each screen does.
const TASKS_HINT =
  'Task Library — routes pilots have shared. Open one in the builder, copy and change it, vote on it, or put a date on it.';
const FLY_DAYS_HINT =
  "Fly Days — days someone has scheduled a task for. Join one, see who's in, or schedule a new one.";

const HeaderBar: React.FC<HeaderBarProps> = ({
  isSupabaseConfigured, authLoading, isSignedIn, displayName,
  onQuickTask, isDrawing, activeView, onBrowseTasks, onJoinTask, onLeaderboard, onHowItWorks, onGoHome,
  flyDayCount, showFlyDayHint, onDismissFlyDayHint,
  onSignIn, onSignOut, onRenameProfile,
}) => {
  // The full action row does not fit on a phone — it used to run ~270px past the
  // screen edge, putting Export, Rankings, Settings and Sign in out of reach.
  // The three primary actions stay visible (on short labels below `xs`); the
  // rest move into this menu below the `md` breakpoint.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const guard = (action: () => void) => () => {
    setMenuOpen(false);
    isSupabaseConfigured ? action() : alert(backendMessage);
  };
  const plain = (action: () => void) => () => { setMenuOpen(false); action(); };

  /**
   * One neutral treatment for all the primary actions, with the active one
   * filled. Four differently-coloured buttons competed with the map for
   * attention and implied a hierarchy that isn't real — these are peers.
   */
  const primaryButton = (state: 'active' | 'idle' | 'disabled') => {
    const base = 'flex items-center gap-1 sm:gap-1.5 rounded-full px-2.5 sm:px-4 py-2 text-sm font-medium transition shrink-0 whitespace-nowrap border';
    if (state === 'disabled') return `${base} bg-white border-slate-200 text-slate-300 cursor-not-allowed`;
    if (state === 'active') return `${base} bg-blue-50 border-blue-300 text-blue-700`;
    return `${base} bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-sm`;
  };

  // Export lives inside View & Publish now — that screen already shows the
  // XCTrack QR alongside the route, so a separate button just duplicated it.
  // View & Publish now lives on the map beside Edit route, where you're already
  // looking when a route is finished.
  const secondary = [
    { key: 'how', label: 'How it works', Icon: QuestionMarkCircleIcon, onClick: plain(onHowItWorks), needsBackend: false },
    { key: 'rankings', label: 'Rankings', Icon: TrophyIcon, onClick: guard(onLeaderboard), needsBackend: true, beta: true },
  ];

  return (
    <header className="bg-white border-b border-slate-200 px-2 sm:px-4 py-2 flex justify-between items-center gap-2 shrink-0 z-50">
      <button onClick={onGoHome} className="hidden xs:flex items-center gap-2 shrink-0 rounded-lg hover:bg-slate-50 transition pr-1" title="Back to the task builder">
        <span className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-semibold shrink-0">V</span>
        <h1 className="text-base font-semibold text-slate-900 tracking-tight hidden xs:block sm:block">VTasker</h1>
      </button>

      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
        {/* The two things people come here to do — always visible. */}
        <button
          onClick={onQuickTask}
          className={primaryButton(isDrawing && activeView === 'builder' ? 'active' : 'idle')}
        >
          <SparklesIcon className="w-4 h-4 shrink-0" />
          <span className="hidden xs:inline">Quick Task</span>
          <span className="xs:hidden">New</span>
        </button>


        {/*
          Two separate jobs, so two separate buttons: Tasks browses the
          evergreen route library, Fly Days deals with the perishable fly-day
          list. Labels shorten below `xs` so three buttons still fit a phone.
        */}
        <button
          onClick={guard(onBrowseTasks)}
          title={isSupabaseConfigured ? TASKS_HINT : backendMessage}
          className={primaryButton(isSupabaseConfigured ? 'idle' : 'disabled')}
        >
          <MagnifyingGlassIcon className="w-4 h-4 shrink-0" />
          <span className="hidden xs:inline">Task Library</span>
          <span className="xs:hidden">Tasks</span>
        </button>

        <div className="relative shrink-0">
          <button
            onClick={guard(onJoinTask)}
            title={isSupabaseConfigured ? FLY_DAYS_HINT : backendMessage}
            className={primaryButton(
              !isSupabaseConfigured ? 'disabled' : activeView === 'flydays' ? 'active' : 'idle',
            )}
          >
            <CalendarDaysIcon className="w-4 h-4 shrink-0" />
            Fly Days
            {/* Permanent, no dismissing: the count is just true, and it helps a
                returning pilot as much as a new one. */}
            {flyDayCount > 0 && (
              <span className="rounded-full bg-amber-400 text-amber-950 px-1 min-w-[17px] text-[11px] font-semibold leading-[17px] text-center">
                {flyDayCount}
              </span>
            )}
          </button>

          {/* One-off pointer at the screen most first-time visitors never find.
              Anchored right so it can't run off a phone screen. */}
          {showFlyDayHint && isSupabaseConfigured && (
            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-[70] w-max max-w-[15rem] animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="relative rounded-xl bg-blue-600 text-white shadow-lg px-3 py-2.5 flex items-start gap-2">
                {/* Arrow inside the card, so it always hangs off the card's own
                    top edge rather than floating over the button. */}
                <div className="absolute -top-1 right-6 w-3 h-3 rotate-45 bg-blue-600" />
                <div className="min-w-0">
                  <button onClick={guard(onJoinTask)} className="text-left">
                    <p className="text-xs font-semibold leading-snug">
                      {flyDayCount > 0
                        ? `${flyDayCount} fly day${flyDayCount === 1 ? '' : 's'} coming up`
                        : 'Looking for a task to join?'}
                    </p>
                    <p className="text-[11px] text-blue-100 leading-snug mt-0.5">
                      {flyDayCount > 0 ? 'Have a look and join one.' : 'Fly days get scheduled here.'}
                    </p>
                  </button>
                </div>
                <button
                  onClick={onDismissFlyDayHint}
                  aria-label="Dismiss"
                  className="rounded-full p-0.5 text-blue-200 hover:text-white hover:bg-white/15 transition shrink-0"
                >
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Wide screens: secondary actions laid out inline as before. */}
        <div className="hidden md:flex items-center gap-1.5">
          <div className="w-px h-5 bg-slate-200 mx-1" />
          {secondary.map(({ key, label, Icon, onClick, needsBackend, beta }) => (
            <button
              key={key}
              onClick={onClick}
              title={needsBackend && !isSupabaseConfigured ? backendMessage : label}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                needsBackend && !isSupabaseConfigured ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-slate-100 text-slate-600'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
              {beta && <span className="rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none">beta</span>}
            </button>
          ))}
        </div>

        {/* Narrow screens: everything else behind one button. */}
        <div className="relative md:hidden shrink-0" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            className="rounded-full p-2 hover:bg-slate-100 text-slate-500 transition"
          >
            <EllipsisHorizontalIcon className="w-5 h-5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl py-1.5 z-[60]">
              {secondary.map(({ key, label, Icon, onClick, needsBackend, beta }) => (
                <button
                  key={key}
                  onClick={onClick}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left transition ${
                    needsBackend && !isSupabaseConfigured ? 'text-slate-300' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" /> {label}
                  {beta && <span className="ml-auto rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-semibold">beta</span>}
                </button>
              ))}

              <div className="h-px bg-slate-100 my-1.5" />

              {authLoading ? null : isSignedIn ? (
                <>
                  <button
                    onClick={plain(onRenameProfile)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left text-slate-700 hover:bg-slate-50 transition"
                  >
                    <UserCircleIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{displayName || 'Pilot'}</span>
                  </button>
                  <button
                    onClick={plain(onSignOut)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left text-slate-700 hover:bg-slate-50 transition"
                  >
                    <ArrowRightStartOnRectangleIcon className="w-4 h-4 shrink-0" /> Sign out
                  </button>
                </>
              ) : (
                <button
                  onClick={guard(onSignIn)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left text-blue-600 hover:bg-slate-50 transition"
                >
                  <UserCircleIcon className="w-4 h-4 shrink-0" /> Sign in
                </button>
              )}
            </div>
          )}
        </div>

        {/* Wide screens keep the account controls inline. */}
        <div className="hidden md:flex items-center gap-1">
          {authLoading ? null : isSignedIn ? (
            <>
              <button
                onClick={onRenameProfile}
                title="Click to change your display name"
                className="flex items-center gap-1.5 rounded-full hover:bg-slate-100 text-slate-600 px-3 py-1.5 text-sm font-medium transition max-w-[10rem]"
              >
                <UserCircleIcon className="w-4 h-4 shrink-0" />
                <span className="truncate">{displayName || 'Pilot'}</span>
              </button>
              <button
                onClick={onSignOut}
                title="Sign out"
                className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
              >
                <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              onClick={guard(onSignIn)}
              title={isSupabaseConfigured ? undefined : backendMessage}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                isSupabaseConfigured ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
            >
              Sign in
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default HeaderBar;
