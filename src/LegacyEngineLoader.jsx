import { useEffect, useState } from 'react';
import mobilePerformanceUrl from '../mobile-performance.js?url';
import atmosphereUrl from '../sky-atmosphere.js?url';
import legacyAppUrl from '../app.js?url';
import detailPanelUrl from '../detail-panel.js?url';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.pitovientoLegacy = 'true';
    script.onload = () => resolve(script);
    script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.body.appendChild(script);
  });
}

function installMapCapture() {
  if (!window.maplibregl?.Map || window.__pitovientoMapCaptureInstalled) return;
  const OriginalMap = window.maplibregl.Map;

  class CapturedMap extends OriginalMap {
    constructor(options) {
      super(options);
      window.__pitovientoMap = this;
      window.dispatchEvent(new CustomEvent('pitoviento:map-ready', { detail: { map: this } }));
    }
  }

  window.maplibregl.Map = CapturedMap;
  window.__pitovientoMapCaptureInstalled = true;
}

export default function LegacyEngineLoader() {
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const scripts = [];

    installMapCapture();

    (async () => {
      try {
        scripts.push(await loadScript(mobilePerformanceUrl));
        scripts.push(await loadScript(atmosphereUrl));
        scripts.push(await loadScript(legacyAppUrl));
        scripts.push(await loadScript(detailPanelUrl));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      active = false;
      // En esta fase mantenemos vivo el mapa legacy para comparar ambos motores
      // sobre exactamente las mismas teselas de terreno y la misma cámara.
    };
  }, []);

  return error ? <div className="react-error">{error}</div> : null;
}
