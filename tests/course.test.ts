import { describe, expect, it } from 'vitest';
import type { Course } from '../src/race/course';
import { loadCourses } from '../src/race/courses';
import { Car } from '../src/race/vehicle';

const { courses, errors } = loadCourses();

/** An autopilot: aims at the centre line ahead, slows for the bends ahead (a comfortable pull). */
function autopilot(car: Car, c: Course, from: number, to: number, dir: 1 | -1, limit = 240): { time: number; maxBump: number; outside: number; done: boolean } {
  const g = c.ground;
  const i0 = from;
  car.place(c.x[i0], c.z[i0], Math.atan2(c.tx[i0] * dir, c.tz[i0] * dir), g);
  let maxBump = 0;
  let outside = 0;
  for (let t = 0; t < limit; t += 1 / 60) {
    const n = c.nearest(car.x, car.z);
    const i = n.i;
    if ((dir > 0 && i >= to - 2) || (dir < 0 && i <= to + 2)) return { time: t, maxBump, outside, done: true };
    const look = Math.round(6 + Math.abs(car.u) * 0.5);
    const j = Math.max(0, Math.min(c.x.length - 1, i + dir * look));
    const dx = c.x[j] - car.x;
    const dz = c.z[j] - car.z;
    const err = Math.atan2(dx * Math.cos(car.h) - dz * Math.sin(car.h), dx * Math.sin(car.h) + dz * Math.cos(car.h));
    // The bend ahead: the heading change over the next 35 m, as a radius.
    let turn = 0;
    for (let k = 5; k <= 35; k += 5) {
      const a = Math.max(0, Math.min(c.x.length - 1, i + dir * (k - 5)));
      const b = Math.max(0, Math.min(c.x.length - 1, i + dir * k));
      turn = Math.max(turn, Math.acos(Math.min(1, c.tx[a] * c.tx[b] + c.tz[a] * c.tz[b])));
    }
    const R = 5 / Math.max(turn, 1e-3);
    const want = Math.min(28, Math.max(7, Math.sqrt(6 * R)));
    car.update(1 / 60, { throttle: car.u < want ? 1 : 0, brake: car.u > want + 2 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)), handbrake: false }, g);
    maxBump = Math.max(maxBump, car.bump);
    if (!c.inside(car.x, car.z)) outside++;
  }
  return { time: limit, maxBump, outside, done: false };
}

it('loads the venues', () => {
  expect(errors).toEqual([]);
  expect(courses.size).toBeGreaterThanOrEqual(2);
});

// (The passes: a wharf has no pass, tests/driftAttack.test.ts covers it.)
describe.each([...courses.keys()].filter((k) => (courses.get(k)!.def.kind ?? 'pass') === 'pass'))('course %s', (name) => {
  const course = courses.get(name)!;
  it('loads, and the road climbs from the lot to the summit on an even grade', () => {
    expect(errors).toEqual([]);
    expect(course.length).toBeGreaterThan(800);
    expect(course.def.atmosphere.sky).toHaveLength(4);
    // The medal times are within reach of a careful driver (the autopilot) but gold needs more.
    expect(course.def.trial.up[2]).toBeLessThan(course.def.trial.up[0]);
    const top = course.summit;
    expect(top.y).toBeGreaterThan(40);
    expect(course.y[0]).toBeCloseTo(0, 5);
    // Grade: never steeper than 16% over any 10 m (a steep mountain pass).
    for (let i = 10; i < course.y.length; i++) expect(Math.abs(course.y[i] - course.y[i - 10]) / 10, `at ${i}`).toBeLessThan(0.16);
  });

  it('keeps the ground continuous where you drive (no steps)', () => {
    for (let i = 0; i < course.x.length; i += 3) {
      for (const d of [-3, 0, 3]) {
        const x = course.x[i] + course.tz[i] * d;
        const z = course.z[i] - course.tx[i] * d;
        const y0 = course.height(x, z);
        expect(Math.abs(course.height(x + course.tx[i] * 0.5, z + course.tz[i] * 0.5) - y0), `at ${i}`).toBeLessThan(0.3);
      }
    }
  });

  it('can be driven up and back down on the handling model without hitting the rails hard', () => {
    const up = autopilot(new Car(), course, 5, course.x.length - 1, 1);
    expect(up.done).toBe(true);
    expect(up.time).toBeLessThan(course.length / 9);
    // Gold is faster than the careful autopilot; bronze is slower.
    expect(course.def.trial.up[2]).toBeLessThan(up.time);
    expect(course.def.trial.up[0]).toBeGreaterThan(up.time);
    expect(up.maxBump).toBeLessThan(4);
    expect(up.outside).toBe(0);
    const down = autopilot(new Car(), course, course.x.length - 25, 5, -1);
    expect(down.done).toBe(true);
    expect(down.maxBump).toBeLessThan(4);
    expect(course.def.trial.down[2]).toBeLessThan(down.time);
    expect(course.def.trial.down[0]).toBeGreaterThan(down.time);
  });

  it('keeps the car in: a car driven at the rail is stopped at it', () => {
    const car = new Car();
    const i = 300;
    const g = course.ground;
    car.place(course.x[i], course.z[i], Math.atan2(course.tz[i], -course.tx[i]), g);
    for (let t = 0; t < 4; t += 1 / 60) car.update(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: false }, g);
    const n = course.nearest(car.x, car.z);
    expect(Math.abs(n.d)).toBeLessThan(course.rail + 0.1);
  });
});
