import React from 'react';
import { TrophyIcon, ArrowUpTrayIcon, SparklesIcon } from '@heroicons/react/24/outline';
import type { FlightResult } from '../lib/dbTypes';

interface EventResultsPanelProps {
  results: FlightResult[];
  canUpload: boolean;
  haveSubmitted: boolean;
  onUploadClick: () => void;
  canFinalize?: boolean;
  finalizing?: boolean;
  onFinalize?: () => void;
}

const rankBadge = (i: number) => {
  if (i === 0) return 'bg-amber-100 text-amber-700';
  if (i === 1) return 'bg-slate-200 text-slate-600';
  if (i === 2) return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-500';
};

const EventResultsPanel: React.FC<EventResultsPanelProps> = ({ results, canUpload, haveSubmitted, onUploadClick, canFinalize, finalizing, onFinalize }) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5"><TrophyIcon className="w-4 h-4 text-amber-500" /> Results</p>
        {canUpload && !haveSubmitted && (
          <button
            onClick={onUploadClick}
            className="flex items-center gap-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 px-3.5 py-1.5 text-xs font-medium transition"
          >
            <ArrowUpTrayIcon className="w-3.5 h-3.5" /> Upload Flight
          </button>
        )}
        {haveSubmitted && (
          <span className="rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-medium">Flight submitted</span>
        )}
      </div>

      {results.length === 0 ? (
        <p className="text-sm text-slate-400">No flights submitted yet. Simplified GAP-inspired scoring — distance + speed + goal bonus, normalized to the best pilot in this event.</p>
      ) : (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-slate-50 transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${rankBadge(i)}`}>{i + 1}</span>
                <span className="text-sm font-medium text-slate-700 truncate">{r.display_name || 'Pilot'}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                <span>{r.distance_km} km</span>
                {!r.ess_time && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">landed out</span>}
                <span className="text-sm font-semibold text-slate-900">{r.total_points} pts</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {canFinalize && onFinalize && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Scores everyone and updates pilot rankings.</p>
          <button
            onClick={onFinalize}
            disabled={finalizing}
            className="flex items-center gap-1.5 rounded-full bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white px-4 py-1.5 text-xs font-medium transition shrink-0"
          >
            <SparklesIcon className="w-3.5 h-3.5" /> {finalizing ? 'Scoring…' : 'Finalize & Score'}
          </button>
        </div>
      )}
    </div>
  );
};

export default EventResultsPanel;
