import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap, useMapEvents, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import type { SharedTask } from '../lib/dbTypes';
import { computeOptimizedPoints } from '../lib/taskGeometry';
import { assignTaskColors } from '../lib/taskColors';

// react-leaflet's generated prop types don't line up in this setup (same
// workaround MapComponent.tsx uses).
const MapContainerAny = MapContainer as any;
const TileLayerAny = TileLayer as any;
const PolylineAny = Polyline as any;
const CircleMarkerAny = CircleMarker as any;
const TooltipAny = Tooltip as any;
const LayersControlAny = LayersControl as any;
const BaseLayerAny = (LayersControl as any).BaseLayer;

export interface TaskRoute {
  task: SharedTask;
  points: L.LatLng[];
  start: L.LatLng;
  color: string;
}

/** Precomputes the drawable geometry for each task once, rather than per render. */
export function buildTaskRoutes(tasks: SharedTask[]): TaskRoute[] {
  const drawable = tasks.filter(t => Array.isArray(t.points) && t.points.length >= 2);
  const colors = assignTaskColors(drawable.map(t => t.id));
  return drawable.map(task => {
    const points = computeOptimizedPoints(task.points);
    return { task, points, start: points[0], color: colors.get(task.id)! };
  });
}

const FitToRoutes: React.FC<{ routes: TaskRoute[]; selectedId: string | null }> = ({ routes, selectedId }) => {
  const map = useMap();

  // The map mounts inside a flex column that has no height until layout settles,
  // so Leaflet's first viewport measurement is 0x0 and every projected point
  // lands on the same pixel. Re-measure once the container has real dimensions
  // before any fitBounds runs, otherwise the routes draw as a dot at the origin.
  useEffect(() => {
    const settle = () => map.invalidateSize();
    const raf = requestAnimationFrame(settle);
    const timer = window.setTimeout(settle, 250);
    window.addEventListener('resize', settle);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener('resize', settle);
    };
  }, [map]);

  /**
   * Zoom to a task when the SELECTION changes — not whenever `routes` does.
   *
   * `routes` is a fresh array on every render, and with "search this area" on,
   * panning re-filters it. Depending on it meant every pan snapped the map back
   * to the selected task, so the map could not be moved at all.
   *
   * The bottom padding keeps the route clear of the detail panel that slides
   * over the lower part of the map once something is selected — without it the
   * end of the task sits behind the panel.
   */
  const fittedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) { fittedIdRef.current = null; return; }
    if (fittedIdRef.current === selectedId) return;
    const route = routes.find(r => r.task.id === selectedId);
    if (!route) return;

    fittedIdRef.current = selectedId;
    map.invalidateSize();
    const height = map.getSize().y;
    const panelInset = Math.min(Math.round(height * 0.46), 260);
    map.fitBounds(L.latLngBounds(route.points), {
      animate: true,
      paddingTopLeft: [30, 30],
      paddingBottomRight: [30, panelInset + 20],
    });
  }, [selectedId, routes, map]);

  // Frame everything once, the first time we have routes to show. This must not
  // re-run whenever the visible set changes: with "search this area" active,
  // refitting would move the map, which re-filters by the new bounds, which
  // changes the set again — the map would fight the user as they pan.
  const hasFramedRef = useRef(false);
  useEffect(() => {
    if (hasFramedRef.current || selectedId || routes.length === 0) return;
    const all = routes.flatMap(r => r.points);
    if (all.length === 0) return;
    hasFramedRef.current = true;
    const frame = () => {
      map.invalidateSize();
      map.fitBounds(L.latLngBounds(all).pad(0.15), { animate: false });
    };
    const raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes.length]);

  return null;
};

const BoundsReporter: React.FC<{ onBoundsChange: (b: L.LatLngBounds) => void }> = ({ onBoundsChange }) => {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
    zoomend: () => onBoundsChange(map.getBounds()),
  });

  // Report the starting viewport too. Without this, `bounds` stays null until the
  // user happens to pan or zoom, and "search this area" silently matches
  // everything on first click — it looks broken rather than filtering.
  useEffect(() => {
    const report = () => onBoundsChange(map.getBounds());
    const raf = requestAnimationFrame(report);
    // Re-report after the initial fitBounds has settled the viewport.
    const timer = window.setTimeout(report, 400);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [map, onBoundsChange]);

  return null;
};

interface TaskDiscoveryMapProps {
  routes: TaskRoute[];
  selectedId: string | null;
  onSelect: (taskId: string) => void;
  onBoundsChange?: (bounds: L.LatLngBounds) => void;
  /** Task ids that have an upcoming fly day — drawn with a ring so they stand out. */
  scheduledTaskIds?: Set<string>;
}

const TaskDiscoveryMap: React.FC<TaskDiscoveryMapProps> = ({ routes, selectedId, onSelect, onBoundsChange, scheduledTaskIds }) => {
  // Draw the selected route last so its bolder line sits above its neighbours.
  const ordered = useMemo(
    () => [...routes].sort((a, b) => (a.task.id === selectedId ? 1 : 0) - (b.task.id === selectedId ? 1 : 0)),
    [routes, selectedId],
  );

  return (
    <MapContainerAny center={[-41.3, 173.2]} zoom={9} style={{ height: '100%', width: '100%' }} className="z-0">
      <LayersControlAny position="topright">
        <BaseLayerAny checked name="Streets">
          <TileLayerAny
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </BaseLayerAny>
        <BaseLayerAny name="Topographic">
          <TileLayerAny
            attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            maxZoom={17}
          />
        </BaseLayerAny>
        <BaseLayerAny name="Satellite">
          <TileLayerAny
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </BaseLayerAny>
      </LayersControlAny>

      <FitToRoutes routes={routes} selectedId={selectedId} />
      {onBoundsChange && <BoundsReporter onBoundsChange={onBoundsChange} />}

      {ordered.map(({ task, points, start, color }) => {
        const isSelected = task.id === selectedId;
        const dimmed = selectedId !== null && !isSelected;
        const isScheduled = scheduledTaskIds?.has(task.id) ?? false;
        return (
          <React.Fragment key={task.id}>
            {/* Halo behind the start dot marks a task someone has scheduled a day for. */}
            {isScheduled && (
              <CircleMarkerAny
                center={start}
                radius={isSelected ? 14 : 11}
                interactive={false}
                pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: dimmed ? 0.08 : 0.18 }}
              />
            )}
            <PolylineAny
              positions={points}
              pathOptions={{
                color,
                weight: isSelected ? 5 : 2.5,
                opacity: dimmed ? 0.35 : 0.9,
              }}
              eventHandlers={{ click: () => onSelect(task.id) }}
            >
              <TooltipAny sticky>
                <span className="font-medium">{task.name}</span>
                <br />
                {task.distance_optimized_km ?? '?'} km
              </TooltipAny>
            </PolylineAny>

            <CircleMarkerAny
              center={start}
              radius={isSelected ? 8 : 5}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: color,
                fillOpacity: dimmed ? 0.45 : 1,
              }}
              eventHandlers={{ click: () => onSelect(task.id) }}
            >
              <TooltipAny direction="top" offset={[0, -8]}>
                <span className="font-medium">{task.name}</span>
                <br />
                Start · {task.distance_optimized_km ?? '?'} km
              </TooltipAny>
            </CircleMarkerAny>
          </React.Fragment>
        );
      })}
    </MapContainerAny>
  );
};

export default TaskDiscoveryMap;
