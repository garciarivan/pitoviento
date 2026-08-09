import { FlowModel } from './flowModel.js';
import { clamp, destination, normalizeBearing } from './geo.js';

export class WindParticleEngine {
  constructor({ terrainSampler, site, areaKm = 40, stability = 'neutral', speedKmh = 20, exaggeration = 1.35 } = {}) {
    this.site = site;
    this.areaKm = areaKm;
    this.model = new FlowModel({ terrainSampler, stability, speedKmh, exaggeration });
    this.globalStreams = [];
    this.localStreams = [];
    this.selectedStream = null;
  }

  configure(config = {}) {
    this.model.configure(config);
  }

  get flowBearing() {
    return normalizeBearing((this.fromDeg ?? 315) + 180);
  }

  setWind({ fromDeg, speedKmh, stability, exaggeration } = {}) {
    if (Number.isFinite(fromDeg)) this.fromDeg = normalizeBearing(fromDeg);
    this.model.configure({ speedKmh, stability, exaggeration });
  }

  clear() {
    this.globalStreams = [];
    this.localStreams = [];
    this.selectedStream = null;
  }

  sampleSite(probe = 180) {
    if (!this.site) return null;
    return this.model.localFlowAt(
      this.site.lon,
      this.site.lat,
      this.fromDeg ?? 315,
      this.model.speedKmh,
      probe
    );
  }

  buildGlobal({ density = 27, totalM = 40000, step = 850 } = {}) {
    if (!this.site) return [];
    const count = clamp(Math.round(density * 2.5), density, 75);
    const flow = this.flowBearing;
    const cross = normalizeBearing(flow + 90);
    const upstream = destination(this.site.lon, this.site.lat, normalizeBearing(flow + 180), totalM * 0.46);
    const span = this.areaKm * 1000 * 1.08;
    const streams = [];

    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const offset = (t - 0.5) * span;
      const seed = destination(upstream[0], upstream[1], offset >= 0 ? cross : normalizeBearing(cross + 180), Math.abs(offset));
      const phase = (i % 11) / 11;
      const stream = this.model.traceStream(seed, flow, totalM, step, phase, 'global');
      if (stream) streams.push(stream);
    }

    this.globalStreams = streams;
    return streams;
  }

  buildLocal({ center = this.site, count = 71, spacingM = 70, totalM = 12000, step = 120 } = {}) {
    if (!center) return [];
    const flow = this.flowBearing;
    const cross = normalizeBearing(flow + 90);
    const upstream = destination(center.lon, center.lat, normalizeBearing(flow + 180), totalM * 0.38);
    const streams = [];

    for (let i = 0; i < count; i += 1) {
      const centered = i - (count - 1) / 2;
      const offset = centered * spacingM;
      const seed = destination(upstream[0], upstream[1], offset >= 0 ? cross : normalizeBearing(cross + 180), Math.abs(offset));
      const phase = ((i * 7) % 19) / 19;
      const stream = this.model.traceStream(seed, flow, totalM, step, phase, 'local');
      if (stream) streams.push(stream);
    }

    this.localStreams = streams;
    return streams;
  }

  buildSelected(lon, lat, { totalM = 15000, step = 75 } = {}) {
    const stream = this.model.traceStream([lon, lat], this.flowBearing, totalM, step, 0, 'selected');
    this.selectedStream = stream;
    return stream;
  }
}
