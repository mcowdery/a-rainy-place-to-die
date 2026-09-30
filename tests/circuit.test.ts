import { describe, expect, it } from 'vitest';
import { RivalDriver, separateCars } from '../src/race/battle';
import { tunedSpec } from '../src/race/catalog';
import type { CarType } from '../src/poc3d/models/vehicles';
import { CircuitRace, gridSlots } from '../src/race/circuit';
import { loadCourses } from '../src/race/courses';
import { Car, ROAD_ASSISTS } from '../src/race/vehicle';

const { courses } = loadCourses();
const manila = courses.get('manila')!;
const def = manila.def.circuit!;

/** A field of AI cars on the grid: the course's rivals (and more, if asked for), each with its driver. */
function field(count: number): { car: Car; drv: RivalDriver }[] {
  const slots = gridSlots(manila, def.start, count);
  const riv = [...def.rivals, ...def.rivals];
  return slots.map((sl, k) => {
    const r = riv[k];
    const car = new Car(tunedSpec(r.type as CarType, {}), ROAD_ASSISTS);
    const i = sl.i;
    car.place(manila.x[i] + manila.tz[i] * sl.lane, manila.z[i] - manila.tx[i] * sl.lane, Math.atan2(manila.tx[i], manila.tz[i]), manila.ground);
    const drv = new RivalDriver(car, manila, 'up', r.skill, sl.lane);
    drv.laneMax = manila.half - 1.6;
    drv.top = 70;
    return { car, drv };
  });
}

describe('circuits', () => {
  it('loads the Manila street circuit as a closed loop', () => {
    expect(manila.loop).toBe(true);
    expect(manila.length).toBeGreaterThan(2000);
    const n = manila.x.length;
    // Its last sample runs on into its first, a metre on.
    expect(Math.hypot(manila.x[n - 1] - manila.x[0], manila.z[n - 1] - manila.z[0])).toBeLessThan(1.6);
    expect(manila.wrap(n + 5)).toBe(5);
    expect(manila.wrap(-1)).toBe(n - 1);
    // Flat, and the car can drive off the paddock onto the track.
    expect(manila.height(0, 40)).toBe(0);
    expect(manila.inside(-250, 0)).toBe(true);
    expect(manila.inside(-250, 36)).toBe(true);
  });

  it('counts laps and places: across the line, the next lap round, finishers by time', () => {
    const slots = gridSlots(manila, def.start, 2);
    const race = new CircuitRace(manila, 2, def.start, ['you', 'them'], slots);
    race.update(3.1, [slots[0].i, slots[1].i]);
    expect(race.phase).toBe('racing');
    const n = manila.x.length;
    const at = [slots[0].i, slots[1].i];
    let lapEvents = 0;
    // You 4 m a step, them 3.5: laps come round, and you finish first.
    for (let step = 0; step < 5000 && race.phase === 'racing'; step++) {
      at[0] = manila.wrap(at[0] + 4);
      at[1] = manila.wrap(at[1] + (step % 2 ? 3 : 4));
      lapEvents += race.update(0.1, at).filter((e) => e.kind === 'lap').length;
    }
    expect(race.phase).toBe('finished');
    expect(race.racers[0].laps).toBe(2);
    expect(race.standings()[0]).toBe(0);
    expect(lapEvents).toBe(2);
    expect(race.racers[0].finished).toBeCloseTo((2 * n + 10) / 40, 0);
    // A jump across the track is ignored.
    const r2 = new CircuitRace(manila, 1, def.start, ['a'], slots);
    r2.update(3.1, [slots[0].i]);
    const d0 = r2.racers[0].dist;
    r2.update(0.1, [manila.wrap(slots[0].i + 400)]);
    expect(r2.racers[0].dist).toBe(d0);
  });

  it('has a rival lap it on its own, cleanly and at a racing pace', () => {
    const [{ car, drv }] = field(1);
    const race = new CircuitRace(manila, 2, def.start, ['r'], gridSlots(manila, def.start, 1));
    let walls = 0;
    for (let t = 0; t < 300 && race.phase !== 'finished'; t += 1 / 60) {
      car.update(1 / 60, drv.controls(1 / 60, null, false), manila.ground);
      if (car.bump > 3) walls++;
      race.update(1 / 60, [manila.nearest(car.x, car.z).i]);
    }
    expect(race.phase).toBe('finished');
    const lap2 = race.racers[0].lapTimes[1] - race.racers[0].lapTimes[0];
    // 2.75 km: about 100-150 km/h on average, off no walls.
    expect(manila.length / lap2 * 3.6).toBeGreaterThan(95);
    expect(manila.length / lap2 * 3.6).toBeLessThan(170);
    expect(walls).toBeLessThanOrEqual(1);
  });

  it('races a field of five three laps with knocks, everyone finishing', () => {
    const cars = field(5);
    const race = new CircuitRace(manila, def.laps, def.start, cars.map((_, k) => `car${k}`), gridSlots(manila, def.start, 5));
    const all = cars.map((c) => c.car);
    let t = 0;
    for (; t < 700 && race.racers.some((r) => r.finished === null); t += 1 / 60) {
      const held = race.phase === 'countdown';
      for (const c of cars) if (!held) c.car.update(1 / 60, c.drv.controls(1 / 60, all, false), manila.ground);
      for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) separateCars(all[a], all[b]);
      // (The race runs on after the first finisher here: `you` is a car that never finishes early.)
      race.update(1 / 60, all.map((c) => manila.nearest(c.x, c.z).i), 4);
      if (race.phase === 'finished' && race.racers.some((r) => r.finished === null)) race.phase = 'racing';
    }
    for (const r of race.racers) expect(r.laps).toBe(def.laps);
    const order = race.standings();
    const times = order.map((k) => race.racers[k].finished!);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
