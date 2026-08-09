export const EARTH_RADIUS_M = 6371008.8;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const toRad = degrees => degrees * Math.PI / 180;
export const toDeg = radians => radians * 180 / Math.PI;
export const normalizeBearing = degrees => ((degrees % 360) + 360) % 360;

export function angleDiff(target, source) {
  return ((target - source + 540) % 360) - 180;
}

export function blendBearing(current, target, factor) {
  return normalizeBearing(current + angleDiff(target, current) * factor);
}

export function destination(lon, lat, bearingDeg, distanceM) {
  const bearing = toRad(bearingDeg);
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)];
}

export function distanceM(aLon, aLat, bLon, bLat) {
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const deltaLat = toRad(bLat - aLat);
  const deltaLon = toRad(bLon - aLon);
  const h = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += distanceM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  }
  return Math.max(total, 1);
}

export function compassLabel(degrees) {
  const names = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  return names[Math.round(normalizeBearing(degrees) / 22.5) % 16];
}
