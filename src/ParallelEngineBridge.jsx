import { useEffect, useRef, useState } from 'react';
import { WindParticleEngine, DeckParticleRenderer } from './engine/index.js';

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

export default function ParallelEngineBridge() {
  const engineRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(0);
  const rebuildTimerRef = useRef(0);
  const buildTokenRef = useRef(0);
  const selectedRef = useRef(null);
  const [status, setStatus] = useState('nuevo motor en espera');

  useEffect(() => {
    let active = true;
    let map = null;
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
      else if (current === 'both') setStatus('comparación visual: v3.1 + GPU');
      else setStatus('renderer GPU activo');
    };

    const compareSite = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const next = engine.sampleSite(180);
      if (!next) return;

      const oldW = Number.parseFloat(document.getElementById('siteW')?.textContent || '');
      const oldSpeed = Number.parseFloat(document.getElementById('siteLocalSpeed')?.textContent || '');
      const dw = Number.isFinite(oldW) ? next.w - oldW : 0;
      const ds = Number.isFinite(oldSpeed) ? next.localSpeedKmh - oldSpeed : 0;
      const tag = document.getElementById('engineCompare');
      if (tag) {
        tag.textContent = `Δ Pitolero: w ${dw >= 0 ? '+' : ''}${dw.toFixed(2)} m/s · vel ${ds >= 0 ? '+' : ''}${ds.toFixed(1)} km/h`;
      }
    };

    const rebuild = async ({ global = true, local = true } = {}) => {
      const currentMode = mode();
      if (currentMode === 'legacy') return;
      const engine = engineRef.current;
      const renderer = rendererRef.current;
      if (!engine || !renderer || !map?.isStyleLoaded()) return;

      const token = ++buildTokenRef.current;
      const controls = readControls();
      engine.setWind(controls);
      setStatus('calculando nuevo motor…');

      await new Promise(resolve => setTimeout(resolve, 16));
      if (!active || token !== buildTokenRef.current) return;

      if (global) {
        engine.buildGlobal({ density: controls.density, totalM: 54000, step: 850 });
      }

      if (local) {
        const cfg = localConfig(map);
        if (cfg.count > 0) {
          const center = map.getCenter();
          engine.buildLocal({
            center: { lon: center.lng, lat: center.lat },
            count: cfg.count,
            spacingM: cfg.spacingM,
            totalM: cfg.totalM,
            step: cfg.step
          });
        } else {
          engine.localStreams = [];
        }
      }

      if (selectedRef.current) {
        const cfg = localConfig(map);
        engine.buildSelected(selectedRef.current.lng, selectedRef.current.lat, {
          totalM: Math.max(5000, cfg.totalM || 8000),
          step: Math.max(55, Math.min(220, cfg.step || 180))
        });
      }

      if (!active || token !== buildTokenRef.current) return;
      renderer.setStreams({
        global: engine.globalStreams,
        local: engine.localStreams,
        selected: engine.selectedStream
      });
      compareSite();
      setStatus(`GPU listo · ${engine.globalStreams.length} regionales · ${engine.localStreams.length} locales`);
    };

    const scheduleRebuild = (options, delay = 220) => {
      clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current = window.setTimeout(() => rebuild(options), delay);
    };

    (async () => {
      try {
        map = await waitForMap();
        if (!active) return;

        const terrainSampler = (lon, lat) => {
          try {
            const value = map.queryTerrainElevation([lon, lat], { exaggerated: false });
            return Number.isFinite(value) ? value : null;
          } catch {
            return null;
          }
        };

        const initial = readControls();
        engineRef.current = new WindParticleEngine({
          terrainSampler,
          site: SITE,
          areaKm: 40,
          stability: initial.stability,
          speedKmh: initial.speedKmh,
          exaggeration: initial.exaggeration
        });
        engineRef.current.setWind(initial);
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

        const onMoveEnd = () => scheduleRebuild({ global: false, local: true }, 180);
        const onIdle = () => {
          if (mode() !== 'legacy' && engineRef.current?.globalStreams.length === 0) {
            scheduleRebuild({ global: true, local: true }, 100);
          }
        };
        const onClick = event => {
          selectedRef.current = event.lngLat;
          if (mode() !== 'legacy') scheduleRebuild({ global: false, local: false }, 30);
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
      clearTimeout(rebuildTimerRef.current);
      cancelAnimationFrame(rafRef.current);
      listeners.forEach(dispose => dispose());
      rendererRef.current?.destroy();
      rendererRef.current = null;
      engineRef.current = null;
    };
  }, []);

  return <div className="engine-dev-status" aria-live="polite">{status}</div>;
}
