import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { GpuVectorParticleLayerV2 } from './engine/GpuVectorParticleLayerV2.js';
import { ServerFieldClient } from './engine/ServerFieldClient.js';

const SITE = { lon: -5.979353098143796, lat: 40.13618392931326 };
const DEM_URL = 'https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png';
const ORTHO_URL = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg';
const BASE_URL = 'https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{y}.jpeg';
const TERRAIN_SOURCE_ID = 'terrain-3d';
const HILLSHADE_SOURCE_ID = 'terrain-hillshade';
const PARTICLE_LAYER_ID = 'pitoviento-server-vector-particles-v2';

function mapStyle() {
  return {
    version: 8,
    sources: {
      ignbase: { type: 'raster', tiles: [BASE_URL], tileSize: 256, scheme: 'tms', maxzoom: 18 },
      pnoa: { type: 'raster', tiles: [ORTHO_URL], tileSize: 256, scheme: 'tms', maxzoom: 19 },
      [TERRAIN_SOURCE_ID]: { type: 'raster-dem', tiles: [DEM_URL], tileSize: 512, minzoom: 5, maxzoom: 15, encoding: 'mapbox' },
      [HILLSHADE_SOURCE_ID]: { type: 'raster-dem', tiles: [DEM_URL], tileSize: 512, minzoom: 5, maxzoom: 15, encoding: 'mapbox' }
    },
    layers: [
      { id: 'base', type: 'raster', source: 'ignbase', paint: { 'raster-opacity': 1 } },
      { id: 'ortho', type: 'raster', source: 'pnoa', paint: { 'raster-opacity': 0.74, 'raster-saturation': -0.08, 'raster-contrast': 0.10 } },
      { id: 'hillshade', type: 'hillshade', source: HILLSHADE_SOURCE_ID, paint: { 'hillshade-exaggeration': 0.42, 'hillshade-shadow-color': '#071017', 'hillshade-highlight-color': '#fff4d8', 'hillshade-accent-color': '#3b4a54' } }
    ]
  };
}

function applyAtmosphere(map) {
  if (typeof map.setSky !== 'function') return;
  try {
    map.setSky({
      'sky-color': '#7eb9ef',
      'sky-horizon-blend': 0.28,
      'horizon-color': '#dceeff',
      'horizon-fog-blend': 0.22,
      'fog-color': '#eff7ff',
      'fog-ground-blend': 0.12
    });
  } catch (error) {
    console.warn('No se pudo activar la atmósfera:', error);
  }
}

