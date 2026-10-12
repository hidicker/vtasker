import React, { useEffect, useState } from 'react';
import { XMarkIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import type { LeaderboardRow } from '../lib/dbTypes';
import { listLeaderboard } from '../lib/leaderboardApi';

interface LeaderboardPanelProps {
  onClose: () => void;
  currentUserId?: string;
}

const rankStyle = (i: number) => {
  if (i === 0) return 'bg-amber-100 text-amber-700';
  if (i === 1) return 'bg-slate-200 text-slate-600';
  if (i === 2) return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-500';
};

const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({ onClose, currentUserId }) => {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listLeaderboard()
      .then(setRows)
      .catch(err => setError(err?.message || 'Could not load the leaderboard.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-[3600] bg-slate-900/40 backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="bg-white h-[88vh] max-w-2xl mx-auto w-full mt-[6vh] rounded-2xl flex flex-col shadow-xl overflow-hidden border border-slate-200">
        <div className="px-6 py-5 flex justify-between items-center border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-slate-900">Pilot Rankings</h2>
            <span className="rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">Beta</span>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex gap-2.5 rounded-xl bg-blue-50 p-3.5">
            <InformationCircleIcon className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-900/80 leading-relaxed">
              Chess-style ratings. Everyone starts at 1200. In each event every pair of pilots counts as
              a head-to-head match, so beating a higher-rated pilot gains you more than beating a lower-rated one.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400">No ratings yet. Ratings appear once an event has results from two or more pilots.</p>
          )}

          <div className="space-y-1">
            {rows.map((row, i) => (
              <div
                key={row.user_id}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 transition ${row.user_id === currentUserId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${rankStyle(i)}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {row.display_name}
                      {row.user_id === currentUserId && <span className="ml-2 text-xs font-normal text-blue-600">you</span>}
                    </p>
                    <p className="text-xs text-slate-400">{row.events} event{row.events === 1 ? '' : 's'} · {row.matches} matchup{row.matches === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <span className="text-base font-semibold text-slate-900 tabular-nums shrink-0">{row.rating}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPanel;
