import { MapboxOverlay } from '@deck.gl/mapbox';
import { ScatterplotLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';

const CYCLE = 100;

function streamToTrip(stream, cycle = CYCLE) {
  if (!stream?.path?.length || !stream.timeline?.length) return null;
  const totalTime = Math.max(stream.totalTime || 1, 1);
  return {
    path: stream.path,
    timestamps: stream.timeline.map(value => (value / totalTime) * cycle),
    color: stream.values?.[Math.floor((stream.values.length - 1) / 2)]?.color || [90, 200, 250, 205]
  };
}

function makeCopies(trips, copies) {
  const output = [];
  for (const trip of trips) {
    if (!trip) continue;
    for (let copy = 0; copy < copies; copy += 1) {
      const offset = (CYCLE / copies) * copy;
      output.push({
        path: trip.path,
        color: trip.color,
        timestamps: trip.timestamps.map(value => value + offset)
      });
    }
  }
  return output;
}

export class DeckParticleRenderer {
  constructor({ map, widthMinPixels = 1.2, trailLength = 2.4 } = {}) {
    if (!map) throw new TypeError('DeckParticleRenderer necesita una instancia de MapLibre.');
    this.map = map;
    this.widthMinPixels = widthMinPixels;
    this.trailLength = trailLength;
    this.currentTime = 0;
    this.overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(this.overlay);
    this.data = { global: [], local: [], selected: null, probe: null };
  }

  setStreams({ global = [], local = [], selected = null } = {}) {
    this.data.global = global;
    this.data.local = local;
    this.data.selected = selected;
    this.render();
  }

  setProbe(position) {
    this.data.probe = position;
    this.render();
  }

  setCurrentTime(time) {
    this.currentTime = time % CYCLE;
    this.render();
  }

  buildTrips() {
    const globalTrips = makeCopies(this.data.global.map(streamToTrip), 4);
    const localTrips = makeCopies(this.data.local.map(streamToTrip), 7);
    const selectedTrips = this.data.selected ? makeCopies([streamToTrip(this.data.selected)], 9) : [];
    return { globalTrips, localTrips, selectedTrips };
  }

  render() {
    const { globalTrips, localTrips, selectedTrips } = this.buildTrips();
    const layers = [];

    if (globalTrips.length || localTrips.length) {
      layers.push(new TripsLayer({
        id: 'pitoviento-next-trips',
        data: [...globalTrips, ...localTrips],
        getPath: item => item.path,
        getTimestamps: item => item.timestamps,
        getColor: item => item.color,
        currentTime: this.currentTime,
        trailLength: this.trailLength,
        widthMinPixels: this.widthMinPixels,
        capRounded: true,
        jointRounded: true,
        opacity: 0.92
      }));
    }

    if (selectedTrips.length) {
      layers.push(new TripsLayer({
        id: 'pitoviento-next-selected',
        data: selectedTrips,
        getPath: item => item.path,
        getTimestamps: item => item.timestamps,
        getColor: () => [255, 255, 255, 245],
        currentTime: this.currentTime,
        trailLength: 4.2,
        widthMinPixels: 2.0,
        capRounded: true,
        jointRounded: true
      }));
    }

    if (this.data.probe) {
      layers.push(new ScatterplotLayer({
        id: 'pitoviento-next-probe',
        data: [this.data.probe],
        getPosition: point => point,
        getRadius: 34,
        radiusUnits: 'meters',
        getFillColor: [255, 255, 255, 230],
        stroked: true,
        getLineColor: [20, 20, 20, 220],
        lineWidthMinPixels: 1
      }));
    }

    this.overlay.setProps({ layers });
  }

  destroy() {
    if (this.overlay) {
      this.map.removeControl(this.overlay);
      this.overlay = null;
    }
  }
}
