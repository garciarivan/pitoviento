const DEFAULT_API = import.meta.env.DEV ? 'http://localhost:8000' : '';

function requiredNumberHeader(headers, name) {
  const raw = headers.get(name);
  const value = Number(raw);
  if (raw === null || !Number.isFinite(value)) {
    throw new Error(`Cabecera ${name} ausente o inválida`);
  }
  return value;
}

function requiredIntegerHeader(headers, name) {
  const value = requiredNumberHeader(headers, name);
  if (!Number.isInteger(value)) throw new Error(`Cabecera ${name} debe ser un entero`);
  return value;
}

export class ServerFieldClient {
  constructor(baseUrl = import.meta.env.VITE_WIND_API_URL || DEFAULT_API) {
    this.baseUrl = (baseUrl || '').replace(/\/$/, '');
  }

  endpoint(path) {
    return this.baseUrl ? `${this.baseUrl}${path}` : path;
  }

  async health(signal) {
    const response = await fetch(this.endpoint('/api/health'), { signal });
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.json();
  }

  async buildField({ lat, lon, areaKm = 40, direction = 315, speed = 20, stability = 'neutral', width = 128, height = 128, signal } = {}) {
    const url = new URL(this.endpoint('/api/wind-field'), window.location.origin);
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

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('application/octet-stream')) {
      throw new Error(`Tipo de respuesta inválido: ${contentType || 'sin Content-Type'}`);
    }

    const fieldWidth = requiredIntegerHeader(response.headers, 'X-Field-Width');
    const fieldHeight = requiredIntegerHeader(response.headers, 'X-Field-Height');
    if (fieldWidth <= 0 || fieldHeight <= 0) {
      throw new Error(`Dimensiones de campo inválidas: ${fieldWidth}×${fieldHeight}`);
    }

    const west = requiredNumberHeader(response.headers, 'X-Field-West');
    const south = requiredNumberHeader(response.headers, 'X-Field-South');
    const east = requiredNumberHeader(response.headers, 'X-Field-East');
    const north = requiredNumberHeader(response.headers, 'X-Field-North');
    if (west >= east || south >= north) throw new Error('Límites geográficos del campo inválidos');

    const valid = requiredIntegerHeader(response.headers, 'X-Field-Valid');
    if (valid < 0 || valid > fieldWidth * fieldHeight) {
      throw new Error(`Número de muestras válidas fuera de rango: ${valid}`);
    }

    const buffer = await response.arrayBuffer();
    const expectedBytes = fieldWidth * fieldHeight * 4 * 4;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Campo binario invalido: ${buffer.byteLength} bytes, esperados ${expectedBytes}`);
    }

    return {
      width: fieldWidth,
      height: fieldHeight,
      valid,
      bounds: {
        west,
        south,
        east,
        north
      },
      data: new Float32Array(buffer),
      meta: {
        cache: response.headers.get('X-Field-Cache') || 'UNKNOWN',
        edgeCache: response.headers.get('x-vercel-cache') || 'UNKNOWN',
        computeMs: requiredNumberHeader(response.headers, 'X-Field-Compute-Ms'),
        demZoom: requiredNumberHeader(response.headers, 'X-DEM-Zoom')
      }
    };
  }
}