export default function ServerFieldApp() {
  const mapRef = useRef(null);
  const particleLayerRef = useRef(null);
  const latestFieldRef = useRef(null);
  const requestAbortRef = useRef(null);
  const [direction, setDirection] = useState(315);
  const [speed, setSpeed] = useState(20);
  const [stability, setStability] = useState('neutral');
  const [nonce, setNonce] = useState(0);
  const [mapStatus, setMapStatus] = useState('Inicializando mapa base…');
  const [mapError, setMapError] = useState('');
  const [terrainStatus, setTerrainStatus] = useState('Relieve pendiente…');
  const [terrainError, setTerrainError] = useState('');
  const [gpuStatus, setGpuStatus] = useState('Renderer de partículas pendiente…');
  const [gpuError, setGpuError] = useState('');
  const [apiStatus, setApiStatus] = useState('Preparando petición al servidor…');
  const [apiError, setApiError] = useState('');
  const [fieldApplied, setFieldApplied] = useState(false);
  const client = useMemo(() => new ServerFieldClient(), []);
  const apiLabel = import.meta.env.VITE_WIND_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : 'mismo dominio · /api');

  useEffect(() => {
    let mounted = true;
    let map;
    let terrainAttempted = false;
    let gpuAttempted = false;
    let fallbackTimer;

    try {
      map = new maplibregl.Map({
        container: 'serverFieldMap',
        style: mapStyle(),
        center: [SITE.lon, SITE.lat],
        zoom: 10.15,
        pitch: 66,
        bearing: 28,
        maxPitch: 85,
        maxZoom: 18,
        hash: false,
        canvasContextAttributes: {
          antialias: true,
          contextType: 'webgl2',
          powerPreference: 'high-performance'
        }
      });
    } catch (mapInitError) {
      setMapError(mapInitError instanceof Error ? mapInitError.message : String(mapInitError));
      setMapStatus('No se pudo crear el mapa base.');
      return undefined;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    const markerEl = document.createElement('div');
    markerEl.className = 'server-site-marker';
    new maplibregl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([SITE.lon, SITE.lat]).addTo(map);

    const initializeVisuals = () => {
      if (!mounted || !map.getSource('ignbase') || !map.getSource(TERRAIN_SOURCE_ID)) return;
      setMapStatus('Mapa base listo.');

      if (!terrainAttempted) {
        try {
          map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.45 });
          applyAtmosphere(map);
          terrainAttempted = true;
          setTerrainError('');
          setTerrainStatus('Relieve 3D activo.');
        } catch (terrainInitError) {
          if (/style is not done loading/i.test(String(terrainInitError))) return;
          terrainAttempted = true;
          console.warn('No se pudo activar terrain:', terrainInitError);
          setTerrainError(terrainInitError instanceof Error ? terrainInitError.message : String(terrainInitError));
          setTerrainStatus('Relieve 3D no disponible.');
        }
      }

      if (!gpuAttempted) {
        try {
          const layer = new GpuVectorParticleLayerV2({
            map,
            id: PARTICLE_LAYER_ID,
            particleCount: window.matchMedia('(max-width:720px)').matches ? 4000 : 8000,
            onReady: () => {
              if (mounted) setGpuStatus(latestFieldRef.current ? 'Renderer WebGL2 listo · preparando partículas…' : 'Renderer listo · esperando campo del servidor…');
            },
            onFirstRender: () => {
              if (mounted) setGpuStatus('Partículas de viento renderizándose.');
            }
          });
          gpuAttempted = true;
          particleLayerRef.current = layer;
          layer.setEnabled(true);
          if (latestFieldRef.current) {
            layer.setField(latestFieldRef.current);
            setFieldApplied(true);
            setGpuStatus('Partículas de viento activas.');
          } else {
            setGpuStatus('Renderer listo · esperando campo del servidor…');
          }
          setGpuError('');
        } catch (gpuInitError) {
          if (/style is not done loading/i.test(String(gpuInitError))) return;
          gpuAttempted = true;
          console.error('No se pudo iniciar el renderer GPU:', gpuInitError);
          setGpuError(gpuInitError instanceof Error ? gpuInitError.message : String(gpuInitError));
          setGpuStatus('Renderer GPU no disponible.');
        }
      }

      if (terrainAttempted && gpuAttempted && fallbackTimer) {
        window.clearInterval(fallbackTimer);
        fallbackTimer = undefined;
      }
    };

    const onMapError = event => {
      const message = event?.error?.message || 'Error cargando recurso del mapa';
      const sourceId = event?.sourceId || event?.error?.sourceId || '';
      console.error('MapLibre:', event?.error || event);
      if (!mounted) return;
      if ([TERRAIN_SOURCE_ID, HILLSHADE_SOURCE_ID].includes(sourceId) || /xyz-mdt|raster-dem|terrain/i.test(message)) {
        setTerrainError(message);
      } else if (sourceId === PARTICLE_LAYER_ID || /webgl|shader|transform feedback/i.test(message)) {
        setGpuError(message);
      } else {
        setMapError(message);
      }
    };

    map.on('style.load', initializeVisuals);
    map.on('styledata', initializeVisuals);
    map.on('error', onMapError);
    fallbackTimer = window.setInterval(initializeVisuals, 1500);
    initializeVisuals();

    return () => {
      mounted = false;
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      requestAbortRef.current?.abort();
      particleLayerRef.current?.destroy();
      particleLayerRef.current = null;
      map.off('style.load', initializeVisuals);
      map.off('styledata', initializeVisuals);
      map.off('error', onMapError);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    let controller;
    const timer = window.setTimeout(async () => {
      requestAbortRef.current?.abort();
      controller = new AbortController();
      requestAbortRef.current = controller;
      setApiError('');
      setApiStatus('Solicitando campo aerológico al servidor…');
      try {
        const isMobile = window.matchMedia('(max-width:720px)').matches;
        const field = await client.buildField({
          lat: SITE.lat,
          lon: SITE.lon,
          areaKm: 40,
          direction,
          speed,
          stability,
          width: isMobile ? 96 : 128,
          height: isMobile ? 96 : 128,
          signal: controller.signal
        });
        if (controller.signal.aborted) return;
        latestFieldRef.current = field;
        if (particleLayerRef.current) {
          particleLayerRef.current.setField(field);
          setFieldApplied(true);
          setGpuStatus('Partículas de viento activas.');
        }
        const ratio = Math.round((field.valid / (field.width * field.height)) * 100);
        const edge = field.meta.edgeCache !== 'UNKNOWN' ? ` · edge ${field.meta.edgeCache}` : '';
        setApiStatus(`Campo recibido · servidor ${field.meta.cache}${edge} · ${field.width}×${field.height} · ${ratio}% válido · ${field.meta.computeMs} ms · DEM z${field.meta.demZoom}`);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setApiError(err instanceof Error ? err.message : String(err));
        setApiStatus('No se pudo obtener el campo del servidor.');
      }
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [direction, speed, stability, nonce, client]);

  const errors = [
    apiError ? `API: ${apiError}` : '',
    gpuError ? `GPU: ${gpuError}` : '',
    terrainError ? `Relieve: ${terrainError}` : '',
    mapError ? `Mapa: ${mapError}` : ''
  ].filter(Boolean);
  const statusLines = errors.length
    ? [...errors, apiError ? '' : apiStatus].filter(Boolean)
    : [apiStatus, fieldApplied ? `Campo aplicado · ${gpuStatus}` : gpuStatus, terrainStatus, mapStatus];
  const panelStatus = statusLines.filter(Boolean).join('\n');

  return (
    <div className="server-field-shell">
      <div id="serverFieldMap" className="server-field-map" />
      <section className="server-field-panel">
        <div className="server-field-title">🪂 Pitolero Wind Lab <span className="server-field-badge">server-field</span></div>
        <div className="server-field-subtitle">FastAPI calcula el campo aerológico con el MDT del IGN. El navegador representa el relieve 3D y advecta las partículas sobre la elevación real.</div>

        <div className="server-field-row"><span>Viento desde</span><strong>{direction}°</strong></div>
        <input type="range" min="0" max="359" step="1" value={direction} onChange={event => setDirection(Number(event.target.value))} />

        <div className="server-field-row"><span>Velocidad</span><strong>{speed} km/h</strong></div>
        <input type="range" min="5" max="55" step="1" value={speed} onChange={event => setSpeed(Number(event.target.value))} />

        <div className="server-field-row"><span>Estabilidad</span></div>
        <select value={stability} onChange={event => setStability(event.target.value)}>
          <option value="unstable">Inestable / convectiva</option>
          <option value="neutral">Neutra</option>
          <option value="stable">Estable</option>
        </select>

        <button type="button" onClick={() => setNonce(value => value + 1)} style={{ marginTop: 11, width: '100%' }}>Recalcular en servidor</button>
        <div className={`server-field-status${errors.length ? ' error' : ''}`}>{panelStatus}</div>
        <div className="server-field-note">Las peticiones se agrupan durante 260 ms. En Vercel el mismo campo puede servirse desde CDN, Runtime Cache o memoria de la función.</div>
        <div className="server-field-api">API: {apiLabel}</div>
      </section>
    </div>
  );
}
