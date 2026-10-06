import type { Part } from '../../race/carView';
import type { Controls } from '../../race/vehicle';
import type { CarType } from '../models/vehicles';

/**
 * Car chases in the city, for trying out the gun fighting from the car (district/carGun.ts): you at the wheel of
 * your own car with the Type 54, against cars on the same handling model that drive the streets by themselves
 * (district/chaseCar.ts). Two kinds:
 * - `hunt`: a car makes a run for it and you stop it: shoot it to pieces, shoot out its tyres (one and it limps,
 *   slower and loose at the back; two and it's done), put a round through the glass into its driver, or ram it off
 *   the road. It's lost if it gets clean away or the clock runs out.
 * - `hunted`: cars come after you, their gunmen shooting from the passenger window (the left: they come up on
 *   your right for the line). See them all off, lose them, or (a getaway) reach the place you're running to.
 * This is the pure part the tests drive (tests/chase.test.ts): the jobs, the rules of damage, how a job is won
 * and lost, how a pursuer steers when it has you in sight, where a runner runs to, and a gunman's trigger.
 */

export type ChaseKind = 'hunt' | 'hunted';

/** A car in a chase: what it is, how well it's driven and shot from, what it takes. */
export interface ChaseCarDef {
  readonly name: string;
  readonly type: CarType;
  readonly paint: number;
  /** Its engine and grip against the catalogue coupe's (1: the same). */
  readonly power: number;
  readonly grip: number;
  /** How hard it's driven (a share of the pursuit style's pace: district/autoDrive.ts). */
  readonly pace: number;
  /** A gunman in the passenger seat, and how well he shoots (1: the race rivals'). */
  readonly gunman: boolean;
  readonly aim: number;
  readonly health: number;
}

export interface ChaseDef {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly kind: ChaseKind;
  readonly cars: readonly ChaseCarDef[];
  /** A hunt's time limit (s). */
  readonly time?: number;
  /** A getaway: the node to reach (you needn't shake them first). */
  readonly reach?: string;
  /** What it pays, won. */
  readonly pay: number;
}

const SALOON = 0x0b0b0e;
const car = (name: string, type: CarType, paint: number, o: Partial<ChaseCarDef> = {}): ChaseCarDef => ({ name, type, paint, power: 1, grip: 1, pace: 0.9, gunman: false, aim: 1, health: 70, ...o });

/** The jobs on offer (the debug menu's Car chases; `__chase.start(id)`). */
export const CHASES: readonly ChaseDef[] = [
  {
    id: 'runner',
    name: 'The runner',
    blurb: "A bagman is making a run for it in a black saloon. Stop the car: shoot it up, shoot out a tyre, or put it into a wall. He isn't armed.",
    kind: 'hunt',
    cars: [car('Bagman', 'sedan', SALOON, { pace: 0.84, health: 60 })],
    time: 180,
    pay: 30000,
  },
  {
    id: 'runner_armed',
    name: 'The lieutenant',
    blurb: 'A Rindō-gumi lieutenant in a big saloon, quicker, with a man in the passenger seat who shoots back when you come alongside.',
    kind: 'hunt',
    cars: [car('Lieutenant', 'luxury', SALOON, { pace: 0.94, power: 1.15, gunman: true, aim: 0.9, health: 90 })],
    time: 210,
    pay: 60000,
  },
  {
    id: 'tail',
    name: 'On your tail',
    blurb: 'Two cars of Rindō-gumi men have found you. Their gunmen shoot from the left window, so they come up on your right. See them off, or lose them.',
    kind: 'hunted',
    cars: [car('Rindō-gumi 1', 'sedan', SALOON, { gunman: true, pace: 0.96, power: 1.1, health: 60 }), car('Rindō-gumi 2', 'luxury', 0x16181c, { gunman: true, aim: 0.85, pace: 0.92, power: 1.15, health: 75 })],
    pay: 50000,
  },
  {
    id: 'hit_squad',
    name: 'The hit squad',
    blurb: 'Three cars, better drivers, better shots. Nobody is coming to help.',
    kind: 'hunted',
    cars: [
      car('Rindō-gumi 1', 'luxury', SALOON, { gunman: true, aim: 1.15, pace: 1, power: 1.25, health: 80 }),
      car('Rindō-gumi 2', 'sedan', SALOON, { gunman: true, aim: 1.1, pace: 1, power: 1.2, health: 65 }),
      car('Rindō-gumi 3', 'sports', 0x5a0c10, { gunman: true, aim: 1, pace: 1.04, power: 1.1, grip: 1.05, health: 55 }),
    ],
    pay: 110000,
  },
  {
    id: 'getaway',
    name: 'The getaway',
    blurb: 'Two cars on you and a long way home. Get to Yotaka Garage: you needn’t stop them, only arrive.',
    kind: 'hunted',
    cars: [car('Rindō-gumi 1', 'sedan', SALOON, { gunman: true, pace: 0.98, power: 1.15, health: 70 }), car('Rindō-gumi 2', 'sedan', 0x16181c, { gunman: true, pace: 0.95, power: 1.1, health: 70 })],
    reach: 'city_garage.front',
    pay: 70000,
  },
];

