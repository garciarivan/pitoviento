import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { GpuVectorParticleLayer } from './engine/GpuVectorParticleLayer.js';
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
      { id: 'ortho', type: 'raster', source: 'pnoa', paint: { 'raster-opacity': 0.72, 'raster-saturation': -0.12, 'raster-contrast': 0.08 } },
      { id: 'hillshade', type: 'hillshade', source: 'terrain', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#071017', 'hillshade-highlight-color': '#fff4d8', 'hillshade-accent-color': '#3b4a54' } }
    ],
    terrain: { source: 'terrain', exaggeration: 1.35 }
  };
}

function applyAtmosphere(map) {
  if (typeof map.setSky !== 'function') return;
  map.setSky({
    'sky-color': '#7eb9ef',
    'sky-horizon-blend': 0.28,
    'horizon-color': '#dceeff',
    'horizon-fog-blend': 0.22,
    'fog-color': '#eff7ff',
    'fog-ground-blend': 0.12
  });
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
    const map = new maplibregl.Map({
      container: 'serverFieldMap',
      style: mapStyle(),
      center: [SITE.lon, SITE.lat],
      zoom: 10.15,
      pitch: 66,
      bearing: 28,
      maxPitch: 85,
      maxZoom: 18,
      antialias: true,
      hash: false
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

    const markerEl = document.createElement('div');
    markerEl.className = 'server-site-marker';
    new maplibregl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([SITE.lon, SITE.lat]).addTo(map);

    map.on('load', () => {
      applyAtmosphere(map);
      particleLayerRef.current = new GpuVectorParticleLayer({
        map,
        id: 'pitoviento-server-vector-particles',
        particleCount: window.matchMedia('(max-width:720px)').matches ? 30000 : 60000
      });
      particleLayerRef.current.setEnabled(true);
      setReady(true);
      setStatus('Mapa listo · solicitando campo al servidor…');
    });

    return () => {
      requestAbortRef.current?.abort();
      particleLayerRef.current?.destroy();
      particleLayerRef.current = null;
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
      setError('');
      setStatus('Solicitando campo aerologico al servidor…');
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
        setStatus(`Servidor ${field.meta.cache}${edge} · ${field.width}×${field.height} · ${ratio}% valido · ${field.meta.computeMs} ms · DEM z${field.meta.demZoom}`);
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
        <div className="server-field-subtitle">FastAPI calcula el campo aerologico con el MDT del IGN. El navegador solo representa el terreno y advecta las particulas en GPU.</div>

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
        <div className="server-field-note">Las peticiones se agrupan durante 260 ms. En Vercel el mismo campo puede servirse desde CDN, Runtime Cache o memoria de la funcion.</div>
        <div className="server-field-api">API: {apiLabel}</div>
      </section>
    </div>
  );
}
