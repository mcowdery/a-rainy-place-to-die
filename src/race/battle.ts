import type { Course } from './course';
import type { Dir } from './trial';
import type { Car, Controls } from './vehicle';

/**
 * A battle down (or up) the pass against a rival driver, both armed: real guns (damage; a car shot to pieces
 * is out) or paintball (each hit taken adds a second to your time). This is the pure part the tests drive:
 * the rival's driving and the two cars knocking into each other. Shooting, damage and the HUD are in main.ts.
 */

export type Arms = 'gun' | 'paint';

/**
 * Real guns: a car's health, and the damage of a hit on the body or through the glass. A tyre shot out or a
 * round in the driver's head is lethal: the car is out at once (a gunman's head silences his gun).
 */
export const HEALTH = 100;
export const DAMAGE = { body: 6, glass: 12 } as const;
/** Paintball: seconds added to your time for each hit you take. */
export const PAINT_PENALTY = 0.5;

/** A car's world velocity from its body frame (u forward, w to its left). */
const velocity = (c: Car): [number, number] => [Math.sin(c.h) * c.u + Math.cos(c.h) * c.w, Math.cos(c.h) * c.u - Math.sin(c.h) * c.w];
const setVelocity = (c: Car, vx: number, vz: number): void => {
  c.u = vx * Math.sin(c.h) + vz * Math.cos(c.h);
  c.w = vx * Math.cos(c.h) - vz * Math.sin(c.h);
};

/** Each car as three circles along it (nose, middle, tail), radius R: close enough to a coupe for knocks. */
const R = 0.92;
const SPOTS = [-1.3, 0, 1.3];

/**
 * Keep two cars apart: where they overlap, push them apart (half each) and, if they were closing, trade
 * momentum along the contact (equal masses, a little bounce) and spin each a little by where it was struck.
 * Returns the closing speed of the knock (m/s, 0 if none).
 */
export function separateCars(a: Car, b: Car): number {
  let best = 0;
  let nx = 0;
  let nz = 0;
  let pa = 0;
  let pb = 0;
  for (const sa of SPOTS) {
    for (const sb of SPOTS) {
      const ax = a.x + Math.sin(a.h) * sa;
      const az = a.z + Math.cos(a.h) * sa;
      const bx = b.x + Math.sin(b.h) * sb;
      const bz = b.z + Math.cos(b.h) * sb;
      const d = Math.hypot(bx - ax, bz - az);
      const pen = 2 * R - d;
      if (pen > best && d > 1e-4) {
        best = pen;
        nx = (bx - ax) / d;
        nz = (bz - az) / d;
        pa = sa;
        pb = sb;
      }
    }
  }
  if (best <= 0) return 0;
  a.x -= nx * best * 0.5;
  a.z -= nz * best * 0.5;
  b.x += nx * best * 0.5;
  b.z += nz * best * 0.5;
  const [avx, avz] = velocity(a);
  const [bvx, bvz] = velocity(b);
  const closing = (avx - bvx) * nx + (avz - bvz) * nz;
  if (closing <= 0) return 0;
  // Equal masses, restitution 0.25: each takes half the closing speed (and a bit) along the contact.
  const j = closing * (1 + 0.25) * 0.5;
  setVelocity(a, avx - nx * j, avz - nz * j);
  setVelocity(b, bvx + nx * j, bvz + nz * j);
  // Struck off-centre, a car turns: a nose or tail hit swings it about its middle.
  const sideA = Math.cos(a.h) * nx - Math.sin(a.h) * nz;
  const sideB = Math.cos(b.h) * nx - Math.sin(b.h) * nz;
  a.r -= pa * sideA * j * 0.35;
  b.r += pb * sideB * j * 0.35;
  a.bump = Math.max(a.bump, closing);
  b.bump = Math.max(b.bump, closing);
  return closing;
}

/**
 * The rival's driving: it follows the road in a lane of its choosing (a line to the left or right of the
 * centre), slowing for the bends ahead as a quick, tidy driver does (`skill` scales its pace), moving over to
 * pass you when you're in its way, and pushing harder when it's behind (and easing off when well ahead).
 */
/** The sideways grip (m/s^2) the rival plans its circuit corners for. */
const LAT = 5.6;

export class RivalDriver {
  /** Metres left of the centre line, in the direction of travel (the lane it's in, and the one it wants). */
  lane: number;
  private want: number;
  /**
   * On a circuit (a loop): how far from the centre it may go (a racing line to the inside of each bend), its top
   * speed (m/s), and a nudge to its pace from outside (the race's: pushing when behind the leader).
   */
  laneMax = 1.7;
  top = 30;
  push = 1;
  /** Seconds left of a pass (it holds its line to the side until then). */
  private passing = 0;

  constructor(
    readonly car: Car,
    readonly course: Course,
    readonly dir: Dir,
    public skill = 1,
    lane = -1.7,
  ) {
    this.lane = this.want = lane;
  }

  /** Back to the start, in a lane. */
  reset(lane: number): void {
    this.lane = this.want = lane;
  }

  /** Where a car is along the run (road samples from its start; more is further on). */
  progress(c: Car): number {
    const i = this.course.nearest(c.x, c.z).i;
    if (i < 0) return -1;
    return this.dir === 'up' ? i : this.course.x.length - 1 - i;
  }

