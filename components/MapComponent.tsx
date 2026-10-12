import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, Circle, CircleMarker, Tooltip, LayerGroup, useMap, useMapEvents, LayersControl } from 'react-leaflet';
import L from 'leaflet';
import { Waypoint, TaskPoint, TaskPointType } from '../types';
import { loadLaunchSites, launchSitesIfLoaded, sitesInBounds, type LaunchSite } from '../lib/launchSites';
import { airspaceInView, describeLimit, AIRSPACE_SOURCE, AIRSPACE_FETCHED, type Airspace } from '../lib/airspace';
import { PlusCircleIcon, TagIcon } from '@heroicons/react/24/outline';

// Fix for default marker icons in React Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Use type assertions to bypass property errors on react-leaflet components in specific environments where types may be mismatched
const MapContainerAny = MapContainer as any;
const TileLayerAny = TileLayer as any;
const MarkerAny = Marker as any;
const CircleAny = Circle as any;
const PolygonAny = Polygon as any;
const LayerGroupAny = LayerGroup as any;
const CircleMarkerAny = CircleMarker as any;
const TooltipAny = Tooltip as any;
const LayersControlAny = LayersControl as any;
const LayersControlBaseLayerAny = (LayersControl as any).BaseLayer;
const LayersControlOverlayAny = (LayersControl as any).Overlay;

interface MapComponentProps {
  waypoints: Waypoint[];
  taskPoints: TaskPoint[];
  onWaypointSelect?: (wp: Waypoint) => void;
  onMapClick?: (lat: number, lng: number) => void;
  showOptimized: boolean;
  showCenterLine: boolean;
  showLabels: boolean;
  showLaunchSites?: boolean;
  /** Supplied on the builder map, so its toggles join the same button column. */
  onToggleLabels?: () => void;
  onToggleLaunchSites?: () => void;
  isShareMode?: boolean;
  isLibraryVisible?: boolean;
  isTaskEditorVisible?: boolean;
  /** True while another view covers this map, so it can re-measure on return. */
  isHidden?: boolean;
  isQuickTaskMode?: boolean;
  quickTaskPath?: L.LatLng[];
  onMoveQuickTaskPoint?: (index: number, lat: number, lng: number) => void;
  /** Centre on the user's position once, on first load. */
  autoLocate?: boolean;
}

