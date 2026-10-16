import { describe, expect, it } from 'vitest';
import { inPark, inPond, PARK, PONDS } from '../src/poc3d/district/parkLand';

describe('Yūnagi Riverside Park', () => {
  it('is the unbuilt land between the river and the headland, in whole cells', () => {
    for (const v of [PARK.x0, PARK.x1, PARK.z0, PARK.z1]) expect(v % 128).toBe(0);
    expect(inPark(5222, 2330)).toBe(true);
    expect(inPark(5222, 2290)).toBe(false);
    expect(inPark(5222, 2290, 20)).toBe(true);
  });

  it('closes its ponds, with their banks, to walkers and cars', () => {
    for (const p of PONDS) {
      expect(inPond(p.cx, p.cz)).toBe(true);
      expect(inPond(p.cx + p.a * 1.2, p.cz)).toBe(true);
      expect(inPond(p.cx + p.a * 1.6, p.cz)).toBe(false);
      expect(inPark(p.cx, p.cz)).toBe(true);
    }
  });
});
