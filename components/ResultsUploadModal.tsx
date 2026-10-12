import React, { useRef, useState } from 'react';
import { XMarkIcon, ArrowUpTrayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import type { EventRow } from '../lib/dbTypes';
import { parseIGC } from '../lib/igcParser';
import { walkTaskCylinders, resolveTaskTime, FlightWalkResult } from '../lib/scoring';
import { submitFlightResult } from '../lib/resultsApi';

interface ResultsUploadModalProps {
  event: EventRow;
  onClose: () => void;
  isSignedIn: boolean;
  onRequestAuth: () => void;
  onSubmitted: () => void;
}

function combineDateAndTime(date: Date, hhmm: string): Date {
  const hours = parseInt(hhmm.slice(0, 2) || '0', 10);
  const minutes = parseInt(hhmm.slice(2, 4) || '0', 10);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, 0));
}

const fmt = (d: Date | null) => d ? d.toISOString().slice(11, 19) + ' UTC' : 'Not reached';

const ResultsUploadModal: React.FC<ResultsUploadModalProps> = ({ event, onClose, isSignedIn, onRequestAuth, onSubmitted }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [igcFile, setIgcFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FlightWalkResult | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleFile = (file: File) => {
    setError('');
    setPreview(null);
    setIgcFile(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseIGC(text);
      if (parsed.fixes.length === 0) {
        setError("Couldn't find any GPS fixes in that file — is it a valid .igc?");
        return;
      }
      const anchorDate = parsed.date ?? new Date(event.event_date + 'T00:00:00Z');
      // Resolved against the track itself, because a flight that crosses UTC
      // midnight puts the gate on the day after the file's header date.
      const sssOpenAt = resolveTaskTime(event.start_time, parsed.fixes, anchorDate)
        ?? combineDateAndTime(anchorDate, event.start_time);
      const deadline = event.task_deadline
        ? resolveTaskTime(event.task_deadline, parsed.fixes, anchorDate)
        : null;

      const walk = walkTaskCylinders(parsed.fixes, event.task_points || [], sssOpenAt, deadline);
      // Keep the File itself — it gets uploaded to Storage rather than inlined
      // into the results row.
      setIgcFile(file);
      setPreview(walk);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!preview || !igcFile) return;
    if (!isSignedIn) { onRequestAuth(); return; }
    setSubmitting(true);
    setError('');
    try {
      await submitFlightResult({ eventId: event.id, igcFile, walk: preview });
      onSubmitted();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not submit this result.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[4200] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-slate-200">
        <div className="p-5 flex justify-between items-center border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-900">Submit your flight</h3>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"><XMarkIcon className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-500">Upload your IGC flight log — we'll check it against this task's cylinders and estimate your score.</p>

          <input ref={fileInputRef} type="file" accept=".igc" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 px-4 py-2.5 text-sm font-medium transition"
          >
            <ArrowUpTrayIcon className="w-4 h-4" /> {igcFile ? igcFile.name : 'Choose .igc file'}
          </button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {preview && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <CheckCircleIcon className="w-4 h-4 text-blue-500" /> Parsed successfully
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                <div>SSS <span className="block text-slate-800 font-medium">{fmt(preview.sssTime)}</span></div>
                <div>ESS <span className="block text-slate-800 font-medium">{fmt(preview.essTime)}</span></div>
                <div>Goal <span className="block text-slate-800 font-medium">{fmt(preview.goalTime)}</span></div>
                <div>Distance <span className="block text-slate-800 font-medium">{preview.distanceKm} km</span></div>
              </div>
              <span className="inline-block rounded-full bg-amber-50 text-amber-700 px-3 py-1 text-xs font-medium">Preview — points are calculated once submitted</span>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!preview || submitting}
            className="w-full rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-5 py-2.5 text-sm font-medium transition"
          >
            {submitting ? 'Submitting…' : isSignedIn ? 'Submit Flight' : 'Sign In to Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsUploadModal;