const MapUpdater: React.FC<{ 
  waypoints: Waypoint[]; 
  taskPoints: TaskPoint[]; 
  isShareMode: boolean;
  isLibraryVisible?: boolean;
  isTaskEditorVisible?: boolean;
  isHidden?: boolean;
}> = ({ waypoints, taskPoints, isShareMode, isLibraryVisible, isTaskEditorVisible, isHidden }) => {
  const map = useMap();

  // Fix for Leaflet "half-rendering" - Force map to re-check container size
  // We use multiple timeouts to catch the layout at different stages of the transition (0ms to 1000ms)
  useEffect(() => {
    map.invalidateSize();
    const delays = [50, 150, 300, 450, 600, 1000];
    const timers = delays.map(delay => 
      setTimeout(() => {
        map.invalidateSize();
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [map, isLibraryVisible, isTaskEditorVisible, isHidden]);

  /**
   * The builder is hidden rather than unmounted while Fly Days is open, so its
   * container drops to zero size and Leaflet keeps the stale dimensions. Coming
   * back left the map drawn at the old size — a strip of tiles and a lot of
   * grey. Watching the container catches that, and any other layout change,
   * without threading a prop through for each one.
   */
  useEffect(() => {
    const container = map.getContainer();
    let lastWidth = 0, lastHeight = 0;

    const observer = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      // Ignore the collapse to zero; only react to coming back with real size.
      if (width === 0 || height === 0) return;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width; lastHeight = height;
      map.invalidateSize();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  // Read-only previews (task summary, event screen) should frame the task they
  // were opened to show. The interactive builder deliberately never moves the
  // map on its own: switching a waypoint dataset on used to refit the view and
  // throw away wherever the user had panned to, which is disorienting mid-task.
  useEffect(() => {
    if (!isShareMode || taskPoints.length === 0) return;
    const bounds = L.latLngBounds(taskPoints.map(tp => [tp.waypoint.lat, tp.waypoint.lng]));
    if (!bounds.isValid()) return;

    // Padding is generous on purpose: a task framed edge-to-edge tells you
    // nothing about the terrain it crosses, and the cylinders get clipped.
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [60, 60] });
    };
    fit();

    // These previews open inside modals that animate in, so the container is
    // routinely still 0-height when this first runs. fitBounds on a 0-height
    // box clamps to maxZoom — a 14km task was being framed at zoom 17, about
    // 700m across — and nothing refit it once the container settled. Refit
    // while the container is still changing size, then leave the view alone so
    // a pilot's own panning survives.
    let settled = false;
    const observer = new ResizeObserver(() => { if (!settled) fit(); });
    observer.observe(map.getContainer());
    const stopRefitting = setTimeout(() => { settled = true; observer.disconnect(); }, 1200);

    return () => { clearTimeout(stopRefitting); observer.disconnect(); };
  }, [taskPoints, map, isShareMode]);

  useEffect(() => {
    const handleResize = () => map.invalidateSize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [map]);

  return null;
};

const MapEvents: React.FC<{ 
  onMapClick?: (lat: number, lng: number) => void,
  onContextMenu?: (lat: number, lng: number, x: number, y: number) => void,
  onClearMenu?: () => void
}> = ({ onMapClick, onContextMenu, onClearMenu }) => {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng);
      onClearMenu?.();
    },
    contextmenu(e) {
      onContextMenu?.(e.latlng.lat, e.latlng.lng, e.containerPoint.x, e.containerPoint.y);
    },
    dragstart() {
      onClearMenu?.();
    },
    zoomstart() {
      onClearMenu?.();
    }
  });
  return null;
};

/**
 * Launch sites, from the baked-in ParaglidingEarth snapshot.
 *
 * A wing glyph rather than a pin: these aren't task points and shouldn't read
 * like one. Kept below the route in z-order and shown only from zoom 9 in — at
 * a national view 149 of them turn the map into confetti and tell you nothing.
 */
const LAUNCH_MIN_ZOOM = 9;
/** Close enough that a name label fits without colliding with its neighbours. */
const LAUNCH_LABEL_ZOOM = 11;

const launchIcon = L.divIcon({
  className: '',
  html:
    '<div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;' +
    'filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));">' +
    '<svg viewBox="0 0 20 20" width="24" height="24" aria-hidden="true">' +
    '<path d="M2.6 6.4 A8.6 8.6 0 0 1 17.4 6.4 L10 15.4 Z" ' +
    'fill="#0d9488" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>' +
    '</svg></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 18],
});


/**
 * Airspace overlay.
 *
 * ADVISORY ONLY — a dated snapshot with boundaries simplified to about 50 m.
 * The popup says so, because a blue polygon on a map looks authoritative
 * whether or not it is.
 *
 * Only what is on screen is drawn, and only from zoom 8 in: the full set is
 * ~15,000 polygons and drawing them all would stop the map dead.
 */
const AIRSPACE_MIN_ZOOM = 8;

/** Colour by how much it matters to a free-flight pilot, not by ICAO class. */
function airspaceStyle(a: Airspace): { color: string; weight: number } {
  if (a.type === 3) return { color: '#dc2626', weight: 2 };            // Prohibited
  if (a.type === 1 || a.type === 2) return { color: '#ea580c', weight: 1.8 }; // Restricted / Danger
  if (a.type === 21 || a.type === 28) return { color: '#16a34a', weight: 1.5 }; // Gliding / sporting
  return { color: '#2563eb', weight: 1.5 };                            // Controlled and everything else
}

