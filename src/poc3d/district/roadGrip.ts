/**
 * How the weather drives (ownCar.ts, raceRival.ts; the traffic's caution is `conditions` in real/traffic.ts and
 * real/expressway.ts). Pure, so the tests can drive it.
 *
 * - Wet roads grip a little less.
 * - Puddles: the same puddles the ground shader draws (city.ts and ssr.ts: two octaves of value noise over the
 *   ground, a puddle where it's high, growing as the ground wets through), worked out here in 32-bit floats as the
 *   GPU does. A wheel in one is dragged back (so a puddle on one side pulls the car toward it), and at speed it
 *   skims the water and loses grip (aquaplaning). Kept mild: at night in the rain you can't always see them.
 * - Snow on the road: much less grip and a little drag through it.
 * - Autumn leaves on the road: a little less grip, more when they're wet.
 * - Wind: a crosswind pushes the car sideways (with the gusts), hard up on the expressway or a bridge, less
 *   between the buildings, and more the faster you go (the tyres hold a car that's standing).
 * - Fog, darkness and lightning change only what you can see.
 */
const f = Math.fround;
const fract = (v: number): number => f(v - Math.floor(v));

/** The shader's h2 (Dave Hoskins' sin-free hash), step by step in 32-bit floats. */
function h2(px: number, py: number): number {
  let x = fract(f(px * f(0.1031)));
  let y = fract(f(py * f(0.1031)));
  let z = fract(f(px * f(0.1031)));
  const d = f(f(f(x * f(y + f(33.33))) + f(y * f(z + f(33.33)))) + f(z * f(x + f(33.33))));
  x = f(x + d);
  y = f(y + d);
  z = f(z + d);
  return fract(f(f(x + y) * z));
}

function vnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = f(px - ix);
  let fy = f(py - iy);
  fx = f(fx * fx * (3 - 2 * fx));
  fy = f(fy * fy * (3 - 2 * fy));
  const a = h2(ix, iy);
  const b = h2(ix + 1, iy);
  const c = h2(ix, iy + 1);
  const d = h2(ix + 1, iy + 1);
  return f(f(a + (b - a) * fx) + f(f(c + (d - c) * fx) - f(a + (b - a) * fx)) * fy);
}

