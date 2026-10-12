import React from 'react';
import { XMarkIcon, MapPinIcon, ShareIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';

interface WelcomeModalProps {
  onClose: () => void;
}

/**
 * Shown once, on a pilot's first visit.
 *
 * The app opens straight into drawing mode on an empty map, which is only
 * obvious if you already know that tapping the map does something. Three steps,
 * task-building only — rankings and scoring are a later concern and would just
 * make this longer.
 */
const steps = [
  {
    Icon: MapPinIcon,
    title: 'Draw a route',
    body: 'Tap on the map, then hit View & Publish. VTasker works out the cylinders so your route becomes the shortest path.',
  },
  {
    Icon: ShareIcon,
    title: 'Name it, publish it',
    body: "It's added to the library of tasks, where any pilot can find it and load it into their own builder.",
  },
  {
    Icon: CalendarDaysIcon,
    title: 'Pick a day, invite people',
    body: 'Put a date on a task and send the invite link — anyone who opens it joins. Works for a casual fly day or as part of a comp.',
  },
];

const WelcomeModal: React.FC<WelcomeModalProps> = ({ onClose }) => (
  <div className="fixed inset-0 z-[4500] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
      <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 shrink-0">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">Welcome to VTasker</p>
          <h2 className="text-xl font-semibold text-slate-900 tracking-tight mt-1">Set a task in a minute</h2>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-2 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition shrink-0"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="px-6 pb-2 overflow-y-auto">
        <ol className="space-y-4">
          {steps.map(({ Icon, title, body }, i) => (
            <li key={title} className="flex gap-3.5">
              <span className="shrink-0 w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  <span className="text-slate-400 tabular-nums mr-1.5">{i + 1}.</span>{title}
                </p>
                <p className="text-sm text-slate-600 leading-snug mt-0.5">{body}</p>
              </div>
            </li>
          ))}
        </ol>

      </div>

      <div className="px-6 py-5 shrink-0">
        <button
          onClick={onClose}
          className="w-full rounded-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-sm font-medium transition"
        >
          Start drawing
        </button>
      </div>
    </div>
  </div>
);

export default WelcomeModal;
