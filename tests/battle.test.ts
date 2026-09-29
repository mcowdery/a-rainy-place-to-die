import { describe, expect, it } from 'vitest';
import { RivalDriver, separateCars } from '../src/race/battle';
import { loadCourses } from '../src/race/courses';
import { trialPlan } from '../src/race/trial';
import { Car } from '../src/race/vehicle';

const { courses } = loadCourses();

describe('battles', () => {
  it('pushes overlapping cars apart and trades momentum in a knock', () => {
    const a = new Car();
    const b = new Car();
    a.place(0, 0, 0);
    b.place(1.2, 0.5, 0);
    // a sliding to its left (+x at heading 0) into b, which stands still.
    a.w = 6;
    const closing = separateCars(a, b);
    expect(closing).toBeGreaterThan(3);
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    expect(d).toBeGreaterThan(1.2);
    // b is shoved away (to its left, +w), a slowed.
    expect(b.w).toBeGreaterThan(1);
    expect(Math.abs(a.w)).toBeLessThan(6);
    // Apart, nothing happens.
    const c = new Car();
    c.place(10, 0, 0);
    expect(separateCars(a, c)).toBe(0);
  });

  for (const [name, course] of courses) {
    for (const dir of ['up', 'down'] as const) {
      it(`${name} ${dir}: the rival drives the run cleanly on its own`, () => {
        const plan = trialPlan(course, dir);
        const car = new Car();
        const s = dir === 'up' ? 1 : -1;
        const i = plan.grid;
        car.place(course.x[i], course.z[i], Math.atan2(course.tx[i] * s, course.tz[i] * s), course.ground);
        const rival = new RivalDriver(car, course, dir);
        let t = 0;
        let bumps = 0;
        for (; t < 200; t += 1 / 60) {
          car.update(1 / 60, rival.controls(1 / 60, null, false), course.ground);
          if (car.bump > 4) bumps++;
          const p = course.nearest(car.x, car.z).i;
          if (dir === 'up' ? p >= plan.finish : p <= plan.finish) break;
        }
        expect(t).toBeLessThan(course.length / 11);
        expect(bumps).toBe(0);
      });
    }
  }

  it('races side by side down Kurokami with knocks, and both reach the bottom', () => {
    const course = courses.get('kurokami')!;
    const plan = trialPlan(course, 'down');
    const mk = (lane: number): { car: Car; drv: RivalDriver } => {
      const car = new Car();
      const i = plan.grid;
      const lx = -course.tz[i];
      const lz = course.tx[i];
      car.place(course.x[i] + lx * lane, course.z[i] + lz * lane, Math.atan2(-course.tx[i], -course.tz[i]), course.ground);
      return { car, drv: new RivalDriver(car, course, 'down', 1, lane) };
    };
    const a = mk(1.7);
    const b = mk(-1.7);
    const done = [false, false];
    for (let t = 0; t < 200 && !(done[0] && done[1]); t += 1 / 60) {
      [a, b].forEach((r, k) => {
        if (done[k]) return;
        r.car.update(1 / 60, r.drv.controls(1 / 60, (k ? a : b).car, false), course.ground);
        if (course.nearest(r.car.x, r.car.z).i <= plan.finish) done[k] = true;
      });
      separateCars(a.car, b.car);
    }
    expect(done).toEqual([true, true]);
  });
});
