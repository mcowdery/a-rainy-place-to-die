import { describe, expect, it } from 'vitest';
import { loadCourses } from '../src/race/courses';
import { parseCourse } from '../src/race/course';
import { acrossCar, ARC, clampAim, WEAPONS } from '../src/race/shooting';
import { ringPoints } from '../src/race/targets';

const DEG = Math.PI / 180;

describe('shooting practice', () => {
  it('scores a board by ring', () => {
    expect(ringPoints(0, 0)).toBe(10);
    expect(ringPoints(0.05, 0.05)).toBe(10);
    expect(ringPoints(0.2, 0)).toBe(5);
    expect(ringPoints(0, -0.3)).toBe(2);
    expect(ringPoints(0.45, 0.2)).toBe(1);
  });

  it('keeps the aim in the arc: wide on the driver side (right), shorter across the car', () => {
    expect(clampAim(-90 * DEG)).toBeCloseTo(-90 * DEG);
    expect(clampAim(-179 * DEG)).toBeCloseTo(ARC.right);
    expect(clampAim(150 * DEG)).toBeCloseTo(ARC.left);
    expect(ARC.right).toBeLessThan(-ARC.left);
    expect(acrossCar(-60 * DEG)).toBe(false);
    expect(acrossCar(5 * DEG)).toBe(false);
    expect(acrossCar(60 * DEG)).toBe(true);
  });

  it('has a pistol and a paintball marker', () => {
    expect(WEAPONS.map((w) => w.id)).toEqual(['pistol', 'paint']);
    const [pistol, paint] = WEAPONS;
    expect(pistol.speed).toBe(0);
    expect(pistol.auto).toBe(false);
    expect(paint.speed).toBeGreaterThan(50);
    expect(paint.auto).toBe(true);
  });

  it('stands every target in the practice lot, clear of the road out', () => {
    const { courses, errors } = loadCourses();
    expect(errors).toEqual([]);
    const c = courses.get('kurokami')!;
    const T = c.def.targets ?? [];
    expect(T.length).toBeGreaterThan(20);
    for (const t of T) {
      for (const p of t.kind === 'mover' ? [t.at, t.to!] : [t.at]) {
        expect(c.inLot(p[0], p[1], 2), `${t.kind} at ${p}`).toBe(true);
        expect(Math.abs(p[0]) > 8 || p[1] > c.def.lot.z + 10, `${t.kind} at ${p} blocks the road`).toBe(true);
      }
    }
  });

  it('rejects bad targets', () => {
    const errors: string[] = [];
    const base = 'name: x\nlot: { x: 0, z: 0, w: 10, h: 10 }\nroad: { width: 7, shoulder: 1, slope: 0.1, rough: 1, points: [[0,0],[0,-10],[0,-20],[0,-30]] }\nsummit: { r: 10 }\n';
    parseCourse('t.yaml', `${base}targets:\n  - { kind: cannon, at: [1, 2], face: 0 }\n  - { kind: mover, at: [1, 2], face: 0 }\n`, errors);
    expect(errors.some((e) => e.includes('kind'))).toBe(true);
    expect(errors.some((e) => e.includes('mover needs'))).toBe(true);
  });
});
