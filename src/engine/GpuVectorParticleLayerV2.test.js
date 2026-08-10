import test from 'node:test';
import assert from 'node:assert/strict';

import { MOTION_SCALE, visualAdvectionMeters } from './GpuVectorParticleLayerV2.js';

test('la advección visual conserva las proporciones 5:20:55 km/h', () => {
  const dt = 1 / 60;
  const distance5 = visualAdvectionMeters(5 / 3.6, dt);
  const distance20 = visualAdvectionMeters(20 / 3.6, dt);
  const distance55 = visualAdvectionMeters(55 / 3.6, dt);

  assert.equal(MOTION_SCALE, 12);
  assert.ok(Math.abs(distance20 / distance5 - 4) < 1e-6);
  assert.ok(Math.abs(distance55 / distance5 - 11) < 1e-6);
});
