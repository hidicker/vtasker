import React from 'react';
import { CalendarDaysIcon, UsersIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import type { EventRow } from '../lib/dbTypes';

interface ScheduledEventChipProps {
  event: EventRow;
  joined: boolean;
  joining: boolean;
  onJoin: () => void;
  onOpen: () => void;
}

/** "Sat 9 Aug" — short enough for a list row, unambiguous about the day. */
export function formatEventDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';

  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** 1230 -> 12:30 */
export function formatStartTime(hhmm: string): string {
  if (!hhmm || hhmm.length < 3) return hhmm;
  const padded = hhmm.padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

const ScheduledEventChip: React.FC<ScheduledEventChipProps> = ({ event, joined, joining, onJoin, onOpen }) => {
  const soon = formatEventDate(event.event_date);
  const isImminent = soon === 'Today' || soon === 'Tomorrow';

  return (
    <div
      className={`mt-2 flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
        isImminent ? 'border-amber-200 bg-amber-50' : 'border-blue-100 bg-blue-50/60'
      }`}
    >
      <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="flex items-center gap-2 min-w-0 flex-1 text-left">
        <CalendarDaysIcon className={`w-4 h-4 shrink-0 ${isImminent ? 'text-amber-600' : 'text-blue-600'}`} />
        <span className="min-w-0">
          <span className={`block text-xs font-semibold truncate ${isImminent ? 'text-amber-900' : 'text-blue-900'}`}>
            {soon} · {formatStartTime(event.start_time)}
          </span>
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <UsersIcon className="w-3 h-3" />
            {event.participant_count ?? 0} {event.participant_count === 1 ? 'pilot' : 'pilots'} in
          </span>
        </span>
      </button>

      {joined ? (
        <span className="flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-1 text-[11px] font-medium shrink-0">
          <CheckCircleSolid className="w-3.5 h-3.5" /> You're in
        </span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onJoin(); }}
          disabled={joining}
          className="flex items-center gap-1 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 text-[11px] font-medium transition shrink-0"
        >
          <CheckCircleIcon className="w-3.5 h-3.5" /> {joining ? 'Joining…' : 'Join'}
        </button>
      )}
    </div>
  );
};

export default ScheduledEventChip;