/** You: what you take before you're done (a job's own health, apart from the car's bodywork). */
export const YOUR_HEALTH = 100;
/** A round into a car's body, or through its glass; and what a tyre shot out costs it besides. */
export const SHOT = { body: 8, glass: 14, tyre: 15 } as const;
/** A car's done once this many of its tyres are shot out; with one gone it's this much slower. */
export const TYRES_OUT = 2;
export const LIMP = 0.6;
/** A round that finds you: in the bodywork, through the glass, or (rare: he aims at the cabin) the head. */
export const SHOT_AT_YOU = { body: 3, glass: 6, head: 12 } as const;
/** A round that finds one of your tyres bursts it this often (else it's in the bodywork). */
export const TYRE_BURST = 0.35;
/** A hunt is lost once the runner has been this far off (m) for this long (s). */
export const LOST = { dist: 330, secs: 9 } as const;
/** Pursuers are shaken once every one still running has been this far off (m), unseen, for this long (s). */
export const SHAKEN = { dist: 210, secs: 12 } as const;
/** A getaway's place is reached within this of it (m). */
export const REACHED = 14;
/** How long you may be out of the car (s). */
const ON_FOOT = 4;

/** What a knock between two cars costs the one in a chase, by how fast they closed (m/s): a nudge is nothing, a ram tells. */
export const ramDamage = (closing: number): number => Math.max(0, closing - 3.5) * 2.4;

/** What a round does to a chase car by where it struck. */
export function shotAt(part: Part, who: 'driver' | 'gunman' | undefined): { damage: number; out: string | null; gunman: boolean; tyre: boolean; note: string } {
  if (part === 'head' && who === 'gunman') return { damage: 0, out: null, gunman: true, tyre: false, note: 'HEADSHOT · the gunman is down' };
  if (part === 'head') return { damage: 0, out: 'driver shot', gunman: false, tyre: false, note: 'HEADSHOT' };
  if (part === 'tyre') return { damage: SHOT.tyre, out: null, gunman: false, tyre: true, note: 'TYRE SHOT OUT' };
  const d = part === 'glass' ? SHOT.glass : SHOT.body;
  return { damage: d, out: null, gunman: false, tyre: false, note: `${part === 'glass' ? 'THROUGH THE GLASS' : 'HIT'} −${d}` };
}

export interface ChaseCarState {
  health: number;
  /** Why it's out of it (null: still running). */
  out: string | null;
  /** Its gunman can still shoot. */
  gunman: boolean;
  /** Tyres shot out. */
  tyres: number;
}

/** What the page tells the job each frame. */
export interface ChaseView {
  /** You're at the wheel; your car's wrecked (crash.ts). */
  readonly driving: boolean;
  readonly wrecked: boolean;
  /** Each chase car: how far off, and whether you can see it (or it you). */
  readonly dist: readonly number[];
  readonly seen: readonly boolean[];
  /** A getaway: how far its place is (m). */
  readonly toGoal?: number;
}

export type ChasePhase = 'countdown' | 'running' | 'over';

/** A job under way: the countdown, the clock, your health and theirs, and how it ends. */
export class ChaseState {
  phase: ChasePhase = 'countdown';
  countdown = 3;
  t = 0;
  health = YOUR_HEALTH;
  readonly cars: ChaseCarState[];
  result: { won: boolean; why: string } | null = null;
  /** Seconds the runner's been out of reach (a hunt), every pursuer's been shaken off (hunted), you've been on foot. */
  lostFor = 0;
  clearFor = 0;
  private onFoot = 0;

  constructor(readonly def: ChaseDef) {
    this.cars = def.cars.map((c) => ({ health: c.health, out: null, gunman: c.gunman, tyres: 0 }));
  }

  get running(): boolean {
    return this.phase === 'running';
  }

  /** Seconds left on a hunt's clock (Infinity where there is none). */
  get left(): number {
    return this.def.time === undefined ? Infinity : Math.max(0, this.def.time - this.t);
  }

  /** How many chase cars are still running. */
  get live(): number {
    return this.cars.filter((c) => !c.out).length;
  }