  controls(dt: number, others: Car | readonly Car[] | null, out: boolean): Controls {
    const c = this.course;
    const car = this.car;
    if (out) return { throttle: 0, brake: 0.35, steer: 0, handbrake: false };
    const s = this.dir === 'up' ? 1 : -1;
    const n = c.x.length;
    const at = (k: number): number => (c.loop ? c.wrap(k) : Math.max(0, Math.min(n - 1, k)));
    const i = c.nearest(car.x, car.z).i;
    if (i < 0) return { throttle: 0, brake: 1, steer: 0, handbrake: false };
    let pace = this.skill * this.push;
    const list = others === null ? [] : Array.isArray(others) ? (others as readonly Car[]) : [others as Car];
    if (!c.loop && list[0]) {
      // Pace on a pass: pushing when behind you, easing off when well ahead.
      const gap = this.progress(list[0]) - this.progress(car);
      if (gap > 25) pace *= 1.06;
      else if (gap < -80) pace *= 0.95;
    }
    this.passing = Math.max(0, this.passing - dt);
    // On a circuit, the racing line: to the inside of the bend coming up (and back out after it).
    if (c.loop && this.passing === 0) {
      let turn = 0;
      for (let k = 10; k <= 50; k += 10) {
        const a = at(i + s * (k - 10));
        const b = at(i + s * k);
        turn += c.tz[a] * c.tx[b] - c.tx[a] * c.tz[b];
      }
      turn *= s;
      if (Math.abs(turn) > 0.08) this.want = Math.sign(turn) * this.laneMax * 0.6;
      else if (Math.abs(turn) < 0.03) this.want *= 0.98;
    }
    // Someone in its line just ahead (the nearest): pull out to the other side to pass.
    let block: { ahead: number; across: number } | null = null;
    for (const o of list) {
      if (o === car) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const ahead = dx * Math.sin(car.h) + dz * Math.cos(car.h);
      const across = dx * Math.cos(car.h) - dz * Math.sin(car.h);
      if (ahead > 0 && ahead < 16 && Math.abs(across - this.lane) < 1.9 && (!block || ahead < block.ahead)) block = { ahead, across };
    }
    if (block) {
      const side = c.loop ? this.laneMax * 0.8 : 1.7;
      this.want = block.across > 0 ? -side : side;
      this.passing = 2.5;
    }
    this.lane += Math.max(-dt * 1.2, Math.min(dt * 1.2, this.want - this.lane));
    // Steer at a point ahead on its line (the centre plus its lane, to the left of the way it's going).
    const look = Math.round(6 + Math.abs(car.u) * 0.5);
    const j = at(i + s * look);
    const lx = c.tz[j] * s;
    const lz = -c.tx[j] * s;
    const tx = c.x[j] + lx * this.lane;
    const tz = c.z[j] + lz * this.lane;
    const dx = tx - car.x;
    const dz = tz - car.z;
    const err = Math.atan2(dx * Math.cos(car.h) - dz * Math.sin(car.h), dx * Math.sin(car.h) + dz * Math.cos(car.h));
    // The bend ahead: the heading change over the next 35 m, as a radius, and a speed for it.
    let turn = 0;
    // (Further ahead the faster it goes, so it brakes in time.)
    const reach = c.loop ? Math.max(35, Math.round(car.u * car.u / 12)) : 35;
    for (let k = 5; k <= reach; k += 5) {
      const a = at(i + s * (k - 5));
      const b = at(i + s * k);
      const bend = Math.acos(Math.min(1, c.tx[a] * c.tx[b] + c.tz[a] * c.tz[b]));
      if (!c.loop) turn = Math.max(turn, bend);
      else {
        // The speed it could carry into that bend from here, braking at ~7 m/s^2 over the distance to it.
        // (A little under what the tyres take: a street circuit's walls forgive nothing.)
        // (A car with less steering lock, heavy and slow to turn in, takes them slower.)
        const vb = Math.sqrt(LAT * Math.min(1, (car.spec.lock / 0.6) ** 2) * pace * pace * (5 / Math.max(bend, 1e-3)));
        const v = Math.sqrt(vb * vb + 2 * 6.5 * Math.max(0, k - 5));
        turn = Math.max(turn, 5 * 6.3 / (v * v));
      }
    }
    const radius = 5 / Math.max(turn, 1e-3);
    // (On a circuit the pace is already in the bend speeds above.)
    const want = c.loop ? Math.min(this.top, Math.max(7, Math.sqrt(6.3 * radius))) : Math.min(30, Math.max(7, Math.sqrt(6.3 * radius))) * pace;
    // On a circuit, running wide toward a wall (understeer): near it and still heading for it, off the throttle
    // and a touch of brake, so the front bites again.
    if (c.loop && car.u > 15) {
      const nr = c.nearest(car.x, car.z);
      const j0 = c.wrap(nr.i);
      // The car's heading across the road (+ toward the road's left).
      const across = Math.sin(car.h) * c.tz[j0] - Math.cos(car.h) * c.tx[j0];
      if (Math.abs(nr.d) > c.rail - 2.4 && Math.sign(across) === Math.sign(nr.d) && Math.abs(across) > 0.02) {
        return { throttle: 0, brake: 0.35, steer: Math.max(-1, Math.min(1, err * 3)), handbrake: false };
      }
    }
    return { throttle: car.u < want ? 1 : 0, brake: car.u > want + 2 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)), handbrake: false };
  }
}
