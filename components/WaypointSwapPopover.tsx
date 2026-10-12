import React, { useMemo, useState } from 'react';
import { XMarkIcon, MagnifyingGlassIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import type { TaskPoint, Waypoint } from '../types';
import { findSwapCandidates } from '../lib/waypointSwap';

interface WaypointSwapPopoverProps {
  taskPoints: TaskPoint[];
  index: number;
  library: Waypoint[];
  onSwap: (replacement: Waypoint, preserveTurn: boolean) => void;
  onClose: () => void;
}

const km = (m: number) => (m / 1000).toFixed(1);

const WaypointSwapPopover: React.FC<WaypointSwapPopoverProps> = ({ taskPoints, index, library, onSwap, onClose }) => {
  const [query, setQuery] = useState('');
  const [preserveTurn, setPreserveTurn] = useState(true);

  const current = taskPoints[index];
  const candidates = useMemo(
    () => findSwapCandidates(taskPoints, index, library),
    [taskPoints, index, library],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? candidates.filter(c =>
          c.waypoint.shortName.toLowerCase().includes(q) ||
          c.waypoint.name.toLowerCase().includes(q))
      : candidates;
    return list.slice(0, 60);
  }, [candidates, query]);

  return (
    <div className="fixed inset-0 z-[4400] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col border border-slate-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-start gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900">Change waypoint</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Turnpoint {index + 1} currently uses <span className="font-medium text-slate-700">{current?.waypoint.shortName}</span> · {current?.radius} m
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition shrink-0">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-slate-100">
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              placeholder="Search nearby waypoints…"
              className="w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm outline-none focus:bg-white focus:border-blue-400 transition"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300 text-blue-600 w-4 h-4 focus:ring-blue-400"
              checked={preserveTurn}
              onChange={(e) => setPreserveTurn(e.target.checked)}
            />
            <span className="text-xs text-slate-600 leading-relaxed">
              <span className="font-medium text-slate-800">Keep the task shape</span> — resize the cylinder so the
              route still turns in the same place. Uncheck to keep the {current?.radius} m radius and let the
              cylinder move with the new waypoint.
            </span>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 && (
            <p className="p-5 text-sm text-slate-400">
              {candidates.length === 0
                ? 'No other waypoints within 30 km. Switch on a dataset in the library, or import your own.'
                : 'Nothing matches that search.'}
            </p>
          )}

          {shown.map(c => (
            <button
              key={c.waypoint.id}
              onClick={() => onSwap(c.waypoint, preserveTurn)}
              className="w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-blue-50/60 transition group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{c.waypoint.shortName}</p>
                  <p className="text-xs text-slate-400 truncate">{c.waypoint.name}</p>
                </div>
                <div className="text-right shrink-0">
                  {c.distanceFromCurrentM < 50 ? (
                    // Quick Task invents its own waypoints; the official one for the
                    // same spot is often the whole reason to swap, so call it out.
                    <p className="text-xs font-medium text-emerald-600">same location</p>
                  ) : (
                    <p className="text-xs text-slate-500">{km(c.distanceFromCurrentM)} km away</p>
                  )}
                  {preserveTurn && (
                    <p className="text-xs font-medium text-blue-600 flex items-center gap-1 justify-end">
                      <ArrowsRightLeftIcon className="w-3 h-3" />
                      {c.suggestedRadiusM} m
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default WaypointSwapPopover;