  finish(won: boolean, why: string): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.result = { won, why };
  }

  /** One of your rounds struck chase car i. Returns what to say about it. */
  shoot(i: number, part: Part, who: 'driver' | 'gunman' | undefined): string | null {
    const c = this.cars[i];
    if (!c || c.out || !this.running) return null;
    const s = shotAt(part, who);
    if (s.gunman) {
      if (!c.gunman) return null;
      c.gunman = false;
      return s.note;
    }
    c.health = Math.max(0, c.health - s.damage);
    if (s.tyre) c.tyres++;
    if (s.out) c.out = s.out;
    else if (c.tyres >= TYRES_OUT) c.out = 'tyres shot out';
    else if (c.health === 0) c.out = 'shot to pieces';
    return c.out && !s.out ? `${this.def.cars[i].name.toUpperCase()} DOWN` : s.note;
  }

  /** Chase car i took a knock (from you, or a wall at speed). */
  ram(i: number, closing: number): number {
    const c = this.cars[i];
    if (!c || c.out || !this.running) return 0;
    const d = ramDamage(closing);
    c.health = Math.max(0, c.health - d);
    if (c.health === 0) c.out = 'wrecked';
    return d;
  }

  /** One of their rounds found you. Returns what it cost. */
  shot(part: Part): number {
    if (!this.running) return 0;
    const d = part === 'head' ? SHOT_AT_YOU.head : part === 'glass' ? SHOT_AT_YOU.glass : SHOT_AT_YOU.body;
    this.health = Math.max(0, this.health - d);
    if (this.health === 0) this.finish(false, 'They shot you.');
    return d;
  }

  update(dt: number, v: ChaseView): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) this.phase = 'running';
      return;
    }
    if (this.phase !== 'running') return;
    this.t += dt;
    this.onFoot = v.driving ? 0 : this.onFoot + dt;
    if (v.wrecked) return this.finish(false, 'Your car is wrecked.');
    if (this.onFoot > ON_FOOT) return this.finish(false, 'You left the car.');
    const live = this.cars.map((c, i) => (c.out ? -1 : i)).filter((i) => i >= 0);
    if (this.def.kind === 'hunt') {
      if (live.length === 0) return this.finish(true, this.cars.length > 1 ? 'You stopped them.' : `You stopped him: ${this.cars[0].out}.`);
      if (this.left <= 0) return this.finish(false, 'Out of time: he got away.');
      const far = live.every((i) => v.dist[i] > LOST.dist);
      this.lostFor = far ? this.lostFor + dt : 0;
      if (this.lostFor > LOST.secs) return this.finish(false, 'You lost him.');
      return;
    }
    if (live.length === 0) return this.finish(true, 'You saw them all off.');
    if (this.def.reach !== undefined && (v.toGoal ?? Infinity) < REACHED) return this.finish(true, 'You made it.');
    const clear = live.every((i) => v.dist[i] > SHAKEN.dist && !v.seen[i]);
    this.clearFor = clear ? this.clearFor + dt : 0;
    if (this.def.reach === undefined && this.clearFor > SHAKEN.secs) return this.finish(true, 'You lost them.');
  }
}

/** A car as a pursuer needs it: where it is, the way it points (rad, as race/vehicle.ts), its forward speed. */
export interface Mover {
  readonly x: number;
  readonly z: number;
  readonly h: number;
  readonly u: number;
}

/** Where a pursuer wants to be about you: metres ahead of your middle and to your left (negative: your right). */
export interface Slot {
  readonly along: number;
  readonly across: number;
}

/**
 * The places pursuers take, in the order they're given out: on your right, level with you (the gunman's window faces
 * you); on your tail (to ram); on your left.
 */
export const SLOTS: readonly Slot[] = [
  { along: -0.5, across: -3.1 },
  { along: -6.5, across: 0 },
  { along: -1.5, across: 3.1 },
];

/**
 * A pursuer with you in sight: the controls that take it to its `slot` about you and hold it there at your speed.
 * `wall`: metres to something solid dead ahead (Infinity: clear) and the side that's clearer (+1 its left).
 */
