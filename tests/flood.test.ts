import { describe, expect, it } from 'vitest';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { wheelWater, wading } from '../src/poc3d/district/roadGrip';
import { FloodField, MAX_DEPTH } from '../src/poc3d/real/flood';

describe('flooding', () => {
  const c = loadDistrictContent('manila');
  const field = new FloodField(c.macro, 128, c.terrain);

  it('is nothing under the threshold, deeper with the flood, never over the cap', () => {
    expect(field.depthAt(2400, 1700, 0.04)).toBe(0);
    expect(field.depthAt(2400, 1700, 1)).toBeGreaterThan(field.depthAt(2400, 1700, 0.5));
    for (let x = 0; x < 5000; x += 211) for (let z = 0; z < 3500; z += 197) expect(field.depthAt(x, z, 1)).toBeLessThanOrEqual(MAX_DEPTH + 1e-6);
  });

  it('floods the low ground beside the river deeper than the ground far from water', () => {
    // Col 20 is the Pasig: just west of it against far in the west.
    expect(field.lowAt(2500, 1700)).toBeGreaterThan(field.lowAt(300, 1700));
  });

  it('drags a car wading through it, and not a dry one', () => {
    const wheels = [[0, 0], [1.5, 0], [0, -2.5], [1.5, -2.5]] as const;
    const dry = wheelWater(wheels, 15, { wet: 1, snow: 0 });
    const deep = wheelWater(wheels, 15, { wet: 1, snow: 0, floodAt: () => 0.3 });
    expect(deep.drag).toBeGreaterThan(dry.drag + 2);
    expect(wading(0.3)).toBe(1);
    expect(wading(0.01)).toBe(0);
  });
});
