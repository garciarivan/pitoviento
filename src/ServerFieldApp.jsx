import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { GpuVectorParticleLayerV2 } from './engine/GpuVectorParticleLayerV2.js';
import { ServerFieldClient } from './engine/ServerFieldClient.js';

const SITE = { lon: -5.979353098143796, lat: 40.13618392931326 };
const TARGET_VIEW = { center: [-5.987, 40.113], zoom: 14.2, pitch: 72, bearing: 28 };
const DEFAULT_EXAGGERATION = 2.5;
const DEM_URL = 'https://xyz-mdt.idee.es/1.0.0/raster-dem/{z}/{x}/{y}.png';
const ORTHO_URL = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg';
const BASE_URL = 'https://tms-ign-base.idee.es/1.0.0/IGNBaseTodo/{z}/{x}/{y}.jpeg';
const TERRAIN_SOURCE_ID = 'terrain-3d';
const HILLSHADE_SOURCE_ID = 'terrain-hillshade';
const PARTICLE_LAYER_ID = 'pitoviento-server-vector-particles-v2';
const COMPASS = [
  ['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
  ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]
];

function mapStyle() {
  return {
    version: 8,
    sources: {
      ignbase: { type: 'raster', tiles: [BASE_URL], tileSize: 256, scheme: 'tms', maxzoom: 18, attribution: '© IGN/CNIG · CC BY 4.0 scne.es' },
      pnoa: { type: 'raster', tiles: [ORTHO_URL], tileSize: 256, scheme: 'tms', maxzoom: 19, attribution: 'PNOA máxima actualidad · IGN/CNIG' },
      [TERRAIN_SOURCE_ID]: { type: 'raster-dem', tiles: [DEM_URL], tileSize: 512, minzoom: 5, maxzoom: 15, encoding: 'mapbox', attribution: 'MDT05 LiDAR · IGN/CNIG' },
      [HILLSHADE_SOURCE_ID]: { type: 'raster-dem', tiles: [DEM_URL], tileSize: 512, minzoom: 5, maxzoom: 15, encoding: 'mapbox' }
    },
    layers: [
      { id: 'base', type: 'raster', source: 'ignbase', paint: { 'raster-opacity': 1 } },
      {
        id: 'ortho',
        type: 'raster',
        source: 'pnoa',
        paint: {
          'raster-opacity': 0.94,
          'raster-brightness-min': 0.03,
          'raster-brightness-max': 0.72,
          'raster-contrast': 0.28,
          'raster-saturation': 0.05
        }
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: HILLSHADE_SOURCE_ID,
        paint: {
          'hillshade-exaggeration': 0.8,
          'hillshade-shadow-color': 'rgba(4, 12, 18, 0.82)',
          'hillshade-highlight-color': 'rgba(210, 205, 180, 0.18)',
          'hillshade-accent-color': 'rgba(42, 55, 63, 0.65)'
        }
      }
    ],
    terrain: { source: TERRAIN_SOURCE_ID, exaggeration: DEFAULT_EXAGGERATION }
  };
}

function applyAtmosphere(map) {
  if (typeof map.setSky !== 'function') return;
  try {
    map.setSky({
      'sky-color': '#72b6ee',
      'sky-horizon-blend': 0.12,
      'horizon-color': '#b9d8ed',
      'horizon-fog-blend': 0.06,
      'fog-color': '#dbeaf2',
      'fog-ground-blend': 0.01
    });
  } catch (error) {
    console.warn('No se pudo activar la atmósfera:', error);
  }
}

function compassLabel(degrees) {
  return COMPASS[Math.round(((degrees % 360) + 360) % 360 / 45) % 8][0];
}

function densityToCount(density, mobile) {
  const t = (density - 7) / 20;
  return Math.round((mobile ? 1500 : 3000) + t * (mobile ? 6500 : 15000));
}