export function pursue(self: Mover, you: Mover, slot: Slot, top: number, wall: { ahead: number; side: number } = { ahead: Infinity, side: 0 }): Controls {
  const fx = Math.sin(you.h);
  const fz = Math.cos(you.h);
  // Its place, and how far that is ahead of it along your line (the ground to make up: negative, it's overshot).
  const px = you.x + fx * slot.along + fz * slot.across;
  const pz = you.z + fz * slot.along - fx * slot.across;
  const along = (px - self.x) * fx + (pz - self.z) * fz;
  // (There already, and you're stopped: it stands by you. On the handbrake: the brake at a standstill is reverse.)
  if (Math.hypot(px - self.x, pz - self.z) < 2.5 && Math.abs(you.u) < 1.5 && Math.abs(self.u) < 3) return { throttle: 0, brake: 0, steer: 0, handbrake: true };
  // It steers for a point on the line through its place parallel to yours, a look ahead of where it is along it:
  // so it swings onto that line and settles on it, rather than swerving at the spot itself.
  // (With you stopped or crawling there's no line to follow: it steers for the place itself.)
  const look = Math.max(8, Math.min(26, Math.abs(self.u) * 0.9));
  const moving = Math.max(0, Math.min(1, you.u / 8));
  const on = along > look ? along : along + (look - along) * moving;
  const tx = px - fx * along + fx * on;
  const tz = pz - fz * along + fz * on;
  const dx = tx - self.x;
  const dz = tz - self.z;
  const sx = Math.sin(self.h);
  const sz = Math.cos(self.h);
  const bearing = Math.atan2(dx * sz - dz * sx, dx * sx + dz * sz);
  let steer = Math.max(-1, Math.min(1, bearing * 2.4));
  // Your speed, and on top of it what closes the gap in time to stop closing when it's there: the ground to make
  // up along your line once it's on it, the whole way to its place while it's still off to one side (you stopped
  // across a square from it: it comes over).
  const across = (px - self.x) * fz - (pz - self.z) * fx;
  const reach = Math.abs(across) > 4 ? Math.hypot(px - self.x, pz - self.z) : along;
  const closing = Math.sign(reach) * Math.min(Math.sqrt(2 * 4.5 * Math.abs(reach)), reach > 0 ? 18 : 8);
  let want = Math.max(0, Math.min(top, Math.max(0, you.u) + closing));
  // (Its place is behind it, or off to one side of where it points: slow right down and come round.)
  if (Math.abs(bearing) > 1.3) want = Math.min(want, 7);
  // Something solid ahead: round it on the clearer side, and no faster than it can stop.
  if (wall.ahead < 30) {
    want = Math.min(want, Math.sqrt(2 * 7 * Math.max(0, wall.ahead - 3)) + 2);
    if (wall.ahead < 16 && wall.side !== 0) steer = Math.max(-1, Math.min(1, steer + wall.side * (1 - wall.ahead / 16) * 1.6));
  }
  const err = want - self.u;
  return { throttle: err > 0 ? Math.min(1, err * 0.5 + 0.15) : 0, brake: err < -1 ? Math.min(1, -err * 0.25) : 0, steer, handbrake: false };
}

/**
 * Where a runner might run to from (x, z), heading (hx, hz), with you at (tx, tz): points round it at each of
 * `reach` metres, best first (far from you, the way it's already going, never toward you). The caller takes the first
 * it can route to.
 */
export function fleeGoals(x: number, z: number, hx: number, hz: number, tx: number, tz: number, reach: readonly number[] = [750, 480]): [number, number][] {
  const away = Math.hypot(x - tx, z - tz) || 1;
  const ax = (x - tx) / away;
  const az = (z - tz) / away;
  const out: { p: [number, number]; score: number }[] = [];
  for (const r of reach) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const toward = -(dx * ax + dz * az);
      if (toward > 0.5) continue;
      const p: [number, number] = [x + dx * r, z + dz * r];
      out.push({ p, score: Math.hypot(p[0] - tx, p[1] - tz) + 260 * (dx * hx + dz * hz) + 0.2 * r });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((o) => o.p);
}

/** How far a gunman's aim wanders off you (m, at you): more with the distance, both cars' speed, and across his own car. */
export const missBy = (dist: number, speeds: number, across: boolean, aim: number): number => (0.45 + dist * 0.045 + speeds * 0.02 + (across ? 0.6 : 0)) / Math.max(0.2, aim);

/** The furthest a gunman shoots from (m), and how long he takes to bring the gun up (s). */
export const GUNMAN = { range: 42, aim: 0.8 } as const;

/**
 * A gunman's trigger: once he's had a line on you for a moment he fires in twos, threes and fours, with a pause
 * between bursts. `rand`: random numbers in [0, 1).
 */
export class Trigger {
  private aimed = 0;
  /** (Nobody shoots in a job's first moments.) */
  private cool = 3.5;
  private left = 3;

  constructor(private readonly rand: () => number = Math.random) {}

  /** How far the gun's come up (0-1): the arm shows from part way. */
  get raised(): number {
    return Math.min(1, this.aimed / GUNMAN.aim);
  }

  /** Advance dt; `line`: he has a line on you through a window, in range. Returns true when he fires. */
  step(dt: number, line: boolean): boolean {
    this.cool -= dt;
    if (!line) {
      this.aimed = Math.max(0, this.aimed - dt * 2);
      return false;
    }
    this.aimed = Math.min(3, this.aimed + dt);
    if (this.aimed < GUNMAN.aim || this.cool > 0) return false;
    this.cool = 0.4 + this.rand() * 0.5;
    if (--this.left <= 0) {
      this.cool = 1.8 + this.rand() * 2.2;
      this.left = 2 + Math.floor(this.rand() * 3);
    }
    return true;
  }
}
