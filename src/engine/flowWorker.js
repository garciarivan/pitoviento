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

function reply(id, type, payload = {}) {
  self.postMessage({ id, type, ...payload });
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
