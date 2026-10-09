import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { planFleet } from '../src/poc3d/real/boats';

// Manila's boats (real/boats.ts) stay on the water: the bay and the Pasig, and under no bridge deck.
describe('Manila boats', () => {
  const c = loadDistrictContent('manila');
  const CELL = 128;
  const water = (x: number, z: number): boolean => {
    const mx = Math.floor(x / CELL), my = Math.floor(z / CELL);
    if (my >= c.macro.rows) return true;
    return c.macro.kindAt(mx, my) === 'water';
  };
  const bridges = [3, 8, 13, 17].map((r) => r * CELL);
  const pose = { x: 0, z: 0, yaw: 0 };
  it('has a fleet', () => expect(planFleet().length).toBeGreaterThan(30));
  it('sails only on water, and not under the bridges', () => {
    for (const cr of planFleet()) {
      for (let t = 0; t < 1200; t += 7) {
        if (cr.route) cr.route.at(cr.s0 + cr.speed * t, pose);
        else (pose.x = cr.x), (pose.z = cr.z);
        expect(water(pose.x, pose.z), `${cr.model} at ${pose.x | 0},${pose.z | 0}`).toBe(true);
        if (pose.x > 2540 && pose.x < 2710) for (const b of bridges) expect(Math.abs(pose.z - b), `${cr.model} under the bridge at ${b}`).toBeGreaterThan(20);
      }
    }
  });
});
