import React from 'react';
import { TrashIcon, Bars2Icon, ArrowsRightLeftIcon, ArrowUturnLeftIcon, ShareIcon } from '@heroicons/react/24/outline';
import { TaskPoint, TaskPointType } from '../types';

interface FlightPlanPanelProps {
  visible: boolean;
  width: number;
  isResizing: boolean;
  taskName: string;
  onTaskNameChange: (name: string) => void;
  taskStats: { center: string; optimized: string };
  sssOpenTime: string;
  onSssOpenTimeChange: (v: string) => void;
  taskDeadline: string;
  onTaskDeadlineChange: (v: string) => void;
  taskPoints: TaskPoint[];
  onTaskPointsChange: React.Dispatch<React.SetStateAction<TaskPoint[]>>;
  onNewTask: () => void;
  onPublish: () => void;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent, idx: number) => void;
  onDragEnd: () => void;
  onChangeWaypoint: (idx: number) => void;
  onUndo: () => void;
  canUndo: boolean;
}

// Matches the cylinder stroke colours used on the map, so the list and the map
// read as the same thing.
const TYPE_ACCENT: Record<string, string> = {
  [TaskPointType.TAKEOFF]: 'bg-slate-400',
  [TaskPointType.SSS]: 'bg-red-500',
  [TaskPointType.TURNPOINT]: 'bg-indigo-500',
  [TaskPointType.ESS]: 'bg-blue-500',
  [TaskPointType.GOAL]: 'bg-emerald-500',
};

const FlightPlanPanel: React.FC<FlightPlanPanelProps> = ({
  visible, width, isResizing, taskName, onTaskNameChange, taskStats,
  sssOpenTime, onSssOpenTimeChange, taskDeadline, onTaskDeadlineChange,
  taskPoints, onTaskPointsChange, onNewTask, onPublish, onDragStart, onDragOver, onDragEnd, onChangeWaypoint,
  onUndo, canUndo,
}) => {
  const updatePoint = (id: string, patch: Partial<TaskPoint>) =>
    onTaskPointsChange(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <aside
      style={{ width: visible ? `${width}px` : '0px', flexBasis: visible ? `${width}px` : '0px' }}
      className={`bg-white border-l border-slate-200 flex flex-col shrink relative overflow-hidden z-40 ${
        !isResizing ? 'transition-[width,flex-basis] duration-300' : ''
      }`}
    >
      <div className="pt-16 px-4 pb-4 border-b border-slate-100 min-w-[200px]">
        <div className="flex justify-between items-center mb-2 pr-10">
          <h2 className="text-xs font-medium text-slate-400">Flight plan</h2>
          <div className="flex items-center gap-0.5">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title={canUndo ? 'Undo last change' : 'Nothing to undo'}
              className="rounded-full p-1.5 text-slate-300 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-300 transition"
            >
              <ArrowUturnLeftIcon className="w-4 h-4" />
            </button>
            <button onClick={onNewTask} title="Clear task" className="rounded-full p-1.5 hover:bg-slate-100 text-slate-300 hover:text-red-500 transition">
              <TrashIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            className="text-lg font-semibold flex-1 min-w-0 bg-transparent border-none p-0 focus:ring-0 outline-none text-slate-900 tracking-tight"
            value={taskName}
            onChange={(e) => onTaskNameChange(e.target.value)}
          />
          {/* Shortcut into View & Publish rather than a second publish path —
              that screen shows the route and holds the naming rule. */}
          <button
            onClick={onPublish}
            disabled={taskPoints.length === 0}
            title={taskPoints.length === 0 ? 'Add some task points first' : 'View & publish this task'}
            className="flex items-center gap-1 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-30 disabled:hover:bg-blue-600 text-white px-3 py-1.5 text-xs font-medium transition shrink-0 whitespace-nowrap"
          >
            <ShareIcon className="w-3.5 h-3.5 shrink-0" /> View &amp; Publish
          </button>
        </div>

        <div className="flex gap-2 mt-3">
          <div className="rounded-xl border border-slate-200 p-2.5 flex-1 min-w-0">
            <p className="text-[11px] text-slate-400 mb-0.5 truncate">Optimized</p>
            <p className="text-sm font-semibold text-blue-600 truncate">{taskStats.optimized} km</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-2.5 flex-1 min-w-0">
            <p className="text-[11px] text-slate-400 mb-0.5 truncate">Centre-to-centre</p>
            <p className="text-sm font-semibold text-slate-500 truncate">{taskStats.center} km</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <div className="rounded-xl border border-slate-200 p-2.5 min-w-0">
            <label className="text-[11px] text-slate-400 mb-0.5 block truncate">Start opens</label>
            <input
              type="text"
              maxLength={4}
              placeholder="1200"
              className="text-sm font-medium text-slate-800 bg-transparent outline-none w-full"
              value={sssOpenTime}
              onChange={(e) => onSssOpenTimeChange(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            />
          </div>
          <div className="rounded-xl border border-slate-200 p-2.5 min-w-0">
            <label className="text-[11px] text-slate-400 mb-0.5 block truncate">Deadline</label>
            <input
              type="text"
              maxLength={4}
              placeholder="2300"
              className="text-sm font-medium text-slate-800 bg-transparent outline-none w-full"
              value={taskDeadline}
              onChange={(e) => onTaskDeadlineChange(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-w-[200px]">
        {taskPoints.length === 0 && (
          <p className="text-sm text-slate-400 px-1 py-3">
            Click the map or a waypoint to add your first turnpoint.
          </p>
        )}

        {taskPoints.map((tp, idx) => (
          <div
            key={`tp-${tp.id}`}
            draggable
            onDragStart={() => onDragStart(idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDragEnd={onDragEnd}
            className="rounded-xl border border-slate-200 p-3 group relative transition cursor-move hover:border-blue-300 hover:bg-slate-50/50"
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <Bars2Icon className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                <span className={`w-5 h-5 rounded-full text-white flex items-center justify-center text-[11px] font-semibold shrink-0 ${TYPE_ACCENT[tp.type] || 'bg-slate-400'}`}>
                  {idx + 1}
                </span>
                <span className="text-sm font-medium text-slate-800 truncate">{tp.waypoint.shortName}</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0 ml-1">
                <button
                  onClick={() => onChangeWaypoint(idx)}
                  title="Use a different waypoint for this turnpoint"
                  className="rounded-full p-1 text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition"
                >
                  <ArrowsRightLeftIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onTaskPointsChange(prev => prev.filter(p => p.id !== tp.id))}
                  className="rounded-full p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex gap-2 items-end w-full">
              <div className="flex flex-col flex-1 min-w-0">
                <label className="text-[11px] text-slate-400 mb-1 truncate">Type</label>
                <select
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-blue-400 w-full"
                  value={tp.type}
                  onChange={(e) => updatePoint(tp.id, { type: e.target.value as TaskPointType })}
                >
                  <option value={TaskPointType.TAKEOFF}>Takeoff</option>
                  <option value={TaskPointType.SSS}>SSS</option>
                  <option value={TaskPointType.TURNPOINT}>Turnpoint</option>
                  <option value={TaskPointType.ESS}>ESS</option>
                  <option value={TaskPointType.GOAL}>Goal</option>
                </select>
              </div>
              <div className="flex flex-col w-[76px] shrink-0">
                <label className="text-[11px] text-slate-400 mb-1 text-center truncate">Radius m</label>
                <input
                  type="number"
                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:border-blue-400 text-center outline-none w-full"
                  value={tp.radius}
                  onChange={(e) => updatePoint(tp.id, { radius: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};

export default FlightPlanPanel;
