import {
  angleDiff,
  blendBearing,
  clamp,
  destination,
  distanceM,
  normalizeBearing,
  pathLength
} from './geo.js';

const MAX_CHANNEL_DEFLECTION = 40;

const STABILITY = {
  stable: { lift: 1.08, wake: 1.45, mix: 0.72, channel: 1.12 },
  unstable: { lift: 0.82, wake: 0.52, mix: 1.35, channel: 0.78 },
  neutral: { lift: 0.96, wake: 1.0, mix: 1.0, channel: 1.0 }
};

export function colorFor(w, wake) {
  if (wake > 0.65) return [255, 184, 77, 225];
  if (w > 0.55) return [53, 226, 127, 225];
  if (w < -0.55) return [255, 92, 108, 225];
  return [90, 200, 250, 205];
}

export function classFor(w, wake) {
  if (wake > 0.65) return 'estela / rotor probable';
  if (w > 0.55) return 'ascendencia orográfica';
  if (w < -0.55) return 'descendencia / sotavento';
  return 'flujo casi neutro';
}

export class FlowModel {
  constructor({ terrainSampler, stability = 'neutral', speedKmh = 20, exaggeration = 1.35 } = {}) {
    if (typeof terrainSampler !== 'function') {
      throw new TypeError('FlowModel necesita un terrainSampler(lon, lat).');
    }
    this.terrainSampler = terrainSampler;
    this.stability = stability;
    this.speedKmh = speedKmh;
    this.exaggeration = exaggeration;
  }

  configure({ stability, speedKmh, exaggeration } = {}) {
    if (stability) this.stability = stability;
    if (Number.isFinite(speedKmh)) this.speedKmh = speedKmh;
    if (Number.isFinite(exaggeration)) this.exaggeration = exaggeration;
  }

  params() {
    return STABILITY[this.stability] || STABILITY.neutral;
  }

  terrainElev(lon, lat) {
    const value = this.terrainSampler(lon, lat);
    return Number.isFinite(value) ? value : null;
  }

  channelAt(lon, lat, baseFlow, ground, probe) {
    const offsets = [-40, -20, 0, 20, 40];
    const sideDist = clamp(probe * 2.0, 140, 600);
    const alongDist = clamp(probe * 1.35, 120, 450);
    let best = { offset: 0, score: -Infinity };
    let baseScore = -Infinity;

    for (const offset of offsets) {
      const bearing = normalizeBearing(baseFlow + offset);
      const left = destination(lon, lat, (bearing + 270) % 360, sideDist);
      const right = destination(lon, lat, (bearing + 90) % 360, sideDist);
      const ahead = destination(lon, lat, bearing, alongDist);
      const behind = destination(lon, lat, (bearing + 180) % 360, alongDist);
      const hL = this.terrainElev(left[0], left[1]);
      const hR = this.terrainElev(right[0], right[1]);
      const hF = this.terrainElev(ahead[0], ahead[1]);
      const hB = this.terrainElev(behind[0], behind[1]);
      if ([hL, hR, hF, hB].some(value => value === null)) continue;

      const wallL = hL - ground;
      const wallR = hR - ground;
      const wallRise = Math.max(0, Math.min(wallL, wallR));
      const balance = 1 - clamp(
        Math.abs(wallL - wallR) / (Math.abs(wallL) + Math.abs(wallR) + 80),
        0,
        1
      );
      const alongBarrier = Math.max(0, Math.min(hF - ground, hB - ground));
      const score = wallRise * (0.58 + 0.42 * balance) - alongBarrier * 0.68;

      if (offset === 0) baseScore = score;
      if (score > best.score) best = { offset, score };
    }

    if (!Number.isFinite(best.score) || best.score < 10 || best.offset === 0) {
      return {
        bearing: baseFlow,
        deflection: 0,
        strength: 0,
        score: Number.isFinite(best.score) ? best.score : 0
      };
    }

    if (!Number.isFinite(baseScore)) baseScore = 0;
    const advantage = Math.max(0, best.score - baseScore);
    const params = this.params();
    let strength = clamp((best.score - 10) / 115, 0, 1) *
      clamp(advantage / 42, 0, 1) * params.channel;
    strength = clamp(strength, 0, 1);
    const deflection = clamp(
      best.offset * strength,
      -MAX_CHANNEL_DEFLECTION,
      MAX_CHANNEL_DEFLECTION
    );

    return {
      bearing: normalizeBearing(baseFlow + deflection),
      deflection,
      strength,
      score: best.score
    };
  }

