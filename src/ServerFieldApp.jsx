import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { GpuVectorParticleLayerV2 } from './engine/GpuVectorParticleLayerV2.js';
import { ServerFieldClient } from './engine/ServerFieldClient.js';

const SITE = { lon: -5.979353098143796, lat: 40.13618392931326 };
const DEM_URL = 'https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png';
const ORTHO_URL = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg';
const BASE_URL = 'https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{y}.jpeg';

function mapStyle() {
  return {
    version: 8,
    sources: {
      ignbase: { type: 'raster', tiles: [BASE_URL], tileSize: 256, scheme: 'tms', maxzoom: 18 },
      pnoa: { type: 'raster', tiles: [ORTHO_URL], tileSize: 256, scheme: 'tms', maxzoom: 19 },
      terrain: { type: 'raster-dem', tiles: [DEM_URL], tileSize: 512, minzoom: 5, maxzoom: 15, encoding: 'mapbox' }
    },
    layers: [
      { id: 'base', type: 'raster', source: 'ignbase', paint: { 'raster-opacity': 1 } },
      { id: 'ortho', type: 'raster', source: 'pnoa', paint: { 'raster-opacity': 0.74, 'raster-saturation': -0.08, 'raster-contrast': 0.10 } },
      { id: 'hillshade', type: 'hillshade', source: 'terrain', paint: { 'hillshade-exaggeration': 0.42, 'hillshade-shadow-color': '#071017', 'hillshade-highlight-color': '#fff4d8', 'hillshade-accent-color': '#3b4a54' } }
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
  const requestAbortRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [direction, setDirection] = useState(315);
  const [speed, setSpeed] = useState(20);
  const [stability, setStability] = useState('neutral');
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState('Inicializando mapa…');
  const [error, setError] = useState('');
  const client = useMemo(() => new ServerFieldClient(), []);
  const apiLabel = import.meta.env.VITE_WIND_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : 'mismo dominio · /api');

  useEffect(() => {
    let mounted = true;
    const map = new maplibregl.Map({
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
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    const markerEl = document.createElement('div');
    markerEl.className = 'server-site-marker';
    new maplibregl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([SITE.lon, SITE.lat]).addTo(map);

    const onStyleLoad = () => {
      if (!mounted) return;
      try {
        map.setTerrain({ source: 'terrain', exaggeration: 1.45 });
      } catch (terrainError) {
        console.warn('No se pudo activar terrain:', terrainError);
      }
      applyAtmosphere(map);
    };

    const onMapError = event => {
      const message = event?.error?.message || 'Error cargando recurso del mapa';
      console.error('MapLibre:', event?.error || event);
      if (mounted && /webgl|shader|terrain/i.test(message)) setError(message);
    };

    map.on('style.load', onStyleLoad);
    map.on('error', onMapError);

    map.on('load', () => {
      if (!mounted) return;
      // La API debe comenzar aunque falle la capa GPU; así el estado ya no puede
      // quedarse eternamente en "Inicializando mapa…" por un error WebGL.
      setReady(true);
      setStatus('Mapa 3D listo · solicitando campo al servidor…');

      try {
        particleLayerRef.current = new GpuVectorParticleLayerV2({
          map,
          id: 'pitoviento-server-vector-particles-v2',
          particleCount: window.matchMedia('(max-width:720px)').matches ? 30000 : 60000
        });
        particleLayerRef.current.setEnabled(true);
      } catch (gpuError) {
        console.error('No se pudo iniciar el renderer GPU:', gpuError);
        setError(`Renderer GPU: ${gpuError instanceof Error ? gpuError.message : String(gpuError)}`);
      }
    });

    return () => {
      mounted = false;
      requestAbortRef.current?.abort();
      particleLayerRef.current?.destroy();
      particleLayerRef.current = null;
      map.off('style.load', onStyleLoad);
      map.off('error', onMapError);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(async () => {
      requestAbortRef.current?.abort();
      const controller = new AbortController();
      requestAbortRef.current = controller;
      setStatus('Solicitando campo aerológico al servidor…');
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
        particleLayerRef.current?.setField(field);
        const ratio = Math.round((field.valid / (field.width * field.height)) * 100);
        const edge = field.meta.edgeCache !== 'UNKNOWN' ? ` · edge ${field.meta.edgeCache}` : '';
        setError('');
        setStatus(`Servidor ${field.meta.cache}${edge} · ${field.width}×${field.height} · ${ratio}% válido · ${field.meta.computeMs} ms · DEM z${field.meta.demZoom}`);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('No se pudo obtener el campo del servidor.');
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [ready, direction, speed, stability, nonce, client]);

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
        <div className={`server-field-status${error ? ' error' : ''}`}>{error || status}</div>
        <div className="server-field-note">Las peticiones se agrupan durante 260 ms. En Vercel el mismo campo puede servirse desde CDN, Runtime Cache o memoria de la función.</div>
        <div className="server-field-api">API: {apiLabel}</div>
      </section>
    </div>
  );
}
