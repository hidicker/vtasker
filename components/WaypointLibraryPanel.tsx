import React, { useRef } from 'react';
import {
  MagnifyingGlassIcon, PlusIcon, TrashIcon, PencilSquareIcon,
  ArrowUpTrayIcon, ChevronDownIcon, ChevronRightIcon, MapPinIcon, FolderIcon,
} from '@heroicons/react/24/outline';
import { Waypoint } from '../types';

/** Rows rendered at once, before asking the pilot to search instead. */
const LIST_LIMIT = 200;

export interface RegionOption {
  name: string;
  groups: { name: string; datasets: { id: string; label: string; formatCount?: number }[] }[];
}

interface WaypointLibraryPanelProps {
  visible: boolean;
  width: number;
  isResizing: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filteredWaypoints: Waypoint[];
  manualWaypoints: Waypoint[];
  regions: RegionOption[];
  activeDatasetIds: string[];
  onToggleDataset: (id: string) => void;
  isBrowseExpanded: boolean;
  onToggleBrowse: () => void;
  isManualFolderExpanded: boolean;
  onToggleManualFolder: () => void;
  expandedRegions: string[];
  onToggleRegion: (name: string) => void;
  /** Countries start collapsed — three of them expanded buries everything else. */
  expandedCountries: string[];
  onToggleCountry: (name: string) => void;
  onAddToTask: (wp: Waypoint) => void;
  onEditWaypoint: (wp: Waypoint) => void;
  onDeleteWaypoint: (id: string) => void;
  onClearWaypoints: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const WaypointLibraryPanel: React.FC<WaypointLibraryPanelProps> = ({
  visible, width, isResizing, searchQuery, onSearchChange, filteredWaypoints,
  manualWaypoints, regions, activeDatasetIds, onToggleDataset,
  isBrowseExpanded, onToggleBrowse, isManualFolderExpanded, onToggleManualFolder,
  expandedRegions, onToggleRegion, expandedCountries, onToggleCountry,
  onAddToTask, onEditWaypoint, onDeleteWaypoint, onClearWaypoints, onImportFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const Chevron = ({ open }: { open: boolean }) =>
    open ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />;

  return (
    <aside
      style={{ width: visible ? `${width}px` : '0px', flexBasis: visible ? `${width}px` : '0px' }}
      className={`bg-white border-r border-slate-200 flex flex-col shrink relative overflow-hidden z-40 ${
        !isResizing ? 'transition-[width,flex-basis] duration-300' : ''
      }`}
    >
      {/* Title and search stay put; the tree and the results share one scroll
          area beneath them. Previously the tree sat in an uncapped block inside
          an overflow-hidden aside, so on a phone anything below the fold could
          not be reached at all. */}
      <div className="pt-16 px-3 pb-3 shrink-0 min-w-[200px]">
        <div className="flex justify-between items-center mb-3 pr-10">
          <h2 className="text-xs font-medium text-slate-400 pl-12">Waypoints</h2>
          <input ref={fileInputRef} type="file" onChange={onImportFile} className="hidden" accept=".csv,.gpx,.wpt,.cup" />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-full hover:bg-slate-100 text-blue-600 px-2.5 py-1 text-xs font-medium transition"
          >
            <ArrowUpTrayIcon className="w-3.5 h-3.5" /> Import
          </button>
        </div>

        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search waypoints…"
            className="w-full rounded-full border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm outline-none focus:bg-white focus:border-blue-400 transition"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto min-w-[200px]">
        <div className="px-3 pb-3 border-b border-slate-100">
          <button
            onClick={onToggleBrowse}
            className="flex items-center justify-between w-full text-left rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
          >
            <span>Browse</span>
            <Chevron open={isBrowseExpanded} />
          </button>

          {isBrowseExpanded && (
            <div className="mt-1 space-y-1">
              <div className="flex items-center rounded-lg hover:bg-slate-50 transition group/row">
                <button
                  onClick={onToggleManualFolder}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left px-2 py-1.5 text-xs text-slate-600"
                >
                  <MapPinIcon className={`w-3.5 h-3.5 shrink-0 ${isManualFolderExpanded ? 'text-emerald-500' : 'text-slate-400'}`} />
                  Your waypoints
                  <span className="ml-auto text-slate-400">{manualWaypoints.length}</span>
                </button>
                {manualWaypoints.length > 0 && (
                  <button
                    onClick={onClearWaypoints}
                    title="Delete all your waypoints"
                    className="rounded-full p-1 mr-1 text-slate-300 hover:text-red-500 hover:bg-white opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition shrink-0"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {isManualFolderExpanded && (
                <div className="ml-3 pl-2 border-l border-slate-100 space-y-0.5 max-h-[150px] overflow-y-auto">
                  {manualWaypoints.length === 0 ? (
                    <p className="text-xs text-slate-400 px-2 py-1">Click the map to add one.</p>
                  ) : (
                    manualWaypoints.map(wp => (
                      <div key={`manual-wp-${wp.id}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50 group">
                        <button className="flex-1 min-w-0 text-left" onClick={() => onAddToTask(wp)}>
                          <span className="text-xs font-medium text-slate-700 truncate block">{wp.shortName}</span>
                        </button>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                          <button onClick={() => onEditWaypoint(wp)} title="Edit" className="rounded p-1 text-slate-400 hover:text-blue-600 hover:bg-white transition">
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onDeleteWaypoint(wp.id)} title="Delete" className="rounded p-1 text-slate-400 hover:text-red-500 hover:bg-white transition">
                            <TrashIcon className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => onAddToTask(wp)} title="Add to task" className="rounded p-1 text-emerald-600 hover:bg-white transition">
                            <PlusIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Region heading, then a collapsible group per area folder.
                  See lib/waypointCatalogue.ts for how this tree is built. */}
              {regions.map(region => {
                const countryOpen = expandedCountries.includes(region.name);
                const activeInCountry = region.groups
                  .reduce((n, g) => n + g.datasets.filter(d => activeDatasetIds.includes(d.id)).length, 0);
                return (
                <div key={region.name} className="pt-1">
                  <button
                    onClick={() => onToggleCountry(region.name)}
                    className="flex items-center gap-1.5 w-full text-left rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-50 transition"
                  >
                    <Chevron open={countryOpen} />
                    <span className="truncate">{region.name}</span>
                    {activeInCountry > 0 ? (
                      <span className="ml-auto shrink-0 rounded-full bg-blue-100 text-blue-700 px-1.5 text-[10px] font-medium normal-case">{activeInCountry}</span>
                    ) : (
                      <span className="ml-auto shrink-0 text-[10px] text-slate-300 normal-case">{region.groups.length}</span>
                    )}
                  </button>

                  {countryOpen && region.groups.map(group => {
                    const open = expandedRegions.includes(group.name);
                    const activeHere = group.datasets.filter(d => activeDatasetIds.includes(d.id)).length;
                    return (
                      <div key={group.name}>
                        <button
                          onClick={() => onToggleRegion(group.name)}
                          className="flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 transition"
                        >
                          <FolderIcon className={`w-3.5 h-3.5 shrink-0 ${open ? 'text-blue-500' : 'text-slate-400'}`} />
                          <span className="truncate">{group.name}</span>
                          {activeHere > 0 ? (
                            <span className="ml-auto shrink-0 rounded-full bg-blue-100 text-blue-700 px-1.5 text-[10px] font-medium">{activeHere}</span>
                          ) : (
                            <span className="ml-auto shrink-0 text-[10px] text-slate-300">{group.datasets.length}</span>
                          )}
                        </button>

                        {open && (
                          <div className="ml-3 pl-2 border-l border-slate-100 space-y-0.5">
                            {group.datasets.map(ds => (
                              <label
                                key={ds.id}
                                htmlFor={`dataset-${ds.id}`}
                                className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50 cursor-pointer transition"
                              >
                                <input
                                  id={`dataset-${ds.id}`}
                                  type="checkbox"
                                  aria-label={ds.label}
                                  className="mt-0.5 rounded border-slate-300 text-blue-600 w-3.5 h-3.5 focus:ring-blue-400 shrink-0"
                                  checked={activeDatasetIds.includes(ds.id)}
                                  onChange={() => onToggleDataset(ds.id)}
                                />
                                <span className="text-xs text-slate-600 leading-snug">{ds.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
          )}
        </div>

        {filteredWaypoints.length === 0 && (
          <p className="text-sm text-slate-400 px-4 py-4">
            {searchQuery ? 'No waypoints match.' : 'Turn on a dataset above, or import your own.'}
          </p>
        )}
        {/* Capped: some sets run to tens of thousands of points, and a DOM row
            each would hang the panel. Searching narrows it, which is what you
            would do anyway to find one waypoint among 41,000. */}
        {filteredWaypoints.length > LIST_LIMIT && (
          <p className="px-4 py-2 text-xs text-slate-500 bg-amber-50 border-b border-amber-100">
            Showing {LIST_LIMIT} of {filteredWaypoints.length.toLocaleString()} — search to narrow it down.
          </p>
        )}
        {filteredWaypoints.slice(0, LIST_LIMIT).map((wp, idx) => (
          <button
            key={`lib-${wp.id}-${idx}`}
            onClick={() => onAddToTask(wp)}
            className="w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-blue-50/50 transition group"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-slate-800 truncate">{wp.shortName}</p>
                <p className="text-xs text-slate-400 truncate">{wp.name}</p>
              </div>
              <PlusIcon className="w-4 h-4 text-blue-600 opacity-0 group-hover:opacity-100 transition shrink-0 mt-0.5" />
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
};

export default WaypointLibraryPanel;
