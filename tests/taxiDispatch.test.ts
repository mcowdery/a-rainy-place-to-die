import { describe, expect, it } from 'vitest';
import { Approach, Polyline, sideOf, trimToUnseen } from '../src/poc3d/district/taxiDispatch';

// North up the road along x = 0, then a right turn east along z = -100, to the kerb at x = 120.
const route: [number, number][] = [
  [0, 0],
  [0, -100],
  [120, -100],
];

describe('called taxis', () => {
  it('drive the route smoothly, keeping left, slowing for the corner, and pull in at the end', () => {
    const a = new Approach(route);
    let prev = a.pose();
    let slowest = Infinity;
    let t = 0;
    for (; t < 60 && !a.arrived; t += 1 / 60) {
      a.step(1 / 60);
      const p = a.pose();
      // No jumps: never more than the speed allows in a frame (plus a little for the heading easing).
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(12 / 60 + 0.05);
      prev = p;
      if (Math.abs(a.d - 100) < 6) slowest = Math.min(slowest, a.v);
      // On the first straight, going north (-z), keep left: west of the centreline (x < 0).
      if (a.d > 10 && a.d < 80) expect(p.x).toBeLessThan(-1.2);
    }
    expect(a.arrived).toBe(true);
    expect(t).toBeLessThan(40);
    expect(slowest).toBeLessThan(6);
    // At the kerb: the end of the route, on the left of travel east (north of the line: z < -100).
    const p = a.pose();
    expect(Math.abs(p.x - 120)).toBeLessThan(1.5);
    expect(p.z).toBeLessThan(-101.5);
  });

  it('stops short of a vehicle in its way', () => {
    const a = new Approach(route);
    for (let t = 0; t < 10; t += 1 / 60) a.step(1 / 60, Math.max(0, 40 - a.d));
    expect(a.d).toBeLessThan(40);
    expect(a.v).toBeLessThan(0.5);
    expect(a.arrived).toBe(false);
  });

  it('sets out from the nearest point you cannot see, and knows which side of the road you are on', () => {
    const line = new Polyline(route);
    expect(line.length).toBeCloseTo(220, 5);
    // Everything within 150 m of the kerb is in view.
    const seen = (x: number, z: number): boolean => Math.hypot(x - 120, z + 100) < 150;
    const t = trimToUnseen(route, seen)!;
    expect(Math.hypot(t[0][0] - 120, t[0][1] + 100)).toBeGreaterThanOrEqual(150);
    expect(t[t.length - 1]).toEqual([120, -100]);
    // All in view: no way to come without being seen.
    expect(trimToUnseen(route, () => true)).toBe(null);
    // Heading east at the end, north of the road is its left.
    expect(sideOf(route, 120, -104)).toBe(1);
    expect(sideOf(route, 120, -96)).toBe(-1);
  });
});
