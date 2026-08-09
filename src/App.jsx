import LegacyEngineLoader from './LegacyEngineLoader.jsx';
import ParallelEngineBridge from './ParallelEngineBridge.jsx';

const compass = [
  ['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
  ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]
];

function ControlPanel() {
  return (
    <div id="controlPanel" className="panel">
      <div className="head">
        <div className="title">🪂 Pitolero Wind Lab <span className="badge">react-gpu</span></div>
        <div className="subtitle">React + Vite con comparación directa entre v3.1, TripsLayer y advección vectorial WebGL2.</div>
      </div>

      <div className="section engine-dev-section">
        <div className="row"><span className="label">Motor visual</span></div>
        <select id="engineMode" defaultValue="legacy">
          <option value="legacy">v3.1 original</option>
          <option value="gpu">GPU · trayectorias TripsLayer</option>
          <option value="vector">GPU vectorial · 60.000 partículas</option>
          <option value="both">Comparar v3.1 + TripsLayer</option>
        </select>
        <div id="engineCompare" className="notice engine-compare" style={{ marginTop: 7 }}>El nuevo motor se calcula solo al activarlo.</div>
        <div className="notice" style={{ marginTop: 5 }}>“GPU vectorial” mueve las partículas mediante transform feedback en WebGL2 sobre un campo regular calculado en el Web Worker.</div>
      </div>

      <div className="section">
        <div className="row"><span className="label">Viento desde</span><span className="value"><b id="dirLabel">NO</b> · <span id="dirDeg">315°</span></span></div>
        <input id="direction" type="range" min="0" max="359" step="1" defaultValue="315" />
        <div className="compass" style={{ marginTop: 8 }}>
          {compass.map(([label, deg]) => <button key={deg} data-dir={deg} className={deg === 315 ? 'active' : ''}>{label}</button>)}
        </div>
      </div>

      <div className="section">
        <div className="row"><span className="label">Velocidad</span><span className="value"><span id="speedLabel">20</span> km/h</span></div>
        <input id="speed" type="range" min="5" max="55" step="1" defaultValue="20" />
        <div className="row" style={{ marginTop: 12 }}><span className="label">Estabilidad</span></div>
        <select id="stability" defaultValue="neutral">
          <option value="unstable">Inestable / convectiva</option>
          <option value="neutral">Neutra</option>
          <option value="stable">Estable</option>
        </select>
      </div>

      <div className="section">
        <div className="row"><span className="label">Densidad base del flujo</span><span className="value" id="densityLabel">27</span></div>
        <input id="density" type="range" min="7" max="27" step="2" defaultValue="27" />
        <div className="notice" style={{ marginTop: 6 }}>La v3.1 permanece intacta como referencia visual. <strong id="localDensityLabel">alta densidad regional</strong>.</div>
        <div className="row" style={{ marginTop: 10 }}><span className="label">Exageración del relieve</span><span className="value" id="exagLabel">1.35×</span></div>
        <input id="exag" type="range" min="1" max="2.2" step="0.05" defaultValue="1.35" />
      </div>

      <div className="section">
        <div className="metrics">
          <div className="metric"><div className="k">Pitolero</div><div className="v" id="siteElev">— m</div><div className="s">elevación DEM</div></div>
          <div className="metric"><div className="k">w estimada</div><div className="v" id="siteW">— m/s</div><div className="s" id="siteClass">esperando terreno</div></div>
          <div className="metric"><div className="k">Velocidad local</div><div className="v" id="siteLocalSpeed">— km/h</div><div className="s" id="siteVenturi">calculando relieve</div></div>
          <div className="metric"><div className="k">Dirección flujo</div><div className="v" id="flowDir">135°</div><div className="s" id="flowDirSub">base sinóptica</div></div>
          <div className="metric"><div className="k">Área</div><div className="v">40 × 40</div><div className="s">km alrededor</div></div>
          <div className="metric"><div className="k">Canalización</div><div className="v">±40°</div><div className="s">confinamiento de valle</div></div>
        </div>
      </div>

      <div className="section">
        <div className="switches">
          <label className="switch"><input id="particles" type="checkbox" defaultChecked /> partículas 3D</label>
          <label className="switch"><input id="hillshade" type="checkbox" defaultChecked /> sombreado</label>
          <label className="switch"><input id="ortho" type="checkbox" defaultChecked /> ortofoto PNOA</label>
        </div>
        <div className="actions" style={{ marginTop: 9 }}><button id="resetView">Vista Pitolero</button><button id="recalc">Recalcular flujo</button></div>
        <div className="notice" style={{ marginTop: 9 }}><strong>Fase 3:</strong> el Worker genera un campo vectorial regular y WebGL2 advecta decenas de miles de partículas sin recalcular su posición en JavaScript.</div>
      </div>

      <div className="section">
        <div className="legend"><div className="lg"><span className="sw up"></span>ascendencia</div><div className="lg"><span className="sw neutral"></span>flujo neutro</div><div className="lg"><span className="sw down"></span>descendencia</div><div className="lg"><span className="sw wake"></span>estela/rotor</div></div>
      </div>

      <div className="section">
        <div className="status"><span id="statusDot" className="dot"></span><span id="statusText">Cargando mapa y MDT oficial…</span></div>
        <div className="notice" style={{ marginTop: 9 }}><strong>Importante:</strong> herramienta diagnóstica de orografía; no sustituye una predicción operativa ni CFD.</div>
      </div>
    </div>
  );
}

function DetailPanel() {
  return (
    <aside id="detailPanel" className="detail-panel" aria-hidden="true" aria-label="Detalle puntual de viento">
      <div className="detail-head"><div><div className="detail-eyebrow">Punto seleccionado</div><div className="detail-title">Detalle del viento</div></div><button id="detailClose" className="detail-close" type="button" aria-label="Cerrar detalle">×</button></div>
      <div id="detailCoords" className="detail-coords">—</div>
      <div className="detail-grid">
        <div className="detail-item"><span>Altitud</span><strong id="detailElev">—</strong></div>
        <div className="detail-item"><span>Velocidad local</span><strong id="detailSpeed">—</strong></div>
        <div className="detail-item"><span>Rumbo local</span><strong id="detailBearing">—</strong></div>
        <div className="detail-item"><span>Canalización</span><strong id="detailChannel">—</strong></div>
        <div className="detail-item"><span>Venturi</span><strong id="detailVenturi">—</strong></div>
        <div className="detail-item"><span>w estimada</span><strong id="detailW">—</strong></div>
      </div>
      <div id="detailClass" className="detail-class">—</div>
      <div className="detail-hint">La trayectoria resaltada nace en este punto.</div>
    </aside>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <div id="map" />
      <ControlPanel />
      <button id="panelToggle" className="panel-toggle" aria-controls="controlPanel" aria-expanded="false" aria-label="Abrir controles">›</button>
      <DetailPanel />
      <div className="wind-chip"><div id="windArrow" className="arrow">↑</div><div><div className="big"><span id="chipDir">NO</span> · <span id="chipSpeed">20</span> km/h</div><div className="small">desde esa dirección · flecha hacia donde sopla</div></div></div>
      <LegacyEngineLoader />
      <ParallelEngineBridge />
    </div>
  );
}
