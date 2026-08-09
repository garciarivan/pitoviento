import { useEffect, useState } from 'react';
import mobilePerformanceUrl from '../mobile-performance.js?url';
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

export default function LegacyEngineLoader() {
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const scripts = [];

    (async () => {
      try {
        scripts.push(await loadScript(mobilePerformanceUrl));
        scripts.push(await loadScript(legacyAppUrl));
        scripts.push(await loadScript(detailPanelUrl));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      active = false;
      // Durante esta primera fase no destruimos el mapa legacy al desmontar:
      // evitamos dobles inicializaciones mientras migramos el motor a módulos.
    };
  }, []);

  return error ? <div className="react-error">{error}</div> : null;
}
