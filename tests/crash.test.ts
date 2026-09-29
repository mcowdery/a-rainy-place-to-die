import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { impactDamage, repairCost, TOTALED, type HitKind } from '../src/poc3d/district/crash';
import { OwnCar } from '../src/poc3d/district/ownCar';
import type { DrivenVehicle, TrafficSystem } from '../src/poc3d/real/traffic';

/** Traffic that just holds the car's record. */
const traffic = {
  addOwn: (_o: THREE.Object3D, half: number, width: number, label: string, x: number, z: number, dx: number, dz: number): DrivenVehicle =>
    ({ obj: new THREE.Group(), half, width, bus: false, axle: 1, label, x, z, dx, dz, v: 0, acc: 0, curv: 0, hideBody: false }) as DrivenVehicle,
} as unknown as TrafficSystem;

/**
 * A car at the origin facing +z (north is -z here, it drives toward +z), up to speed, into a world `probe`;
 * returns the car after `secs` with full throttle then coasting.
 */
function run(probe: (x: number, z: number, r: number) => HitKind | null, kmh: number, secs = 3): OwnCar {
  const car = new OwnCar(new THREE.MeshBasicMaterial(), traffic, { x: 0, z: 0, h: 0 }, (x, z, r) => probe(x, z, r), null, () => [], true);
  car.condition = 0;
  car.sim.u = kmh / 3.6;
  for (let t = 0; t < secs; t += 1 / 60) car.drive(1 / 60, { throttle: 0.3, brake: 0, steer: 0, handbrake: false });
  return car;
}

const wall = (z0: number) => (_x: number, z: number, r: number): HitKind | null => (z + r > z0 ? 'hard' : null);
const post = (px: number, pz: number, pr: number, kind: HitKind) => (x: number, z: number, r: number): HitKind | null => (Math.hypot(x - px, z - pz) < pr + r ? kind : null);

describe('crashing your car', () => {
  it('stops at a wall hit head-on, damaged by the speed', () => {
    const car = run(wall(20), 30);
    expect(car.sim.z).toBeLessThan(20);
    expect(Math.abs(car.sim.u)).toBeLessThan(1.5);
    expect(car.condition).toBeGreaterThan(8);
    expect(car.condition).toBeLessThan(35);
    expect(car.totaled).toBe(false);
  });

  it('is totalled by a wall at speed', () => {
    const car = run(wall(30), 95);
    expect(car.totaled).toBe(true);
    expect(car.condition).toBe(TOTALED);
  });

  it('stops at a pole on the centre line', () => {
    const car = run(post(0, 20, 0.2, 'hard'), 40);
    expect(car.sim.z).toBeLessThan(20);
    expect(car.condition).toBeGreaterThan(10);
  });

  it('clips a pole with its side and drives on, slower and a little damaged', () => {
    const car = run(post(0.75, 20, 0.2, 'hard'), 50, 2.5);
    expect(car.sim.z).toBeGreaterThan(25);
    expect(car.condition).toBeGreaterThan(2);
    expect(car.condition).toBeLessThan(40);
    const clean = run(() => null, 50, 2.5);
    expect(car.sim.u).toBeLessThan(clean.sim.u);
  });

  it('drives through a hedge, slowed a little', () => {
    const car = run((x, z, r) => (Math.abs(z - 20) < 1 + r && Math.abs(x) < 3 + r ? 'soft' : null), 50, 2.5);
    expect(car.sim.z).toBeGreaterThan(25);
    expect(car.condition).toBeGreaterThan(0.5);
    expect(car.condition).toBeLessThan(15);
  });

  it('stops for a person without damage', () => {
    const car = run(post(0, 15, 0.35, 'person'), 20);
    expect(car.sim.z).toBeLessThan(15);
    expect(car.condition).toBe(0);
  });

  it('prices the repair by the damage, with the tow when totalled', () => {
    expect(impactDamage(1)).toBe(0);
    expect(repairCost(10)).toBeLessThan(repairCost(60));
    expect(repairCost(TOTALED)).toBeGreaterThan(repairCost(99));
  });
});
