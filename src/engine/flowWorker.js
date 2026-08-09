import { WindParticleEngine } from './WindParticleEngine.js';
import { createGridSampler } from './TerrainGrid.js';

let engine = null;
let regionalSampler = null;
let localSampler = null;
let gridMeta = null;
let localGridMeta = null;

function compositeSampler(lon, lat) {
  const local = localSampler ? localSampler(lon, lat) : null;
  if (Number.isFinite(local)) return local;
  return regionalSampler ? regionalSampler(lon, lat) : null;
}

function reply(id, type, payload = {}, transfer = []) {
  self.postMessage({ id, type, ...payload }, transfer);
}

function metaFor(grid) {
  return {
    width: grid.width,
    height: grid.height,
    valid: grid.valid,
    west: grid.west,
    south: grid.south,
    east: grid.east,
    north: grid.north
  };
}

function buildVectorField({ controls = {}, width = 128, height = 128, preferLocal = true } = {}) {
  engine.setWind(controls);
  const source = preferLocal && localGridMeta ? localGridMeta : gridMeta;
  if (!source) throw new Error('No hay rejilla DEM para generar el campo vectorial.');

  width = Math.max(24, Math.min(256, Math.round(width)));
  height = Math.max(24, Math.min(256, Math.round(height)));
  const data = new Float32Array(width * height * 4);
  const dx = (source.east - source.west) / Math.max(1, width - 1);
  const dy = (source.north - source.south) / Math.max(1, height - 1);
  const meanLat = (source.south + source.north) * 0.5;
  const widthM = Math.max(1, (source.east - source.west) * 111320 * Math.cos(meanLat * Math.PI / 180));
  const heightM = Math.max(1, (source.north - source.south) * 111320);
  const probe = Math.max(55, Math.min(420, Math.max(widthM / width, heightM / height) * 1.6));
  let valid = 0;

  for (let y = 0; y < height; y += 1) {
    const lat = source.south + y * dy;
    for (let x = 0; x < width; x += 1) {
      const lon = source.west + x * dx;
      const sample = engine.model.localFlowAt(
        lon,
        lat,
        engine.fromDeg ?? 315,
        engine.model.speedKmh,
        probe
      );
      const offset = (y * width + x) * 4;
      if (!sample) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        continue;
      }
      const speedMs = sample.localSpeedKmh / 3.6;
      const bearing = sample.localBearing * Math.PI / 180;
      data[offset] = speedMs * Math.sin(bearing);
      data[offset + 1] = speedMs * Math.cos(bearing);
      data[offset + 2] = sample.w;
      data[offset + 3] = sample.venturiBoost;
      valid += 1;
    }
  }

  return {
    width,
    height,
    valid,
    probe,
    bounds: {
      west: source.west,
      south: source.south,
      east: source.east,
      north: source.north
    },
    data
  };
}

self.onmessage = event => {
  const message = event.data || {};
  const { id, type } = message;

  try {
    if (type === 'init') {
      const grid = {
        ...message.grid,
        values: new Float32Array(message.gridBuffer)
      };
      gridMeta = metaFor(grid);
      regionalSampler = createGridSampler(grid);
      localSampler = null;
      localGridMeta = null;
      engine = new WindParticleEngine({
        terrainSampler: compositeSampler,
        site: message.site,
        areaKm: message.areaKm || 40,
        stability: message.controls?.stability || 'neutral',
        speedKmh: message.controls?.speedKmh || 20,
        exaggeration: message.controls?.exaggeration || 1.35
      });
      engine.setWind(message.controls || {});
      reply(id, 'ready', { grid: gridMeta });
      return;
    }

    if (!engine) throw new Error('Worker aerológico no inicializado.');

    if (type === 'setLocalGrid') {
      if (message.clear) {
        localSampler = null;
        localGridMeta = null;
        reply(id, 'localGrid', { grid: null });
        return;
      }
      const grid = {
        ...message.grid,
        values: new Float32Array(message.gridBuffer)
      };
      localSampler = createGridSampler(grid);
      localGridMeta = metaFor(grid);
      reply(id, 'localGrid', { grid: localGridMeta });
      return;
    }

    if (type === 'buildField') {
      const field = buildVectorField(message);
      const buffer = field.data.buffer;
      reply(id, 'field', {
        width: field.width,
        height: field.height,
        valid: field.valid,
        probe: field.probe,
        bounds: field.bounds,
        fieldBuffer: buffer
      }, [buffer]);
      return;
    }

    if (type === 'build') {
      const controls = message.controls || {};
      engine.setWind(controls);

      if (message.global) engine.buildGlobal(message.globalOptions || {});

      if (message.local) {
        if (message.localOptions?.count > 0) engine.buildLocal(message.localOptions);
        else engine.localStreams = [];
      }

      if (message.selected) {
        engine.buildSelected(
          message.selected.lon,
          message.selected.lat,
          message.selected.options || {}
        );
      } else if (message.clearSelected) {
        engine.selectedStream = null;
      }

      reply(id, 'result', {
        globalStreams: message.global ? engine.globalStreams : null,
        localStreams: message.local ? engine.localStreams : null,
        selectedStream: message.selected || message.clearSelected ? engine.selectedStream : undefined,
        siteSample: engine.sampleSite(180),
        localGrid: localGridMeta
      });
      return;
    }

    if (type === 'sample') {
      engine.setWind(message.controls || {});
      reply(id, 'sample', { sample: engine.sampleSite(message.probe || 180) });
      return;
    }

    throw new Error(`Mensaje de worker desconocido: ${type}`);
  } catch (error) {
    reply(id, 'error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : ''
    });
  }
};
