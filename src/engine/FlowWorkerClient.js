export class FlowWorkerClient {
  constructor() {
    this.worker = new Worker(new URL('./flowWorker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();

    this.worker.onmessage = event => {
      const message = event.data || {};
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === 'error') pending.reject(new Error(message.message || 'Error del worker aerológico.'));
      else pending.resolve(message);
    };

    this.worker.onerror = event => {
      const error = new Error(event.message || 'Error no controlado del worker aerológico.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  request(type, payload = {}, transfer = []) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  async init({ grid, site, areaKm, controls }) {
    const buffer = grid.values.buffer;
    return this.request('init', {
      grid: {
        west: grid.west,
        south: grid.south,
        east: grid.east,
        north: grid.north,
        width: grid.width,
        height: grid.height,
        valid: grid.valid
      },
      gridBuffer: buffer,
      site,
      areaKm,
      controls
    }, [buffer]);
  }

  setLocalGrid(grid = null) {
    if (!grid) return this.request('setLocalGrid', { clear: true });
    const buffer = grid.values.buffer;
    return this.request('setLocalGrid', {
      grid: {
        west: grid.west,
        south: grid.south,
        east: grid.east,
        north: grid.north,
        width: grid.width,
        height: grid.height,
        valid: grid.valid
      },
      gridBuffer: buffer
    }, [buffer]);
  }

  build(payload) {
    return this.request('build', payload);
  }

  sample(payload) {
    return this.request('sample', payload);
  }

  destroy() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    const error = new Error('Worker aerológico destruido.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
