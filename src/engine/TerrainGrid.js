import { destination } from './geo.js';

export function boundsAroundSite(site, spanKm = 58) {
  const half = spanKm * 500;
  const south = destination(site.lon, site.lat, 180, half)[1];
  const north = destination(site.lon, site.lat, 0, half)[1];
  const west = destination(site.lon, site.lat, 270, half)[0];
  const east = destination(site.lon, site.lat, 90, half)[0];
  return { west, south, east, north };
}

export async function buildTerrainGrid({
  map,
  bounds,
  width = 221,
  height = 221,
  rowsPerSlice = 4,
  signal,
  onProgress
} = {}) {
  if (!map) throw new TypeError('buildTerrainGrid necesita una instancia de MapLibre.');
  if (!bounds) throw new TypeError('buildTerrainGrid necesita límites geográficos.');

  const values = new Float32Array(width * height);
  values.fill(Number.NaN);

  const dx = (bounds.east - bounds.west) / Math.max(1, width - 1);
  const dy = (bounds.north - bounds.south) / Math.max(1, height - 1);

  let valid = 0;
  for (let y = 0; y < height; y += 1) {
    if (signal?.aborted) throw new DOMException('Operación cancelada', 'AbortError');
    const lat = bounds.south + dy * y;

    for (let x = 0; x < width; x += 1) {
      const lon = bounds.west + dx * x;
      try {
        const elevation = map.queryTerrainElevation([lon, lat], { exaggerated: false });
        if (Number.isFinite(elevation)) {
          values[y * width + x] = elevation;
          valid += 1;
        }
      } catch {
        // Dejamos NaN. El sampler interpolado devolverá null fuera de datos válidos.
      }
    }

    if (typeof onProgress === 'function') onProgress((y + 1) / height, valid);
    if ((y + 1) % rowsPerSlice === 0) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }

  return {
    west: bounds.west,
    south: bounds.south,
    east: bounds.east,
    north: bounds.north,
    width,
    height,
    values,
    valid
  };
}

export function createGridSampler(grid) {
  const { west, south, east, north, width, height, values } = grid;
  const lonScale = (width - 1) / (east - west);
  const latScale = (height - 1) / (north - south);

  return (lon, lat) => {
    const gx = (lon - west) * lonScale;
    const gy = (lat - south) * latScale;
    if (gx < 0 || gy < 0 || gx > width - 1 || gy > height - 1) return null;

    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;

    const a = values[y0 * width + x0];
    const b = values[y0 * width + x1];
    const c = values[y1 * width + x0];
    const d = values[y1 * width + x1];
    if (![a, b, c, d].every(Number.isFinite)) return null;

    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
  };
}
