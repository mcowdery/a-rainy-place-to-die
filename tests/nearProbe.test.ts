import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { District, OBSTACLE_R } from '../src/poc3d/district/world';
import { NearObstacle } from '../src/poc3d/district/nearProbe';

// Your car's probes (NearObstacle) have to answer as District.obstacle does, whichever way they are made: near the
// last gathering, far from it, with a radius past what a gathering holds, and after the clock has moved on.
const content = loadDistrictContent();
const district = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues);

describe('NearObstacle', () => {
  it('answers as District.obstacle does, and gathers rarely', () => {
    let seed = 5;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let clock = 0;
    const near = new NearObstacle(district, 110, 1000, () => clock);
    const radii = [0.35, 0.9, 1.6, OBSTACLE_R, OBSTACLE_R + 1];
    // A car driving 30 m/s through Asagiri and Kaburo, 60 probes a frame (a few metres round it) at 60 frames a second, and now and then a far one.
    let x = 23.5 * CELL;
    const z = 11.5 * CELL;
    let probes = 0;
    for (let frame = 0; frame < 600; frame++) {
      clock += 1000 / 60;
      x += 0.5;
      for (let i = 0; i < 60; i++) {
        const far = i === 59 && frame % 50 === 0;
        const px = x + (far ? (rand() * 2 - 1) * 400 : (rand() * 2 - 1) * 6);
        const pz = z + (far ? (rand() * 2 - 1) * 400 : (rand() * 2 - 1) * 6);
        const r = radii[i % radii.length];
        expect(near.probe(px, pz, r), `frame ${frame} (${px.toFixed(1)}, ${pz.toFixed(1)}) r ${r}`).toBe(district.obstacle(px, pz, r));
        probes++;
      }
    }
    // Ten seconds: a gathering a second, and a few for the far probes; most probes answered from the gathering.
    expect(near.gathers).toBeLessThan(40);
    expect(near.slow).toBeLessThan(probes * 0.4);
  }, 60_000);

  it('is much quicker than District.obstacle for probes near one another', () => {
    const near = new NearObstacle(district);
    const x0 = 29.5 * CELL;
    const z0 = 11.5 * CELL;
    const pts: [number, number][] = Array.from({ length: 2000 }, (_, i) => [x0 + (i % 40) * 0.3, z0 + Math.floor(i / 40) * 0.3]);
    const time = (f: (x: number, z: number, r: number) => unknown): number => {
      const t = performance.now();
      for (const [px, pz] of pts) f(px, pz, 1.2);
      return performance.now() - t;
    };
    time(near.probe);
    const slow = time((px, pz, r) => district.obstacle(px, pz, r));
    const fast = time(near.probe);
    console.log(`2000 probes: obstacle ${slow.toFixed(1)} ms, NearObstacle ${fast.toFixed(1)} ms`);
    expect(fast).toBeLessThan(slow);
  });
});
