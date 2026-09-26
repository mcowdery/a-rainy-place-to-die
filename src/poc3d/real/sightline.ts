import type { Building3 } from '../district/plan';
import { frontFrame } from './buildings';

/** Whether something high on a building's street face, at height y, can be seen from the street. */
export type Sightline = (b: Building3, y: number) => boolean;

/** Everything is visible (for single-building scenes like the showroom). */
export const ALWAYS_SEEN: Sightline = () => true;

/**
 * Open distance in front of b's street face at height y: how far a ray from the middle of the face runs
 * before hitting a building at least that tall (up to max). Lower buildings don't block the view.
 */
export function openAhead(b: Building3, y: number, others: readonly Building3[], max = 80): number {
  const f = frontFrame(b);
  const ox = f.p[0] + f.r[0] * (f.fw / 2) + f.n[0] * 0.05;
  const oz = f.p[2] + f.r[2] * (f.fw / 2) + f.n[2] * 0.05;
  const [dx, dz] = [f.n[0], f.n[2]];
  let best = max;
  for (const o of others) {
    if (o === b || o.h < y - 1) continue;
    // Ray against the footprint (slab method); the ray is axis-aligned, so one axis is a range check.
    const x0 = o.x - o.w / 2;
    const x1 = o.x + o.w / 2;
    const z0 = o.z - o.d / 2;
    const z1 = o.z + o.d / 2;
    let t: number;
    if (dx !== 0) {
      if (oz < z0 || oz > z1) continue;
      t = dx > 0 ? x0 - ox : ox - x1;
    } else {
      if (ox < x0 || ox > x1) continue;
      t = dz > 0 ? z0 - oz : oz - z1;
    }
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/**
 * A sightline test over a neighbourhood of buildings: something at height y needs open ground ahead of
 * max(14 m, 0.6 y), i.e. it faces a junction, a square, a street running away from it, or lower roofs,
 * and isn't just staring at the building across a narrow street.
 */
export function sightline(others: readonly Building3[]): Sightline {
  return (b, y) => openAhead(b, y, others) >= Math.max(14, 0.6 * y);
}