const smooth = (e0: number, e1: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** How deep in a puddle a point on the road is (0 dry ground, 1 the middle of one), with the ground wet 0-1. */
export function puddleAt(x: number, z: number, wet: number): number {
  if (wet <= 0.35) return 0;
  const pn = vnoise(f(x * f(0.22)), f(z * f(0.22))) + 0.12 * vnoise(f(x * f(1.9)), f(z * f(1.9)));
  return smooth(0.62, 0.68, pn) * smooth(0.35, 0.9, wet);
}

/** How much a wheel in this depth of flood water (m) is wading, 0-1: nothing at a puddle's depth, full at about 25 cm. */
export const wading = (depth: number): number => smooth(0.04, 0.25, depth);

export interface RoadWeather {
  /** The depth of the flood water over the street at (x, z), in m (Manila's monsoon floods, real/flood.ts). */
  readonly floodAt?: (x: number, z: number) => number;
  /** The ground wet through (0-1, the city's uWet). */
  readonly wet: number;
  /** Snow lying (0-1, the city's uSnow). */
  readonly snow: number;
  /** Fallen leaves on the road (autumn: 1). */
  readonly leaves?: number;
  /** The wind now (world x, z; its length the strength, 1 a gale: main.ts windVec / 3.2), and how exposed the car
   * is to it (1 up on the deck or a bridge, about half down between the buildings). */
  readonly wind?: readonly [number, number];
  readonly exposure?: number;
}

export const DRY: RoadWeather = { wet: 0, snow: 0 };

/** Roads keep a little less snow than pavements (city.ts: 0.8 of it). */
const ROAD_SNOW = 0.8;

/** The grip the road has everywhere in this weather (1 dry): wet a little less, snow much less. */
export function weatherGrip(w: RoadWeather): number {
  return (1 - 0.1 * w.wet) * (1 - 0.55 * w.snow * ROAD_SNOW) * (1 - (w.leaves ?? 0) * (0.04 + 0.08 * w.wet));
}

/** The crosswind's sideways push on a car heading h at speed (m/s): its acceleration (m/s^2, + to the car's left). */
export function crosswind(h: number, speed: number, w: RoadWeather): number {
  if (!w.wind) return 0;
  const [wx, wz] = w.wind;
  // The car's left: (cos h, -sin h).
  const side = wx * Math.cos(h) - wz * Math.sin(h);
  return Math.sign(side) * side * side * 2.4 * (w.exposure ?? 0.5) * Math.min(1, Math.abs(speed) / 8);
}

export interface WheelWater {
  /** Grip left at the front and rear axles (multiplies the car's gripMul). */
  readonly grip: [number, number];
  /** Deceleration (m/s^2) from the water and snow the wheels push through, and the yaw rate it adds (rad/s, + left). */
  readonly drag: number;
  readonly yaw: number;
  /** How much water the wheels are in (0-1), for the sound and the spray. */
  readonly splash: number;
}

/**
 * The puddles under a car's four wheels: (x, z) of each, in the order front left, front right, rear left, rear
 * right; its speed (m/s).
 */
export function wheelWater(wheels: readonly (readonly [number, number])[], speed: number, w: RoadWeather): WheelWater {
  const fl = wheels.map(([x, z]) => (w.floodAt ? wading(w.floodAt(x, z)) : 0));
  const d = wheels.map(([x, z], i) => Math.max(puddleAt(x, z, w.wet), fl[i]));
  const s = Math.abs(speed);
  // Skimming the water: nothing at a crawl, most by motorway speed.
  const skim = smooth(11, 30, s);
  const grip: [number, number] = [1 - 0.28 * skim * Math.max(d[0], d[1]), 1 - 0.34 * skim * Math.max(d[2], d[3])];
  const water = (d[0] + d[1] + d[2] + d[3]) / 4;
  // The water drags (more with speed), and deep snow a little.
  const wade = (fl[0] + fl[1] + fl[2] + fl[3]) / 4;
  // Wading a flood is far worse than a puddle: the water piles up against the car (about 5 m/s^2 at 20 m/s).
  const drag = water * Math.min(3.2, 0.9 + s * 0.09) + wade * wade * (1.2 + s * 0.2) + w.snow * ROAD_SNOW * Math.min(0.9, s * 0.05);
  // One side in the water: that side slows, so the car turns toward it (softly: you can't always see them).
  const left = d[0] + d[2];
  const right = d[1] + d[3];
  const yaw = (left - right) * 0.5 * Math.min(1, s / 15) * 0.09;
  return { grip, drag, yaw: speed >= 0 ? yaw : -yaw, splash: Math.max(...d) };
}

/** A car on the racing model, as far as the weather touches it. */
interface CarLike {
  x: number;
  z: number;
  h: number;
  u: number;
  w: number;
  gripMul: [number, number];
}

/** A car's four wheels (front left, front right, rear left, rear right): front and rear axle along it, half track. */
export function wheelsOf(car: CarLike, front: number, rear: number, half: number): [number, number][] {
  const fx = Math.sin(car.h);
  const fz = Math.cos(car.h);
  const lx = Math.cos(car.h);
  const lz = -Math.sin(car.h);
  return [
    [car.x + fx * front + lx * half, car.z + fz * front + lz * half],
    [car.x + fx * front - lx * half, car.z + fz * front - lz * half],
    [car.x + fx * rear + lx * half, car.z + fz * rear + lz * half],
    [car.x + fx * rear - lx * half, car.z + fz * rear - lz * half],
  ];
}

/**
 * Before the car's step: the water under its wheels takes grip at that axle (over what it had: base). Returns the
 * water, for after.
 */
export function weatherBefore(car: CarLike, w: RoadWeather, base: readonly [number, number], front: number, rear: number, half = 0.72): WheelWater {
  const ww = wheelWater(wheelsOf(car, front, rear, half), car.u, w);
  car.gripMul = [base[0] * ww.grip[0], base[1] * ww.grip[1]];
  return ww;
}

/** After the car's step: the drag of the water and snow, the pull toward a puddle on one side, the crosswind. */
export function weatherAfter(car: CarLike, dt: number, ww: WheelWater, w: RoadWeather): void {
  const s = Math.hypot(car.u, car.w);
  if (ww.drag > 0 && s > 0.2) {
    const k = Math.max(0, 1 - (ww.drag * dt) / s);
    car.u *= k;
    car.w *= k;
  }
  car.h += ww.yaw * dt;
  car.w += crosswind(car.h, car.u, w) * dt;
}
