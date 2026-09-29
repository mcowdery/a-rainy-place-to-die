import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { CELL, DISTRICTS3 } from '../src/poc3d/district/plan';
import { District } from '../src/poc3d/district/world';
import { Terrain } from '../src/poc3d/district/terrain';

const content = loadDistrictContent();
const T = content.terrain;

describe('the terraces', () => {
  it('lifts the terrace cells to flat plateaus, and slopes the cells round them without a step', () => {
    const campus = new Terrain([{ name: 't', cells: [2, 2, 4, 4], level: 12 }]);
    // On the plateau: level everywhere.
    for (const [x, z] of [[2.1, 2.1], [3.9, 3.9], [3, 3]]) expect(campus.height(x * CELL, z * CELL)).toBeCloseTo(12, 5);
    // Off it: down to 0 a cell away, continuously (no step bigger than the slope allows over a metre).
    expect(campus.height(5.5 * CELL, 3 * CELL)).toBe(0);
    for (let x = 0; x < 6 * CELL; x += 1) {
      const d = Math.abs(campus.height(x + 1, 3.3 * CELL) - campus.height(x, 3.3 * CELL));
      expect(d).toBeLessThan(12 / CELL + 1e-6);
    }
    // A building on the slope stands at the lowest ground under it.
    const x = 4.5 * CELL;
    expect(campus.footing(x, 3 * CELL, 20, 10)).toBeCloseTo(campus.height(x + 10, 3 * CELL), 5);
  });

  it('raises Gakuenzaka and the temple, and keeps the rail, stations and expressway on level ground', () => {
    const uni = content.placed.find((p) => p.id === 'university')!;
    expect(T.height(uni.building.x, uni.building.z)).toBeCloseTo(12, 5);
    expect(T.footing(uni.building.x, uni.building.z, uni.building.w, uni.building.d)).toBeCloseTo(12, 5);
    const temple = content.placed.find((p) => p.id === 'tokoji')!;
    expect(T.footing(temple.building.x, temple.building.z, temple.building.w, temple.building.d)).toBeCloseTo(6, 5);
    // The Toto Line's viaduct, the stations, the subway stations: all at ground 0.
    for (const p of content.placed.filter((q) => q.stamp.landmark === 'station' || q.stamp.landmark === 'subway')) {
      const b = p.building;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) expect(T.height(b.x + (dx * b.w) / 2, b.z + (dz * b.d) / 2), p.id).toBe(0);
    }
    if (content.rail) for (let z = content.rail.z0; z <= content.rail.z1; z += 8) expect(T.height(content.rail.x, z)).toBe(0);
  });

  it('walks up the hill: the floor follows the ground, and street level on the plateau is still street level', () => {
    const d = new District(content.macro, DISTRICTS3, content.placed, 7, content.zones, content.avenues, content.bridges, T);
    // Down the middle of the slope below the university (row 5), from the plateau's edge to Kita-ōdōri.
    const x = 23.5 * CELL;
    let last = d.floorAt(x, 5 * CELL);
    expect(last).toBeCloseTo(12, 3);
    for (let z = 5 * CELL; z <= 6 * CELL; z += 2) {
      const y = d.floorAt(x, z);
      expect(Math.abs(y - last)).toBeLessThan(0.3);
      last = y;
    }
    expect(last).toBeCloseTo(0, 3);
    // Buildings on the plateau still collide (the walker's level there counts as street level).
    const p = d.plan(23, 3)!;
    const b = p.buildings[0];
    expect(d.blocked(b.x, b.z, 0.4, 12)).toBe(true);
    expect(d.aboveGround(b.x, b.z, 12 + 1.7)).toBeCloseTo(1.7, 5);
  });
});
