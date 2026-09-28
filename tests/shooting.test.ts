import { describe, expect, it } from 'vitest';
import { loadCourses } from '../src/race/courses';
import { parseCourse } from '../src/race/course';
import { ARC, nearestShot, sideFor, spreadOf, WEAPONS, WINDOW_ARC } from '../src/race/shooting';
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

  it('shoots out of the driver window wide, through the passenger window narrow, never the windscreen', () => {
    // Right-hand drive: the driver's window (right, negative) from just ahead round to behind.
    expect(sideFor(0)).toBe('driver');
    expect(sideFor(-90 * DEG)).toBe('driver');
    expect(sideFor(-160 * DEG)).toBe('driver');
    expect(sideFor(-175 * DEG)).toBe(null);
    // The windscreen, and behind on the left.
    expect(sideFor(30 * DEG)).toBe(null);
    expect(sideFor(150 * DEG)).toBe(null);
    // The passenger window: a slot, and only as high or low as the window.
    expect(sideFor(80 * DEG)).toBe('across');
    expect(sideFor(80 * DEG, 0.5)).toBe(null);
    expect(WINDOW_ARC.to - WINDOW_ARC.from).toBeLessThan((ARC.ahead - ARC.right) / 3);
    // Just inside the window's frame goes through; just past its pillars doesn't.
    expect(sideFor(WINDOW_ARC.from + 0.05)).toBe('across');
    expect(sideFor(WINDOW_ARC.to - 0.05)).toBe('across');
    expect(sideFor(WINDOW_ARC.from - 0.05)).toBe(null);
    expect(sideFor(WINDOW_ARC.to + 0.05)).toBe(null);
    // Off every window, the weapon waits at the nearest shot.
    expect(nearestShot(30 * DEG, 0).rel).toBeCloseTo(ARC.ahead);
    expect(nearestShot(50 * DEG, 0).side).toBe('across');
    expect(nearestShot(170 * DEG, 0).side).toBe('driver');
  });

  it('spreads wider across the car and far wider from the hip', () => {
    const [pistol] = WEAPONS;
    const at = { slide: 0, speed: 0, across: false, hip: false };
    const base = spreadOf(pistol, at);
    expect(spreadOf(pistol, { ...at, across: true })).toBeGreaterThan(base * 2);
    expect(spreadOf(pistol, { ...at, hip: true })).toBeGreaterThan(base * 5);
    expect(spreadOf(pistol, { ...at, slide: 0.5, speed: 20 })).toBeGreaterThan(base);
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
