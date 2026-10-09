import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { District, OBSTACLE_R } from '../src/poc3d/district/world';

// The chase cars' local probe (District.obstacleNear) has to answer exactly as District.obstacle does: it replaced
// ~50 calls a frame a car, which were two thirds of the CPU in the long run.
const content = loadDistrictContent();
const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);

describe('District.obstacleNear', () => {
  it('answers as obstacle does, at any radius up to OBSTACLE_R, over streets, blocks and set pieces', () => {
    let seed = 99;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const radii = [0.35, 0.8, 1.2, 1.6, OBSTACLE_R];
    // (Kaburo's core, Asagiri, and the electric town: dense, towers, and a set piece or two.)
    for (const [cx, cz] of [[29.5 * CELL, 11.5 * CELL], [23.5 * CELL, 11.5 * CELL], [32 * CELL, 10.5 * CELL]]) {
      const pad = 70;
      const near = district.obstacleNear(cx, cz, pad);
      const seen = new Set<string | null>();
      for (let i = 0; i < 3000; i++) {
        const x = cx + (rand() * 2 - 1) * (pad - 3);
        const z = cz + (rand() * 2 - 1) * (pad - 3);
        const r = radii[i % radii.length];
        const want = district.obstacle(x, z, r);
        seen.add(want);
        expect(near(x, z, r), `(${x.toFixed(1)}, ${z.toFixed(1)}) r ${r}`).toBe(want);
      }
      // (Walls, and open street, at least: or the check says nothing.)
      expect(seen.has('wall')).toBe(true);
      expect(seen.has(null)).toBe(true);
    }
  });
});
