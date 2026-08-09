import { useEffect, useRef, useState } from 'react';
import {
  DeckParticleRenderer,
  FlowWorkerClient,
  boundsAroundSite,
  buildTerrainGrid,
  distanceM
} from './engine/index.js';

const SITE = { lon: -5.979353098143796, lat: 40.13618392931326, name: 'Pico Pitolero' };
const CYCLE = 100;

function readControls() {
  const number = (id, fallback) => {
    const el = document.getElementById(id);
    const value = el ? Number(el.value) : fallback;
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    fromDeg: number('direction', 315),
    speedKmh: number('speed', 20),
    density: number('density', 27),
    exaggeration: number('exag', 1.35),
    stability: document.getElementById('stability')?.value || 'neutral'
  };
}

function waitForMap(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      const map = window.__pitovientoMap;
      if (map) return resolve(map);
      if (performance.now() - started > timeoutMs) return reject(new Error('No se pudo capturar el mapa legacy.'));
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function waitForIdle(map, timeoutMs = 5000) {
  return new Promise(resolve => {
    if (map.loaded() && !map.isMoving()) {
      const timer = setTimeout(resolve, 250);
      map.once('idle', () => {
        clearTimeout(timer);
        resolve();
      });
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    map.once('idle', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function localConfig(map) {
  const zoom = map.getZoom();
  if (zoom < 11) return { count: 0, spacingM: 0, totalM: 0, step: 0 };
  if (zoom < 12) return { count: 31, spacingM: 260, totalM: 12000, step: 520 };
  if (zoom < 13) return { count: 47, spacingM: 190, totalM: 11000, step: 320 };
  if (zoom < 14) return { count: 67, spacingM: 135, totalM: 9000, step: 190 };
  if (zoom < 15) return { count: 87, spacingM: 95, totalM: 7000, step: 115 };
  if (zoom < 16) return { count: 107, spacingM: 70, totalM: 5600, step: 70 };
  return { count: 127, spacingM: 52, totalM: 4400, step: 45 };
}

function localGridSpec(map) {
  const zoom = map.getZoom();
  if (zoom < 11.5) return null;

  const bounds = map.getBounds();
  const center = map.getCenter();
  const lonPad = (bounds.getEast() - bounds.getWest()) * 0.22;
  const latPad = (bounds.getNorth() - bounds.getSouth()) * 0.22;
  const expanded = {
    west: bounds.getWest() - lonPad,
    south: bounds.getSouth() - latPad,
    east: bounds.getEast() + lonPad,
    north: bounds.getNorth() + latPad
  };

  const widthM = distanceM(expanded.west, center.lat, expanded.east, center.lat);
  const heightM = distanceM(center.lng, expanded.south, center.lng, expanded.north);
  const targetSpacing = zoom < 13 ? 150 : zoom < 14 ? 105 : zoom < 15 ? 75 : zoom < 16 ? 52 : 38;
  const isMobile = window.matchMedia('(max-width:720px)').matches;
  const cap = isMobile ? 181 : 241;
  const minSize = isMobile ? 61 : 81;
  const width = Math.max(minSize, Math.min(cap, Math.round(widthM / targetSpacing) + 1));
  const height = Math.max(minSize, Math.min(cap, Math.round(heightM / targetSpacing) + 1));

  const quant = value => Math.round(value * 2000) / 2000;
  const key = [Math.floor(zoom * 2) / 2, quant(center.lng), quant(center.lat), width, height].join('|');
  return { bounds: expanded, width, height, targetSpacing, key };
}

export default function ParallelEngineBridge() {
  const workerRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(0);
  const rebuildTimerRef = useRef(0);
  const buildTokenRef = useRef(0);
  const selectedRef = useRef(null);
  const streamsRef = useRef({ global: [], local: [], selected: null });
  const workerReadyRef = useRef(false);
  const workerPreparingRef = useRef(null);
  const localGridKeyRef = useRef('');
  const localGridPreparingRef = useRef(null);
  const [status, setStatus] = useState('nuevo motor en espera');

  useEffect(() => {
    let active = true;
    let map = null;
    let gridAbort = null;
    let localGridAbort = null;
    const listeners = [];

    const addDomListener = (id, type, handler) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(type, handler);
      listeners.push(() => el.removeEventListener(type, handler));
    };

    const setLegacyParticles = enabled => {
      const checkbox = document.getElementById('particles');
      if (!checkbox || checkbox.checked === enabled) return;
      checkbox.checked = enabled;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const mode = () => document.getElementById('engineMode')?.value || 'legacy';

    const updateRendererMode = () => {
      const current = mode();
      const renderer = rendererRef.current;
      if (!renderer) return;
      renderer.setEnabled(current === 'gpu' || current === 'both');
      setLegacyParticles(current !== 'gpu');
      if (current === 'legacy') setStatus('v3.1 activa · motor nuevo en espera');
      else if (!workerReadyRef.current) setStatus('preparando rejilla DEM para el worker…');
      else if (current === 'both') setStatus('comparación visual: v3.1 + GPU/Worker');
      else setStatus('renderer GPU + worker activo');
    };

    const compareSite = siteSample => {
      if (!siteSample) return;
      const oldW = Number.parseFloat(document.getElementById('siteW')?.textContent || '');
      const oldSpeed = Number.parseFloat(document.getElementById('siteLocalSpeed')?.textContent || '');
      const dw = Number.isFinite(oldW) ? siteSample.w - oldW : 0;
      const ds = Number.isFinite(oldSpeed) ? siteSample.localSpeedKmh - oldSpeed : 0;
      const tag = document.getElementById('engineCompare');
      if (tag) tag.textContent = `Δ Pitolero: w ${dw >= 0 ? '+' : ''}${dw.toFixed(2)} m/s · vel ${ds >= 0 ? '+' : ''}${ds.toFixed(1)} km/h`;
    };

    const prepareWorker = async () => {
      if (workerReadyRef.current) return workerRef.current;
      if (workerPreparingRef.current) return workerPreparingRef.current;

      workerPreparingRef.current = (async () => {
        await waitForIdle(map);
        if (!active) return null;

        gridAbort = new AbortController();
        const bounds = boundsAroundSite(SITE, 60);
        const isMobile = window.matchMedia('(max-width:720px)').matches;
        const size = isMobile ? 181 : 221;
        setStatus(`muestreando MDT regional ${size}×${size}…`);

        const grid = await buildTerrainGrid({
          map,
          bounds,
          width: size,
          height: size,
          rowsPerSlice: isMobile ? 2 : 4,
          signal: gridAbort.signal,
          onProgress: progress => {
            if (!active) return;
            const pct = Math.round(progress * 100);
            if (pct % 10 === 0) setStatus(`muestreando MDT regional… ${pct}%`);
          }
        });

        if (!active) return null;
        const ratio = grid.valid / (grid.width * grid.height);
        if (ratio < 0.45) throw new Error(`El MDT cargado es insuficiente para el worker (${Math.round(ratio * 100)}%).`);

        const client = new FlowWorkerClient();
        workerRef.current = client;
        const ready = await client.init({ grid, site: SITE, areaKm: 40, controls: readControls() });
        workerReadyRef.current = true;
        setStatus(`worker listo · regional ${ready.grid.width}×${ready.grid.height} · ${Math.round(ratio * 100)}% válida`);
        return client;
      })();

      try {
        return await workerPreparingRef.current;
      } finally {
        workerPreparingRef.current = null;
      }
    };

    const ensureLocalGrid = async (client, token) => {
      const spec = localGridSpec(map);
      if (!spec) {
        if (localGridKeyRef.current) {
          localGridAbort?.abort();
          localGridKeyRef.current = '';
          await client.setLocalGrid(null);
        }
        return null;
      }
      if (spec.key === localGridKeyRef.current) return spec;
      if (localGridPreparingRef.current) localGridAbort?.abort();

      localGridPreparingRef.current = (async () => {
        localGridAbort = new AbortController();
        setStatus(`MDT local fino · ${spec.width}×${spec.height} · objetivo ~${spec.targetSpacing} m`);
        const grid = await buildTerrainGrid({
          map,
          bounds: spec.bounds,
          width: spec.width,
          height: spec.height,
          rowsPerSlice: 3,
          signal: localGridAbort.signal
        });
        if (!active || token !== buildTokenRef.current) return null;
        const ratio = grid.valid / (grid.width * grid.height);
        if (ratio < 0.60) return null;
        const reply = await client.setLocalGrid(grid);
        if (!active || token !== buildTokenRef.current) return null;
        localGridKeyRef.current = spec.key;
        setStatus(`MDT local activo · ${reply.grid.width}×${reply.grid.height} · ~${spec.targetSpacing} m · ${Math.round(ratio * 100)}% válido`);
        return spec;
      })();

      try {
        return await localGridPreparingRef.current;
      } catch (error) {
        if (error?.name !== 'AbortError') throw error;
        return null;
      } finally {
        localGridPreparingRef.current = null;
      }
    };

    const rebuild = async ({ global = true, local = true, selectedOnly = false } = {}) => {
      if (mode() === 'legacy') return;
      const renderer = rendererRef.current;
      if (!renderer || !map?.isStyleLoaded()) return;

      const token = ++buildTokenRef.current;
      const controls = readControls();
      setStatus(workerReadyRef.current ? 'calculando en Web Worker…' : 'preparando worker…');

      const client = await prepareWorker();
      if (!active || token !== buildTokenRef.current || !client) return;

      if (local || selectedOnly) await ensureLocalGrid(client, token);
      if (!active || token !== buildTokenRef.current) return;

      const cfg = localConfig(map);
      const center = map.getCenter();
      const selected = selectedRef.current ? {
        lon: selectedRef.current.lng,
        lat: selectedRef.current.lat,
        options: {
          totalM: Math.max(5000, cfg.totalM || 8000),
          step: Math.max(45, Math.min(220, cfg.step || 180))
        }
      } : null;

      const result = await client.build({
        controls,
        global: selectedOnly ? false : global,
        local: selectedOnly ? false : local,
        globalOptions: { density: controls.density, totalM: 54000, step: 850 },
        localOptions: cfg.count > 0 ? {
          center: { lon: center.lng, lat: center.lat },
          count: cfg.count,
          spacingM: cfg.spacingM,
          totalM: cfg.totalM,
          step: cfg.step
        } : { count: 0 },
        selected,
        clearSelected: !selected
      });

      if (!active || token !== buildTokenRef.current) return;
      if (result.globalStreams) streamsRef.current.global = result.globalStreams;
      if (result.localStreams) streamsRef.current.local = result.localStreams;
      if (result.selectedStream !== undefined) streamsRef.current.selected = result.selectedStream;

      renderer.setStreams({
        global: streamsRef.current.global,
        local: streamsRef.current.local,
        selected: streamsRef.current.selected
      });
      compareSite(result.siteSample);
      const localTag = result.localGrid ? ` · DEM local ${result.localGrid.width}×${result.localGrid.height}` : '';
      setStatus(`Worker listo · ${streamsRef.current.global.length} regionales · ${streamsRef.current.local.length} locales${localTag}`);
    };

    const scheduleRebuild = (options, delay = 220) => {
      clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current = window.setTimeout(() => rebuild(options), delay);
    };

    (async () => {
      try {
        map = await waitForMap();
        if (!active) return;
        rendererRef.current = new DeckParticleRenderer({ map, widthMinPixels: 1.35, trailLength: 2.8 });
        updateRendererMode();

        const animate = now => {
          const renderer = rendererRef.current;
          if (renderer) renderer.setCurrentTime((now * 0.016) % CYCLE);
          rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);

        const onMode = () => {
          updateRendererMode();
          if (mode() !== 'legacy') scheduleRebuild({ global: true, local: true }, 40);
        };
        addDomListener('engineMode', 'change', onMode);
        addDomListener('direction', 'change', () => scheduleRebuild({ global: true, local: true }, 120));
        addDomListener('speed', 'change', () => scheduleRebuild({ global: true, local: true }, 120));
        addDomListener('density', 'change', () => scheduleRebuild({ global: true, local: true }, 120));
        addDomListener('stability', 'change', () => scheduleRebuild({ global: true, local: true }, 80));
        addDomListener('exag', 'change', () => scheduleRebuild({ global: true, local: true }, 120));

        const onMoveEnd = () => {
          if (mode() !== 'legacy') scheduleRebuild({ global: false, local: true }, 220);
        };
        const onIdle = () => {
          if (mode() !== 'legacy' && streamsRef.current.global.length === 0) scheduleRebuild({ global: true, local: true }, 100);
        };
        const onClick = event => {
          selectedRef.current = event.lngLat;
          if (mode() !== 'legacy') scheduleRebuild({ selectedOnly: true }, 30);
        };

        map.on('moveend', onMoveEnd);
        map.on('zoomend', onMoveEnd);
        map.on('idle', onIdle);
        map.on('click', onClick);
        listeners.push(() => map.off('moveend', onMoveEnd));
        listeners.push(() => map.off('zoomend', onMoveEnd));
        listeners.push(() => map.off('idle', onIdle));
        listeners.push(() => map.off('click', onClick));
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      active = false;
      gridAbort?.abort();
      localGridAbort?.abort();
      clearTimeout(rebuildTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      listeners.forEach(dispose => dispose());
      workerRef.current?.destroy();
      workerRef.current = null;
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  return <div className="engine-dev-status" aria-live="polite">{status}</div>;
}