  venturiAt(lon, lat, bearing, ground, probe, hL = null, hR = null) {
    const leftNearPoint = hL === null
      ? destination(lon, lat, (bearing + 270) % 360, probe)
      : null;
    const rightNearPoint = hR === null
      ? destination(lon, lat, (bearing + 90) % 360, probe)
      : null;
    const leftNear = hL === null ? this.terrainElev(leftNearPoint[0], leftNearPoint[1]) : hL;
    const rightNear = hR === null ? this.terrainElev(rightNearPoint[0], rightNearPoint[1]) : hR;
    const leftFarPoint = destination(lon, lat, (bearing + 270) % 360, probe * 2.2);
    const rightFarPoint = destination(lon, lat, (bearing + 90) % 360, probe * 2.2);
    const leftFar = this.terrainElev(leftFarPoint[0], leftFarPoint[1]);
    const rightFar = this.terrainElev(rightFarPoint[0], rightFarPoint[1]);
    const rise = (height, distance) => height === null ? 0 : (height - ground) / distance;
    const near = Math.max(0, Math.min(rise(leftNear, probe), rise(rightNear, probe)));
    const far = Math.max(0, Math.min(rise(leftFar, probe * 2.2), rise(rightFar, probe * 2.2)));
    const confinement = Math.max(near, far * 0.85);
    const boost = clamp(confinement * 2.6, 0, 0.70);
    return { factor: 1 + boost, boost, confinement };
  }

  localFlowAt(lon, lat, fromDeg, speedKmh = this.speedKmh, probe = 180) {
    const baseFlow = (fromDeg + 180) % 360;
    const params = this.params();
    const h0 = this.terrainElev(lon, lat);
    if (h0 === null) return null;

    const channel = this.channelAt(lon, lat, baseFlow, h0, probe);
    const bearing = channel.bearing;
    const behind = destination(lon, lat, (bearing + 180) % 360, probe);
    const ahead = destination(lon, lat, bearing, probe);
    const left = destination(lon, lat, (bearing + 270) % 360, probe);
    const right = destination(lon, lat, (bearing + 90) % 360, probe);
    const hb = this.terrainElev(behind[0], behind[1]);
    const ha = this.terrainElev(ahead[0], ahead[1]);
    const hL = this.terrainElev(left[0], left[1]);
    const hR = this.terrainElev(right[0], right[1]);
    if ([hb, ha].some(value => value === null)) return null;

    const venturi = this.venturiAt(lon, lat, bearing, h0, probe, hL, hR);
    const localSpeedKmh = speedKmh * venturi.factor;
    const velocityMs = localSpeedKmh / 3.6;
    const slope = (ha - hb) / (2 * probe);
    const w = clamp(velocityMs * slope * 1.55 * params.lift, -5.5, 5.5);

    return {
      elev: h0,
      w,
      slope,
      localSpeedKmh,
      venturiBoost: venturi.boost,
      localBearing: bearing,
      channelStrength: channel.strength,
      channelDeflection: channel.deflection
    };
  }

