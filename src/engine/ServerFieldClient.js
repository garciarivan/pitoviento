const DEFAULT_API = 'http://localhost:8000';

function numberHeader(headers, name, fallback = 0) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : fallback;
}

export class ServerFieldClient {
  constructor(baseUrl = import.meta.env.VITE_WIND_API_URL || DEFAULT_API) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async health(signal) {
    const response = await fetch(`${this.baseUrl}/api/health`, { signal });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.json();
  }

  async buildField({ lat, lon, areaKm = 40, direction = 315, speed = 20, stability = 'neutral', width = 128, height = 128, signal } = {}) {
    const url = new URL(`${this.baseUrl}/api/wind-field`);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('area_km', String(areaKm));
    url.searchParams.set('direction', String(direction));
    url.searchParams.set('speed', String(speed));
    url.searchParams.set('stability', stability);
    url.searchParams.set('width', String(width));
    url.searchParams.set('height', String(height));

    const response = await fetch(url, { signal });
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.json())?.detail || '';
      } catch {}
      throw new Error(detail || `Error ${response.status} calculando el campo en servidor`);
    }

    const buffer = await response.arrayBuffer();
    const fieldWidth = numberHeader(response.headers, 'X-Field-Width', width);
    const fieldHeight = numberHeader(response.headers, 'X-Field-Height', height);
    const expectedBytes = fieldWidth * fieldHeight * 4 * 4;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Campo binario inválido: ${buffer.byteLength} bytes, esperados ${expectedBytes}`);
    }

    return {
      width: fieldWidth,
      height: fieldHeight,
      valid: numberHeader(response.headers, 'X-Field-Valid', fieldWidth * fieldHeight),
      bounds: {
        west: numberHeader(response.headers, 'X-Field-West'),
        south: numberHeader(response.headers, 'X-Field-South'),
        east: numberHeader(response.headers, 'X-Field-East'),
        north: numberHeader(response.headers, 'X-Field-North')
      },
      data: new Float32Array(buffer),
      meta: {
        cache: response.headers.get('X-Field-Cache') || 'UNKNOWN',
        computeMs: numberHeader(response.headers, 'X-Field-Compute-Ms'),
        demZoom: numberHeader(response.headers, 'X-DEM-Zoom')
      }
    };
  }
}