const AirspaceLayer: React.FC<{ visible: boolean }> = ({ visible }) => {
  const map = useMap();
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));
  const [spaces, setSpaces] = useState<Airspace[]>([]);

  useMapEvents({
    zoomend() { setView({ zoom: map.getZoom(), bounds: map.getBounds() }); },
    moveend() { setView({ zoom: map.getZoom(), bounds: map.getBounds() }); },
  });

  const active = visible && view.zoom >= AIRSPACE_MIN_ZOOM;

  useEffect(() => {
    if (!active) { setSpaces([]); return; }
    let cancelled = false;
    const b = view.bounds;
    airspaceInView(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())
      .then(found => { if (!cancelled) setSpaces(found); })
      .catch(() => { if (!cancelled) setSpaces([]); });
    return () => { cancelled = true; };
  }, [active, view]);

  if (!active) return null;

  return (
    <>
      {spaces.map((a, i) => {
        const { color, weight } = airspaceStyle(a);
        return a.rings.map((ring, r) => (
          <PolygonAny
            key={`as-${i}-${r}`}
            positions={ring}
            pathOptions={{ color, weight, fillColor: color, fillOpacity: 0.07 }}
          >
            <Popup>
              <div className="text-sm font-sans">
                <p className="font-bold">{a.name}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {describeLimit(a.lower)} &rarr; {describeLimit(a.upper)}
                </p>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Advisory only &middot; {AIRSPACE_SOURCE} {AIRSPACE_FETCHED} &middot; check the AIP
                </p>
              </div>
            </Popup>
          </PolygonAny>
        ));
      })}
    </>
  );
};

/** Reports the map's view to the parent so markers can be culled to what's on screen. */
const ViewTracker: React.FC<{ onChange: (v: { zoom: number; bounds: L.LatLngBounds }) => void }> = ({ onChange }) => {
  const map = useMap();
  useEffect(() => { onChange({ zoom: map.getZoom(), bounds: map.getBounds() }); }, [map, onChange]);
  useMapEvents({
    moveend() { onChange({ zoom: map.getZoom(), bounds: map.getBounds() }); },
    zoomend() { onChange({ zoom: map.getZoom(), bounds: map.getBounds() }); },
  });
  return null;
};

