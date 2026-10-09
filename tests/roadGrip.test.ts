import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import exText from '../content/world3d/expressway.yaml?raw';
import { loadDistrictContent } from '../src/poc3d/district/content';
import { RacePath } from '../src/poc3d/district/cityRace';
import { Expressway, parseExpressway } from '../src/poc3d/district/expressway';
import { CITY_ASSISTS } from '../src/poc3d/district/ownCar';
import { RaceRival } from '../src/poc3d/district/raceRival';
import { crosswind, DRY, puddleAt, weatherAfter, weatherBefore, weatherGrip, wheelWater, type RoadWeather } from '../src/poc3d/district/roadGrip';
import { Car, FLAT, type Ground } from '../src/race/vehicle';

const RAIN: RoadWeather = { wet: 1, snow: 0 };
const SNOW: RoadWeather = { wet: 0, snow: 1 };

/** Braking from 20 m/s to a stop on flat ground in this weather: the distance (m). */
function stop(w: RoadWeather): number {
  const car = new Car(undefined, CITY_ASSISTS);
  const ground: Ground = { ...FLAT, grip: () => weatherGrip(w) };
  // (On a stretch with no puddles: their drag would stop it sooner.)
  let x0 = 0;
  while ([...Array(40).keys()].some((k) => [-1, 1].some((sd) => puddleAt(x0 + sd, k, 1) > 0))) x0 += 3;
  car.place(x0, 0, 0, ground);
  car.u = 20;
  const dt = 1 / 60;
  for (let t = 0; t < 20 && car.u > 0.05; t += dt) {
    const water = weatherBefore(car, w, [1, 1], 1.3, -1.25);
    car.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: false }, ground);
    weatherAfter(car, dt, water, w);
  }
  return Math.hypot(car.x - x0, car.z);
}

describe('weather on the road', () => {
  it('has puddles only once the ground is wet, over a share of it, where the shader draws them', () => {
    let wet = 0;
    let dry = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = 3000 + i * 1.7;
        const z = 1500 + j * 1.7;
        if (puddleAt(x, z, 1) > 0.5) wet++;
        if (puddleAt(x, z, 0.2) > 0) dry++;
      }
    }
    expect(dry).toBe(0);
    expect(wet / (N * N)).toBeGreaterThan(0.03);
    expect(wet / (N * N)).toBeLessThan(0.4);
  });

  it('stops longer on wet roads, far longer on snow', () => {
    const d = stop(DRY);
    // (The brakes, not the tyres, limit a stop on a merely wet road; a longer one only where it's slippery.)
    expect(stop(RAIN)).toBeGreaterThanOrEqual(d * 0.999);
    expect(stop(RAIN)).toBeLessThan(d * 1.25);
    expect(stop(SNOW)).toBeGreaterThan(d * 1.3);
  });

  it('drags and skims in puddles at speed, pulls toward the wet side, and barely at a crawl', () => {
    // Find a spot deep in a puddle.
    let at: [number, number] | null = null;
    for (let x = 3000; x < 3400 && !at; x += 0.5) for (let z = 1500; z < 1520 && !at; z += 0.5) if (puddleAt(x, z, 1) > 0.95) at = [x, z];
    expect(at).not.toBeNull();
    const [x, z] = at!;
    const all = wheelWater([[x, z], [x, z], [x, z], [x, z]], 28, RAIN);
    expect(all.grip[0]).toBeLessThan(0.8);
    expect(all.drag).toBeGreaterThan(1);
    const crawl = wheelWater([[x, z], [x, z], [x, z], [x, z]], 2, RAIN);
    expect(crawl.grip[0]).toBeGreaterThan(0.99);
    // Only the left wheels in it: a pull to the left, and gently.
    const dryAt = (): [number, number] => {
      for (let q = 0; q < 400; q += 0.5) if (puddleAt(x + q, z, 1) === 0) return [x + q, z];
      return [x, z];
    };
    const d = dryAt();
    const left = wheelWater([[x, z], d, [x, z], d], 20, RAIN);
    expect(left.yaw).toBeGreaterThan(0);
    expect(left.yaw).toBeLessThan(0.2);
  });

  it('pushes a moving car sideways in a crosswind, more when exposed, not one standing', () => {
    // Heading north (h = 0 faces +z); wind blowing toward +x is toward the car's left.
    const w = (exposure: number): RoadWeather => ({ wet: 0, snow: 0, wind: [1, 0], exposure });
    expect(crosswind(0, 25, w(1))).toBeGreaterThan(1);
    expect(crosswind(0, 25, w(0.45))).toBeLessThan(crosswind(0, 25, w(1)));
    expect(crosswind(0, 0, w(1))).toBe(0);
    expect(crosswind(Math.PI, 25, w(1))).toBeLessThan(0);
  });

  it('slows the race rival in the snow, and it still gets round C1 without hitting the walls much', () => {
    const content = loadDistrictContent();
    const ex = new Expressway(parseExpressway('expressway.yaml', exText, [])!);
    const def = content.races.find((r) => r.id === 'c1_lap')!;
    const run = (w: RoadWeather): { t: number; s: number; walls: number } => {
      const path = new RacePath(def, ex);
      const rival = new RaceRival(path, ex, new THREE.MeshBasicMaterial(), def.rival.skill, def.rival);
      rival.weather = w;
      rival.place(4, -1.8);
      const cam = new THREE.Vector3(1e6, 0, 0);
      let t = 0;
      let walls = 0;
      while (t < 500 && rival.s < path.length - 1) {
        rival.update(1 / 60, [], 0, false, cam);
        if (rival.car.bump > 1) walls++;
        t += 1 / 60;
      }
      return { t, s: rival.s, walls };
    };
    const dry = run(DRY);
    const snow = run(SNOW);
    expect(snow.s).toBeGreaterThan(3200);
    expect(snow.walls).toBeLessThanOrEqual(3);
    expect(snow.t).toBeGreaterThan(dry.t * 1.08);
  });
});
