import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { impactDamage, newParts, overall, partsOf, repairCost, sectionsAt, TOTALED, type HitKind } from '../src/poc3d/district/crash';
import { OwnCar } from '../src/poc3d/district/ownCar';
import type { DrivenVehicle, TrafficSystem } from '../src/poc3d/real/traffic';

/** Traffic that just holds the car's record. */
const traffic = {
  addOwn: (_o: THREE.Object3D, half: number, width: number, label: string, x: number, z: number, dx: number, dz: number): DrivenVehicle =>
    ({ obj: new THREE.Group(), half, width, bus: false, axle: 1, label, x, z, dx, dz, v: 0, acc: 0, curv: 0, hideBody: false }) as DrivenVehicle,
} as unknown as TrafficSystem;

type Probe = (x: number, z: number, r: number) => HitKind | null;

/** A car at the origin facing +z at `kmh`, driven for `secs` (a little throttle, steering `steer`) into a world `probe`. */
function run(probe: Probe, kmh: number, secs = 3, steer = 0): OwnCar {
  const car = new OwnCar(new THREE.MeshBasicMaterial(), traffic, { x: 0, z: 0, h: 0 }, (x, z, r) => probe(x, z, r), null, () => [], true);
  Object.assign(car.parts, newParts());
  car.sim.u = kmh / 3.6;
  for (let t = 0; t < secs; t += 1 / 60) car.drive(1 / 60, { throttle: 0.3, brake: 0, steer, handbrake: false });
  return car;
}

const wall = (z0: number): Probe => (_x, z, r) => (z + r > z0 ? 'wall' : null);
const post = (px: number, pz: number, pr: number, kind: HitKind): Probe => (x, z, r) => (Math.hypot(x - px, z - pz) < pr + r ? kind : null);
/** A parked car (4.4 x 1.8 m) centred at (cx, cz), its length along heading a (radians from +z). */
const parked = (cx: number, cz: number, a: number): Probe => (x, z, r) => {
  const dx = x - cx;
  const dz = z - cz;
  const along = dx * Math.sin(a) + dz * Math.cos(a);
  const across = dx * Math.cos(a) - dz * Math.sin(a);
  return Math.abs(along) < 2.2 + r && Math.abs(across) < 0.9 + r ? 'car' : null;
};

describe('crashing your car', () => {
  it('stops at a wall hit head-on, the front damaged by the speed', () => {
    const car = run(wall(20), 60);
    expect(car.sim.z).toBeLessThan(20);
    expect(Math.abs(car.sim.u)).toBeLessThan(1.5);
    expect(car.parts.front).toBeGreaterThan(3);
    expect(car.parts.rear).toBe(0);
    expect(car.totaled).toBe(false);
  });

  it('takes a 100 km/h head-on badly but drivably; only ~140 km/h totals it', () => {
    const hard = run(wall(40), 100);
    expect(hard.parts.front).toBeGreaterThan(25);
    expect(hard.totaled).toBe(false);
    const wreck = run(wall(50), 145);
    expect(wreck.totaled).toBe(true);
    expect(wreck.condition).toBe(TOTALED);
  });

  it('slides along a wall hit at an angle, keeping most of its speed', () => {
    // A wall along x = 3, the car angled 20 degrees into it.
    const car = new OwnCar(new THREE.MeshBasicMaterial(), traffic, { x: 0, z: 0, h: (20 * Math.PI) / 180 }, (x, _z, r) => (x + r > 3 ? 'wall' : null), null, () => [], true);
    Object.assign(car.parts, newParts());
    car.sim.u = 80 / 3.6;
    for (let t = 0; t < 2; t += 1 / 60) car.drive(1 / 60, { throttle: 0.5, brake: 0, steer: 0, handbrake: false });
    expect(car.sim.speed * 3.6).toBeGreaterThan(55);
    expect(car.sim.z).toBeGreaterThan(30);
    // The side scraping it took the damage (facing +z, the car's left is +x, toward the wall).
    expect(car.parts.left).toBeGreaterThan(car.parts.right);
    expect(car.totaled).toBe(false);
  });

  it('ploughs through the side of a car it hits at an angle (no getting wedged)', () => {
    // A taxi across the road 25 m ahead, angled 35 degrees off square to the car's path.
    const car = run(parked(0.8, 25, Math.PI / 2 - (35 * Math.PI) / 180), 70, 2.5);
    expect(car.sim.z).toBeGreaterThan(33);
    expect(car.sim.speed * 3.6).toBeGreaterThan(35);
    expect(car.condition).toBeGreaterThan(0.2);
    expect(car.condition).toBeLessThan(20);
  });

  it('stops for a car met head-on at speed, but nudges through one at a crawl', () => {
    const hit = run(parked(0, 20, Math.PI / 2), 50);
    expect(hit.sim.z).toBeLessThan(20);
    expect(hit.parts.front).toBeGreaterThan(0);
    const crawl = run(parked(0, 6, Math.PI / 2), 10, 4);
    expect(crawl.sim.z).toBeGreaterThan(8);
  });

  it('stops at a pole on its nose, but clips one with a corner and drives on', () => {
    const car = run(post(0, 20, 0.2, 'pole'), 40);
    expect(car.sim.z).toBeLessThan(20);
    const clip = run(post(0.75, 20, 0.2, 'pole'), 50, 2.5);
    expect(clip.sim.z).toBeGreaterThan(25);
    expect(clip.parts.left).toBeGreaterThan(0);
    expect(clip.parts.right).toBe(0);
    const clean = run(() => null, 50, 2.5);
    expect(clip.sim.u).toBeLessThan(clean.sim.u);
  });

  it('drives through a hedge, slowed a little', () => {
    const car = run((x, z, r) => (Math.abs(z - 20) < 1 + r && Math.abs(x) < 3 + r ? 'soft' : null), 50, 2.5);
    expect(car.sim.z).toBeGreaterThan(25);
    expect(car.condition).toBeGreaterThan(0);
    expect(car.condition).toBeLessThan(5);
  });

  it('stops for a person without damage', () => {
    const car = run(post(0, 15, 0.35, 'person'), 20);
    expect(car.sim.z).toBeLessThan(15);
    expect(car.condition).toBe(0);
  });

  it('puts damage on the part that took it', () => {
    const W: [number, number] = [-1.3, 1.3];
    expect(sectionsAt(2.2, 0, 2.15, 0.85, W).front).toBe(1);
    expect(sectionsAt(-2.2, 0, 2.15, 0.85, W).rear).toBe(1);
    expect(sectionsAt(0, -0.85, 2.15, 0.85, W).right).toBe(1);
    expect(sectionsAt(1.3, 0.85, 2.15, 0.85, W).fl).toBeGreaterThan(0);
    expect(impactDamage(1)).toBe(0);
    expect(impactDamage(19 / 3.6)).toBe(0);
  });

  it('prices the repair by the damage, with the tow when totalled; old saves spread their damage', () => {
    const light = { ...newParts(), left: 20 };
    const heavy = { ...newParts(), front: 60, left: 60 };
    const wreck = { ...newParts(), front: 100 };
    expect(repairCost(light)).toBeLessThan(repairCost(heavy));
    expect(overall(wreck)).toBe(TOTALED);
    expect(repairCost(wreck)).toBeGreaterThan(repairCost({ ...newParts(), front: 99 }));
    expect(partsOf({ damage: 30 }).front).toBe(30);
    expect(partsOf({ damage: 30, sections: { ...newParts(), rear: 5 } }).front).toBe(0);
  });
});