  traceStream(start, flow, totalM, step, phase = 0, kind = 'global') {
    const baseSpeed = this.speedKmh;
    const params = this.params();
    const exag = this.exaggeration;
    const path = [];
    const values = [];
    let pos = [start[0], start[1]];
    let crest = -Infinity;
    let crestAge = 999999;
    let airAlt = null;
    let bearing = flow;
    const probe = clamp(step * 0.65, 55, 420);
    const response = kind === 'selected' ? 0.68 : kind === 'local' ? 0.55 : 0.42;

    for (let traveled = 0; traveled <= totalM; traveled += step) {
      const ground = this.terrainElev(pos[0], pos[1]);
      if (ground === null) {
        pos = destination(pos[0], pos[1], bearing, step);
        continue;
      }

      const channel = this.channelAt(pos[0], pos[1], flow, ground, probe);
      bearing = blendBearing(bearing, channel.bearing, response);
      bearing = normalizeBearing(
        flow + clamp(angleDiff(bearing, flow), -MAX_CHANNEL_DEFLECTION, MAX_CHANNEL_DEFLECTION)
      );
      const actualDeflection = angleDiff(bearing, flow);
      const behind = destination(pos[0], pos[1], (bearing + 180) % 360, probe);
      const ahead = destination(pos[0], pos[1], bearing, probe);
      const left = destination(pos[0], pos[1], (bearing + 270) % 360, probe);
      const right = destination(pos[0], pos[1], (bearing + 90) % 360, probe);
      const hb = this.terrainElev(behind[0], behind[1]);
      const ha = this.terrainElev(ahead[0], ahead[1]);
      const hL = this.terrainElev(left[0], left[1]);
      const hR = this.terrainElev(right[0], right[1]);
      if ([hb, ha].some(value => value === null)) {
        pos = destination(pos[0], pos[1], bearing, step);
        continue;
      }

      const venturi = this.venturiAt(pos[0], pos[1], bearing, ground, probe, hL, hR);
      const rawLocalSpeed = baseSpeed * venturi.factor;
      const velocityMs = rawLocalSpeed / 3.6;
      const slope = (ha - hb) / (2 * probe);
      const climb = clamp(velocityMs * slope * 1.55 * params.lift, -5.5, 5.5);

      if (ground > crest) {
        crest = ground;
        crestAge = 0;
      } else {
        crestAge += step;
      }

      const drop = Math.max(0, crest - ground);
      const wake = clamp(
        drop / 650 * Math.exp(-crestAge / (5200 * params.mix)) *
        params.wake * (rawLocalSpeed / 25),
        0,
        1.4
      );
      const localSpeedKmh = rawLocalSpeed * (1 - Math.min(wake, 1) * 0.08);
      const w = clamp(climb - wake * 1.15, -6, 6);

      if (airAlt === null) airAlt = ground + 145 + phase * 65;
      const minimumAgl = kind === 'selected' ? 85 : kind === 'local' ? 120 : 165;
      const targetAlt = ground + minimumAgl + Math.max(w, 0) * 26;
      airAlt += (targetAlt - airAlt) * 0.16 + w * 2.4;
      airAlt = Math.max(airAlt, ground + minimumAgl);

      path.push([pos[0], pos[1], airAlt * exag]);
      values.push({
        elev: ground,
        w,
        wake,
        slope,
        localSpeedKmh,
        venturiBoost: venturi.boost,
        localBearing: bearing,
        channelStrength: channel.strength,
        channelDeflection: actualDeflection,
        color: colorFor(w, wake)
      });

      pos = destination(pos[0], pos[1], bearing, step);
    }

    if (path.length < 2) return null;
    return this.finalizeStream({ path, values, phase, kind });
  }

  finalizeStream(stream) {
    const timeline = [0];
    let totalTime = 0;
    for (let i = 1; i < stream.path.length; i += 1) {
      const distance = distanceM(
        stream.path[i - 1][0], stream.path[i - 1][1],
        stream.path[i][0], stream.path[i][1]
      );
      const a = stream.values[i - 1] || {};
      const b = stream.values[i] || {};
      const speedKmh = ((a.localSpeedKmh || this.speedKmh) + (b.localSpeedKmh || this.speedKmh)) / 2;
      totalTime += distance / Math.max(speedKmh / 3.6, 0.8);
      timeline.push(totalTime);
    }
    stream.timeline = timeline;
    stream.totalTime = Math.max(totalTime, 1);
    stream.lengthM = pathLength(stream.path);
    return stream;
  }
}
