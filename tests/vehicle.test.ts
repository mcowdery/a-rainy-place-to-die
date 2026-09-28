import { describe, expect, it } from 'vitest';
import { Car, COUPE, DRIFT_ASSISTS, FLAT, type Controls, type Ground } from '../src/race/vehicle';

const idle = (): Controls => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });
const drive = (car: Car, s: number, c: Partial<Controls>, ground: Ground = FLAT, each?: () => void): void => {
  const ctl = { ...idle(), ...c };
  for (let t = 0; t < s; t += 1 / 60) {
    car.update(1 / 60, ctl, ground);
    each?.();
  }
};
const deg = (r: number): number => (r * 180) / Math.PI;

describe('Car handling', () => {
  it('pulls away briskly, tops out, and stops in a sensible distance', () => {
    const car = new Car();
    let t100 = 0;
    for (let t = 0; t < 20 && car.u < 100 / 3.6; t += 1 / 60) {
      car.update(1 / 60, { ...idle(), throttle: 1 });
      t100 = t;
    }
    expect(t100).toBeGreaterThan(4.5);
    expect(t100).toBeLessThan(9);
    drive(car, 40, { throttle: 1 });
    expect(car.u * 3.6).toBeGreaterThan(170);
    expect(car.u * 3.6).toBeLessThan(260);
    // 100 km/h to a stop.
    const c2 = new Car();
    c2.u = 100 / 3.6;
    // (Holding the brake after the stop reverses: measure the furthest it got.)
    let far = 0;
    drive(c2, 5, { brake: 1 }, FLAT, () => (far = Math.max(far, c2.z)));
    expect(far).toBeGreaterThan(30);
    expect(far).toBeLessThan(55);
  });

  it('turns the way you steer, and holds a corner without sliding at a sane speed', () => {
    const car = new Car();
    car.u = 15;
    let maxSlide = 0;
    drive(car, 3, { throttle: 0.3, steer: 1 }, FLAT, () => (maxSlide = Math.max(maxSlide, Math.abs(car.slide))));
    // Facing +z at the start and steering left: toward +x (east is on the left facing south), heading up.
    expect(car.h).toBeGreaterThan(1);
    expect(car.x).toBeGreaterThan(5);
    expect(deg(maxSlide)).toBeLessThan(12);
  });

  it('kicks the rear out on the handbrake, and holds the drift on the throttle without spinning', () => {
    const car = new Car();
    car.u = 20;
    drive(car, 0.5, { throttle: 0.4, steer: 1, handbrake: true });
    expect(deg(Math.abs(car.slide))).toBeGreaterThan(12);
    let worst = 0;
    let sliding = 0;
    drive(car, 5, { throttle: 0.75, steer: 0.3 }, FLAT, () => {
      worst = Math.max(worst, Math.abs(car.slide));
      if (Math.abs(car.slide) > 0.17) sliding += 1 / 60;
    });
    expect(deg(worst)).toBeLessThanOrEqual(deg(DRIFT_ASSISTS.maxSlide) + 1);
    // Still going forward (not spun round), and it stayed sideways a good while.
    expect(car.u).toBeGreaterThan(5);
    expect(sliding).toBeGreaterThan(1);
  });

  it('does not spin on full throttle out of a slow corner (traction help), but a handbrake flick lets the power hold a slide', () => {
    const plain = new Car();
    plain.u = 9;
    let slid = 0;
    drive(plain, 2.5, { throttle: 1, steer: 1 }, FLAT, () => (slid = Math.max(slid, Math.abs(plain.slide))));
    expect(deg(slid)).toBeLessThan(12);
    const flick = new Car();
    flick.u = 12;
    drive(flick, 0.35, { throttle: 1, steer: 1, handbrake: true });
    let held = 0;
    drive(flick, 2, { throttle: 1, steer: 0.4 }, FLAT, () => Math.abs(flick.slide) > 0.2 && (held += 1 / 60));
    expect(held).toBeGreaterThan(1);
  });

  it('straightens up when you let go', () => {
    const car = new Car();
    car.u = 20;
    drive(car, 0.6, { throttle: 0.5, steer: 1, handbrake: true });
    drive(car, 3.5, {});
    expect(deg(Math.abs(car.slide))).toBeLessThan(5);
    expect(Math.abs(car.r)).toBeLessThan(0.2);
  });

  it('rolls downhill on a slope, and parks without creeping on the flat', () => {
    // Downhill toward +z: the normal leans +z.
    const s = Math.sin(0.08);
    const slope: Ground = { ...FLAT, normal: () => [0, Math.cos(0.08), s] };
    const car = new Car();
    drive(car, 4, {}, slope);
    expect(car.z).toBeGreaterThan(3);
    const flat = new Car();
    drive(flat, 3, {});
    expect(Math.hypot(flat.x, flat.z)).toBeLessThan(0.01);
  });

  it('reverses from a stop on the brake key', () => {
    const car = new Car();
    drive(car, 3, { brake: 1 });
    expect(car.u).toBeLessThan(-3);
    expect(car.u).toBeGreaterThanOrEqual(-COUPE.reverse - 0.1);
    expect(car.gear).toBe(0);
  });

  it('stops at a wall with a knock', () => {
    const wall: Ground = {
      ...FLAT,
      collide: (_x, z) => (z + 2.15 > 30 ? { px: 0, pz: 30 - (z + 2.15), nx: 0, nz: -1 } : null),
    };
    const car = new Car();
    let knock = 0;
    drive(car, 6, { throttle: 1 }, wall, () => (knock = Math.max(knock, car.bump)));
    expect(car.z + 2.15).toBeLessThanOrEqual(30.01);
    expect(knock).toBeGreaterThan(5);
  });
});
