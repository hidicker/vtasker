import React, { useCallback, useEffect, useState } from 'react';
import { XMarkIcon, TrophyIcon, Cog6ToothIcon } from '@heroicons/react/24/outline';
import { formatEventDate } from './ScheduledEventChip';
import type { Competition } from '../lib/dbTypes';
import { getCompetitionStandings, setDropWorst, type CompetitionStandings } from '../lib/competitionsApi';

interface CompetitionStandingsModalProps {
  competition: Competition;
  onClose: () => void;
  currentUserId?: string;
}

/**
 * Competition standings — each pilot's task points added up across the comp's
 * fly days, worst tasks dropped.
 *
 * The drop setting lives here rather than anywhere in the main chrome: it's the
 * only per-competition setting, it only means anything next to the table it
 * changes, and only the organiser ever touches it.
 */
const CompetitionStandingsModal: React.FC<CompetitionStandingsModalProps> = ({
  competition, onClose, currentUserId,
}) => {
  const [standings, setStandings] = useState<CompetitionStandings | null>(null);
  const [dropWorst, setDropWorstLocal] = useState(competition.drop_worst ?? 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isOrganiser = !!currentUserId && currentUserId === competition.created_by;

  const load = useCallback((drop: number) => {
    setLoading(true);
    setError('');
    getCompetitionStandings(competition.id, drop)
      .then(setStandings)
      .catch((err) => setError(err?.message || 'Could not load standings.'))
      .finally(() => setLoading(false));
  }, [competition.id]);

  useEffect(() => { load(dropWorst); }, [load, dropWorst]);

  const changeDrop = async (next: number) => {
    setDropWorstLocal(next); // recomputes the table straight away
    if (!isOrganiser) return;
    setSaving(true);
    try {
      await setDropWorst(competition.id, next);
    } catch (err: any) {
      setError(err?.message || 'Could not save that setting.');
    } finally {
      setSaving(false);
    }
  };

  const taskCount = standings?.tasks.length ?? 0;
  const maxDrop = Math.max(0, Math.min(5, taskCount - 1));

  return (
    <div className="fixed inset-0 z-[3900] bg-slate-900/50 backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="bg-white h-[92vh] max-w-4xl mx-auto w-full mt-[4vh] rounded-2xl flex flex-col shadow-xl overflow-hidden border border-slate-200">

        <div className="px-6 py-4 flex justify-between items-start gap-3 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Competition</p>
            <h2 className="text-lg font-semibold text-slate-900 truncate flex items-center gap-2">
              <TrophyIcon className="w-5 h-5 text-amber-500 shrink-0" /> {competition.name}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {taskCount === 0
                ? 'No fly days scheduled yet'
                : `${taskCount} task${taskCount === 1 ? '' : 's'} · ${standings?.rows.length ?? 0} pilot${standings?.rows.length === 1 ? '' : 's'}`}
              {dropWorst > 0 && taskCount > 0 && ` · worst ${dropWorst} dropped`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setSettingsOpen(v => !v)}
              title="Scoring settings"
              aria-expanded={settingsOpen}
              className={`rounded-full p-2 transition ${settingsOpen ? 'bg-slate-100 text-slate-700' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'}`}
            >
              <Cog6ToothIcon className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        {settingsOpen && (
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 shrink-0">
            <p className="text-sm font-medium text-slate-800">Drop each pilot's worst tasks</p>
            <p className="text-xs text-slate-500 mt-0.5 mb-2.5 leading-snug">
              A missed task scores zero, so dropping one means a weekend away doesn't
              wreck a series. {isOrganiser ? '' : 'Only the organiser can change this.'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: maxDrop + 1 }, (_, n) => (
                <button
                  key={n}
                  onClick={() => changeDrop(n)}
                  disabled={!isOrganiser || saving}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    dropWorst === n
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {n === 0 ? 'Drop none' : `Drop ${n}`}
                </button>
              ))}
            </div>
            {maxDrop === 0 && taskCount > 0 && (
              <p className="text-xs text-slate-400 mt-2">Needs more than one task before anything can be dropped.</p>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading && <p className="p-6 text-sm text-slate-400">Loading standings…</p>}
          {error && <p className="p-6 text-sm text-red-500">{error}</p>}

          {!loading && !error && standings && standings.rows.length === 0 && (
            <div className="px-6 py-14 text-center">
              <TrophyIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No results yet.</p>
              <p className="text-xs text-slate-400 mt-1">
                Standings appear once pilots upload flight logs and a fly day is scored.
              </p>
            </div>
          )}

          {!loading && !error && standings && standings.rows.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-white/95 backdrop-blur">
                <tr className="text-left">
                  <th className="px-4 py-2.5 text-xs font-medium text-slate-400 w-10">#</th>
                  <th className="px-2 py-2.5 text-xs font-medium text-slate-400">Pilot</th>
                  {standings.tasks.map((t, i) => (
                    <th key={t.eventId} className="px-2 py-2.5 text-xs font-medium text-slate-400 text-right whitespace-nowrap">
                      <span className="block">Task {i + 1}</span>
                      <span className="block font-normal text-[10px] text-slate-300">{formatEventDate(t.eventDate)}</span>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-xs font-medium text-slate-500 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {standings.rows.map((row, idx) => (
                  <tr
                    key={row.userId}
                    className={`border-t border-slate-100 ${row.userId === currentUserId ? 'bg-blue-50/60' : ''}`}
                  >
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="px-2 py-2.5 font-medium text-slate-800">
                      {row.displayName}
                      {row.userId === currentUserId && <span className="text-blue-600 text-xs font-normal"> · you</span>}
                    </td>
                    {row.scores.map((s, i) => (
                      <td
                        key={i}
                        title={s.dropped ? 'Dropped — worst task' : (s.flown ? undefined : 'No result submitted')}
                        className={`px-2 py-2.5 text-right tabular-nums ${
                          s.dropped ? 'text-slate-300 line-through' : s.flown ? 'text-slate-600' : 'text-slate-300'
                        }`}
                      >
                        {s.flown ? Math.round(s.points) : '—'}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                      {Math.round(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="px-6 py-3 border-t border-slate-100 text-xs text-slate-400 shrink-0">
          Task points come from the simplified GAP-inspired scoring on each fly day — not a CIVL-compliant scorer.
        </p>
      </div>
    </div>
  );
};

export default CompetitionStandingsModal;