function sampleField(field, lon, lat) {
  if (!field?.data) return null;
  const x = Math.max(0, Math.min(field.width - 1, Math.round((lon - field.bounds.west) / (field.bounds.east - field.bounds.west) * (field.width - 1))));
  const y = Math.max(0, Math.min(field.height - 1, Math.round((lat - field.bounds.south) / (field.bounds.north - field.bounds.south) * (field.height - 1))));
  const offset = (y * field.width + x) * 4;
  const east = field.data[offset];
  const north = field.data[offset + 1];
  const vertical = field.data[offset + 2];
  const elevation = field.data[offset + 3];
  const speedKmh = Math.hypot(east, north) * 3.6;
  const bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  return { east, north, vertical, elevation, speedKmh, bearing };
}

function verticalClass(vertical) {
  if (vertical > 0.55) return 'ascendencia / barlovento';
  if (vertical < -0.55) return 'descendencia / sotavento';
  return 'flujo casi neutro';
}

function FieldMetric({ label, value, detail }) {
  return <div className="metric"><div className="k">{label}</div><div className="v">{value}</div><div className="s">{detail}</div></div>;
}

export default function ServerFieldApp() {
  const mapRef = useRef(null);
  const particleLayerRef = useRef(null);
  const latestFieldRef = useRef(null);
  const requestAbortRef = useRef(null);
  const densityRef = useRef(27);
  const exaggerationRef = useRef(DEFAULT_EXAGGERATION);
  const [direction, setDirection] = useState(315);
  const [speed, setSpeed] = useState(20);
  const [stability, setStability] = useState('neutral');
  const [density, setDensity] = useState(27);
  const [exaggeration, setExaggeration] = useState(DEFAULT_EXAGGERATION);
  const [particlesVisible, setParticlesVisible] = useState(true);
  const [hillshadeVisible, setHillshadeVisible] = useState(true);
  const [orthoVisible, setOrthoVisible] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [mapStatus, setMapStatus] = useState('Inicializando mapa y MDT oficial…');
  const [mapError, setMapError] = useState('');
  const [terrainStatus, setTerrainStatus] = useState('Relieve pendiente…');
  const [terrainError, setTerrainError] = useState('');
  const [gpuStatus, setGpuStatus] = useState('Renderer de viento pendiente…');
  const [gpuError, setGpuError] = useState('');
  const [apiStatus, setApiStatus] = useState('Preparando campo aerológico…');
  const [apiError, setApiError] = useState('');
  const [fieldApplied, setFieldApplied] = useState(false);
  const [siteSample, setSiteSample] = useState(null);
  const client = useMemo(() => new ServerFieldClient(), []);
  const isMobile = () => window.matchMedia('(max-width:720px)').matches;
  const apiLabel = import.meta.env.VITE_WIND_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : 'mismo dominio · /api');

  useEffect(() => {
    document.body.classList.toggle('controls-open', panelOpen);
    return () => document.body.classList.remove('controls-open');
  }, [panelOpen]);

  useEffect(() => {
    let mounted = true;
    let terrainAttempted = false;
    let gpuAttempted = false;
    let fallbackTimer;
    let terrainVerifyTimer;
    let map;

    try {
      map = new maplibregl.Map({
        container: 'map',
        style: mapStyle(),
        ...TARGET_VIEW,
        maxPitch: 85,
        maxZoom: 18,
        hash: false,
        canvasContextAttributes: { antialias: true, contextType: 'webgl2', powerPreference: 'high-performance' }
      });
    } catch (error) {
      setMapError(error instanceof Error ? error.message : String(error));
      setMapStatus('No se pudo crear el mapa base.');
      return undefined;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    const markerEl = document.createElement('div');
    markerEl.className = 'site-marker';
    new maplibregl.Marker({ element: markerEl, anchor: 'center' }).setLngLat([SITE.lon, SITE.lat]).addTo(map);

    const verifyTerrain = () => {
      if (!mounted || typeof map.queryTerrainElevation !== 'function') return;
      const elevation = map.queryTerrainElevation([SITE.lon, SITE.lat]);
      if (Number.isFinite(elevation) && elevation > 100) {
        if (terrainVerifyTimer) {
          window.clearInterval(terrainVerifyTimer);
          terrainVerifyTimer = undefined;
        }
        setTerrainError('');
        setTerrainStatus(`Relieve 3D activo · MDT ${Math.round(elevation / exaggerationRef.current)} m.`);
      }
    };

    const initializeVisuals = () => {
      if (!mounted || !map.getSource('ignbase') || !map.getSource(TERRAIN_SOURCE_ID)) return;
      setMapStatus('Mapa base listo.');

      if (!terrainAttempted) {
        try {
          map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: exaggerationRef.current });
          applyAtmosphere(map);
          terrainAttempted = true;
          setTerrainError('');
          setTerrainStatus(`Relieve 3D activo · exageración ${exaggerationRef.current.toFixed(2)}×.`);
          terrainVerifyTimer = window.setInterval(verifyTerrain, 1000);
        } catch (error) {
          if (/style is not done loading/i.test(String(error))) return;
          terrainAttempted = true;
          setTerrainError(error instanceof Error ? error.message : String(error));
          setTerrainStatus('Relieve 3D no disponible.');
        }
      }

      if (!gpuAttempted) {
        try {
          const mobile = isMobile();
          const maxParticles = mobile ? 8000 : 18000;
          const layer = new GpuVectorParticleLayerV2({
            map,
            id: PARTICLE_LAYER_ID,
            particleCount: maxParticles,
            activeParticleCount: densityToCount(densityRef.current, mobile),
            terrainExaggeration: exaggerationRef.current,
            onReady: () => mounted && setGpuStatus(latestFieldRef.current ? 'Campo listo · preparando trazas…' : 'Renderer listo · esperando servidor…'),
            onFirstRender: () => mounted && setGpuStatus('Trazas de viento 3D activas.')
          });
          gpuAttempted = true;
          particleLayerRef.current = layer;
          layer.setEnabled(true);
          if (latestFieldRef.current) {
            layer.setField(latestFieldRef.current);
            setFieldApplied(true);
          }
          setGpuError('');
        } catch (error) {
          if (/style is not done loading/i.test(String(error))) return;
          gpuAttempted = true;
          setGpuError(error instanceof Error ? error.message : String(error));
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
      if (!mounted) return;
      if ([TERRAIN_SOURCE_ID, HILLSHADE_SOURCE_ID].includes(sourceId) || /xyz-mdt|raster-dem|terrain/i.test(message)) setTerrainError(message);
      else if (sourceId === PARTICLE_LAYER_ID || /webgl|shader|transform feedback/i.test(message)) setGpuError(message);
      else setMapError(message);
    };

    const onSourceData = event => {
      if (event.sourceId === TERRAIN_SOURCE_ID && event.isSourceLoaded) verifyTerrain();
    };

    map.on('style.load', initializeVisuals);
    map.on('styledata', initializeVisuals);
    map.on('idle', verifyTerrain);
    map.on('sourcedata', onSourceData);
    map.on('error', onMapError);
    fallbackTimer = window.setInterval(initializeVisuals, 1000);
    initializeVisuals();

    return () => {
      mounted = false;
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      if (terrainVerifyTimer) window.clearInterval(terrainVerifyTimer);
      requestAbortRef.current?.abort();
      particleLayerRef.current?.destroy();
      particleLayerRef.current = null;
      map.off('style.load', initializeVisuals);
      map.off('styledata', initializeVisuals);
      map.off('idle', verifyTerrain);
      map.off('sourcedata', onSourceData);
      map.off('error', onMapError);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    densityRef.current = density;
    particleLayerRef.current?.setDensity(densityToCount(density, isMobile()));
  }, [density]);

  useEffect(() => {
    exaggerationRef.current = exaggeration;
    const map = mapRef.current;
    if (map?.getSource(TERRAIN_SOURCE_ID)) map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
    particleLayerRef.current?.setTerrainExaggeration(exaggeration);
    if (!terrainError) setTerrainStatus(`Relieve 3D activo · exageración ${exaggeration.toFixed(2)}×.`);
  }, [exaggeration, terrainError]);

  useEffect(() => {
    particleLayerRef.current?.setEnabled(particlesVisible);
  }, [particlesVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', hillshadeVisible ? 'visible' : 'none');
  }, [hillshadeVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('ortho')) map.setLayoutProperty('ortho', 'visibility', orthoVisible ? 'visible' : 'none');
  }, [orthoVisible]);

  useEffect(() => {
    let controller;
    const timer = window.setTimeout(async () => {
      requestAbortRef.current?.abort();
      controller = new AbortController();
      requestAbortRef.current = controller;
      setApiError('');
      setApiStatus('Calculando campo aerológico en servidor…');
      try {
        const mobile = isMobile();
        const field = await client.buildField({
          lat: SITE.lat,
          lon: SITE.lon,
          areaKm: 40,
          direction,
          speed,
          stability,
          width: mobile ? 96 : 128,
          height: mobile ? 96 : 128,
          signal: controller.signal
        });
        if (controller.signal.aborted) return;
        latestFieldRef.current = field;
        setSiteSample(sampleField(field, SITE.lon, SITE.lat));
        if (particleLayerRef.current) {
          particleLayerRef.current.setField(field);
          setFieldApplied(true);
          setGpuStatus('Trazas de viento 3D activas.');
        }
        const ratio = Math.round(field.valid / (field.width * field.height) * 100);
        const edge = field.meta.edgeCache !== 'UNKNOWN' ? ` · edge ${field.meta.edgeCache}` : '';
        setApiStatus(`Campo ${field.meta.cache}${edge} · ${field.width}×${field.height} · ${ratio}% válido · ${field.meta.computeMs} ms`);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setApiError(error instanceof Error ? error.message : String(error));
        setApiStatus('No se pudo obtener el campo del servidor.');
      }
    }, 260);
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
  }, [direction, speed, stability, nonce, client]);

  const errors = [apiError && `API: ${apiError}`, gpuError && `GPU: ${gpuError}`, terrainError && `Relieve: ${terrainError}`, mapError && `Mapa: ${mapError}`].filter(Boolean);
  const statusText = errors.length ? errors.join(' · ') : `${apiStatus} · ${fieldApplied ? gpuStatus : 'aplicando campo…'} · ${terrainStatus}`;
  const flowDirection = siteSample?.bearing ?? ((direction + 180) % 360);
  const directionDelta = siteSample ? Math.abs((((siteSample.bearing - ((direction + 180) % 360)) + 540) % 360) - 180) : 0;
  const localDensity = densityToCount(density, typeof window !== 'undefined' && isMobile());

  return (
    <div className="app-shell server-field-shell">
      <div id="map" />
      <div id="controlPanel" className={`panel server-field-panel${panelOpen ? ' mobile-open' : ''}`}>
        <div className="head">
          <div className="title">🪂 Pitolero Wind Lab <span className="badge">v3.1 server</span></div>
          <div className="subtitle">Orografía 3D real del IGN + flujo de viento tridimensional calculado en servidor para vuelo libre.</div>
        </div>

        <div className="section">
          <div className="row"><span className="label">Viento desde</span><span className="value"><b>{compassLabel(direction)}</b> · {direction}°</span></div>
          <input aria-label="Dirección del viento" type="range" min="0" max="359" step="1" value={direction} onChange={event => setDirection(Number(event.target.value))} />
          <div className="compass" style={{ marginTop: 8 }}>
            {COMPASS.map(([label, degrees]) => <button type="button" key={degrees} className={degrees === direction ? 'active' : ''} onClick={() => setDirection(degrees)}>{label}</button>)}
          </div>
        </div>

        <div className="section">
          <div className="row"><span className="label">Velocidad</span><span className="value">{speed} km/h</span></div>
          <input aria-label="Velocidad del viento" type="range" min="5" max="55" step="1" value={speed} onChange={event => setSpeed(Number(event.target.value))} />
          <div className="row" style={{ marginTop: 12 }}><span className="label">Estabilidad</span></div>
          <select value={stability} onChange={event => setStability(event.target.value)}>
            <option value="unstable">Inestable / convectiva</option>
            <option value="neutral">Neutra</option>
            <option value="stable">Estable</option>
          </select>
        </div>

        <div className="section">
          <div className="row"><span className="label">Densidad base del flujo</span><span className="value">{density}</span></div>
          <input aria-label="Densidad del flujo" type="range" min="7" max="27" step="2" value={density} onChange={event => setDensity(Number(event.target.value))} />
          <div className="notice" style={{ marginTop: 6 }}>Densidad visual alta. <strong>{localDensity.toLocaleString('es-ES')} trazas GPU</strong> activas sin recrear el campo.</div>
          <div className="row" style={{ marginTop: 10 }}><span className="label">Exageración del relieve</span><span className="value">{exaggeration.toFixed(2)}×</span></div>
          <input aria-label="Exageración del relieve" type="range" min="1" max="3" step="0.05" value={exaggeration} onChange={event => setExaggeration(Number(event.target.value))} />
        </div>

        <div className="section">
          <div className="metrics">
            <FieldMetric label="Pitolero" value={siteSample ? `${Math.round(siteSample.elevation)} m` : '— m'} detail="elevación DEM" />
            <FieldMetric label="w estimada" value={siteSample ? `${siteSample.vertical.toFixed(1)} m/s` : '— m/s'} detail={siteSample ? verticalClass(siteSample.vertical) : 'esperando terreno'} />
            <FieldMetric label="Velocidad local" value={siteSample ? `${siteSample.speedKmh.toFixed(0)} km/h` : '— km/h'} detail={siteSample && siteSample.speedKmh > speed * 1.08 ? 'aceleración orográfica' : 'sin aceleración fuerte'} />
            <FieldMetric label="Dirección flujo" value={`${Math.round(flowDirection)}°`} detail={directionDelta > 5 ? 'desviación local apreciable' : 'base sinóptica'} />
            <FieldMetric label="Área" value="40 × 40" detail="km alrededor" />
            <FieldMetric label="Canalización" value={`±${Math.round(directionDelta)}°`} detail="confinamiento local" />
          </div>
        </div>

        <div className="section">
          <div className="switches">
            <label className="switch"><input type="checkbox" checked={particlesVisible} onChange={event => setParticlesVisible(event.target.checked)} /> partículas 3D</label>
            <label className="switch"><input type="checkbox" checked={hillshadeVisible} onChange={event => setHillshadeVisible(event.target.checked)} /> sombreado</label>
            <label className="switch"><input type="checkbox" checked={orthoVisible} onChange={event => setOrthoVisible(event.target.checked)} /> ortofoto PNOA</label>
          </div>
          <div className="actions" style={{ marginTop: 9 }}>
            <button type="button" onClick={() => mapRef.current?.easeTo({ ...TARGET_VIEW, duration: 1200 })}>Vista Pitolero</button>
            <button type="button" onClick={() => setNonce(value => value + 1)}>Recalcular flujo</button>
          </div>
          <div className="notice" style={{ marginTop: 9 }}>FastAPI calcula el campo con el MDT; WebGL2 advecta y dibuja miles de trazas sobre la elevación exagerada.</div>
        </div>

        <div className="section">
          <div className="legend"><div className="lg"><span className="sw up" />ascendencia</div><div className="lg"><span className="sw neutral" />flujo neutro</div><div className="lg"><span className="sw down" />descendencia</div><div className="lg"><span className="sw wake" />estela/rotor</div></div>
        </div>

        <div className="section">
          <div className="status"><span className={`dot${errors.length ? ' err' : fieldApplied ? ' ok' : ''}`} /><span>{statusText}</span></div>
          <div className="notice server-field-api" style={{ marginTop: 9 }}>API: {apiLabel}. Herramienta diagnóstica; no sustituye una predicción operativa ni CFD.</div>
        </div>
      </div>

      <button type="button" className="panel-toggle" aria-controls="controlPanel" aria-expanded={panelOpen} aria-label={panelOpen ? 'Cerrar controles' : 'Abrir controles'} onClick={() => setPanelOpen(value => !value)}>{panelOpen ? '‹' : '›'}</button>
      <div className="wind-chip">
        <div className="arrow" style={{ transform: `rotate(${(direction + 180) % 360}deg)` }}>↑</div>
        <div><div className="big">{compassLabel(direction)} · {speed} km/h</div><div className="small">desde esa dirección · flecha hacia donde sopla</div></div>
      </div>
    </div>
  );
}
