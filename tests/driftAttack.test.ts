import { describe, expect, it } from 'vitest';
import { loadCourses } from '../src/race/courses';
import { DriftAttack, rankFor } from '../src/race/driftAttack';

const { courses, errors } = loadCourses();
const wharf = courses.get('wharf')!;

describe('the wharf and its drift attack', () => {
  it('loads the wharf: its lot, the container stacks solid, its zones on the lot and clear of the stacks', () => {
    expect(errors).toEqual([]);
    expect(wharf.def.kind).toBe('wharf');
    const b = wharf.def.blocks![0];
    // A car pushed out of a stack.
    expect(wharf.collide(b.x + b.w / 2, b.z + 1, 0, 2.2, 0.9)).not.toBeNull();
    expect(wharf.collide(0, 110, 0, 2.2, 0.9)).toBeNull();
    for (const zn of wharf.def.drift!.zones) {
      expect(wharf.inLot(zn.at[0], zn.at[1])).toBe(true);
      expect(wharf.blockAt(zn.at[0], zn.at[1], zn.r * 0.5)).toBeNull();
    }
  });

  it('scores drift only in the zone that is up, in order, and ranks the total', () => {
    const def = wharf.def.drift!;
    const a = new DriftAttack(def);
    a.update(4, 0, 0, 0);
    expect(a.phase).toBe('running');
    // Drifting outside a zone: nothing.
    a.update(0.1, 0, 0, 100);
    expect(a.score).toBe(0);
    // Through each zone in turn, drifting in it, then out.
    for (let k = 0; k < def.zones.length; k++) {
      const [x, z] = def.zones[k].at;
      for (let i = 0; i < 10; i++) a.update(0.1, x, z, 50);
      a.update(0.1, x + def.zones[k].r + 5, z, 0);
    }
    expect(a.phase).toBe('finished');
    expect(a.points.every((p) => p > 0)).toBe(true);
    expect(a.score).toBe(Math.round(def.zones.reduce((t, zn) => t + 500 * zn.mult, 0)));
    expect(rankFor(0, def.ranks)).toBe('D');
    expect(rankFor(def.ranks[3], def.ranks)).toBe('S');
  });

  it('runs out of time', () => {
    const a = new DriftAttack(wharf.def.drift!);
    a.update(4, 0, 0, 0);
    for (let t = 0; t < wharf.def.drift!.time + 1; t += 1) a.update(1, 0, 0, 0);
    expect(a.phase).toBe('finished');
  });
});
