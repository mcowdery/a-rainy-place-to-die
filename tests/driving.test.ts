import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Driving } from '../src/poc3d/district/driving';
import type { DrivenVehicle } from '../src/poc3d/real/traffic';

/** A car at the origin facing +z (south), and a driver whose walls are wherever `wall` says. */
const setup = (wall: (x: number, z: number, r: number) => boolean = () => false): { d: Driving; car: DrivenVehicle } => {
  const car: DrivenVehicle = { obj: new THREE.Object3D(), half: 2.2, width: 1.8, bus: false, axle: 1.25, label: 'Car', x: 0, z: 0, dx: 0, dz: 1, v: 0, acc: 0, curv: 0, hideBody: false };
  const d = new Driving(new THREE.PerspectiveCamera(), (x, z, r) => wall(x, z, r));
  d.enter(car);
  return { d, car };
};
const run = (d: Driving, s: number, keys: string[]): void => {
  d.keys.clear();
  for (const k of keys) d.keys.add(k);
  for (let t = 0; t < s; t += 1 / 60) d.update(1 / 60);
};

describe('Driving', () => {
  it('pulls away, tops out, and brakes to a stop without going into reverse', () => {
    const { d, car } = setup();
    run(d, 3, ['KeyW']);
    expect(car.v).toBeGreaterThan(6);
    expect(car.z).toBeGreaterThan(8);
    expect(Math.abs(car.x)).toBeLessThan(1e-6);
    run(d, 30, ['KeyW']);
    expect(car.v).toBeLessThanOrEqual(24);
    run(d, 6, ['KeyS']);
    // Holding the brake stops it; only once stopped does S (held again) reverse.
    expect(car.v).toBeLessThanOrEqual(0);
    run(d, 2, ['KeyS']);
    expect(car.v).toBeLessThan(-1);
    expect(d.gear).toBe('R');
  });

  it('turns about the rear axle: the car goes the way it faces (no sliding) and turns right on D', () => {
    const { d, car } = setup();
    run(d, 2, ['KeyW']);
    let prev = { x: car.x, z: car.z, dx: car.dx, dz: car.dz };
    let turned = 0;
    d.keys.add('KeyD');
    for (let t = 0; t < 3; t += 1 / 60) {
      d.update(1 / 60);
      // The rear axle's step is along the heading.
      const rx = car.x - car.dx * car.axle - (prev.x - prev.dx * car.axle);
      const rz = car.z - car.dz * car.axle - (prev.z - prev.dz * car.axle);
      const step = Math.hypot(rx, rz);
      if (step > 1e-4) expect(Math.abs(rx * car.dz - rz * car.dx) / step).toBeLessThan(0.02);
      turned += Math.atan2(prev.dx * car.dz - prev.dz * car.dx, prev.dx * car.dx + prev.dz * car.dz);
      prev = { x: car.x, z: car.z, dx: car.dx, dz: car.dz };
    }
    // Facing south (+z) and turning right (seen from above, x east): toward the west (-x).
    expect(car.x).toBeLessThan(-1);
    expect(Math.abs(turned)).toBeGreaterThan(0.5);
    expect(car.curv).toBeGreaterThan(0);
  });

  it('has less steering lock at speed', () => {
    const slow = setup();
    run(slow.d, 1, ['KeyW']);
    run(slow.d, 1.5, ['KeyW', 'KeyD']);
    const fast = setup();
    run(fast.d, 8, ['KeyW']);
    run(fast.d, 1.5, ['KeyW', 'KeyD']);
    expect(fast.car.curv).toBeLessThan(slow.car.curv / 2);
  });

  it('stops against a wall with a knock, and lets you out beside the car', () => {
    const { d, car } = setup((_x, z, r) => z + r > 20);
    let bumped = 0;
    d.keys.add('KeyW');
    for (let t = 0; t < 10; t += 1 / 60) {
      d.update(1 / 60);
      bumped = Math.max(bumped, d.bump);
    }
    expect(bumped).toBeGreaterThan(2);
    expect(car.z + car.half).toBeLessThan(20.2);
    const spot = d.exitSpot(() => true)!;
    // The driver's door is on the right (right-hand drive): facing +z, that's -x.
    expect(spot.x).toBeLessThan(-1.5);
    expect(d.exitSpot(() => false)).toBeNull();
  });
});