const LaunchSiteLayer: React.FC<{ visible: boolean }> = ({ visible }) => {
  const map = useMap();
  const [sites, setSites] = useState<LaunchSite[] | null>(launchSitesIfLoaded());
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));

  useMapEvents({
    zoomend() { setView({ zoom: map.getZoom(), bounds: map.getBounds() }); },
    moveend() { setView({ zoom: map.getZoom(), bounds: map.getBounds() }); },
  });

  // The snapshot is a lazy chunk, so it's only fetched once someone zooms in
  // far enough to actually want it.
  const wanted = visible && view.zoom >= LAUNCH_MIN_ZOOM;
  useEffect(() => {
    if (!wanted || sites) return;
    let cancelled = false;
    loadLaunchSites().then(s => { if (!cancelled) setSites(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [wanted, sites]);

  // 11,500 markers would bring the map to its knees; only what's on screen is
  // drawn, which at zoom 9+ is a handful.
  const onScreen = useMemo(() => {
    if (!wanted || !sites) return [];
    const b = view.bounds;
    return sitesInBounds(sites, b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  }, [wanted, sites, view]);

  if (onScreen.length === 0) return null;

  return (
    <>
      {onScreen.map((site) => (
        <MarkerAny
          key={`launch-${site.lat}-${site.lng}-${site.name}`}
          position={[site.lat, site.lng]}
          icon={launchIcon}
          // Above the waypoint pins: a launch tucked under a library marker is
          // one the pilot will swear isn't there.
          zIndexOffset={2000}
          eventHandlers={{ click: (e: any) => L.DomEvent.stopPropagation(e) }}
        >
          {/* Named outright once you're close enough for the label to fit —
              a bare glyph among the waypoint pins is easy to miss. */}
          <TooltipAny
            permanent={view.zoom >= LAUNCH_LABEL_ZOOM}
            direction="top"
            offset={[0, -14]}
            className="leaflet-tooltip-launch"
          >
            {site.name}
          </TooltipAny>
        </MarkerAny>
      ))}
    </>
  );
};

// Drawn-route handle. 28px of tappable area around a 14px dot, so it can be
// grabbed with a finger without making the dot itself look heavy.
const quickTaskPointIcon = L.divIcon({
  className: '',
  html: '<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;">'
      + '<div style="width:14px;height:14px;border-radius:50%;background:#ef4444;border:2.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);"></div>'
      + '</div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/** "Centre on me" button, plus the one-off locate when the app first opens. */
const LocateControl: React.FC<{ map: L.Map | null; autoLocate: boolean }> = ({ map, autoLocate }) => {
  const [busy, setBusy] = useState(false);
  const askedRef = useRef(false);

  const locate = (announceFailure: boolean) => {
    if (!map) return;
    if (!navigator.geolocation) {
      if (announceFailure) alert('This browser cannot report your location.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        map.setView([pos.coords.latitude, pos.coords.longitude], 12);
      },
      () => {
        setBusy(false);
        // On first load a denial is expected and silent — nagging about a
        // permission the user just refused would be rude.
        if (announceFailure) alert('Could not get your location. Check location permission for this site.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    if (!map || !autoLocate || askedRef.current) return;
    askedRef.current = true;
    locate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, autoLocate]);

  return (
    <button
      onClick={() => locate(true)}
      disabled={!map}
      title="Centre on my location"
      className={`rounded-full p-2.5 shadow-sm border bg-white border-slate-200 transition ${busy ? 'text-blue-600 animate-pulse' : 'text-slate-500 hover:bg-slate-50'}`}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="3.5" />
        <circle cx="12" cy="12" r="8" opacity="0.45" />
        <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
      </svg>
    </button>
  );
};

/** Hands the Leaflet map instance out to the overlay controls, which render
    outside MapContainer and so have no Leaflet context of their own. */
const MapRefCapture: React.FC<{ onReady: (map: L.Map) => void }> = ({ onReady }) => {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
};

const getPointColor = (type: TaskPointType) => {
  switch (type) {
    case TaskPointType.TAKEOFF: return '#94a3b8';
    case TaskPointType.SSS: return '#ef4444';
    case TaskPointType.GOAL: return '#22c55e';
    case TaskPointType.ESS: return '#3b82f6';
    default: return '#6366f1';
  }
};

type MapLayerType = 'streets' | 'topo' | 'satellite';

const MapComponent: React.FC<MapComponentProps> = ({ 
  waypoints, 
  taskPoints, 
  onWaypointSelect, 
  onMapClick,
  showOptimized,
  showCenterLine,
  showLabels,
  showLaunchSites = false,
  onToggleLabels,
  onToggleLaunchSites,
  isShareMode = false,
  isLibraryVisible,
  isTaskEditorVisible,
  isHidden = false,
  isQuickTaskMode = false,
  quickTaskPath = [],
  onMoveQuickTaskPoint,
  autoLocate = false,
}) => {
  const [mapLayer, setMapLayer] = useState<MapLayerType>('topo');
  const [contextMenu, setContextMenu] = useState<{lat: number, lng: number, x: number, y: number} | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [mapView, setMapView] = useState<{ zoom: number; bounds: L.LatLngBounds } | null>(null);
  /**
   * How much to thicken skyways/thermals, 0-100, for when a handful of faint
   * tracks is all there is. 0 leaves them exactly as they come.
   */
  const [boldLevel, setBoldLevel] = useState(0);
  /** How solid those layers are drawn, 0-100. 60 is how they have always looked. */
  const [kk7Opacity, setKk7Opacity] = useState(60);
  /** True while the map is being dragged or zoomed — see .kk7-moving. */
  const [mapMoving, setMapMoving] = useState(false);
  /** Where in Leaflet's layer menu the sliders are rendered. */
  const [sliderHost, setSliderHost] = useState<HTMLDivElement | null>(null);
  /** Which of the two kk7 overlays are switched on, so the button only shows when one is. */
  const [kk7Layers, setKk7Layers] = useState<string[]>([]);

  /**
   * Only draw library waypoints that are on screen.
   *
   * Some published sets are enormous — the Alps mountain-peak database is 41,000
   * points — and a marker each would lock the browser up. A task point is always
   * drawn regardless, since it belongs to the route rather than the library.
   */
  const visibleWaypoints = useMemo(() => {
    // Comfortably above any real competition set (the largest is ~215) so this
    // only ever bites on the peak databases, and low enough to stay smooth on a
    // phone.
    const MAX_MARKERS = 750;
    if (!mapView || waypoints.length <= MAX_MARKERS) return waypoints;
    const b = mapView.bounds;
    const inView = waypoints.filter(wp =>
      wp.lat >= b.getSouth() && wp.lat <= b.getNorth() &&
      wp.lng >= b.getWest() && wp.lng <= b.getEast());
    // Still too many even zoomed in (a dense peak database) — draw a capped
    // subset rather than freezing. Zooming further thins it out naturally.
    return inView.length > MAX_MARKERS ? inView.slice(0, MAX_MARKERS) : inView;
  }, [waypoints, mapView]);

  const centerCoords: [number, number][] = taskPoints.map(tp => [tp.waypoint.lat, tp.waypoint.lng]);
  
  const optimizedPath = useMemo(() => {
    if (taskPoints.length < 2) return [];
    
    let pts = taskPoints.map(tp => L.latLng(tp.waypoint.lat, tp.waypoint.lng));
    const iterations = 5;
    for (let iter = 0; iter < iterations; iter++) {
      const newPts = [...pts];
      for (let i = 0; i < taskPoints.length; i++) {
        const tp = taskPoints[i];
        const center = L.latLng(tp.waypoint.lat, tp.waypoint.lng);
        const radius = tp.radius;

        let target: L.LatLng;
        if (i === 0) {
          target = pts[i + 1];
        } else if (i === taskPoints.length - 1) {
          target = pts[i - 1];
        } else {
          target = L.latLng(
            (pts[i - 1].lat + pts[i + 1].lat) / 2,
            (pts[i - 1].lng + pts[i + 1].lng) / 2
          );
        }

        const dist = center.distanceTo(target);
        if (dist > 0) {
          const ratio = radius / dist;
          newPts[i] = L.latLng(
            center.lat + (target.lat - center.lat) * ratio,
            center.lng + (target.lng - center.lng) * ratio
          );
        }
      }
      pts = newPts;
    }
    return pts;
  }, [taskPoints]);

  /** Halo radius in pixels at the current setting. */
  const kk7Spread = (boldLevel / 100) * 5;
  const kk7Words = boldLevel === 0 ? 'Normal'
    : boldLevel < 25 ? 'Light'
    : boldLevel < 50 ? 'Medium'
    : boldLevel < 80 ? 'Bold'
    : 'Boldest';
  const kk7FadeWords = kk7Opacity < 20 ? 'See-through'
    : kk7Opacity < 45 ? 'Faint'
    : kk7Opacity < 80 ? 'Medium'
    : 'Solid';

  useEffect(() => {
    if (!mapInstance) return;
    const start = () => setMapMoving(true);
    const stop = () => setMapMoving(false);
    mapInstance.on('movestart', start);
    mapInstance.on('zoomstart', start);
    mapInstance.on('moveend', stop);
    mapInstance.on('zoomend', stop);
    return () => {
      mapInstance.off('movestart', start);
      mapInstance.off('zoomstart', start);
      mapInstance.off('moveend', stop);
      mapInstance.off('zoomend', stop);
    };
  }, [mapInstance]);

  // The sliders belong with the layers they affect, so they are rendered into
  // Leaflet's own layer menu rather than floating over the map.
  useEffect(() => {
    if (!mapInstance) return;
    const list = mapInstance.getContainer().querySelector('.leaflet-control-layers-list');
    if (!list) return;
    const host = document.createElement('div');
    host.className = 'kk7-control-slider';
    // Without this, dragging the slider drags the map and a scroll zooms it.
    L.DomEvent.disableClickPropagation(host);
    L.DomEvent.disableScrollPropagation(host);
    list.appendChild(host);
    setSliderHost(host);
    return () => { host.remove(); setSliderHost(null); };
  }, [mapInstance]);

  // The overlays are toggled in Leaflet's own layer menu, so the only way to
  // know they're on is to listen to it.
  useEffect(() => {
    if (!mapInstance) return;
    const isKk7 = (name: string) => name === 'Skyways' || name === 'Thermals';
    const add = (e: any) => { if (isKk7(e.name)) setKk7Layers(prev => prev.includes(e.name) ? prev : [...prev, e.name]); };
    const remove = (e: any) => { if (isKk7(e.name)) setKk7Layers(prev => prev.filter(n => n !== e.name)); };
    mapInstance.on('overlayadd', add);
    mapInstance.on('overlayremove', remove);
    return () => { mapInstance.off('overlayadd', add); mapInstance.off('overlayremove', remove); };
  }, [mapInstance]);

  return (
    <div className={[
        'w-full h-full relative group kk7-tune',
        boldLevel > 0 && (boldLevel >= 50 ? 'kk7-boost-round' : 'kk7-boost'),
        mapMoving && 'kk7-moving',
      ].filter(Boolean).join(' ')}
      style={{
        // Read by the .kk7-tune/.kk7-boost rules in index.html.
        '--kk7-r': `${kk7Spread}px`,
        '--kk7-nr': `${-kk7Spread}px`,
        '--kk7-d': `${kk7Spread * 0.7}px`,
        '--kk7-nd': `${-kk7Spread * 0.7}px`,
        '--kk7-op': kk7Opacity / 100,
      } as React.CSSProperties}>
      <MapContainerAny
        center={[-41.3, 173.2]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        className="z-0"
      >
        <LayersControlAny position="topleft">
          <LayersControlBaseLayerAny checked={mapLayer === 'streets'} name="Streets">
            <TileLayerAny
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControlBaseLayerAny>
          <LayersControlBaseLayerAny checked={mapLayer === 'topo'} name="Topographic">
            <TileLayerAny
              attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              maxZoom={17}
            />
          </LayersControlBaseLayerAny>
          <LayersControlBaseLayerAny checked={mapLayer === 'satellite'} name="Satellite">
            <TileLayerAny
              attribution='Tiles &copy; Esri'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          </LayersControlBaseLayerAny>

          <LayersControlOverlayAny name="Airspace">
            <LayerGroupAny>
              <AirspaceLayer visible={true} />
            </LayerGroupAny>
          </LayersControlOverlayAny>

          <LayersControlOverlayAny name="Skyways">
            <TileLayerAny
              attribution='&copy; <a href="https://thermal.kk7.ch">thermal.kk7.ch</a>'
              url="https://thermal.kk7.ch/tiles/skyways_all_all/{z}/{x}/{-y}.png?src=nbparagliding.nz"
              className="kk7-skyways"
              maxNativeZoom={13}
              opacity={0.6}
            />
          </LayersControlOverlayAny>

          <LayersControlOverlayAny name="Thermals">
            <TileLayerAny
              attribution='&copy; <a href="https://thermal.kk7.ch">thermal.kk7.ch</a>'
              url="https://thermal.kk7.ch/tiles/thermals_all_all/{z}/{x}/{-y}.png?src=nbparagliding.nz"
              className="kk7-thermals"
              maxNativeZoom={12}
              opacity={0.6}
            />
          </LayersControlOverlayAny>
          </LayersControlAny>
        
        {/* Only while one of those layers is on — it has nothing to act on otherwise. */}
        {sliderHost && kk7Layers.length > 0 && createPortal(
          <>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-slate-600">Thickness</span>
              <span className="text-[11px] text-slate-400">{kk7Words}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Thin line to thick line, so which way is bolder is obvious. */}
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-slate-400 shrink-0" aria-hidden="true">
                <path d="M1 5 H9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={boldLevel}
                onChange={(e) => setBoldLevel(Number(e.target.value))}
                aria-label={`Thickness of ${kk7Layers.join(' and ')}`}
                className="kk7-slider cursor-pointer"
              />
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-slate-500 shrink-0" aria-hidden="true">
                <path d="M1 5 H9" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
              </svg>
            </div>

            <div className="flex items-center justify-between mt-2 mb-1">
              <span className="text-[11px] font-semibold text-slate-600">Transparency</span>
              <span className="text-[11px] text-slate-400">{kk7FadeWords}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Faded square to solid square: left is see-through. */}
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-slate-400 shrink-0" aria-hidden="true">
                <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.25" />
              </svg>
              <input
                type="range"
                min={5}
                max={100}
                step={1}
                value={kk7Opacity}
                onChange={(e) => setKk7Opacity(Number(e.target.value))}
                aria-label={`How solid ${kk7Layers.join(' and ')} are drawn`}
                className="kk7-slider cursor-pointer"
              />
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-slate-500 shrink-0" aria-hidden="true">
                <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            </div>
          </>,
          sliderHost,
        )}

        {!isShareMode && (
          <MapEvents 
            onMapClick={onMapClick} 
            onContextMenu={isQuickTaskMode ? undefined : (lat, lng, x, y) => setContextMenu({lat, lng, x, y})}
            onClearMenu={() => setContextMenu(null)}
          />
        )}
        
        <LaunchSiteLayer visible={showLaunchSites && !isShareMode} />

        <ViewTracker onChange={setMapView} />

        {visibleWaypoints.map((wp, idx) => {
          const isPartOfTask = taskPoints.some(tp => tp.waypoint.id === wp.id);
          if (isShareMode && isPartOfTask) return null;

          return (
            <MarkerAny 
              key={`marker-lib-${wp.id}-${idx}`} 
              position={[wp.lat, wp.lng]}
              opacity={isShareMode ? 0.05 : 1}
              eventHandlers={{
                click: (e: any) => {
                  L.DomEvent.stopPropagation(e);
                  setContextMenu(null);
                  if (isQuickTaskMode) onMapClick?.(wp.lat, wp.lng);
                },
              }}
            >
              {showLabels && !isShareMode && (
                <TooltipAny permanent direction="right" offset={[8, -8]} className="leaflet-tooltip-own">
                  {wp.shortName}
                </TooltipAny>
              )}
              {!isShareMode && !isQuickTaskMode && (
                <Popup>
                  <div className="text-sm font-sans">
                    <p className="font-bold">{wp.shortName}</p>
                    <p>{wp.name}</p>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onWaypointSelect?.(wp); }}
                      className="mt-2 bg-indigo-600 text-white px-2 py-1 rounded text-xs w-full hover:bg-indigo-700"
                    >
                      Add to Task
                    </button>
                  </div>
                </Popup>
              )}
            </MarkerAny>
          );
        })}

        {taskPoints.map((tp, idx) => {
          const labelIcon = L.divIcon({
            className: 'task-label-icon',
            html: `<span>${idx + 1}</span>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });

          return (
            <React.Fragment key={`task-pt-${tp.id}-${idx}`}>
              <CircleAny
                center={[tp.waypoint.lat, tp.waypoint.lng]}
                radius={tp.radius}
                pathOptions={{
                  color: getPointColor(tp.type),
                  // 0.1 all but vanished over satellite and busy topo tiles;
                  // 0.18 was still hard to pick out against green terrain.
                  fillOpacity: 0.3,
                  weight: 2
                }}
              />
              <MarkerAny 
                position={[tp.waypoint.lat, tp.waypoint.lng]} 
                icon={labelIcon}
                interactive={!isShareMode}
              >
                {showLabels && (
                  <TooltipAny permanent direction="right" offset={[8, -8]} className="leaflet-tooltip-own">
                     {tp.waypoint.shortName}
                  </TooltipAny>
                )}
              </MarkerAny>
            </React.Fragment>
          );
        })}

        {isQuickTaskMode && quickTaskPath.length > 0 && (
          <>
            <Polyline
              positions={quickTaskPath}
              pathOptions={{ color: '#ef4444', weight: 5, opacity: 0.95, dashArray: '12, 8', lineCap: 'round' }}
            />
            {quickTaskPath.map((p, i) => (
              // Markers rather than CircleMarkers: Leaflet only supports dragging
              // on Markers, and these need to be movable after they are placed.
              // The icon is sized generously for a fingertip.
              <MarkerAny
                key={`qt-path-${i}`}
                position={p}
                draggable={true}
                icon={quickTaskPointIcon}
                zIndexOffset={1000}
                eventHandlers={{
                  // `drag` keeps the route line bending under the finger as it
                  // moves; `dragend` is the backstop so the final position is
                  // committed even if intermediate events are missed.
                  drag: (e: any) => {
                    const ll = e.target.getLatLng();
                    onMoveQuickTaskPoint?.(i, ll.lat, ll.lng);
                  },
                  dragend: (e: any) => {
                    const ll = e.target.getLatLng();
                    onMoveQuickTaskPoint?.(i, ll.lat, ll.lng);
                  },
                }}
              />
            ))}
          </>
        )}

        {showCenterLine && centerCoords.length > 1 && (
          <Polyline 
            positions={centerCoords} 
            pathOptions={{ color: '#94a3b8', weight: 1, dashArray: '5, 10' }} 
          />
        )}

        {showOptimized && optimizedPath.length > 1 && (
          <Polyline 
            positions={optimizedPath} 
            pathOptions={{ color: '#4f46e5', weight: 4, lineJoin: 'round' }} 
          />
        )}

        <MapRefCapture onReady={setMapInstance} />
        <MapUpdater 
          waypoints={waypoints} 
          taskPoints={taskPoints} 
          isShareMode={isShareMode} 
          isLibraryVisible={isLibraryVisible}
          isTaskEditorVisible={isTaskEditorVisible}
          isHidden={isHidden}
        />
      </MapContainerAny>

      {contextMenu && !isQuickTaskMode && (
        <div 
          className="absolute z-[2000] bg-white shadow-2xl rounded-xl border border-indigo-50 py-1 min-w-[140px] animate-in fade-in zoom-in duration-150"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button 
            type="button"
            className="w-full text-left px-4 py-2 text-[10px] font-black uppercase text-indigo-600 hover:bg-indigo-50 transition flex items-center gap-2"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (contextMenu) {
                onMapClick?.(contextMenu.lat, contextMenu.lng);
              }
              setContextMenu(null);
            }}
          >
            <PlusCircleIcon className="w-4 h-4" /> Add Waypoint
          </button>
        </div>
      )}

      {!isShareMode && (
        <>
          {/* One column for every round map button, on the right. Leaflet owns
              the left side (zoom, layers); splitting ours across both meant
              hand-matching offsets against Leaflet's stack, which is how the
              locate button ended up on top of the zoom control. */}
          <div className="absolute top-4 right-16 z-[1000] flex flex-col items-end gap-1.5">
            <LocateControl map={mapInstance} autoLocate={autoLocate} />
            {onToggleLabels && (
              <button
                onClick={onToggleLabels}
                title={showLabels ? 'Hide labels' : 'Show labels'}
                className={`rounded-full p-2.5 shadow-sm border transition ${
                  showLabels ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <TagIcon className="w-4 h-4" />
              </button>
            )}
            {onToggleLaunchSites && (
              <button
                onClick={onToggleLaunchSites}
                title={showLaunchSites ? 'Hide launch sites' : 'Show launch sites'}
                className={`rounded-full p-2.5 shadow-sm border transition ${
                  showLaunchSites ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden="true">
                  <path d="M2.6 6.4 A8.6 8.6 0 0 1 17.4 6.4 L10 15.4 Z" fill="currentColor" />
                </svg>
              </button>
            )}
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex bg-white/90 backdrop-blur shadow-lg rounded-full border border-slate-200 p-1 gap-0.5">
            {(['streets', 'topo', 'satellite'] as const).map(layer => (
              <button
                key={layer}
                onClick={() => setMapLayer(layer)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition ${
                  mapLayer === layer ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                {layer === 'streets' ? 'Streets' : layer === 'topo' ? 'Topo' : 'Satellite'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default MapComponent;