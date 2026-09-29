import { describe, expect, it } from 'vitest';
import { MODELS, PARTS, stats, tunedSpec } from '../src/race/catalog';
import { loadCourses } from '../src/race/courses';
import { buyCar, earn, freshProfile, spend, trialPay } from '../src/race/profile';
import { RivalDriver } from '../src/race/battle';
import { trialPlan } from '../src/race/trial';
import { Car } from '../src/race/vehicle';

const { courses } = loadCourses();

describe('cars, parts and money', () => {
  it('prices the cars from cheapest to dearest and gives each its own character', () => {
    const s = MODELS.map((m) => ({ m, st: stats(m.spec) }));
    expect(MODELS.map((m) => m.price)).toEqual([...MODELS.map((m) => m.price)].sort((a, b) => a - b));
    const by = (t: string) => s.find((x) => x.m.type === t)!.st;
    // The AWD is the hardest to drift; the roadster the lightest; the rotary among the most powerful.
    expect(by('awd').drift).toBeLessThan(Math.min(by('hatch').drift, by('sports').drift));
    expect(by('roadster').kg).toBeLessThan(by('hatch').kg);
    expect(by('rotary').ps).toBeGreaterThan(by('sports').ps);
  });

  it('parts change the numbers the right way', () => {
    const base = stats(tunedSpec('hatch', {}));
    expect(stats(tunedSpec('hatch', { engine: 3 })).ps).toBeGreaterThan(base.ps);
    expect(stats(tunedSpec('hatch', { weight: 3 })).kg).toBeLessThan(base.kg);
    expect(stats(tunedSpec('hatch', { tyres: 3 })).grip).toBeGreaterThan(base.grip);
    expect(tunedSpec('hatch', { turbo: 1 }).turbo).toBeGreaterThan(0);
    for (const p of PARTS) expect(p.price.length).toBe(p.levels.length);
  });

  it('keeps the wallet honest', () => {
    const p = freshProfile();
    expect(p.cars[0].type).toBe('hatch');
    expect(buyCar(p, 'awd')).toBe(null);
    earn(p, 1_000_000);
    expect(buyCar(p, 'awd')?.type).toBe('awd');
    expect(p.current).toBe(p.cars[1].id);
    expect(spend(p, 10_000_000)).toBe(false);
    expect(trialPay('gold', true)).toBeGreaterThan(trialPay(null, false));
  });

  for (const m of MODELS) {
    it(`the ${m.name} (fully tuned) drives down Yūnagi cleanly`, () => {
      const c = courses.get('yunagi')!;
      const plan = trialPlan(c, 'down');
      const car = new Car(tunedSpec(m.type, { engine: 3, turbo: 3, weight: 3, tyres: 3, suspension: 3, brakes: 3, lsd: 3 }));
      const i = plan.grid;
      car.place(c.x[i], c.z[i], Math.atan2(-c.tx[i], -c.tz[i]), c.ground);
      const drv = new RivalDriver(car, c, 'down');
      let bumps = 0;
      let t = 0;
      for (; t < 240; t += 1 / 60) {
        car.update(1 / 60, drv.controls(1 / 60, null, false), c.ground);
        if (car.bump > 4) bumps++;
        if (c.nearest(car.x, car.z).i <= plan.finish) break;
      }
      expect(t).toBeLessThan(200);
      expect(bumps).toBe(0);
    });
  }
});
