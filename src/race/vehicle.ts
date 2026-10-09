/**
 * Car handling for driving and racing: arcade-leaning over a real tyre model, so drifts come out of the
 * physics (speed, weight transfer, the handbrake, power on) rather than being faked, with assists that make it
 * forgiving on a keyboard.
 *
 * The model: a planar bicycle model (front and rear axle) with
 * - tyre lateral force from the slip angle through a saturating curve (grip builds, peaks, falls off),
 * - the friction circle per axle (drive or brake force eats into the lateral grip: power oversteer, brake
 *   lock-up understeer), rear- or all-wheel drive (a share of the drive at the front), turbo lag (the boost
 *   builds with the revs under throttle), a limited-slip differential (the rear holds its line while spinning),
 * - load transfer front/rear with acceleration (lift off and the rear lightens),
 * - the handbrake (rear grip mostly gone, rear braking),
 * - gravity along the slope of the ground, aerodynamic drag and rolling resistance,
 * - a kinematic blend at walking pace (parking manoeuvres don't jitter).
 * Assists: automatic countersteer while the car slides (you steer into it less), a cap on the slide angle
 * (no spinning out by accident), a cap on the yaw rate, automatic gears.
 *
 * Stunts, each asked for on purpose (the assists stand down for them, and come back once the car's straight):
 * - a burnout: throttle and brake held together at a standstill (the fronts hold, the rears spin; steering walks
 *   the tail round the nose);
 * - a donut: out of a burnout, keep the throttle in and the wheel hard over: the rears stay lit and the car goes
 *   round its nose for as long as both are held (straighten the wheel or lift, and they bite again);
 * - a handbrake turn: the handbrake held (not tapped: a tap is still a drift's flick) with the wheel over brings
 *   the tail round further the longer it's held: let go after half a second or so for a quarter turn (the car
 *   stops turning and grips up the way it points), hold it a second and more and it goes right round to face
 *   back the way it came, a 180;
 * - a J-turn: reversing, the wheel over and the throttle down swings the nose round to face the way it's going.
 * Reversing itself is tame: less lock the faster it backs (the steered wheels trail, and full lock would whip
 * the nose round), and the engine slows it when you let go.
 *
 * Coordinates: world x east, z south, y up. Heading h: the car points along (sin h, cos h); h increasing
 * turns it left (anticlockwise seen from above). Local velocity: u forward, w to the car's left. Pure and
 * deterministic (a fixed 120 Hz step): the tests drive it directly.
 */

export interface CarSpec {
  /** kg, metres (CG to front and rear axle, CG height), yaw inertia factor (I = m * a * b * k). */
  readonly mass: number;
  readonly a: number;
  readonly b: number;
  readonly cgHeight: number;
  readonly inertia: number;
  /** Engine power (W) and the most the rear tyres get to the road at low speed (N). */
  readonly power: number;
  readonly maxDrive: number;
  /** Braking (as a fraction of weight), the share at the front. */
  readonly brake: number;
  readonly brakeFront: number;
  /** Drag coefficient (N per (m/s)^2), rolling resistance (N). */
  readonly drag: number;
  readonly rolling: number;
  /** Tyre grip (peak friction) front and rear, curve stiffness B and shape C (Pacejka-style). */
  readonly gripFront: number;
  readonly gripRear: number;
  readonly B: number;
  readonly C: number;
  /** Full steering lock (rad) at a standstill, the speed (m/s) at which it's halved, steering speed (rad/s). */
  readonly lock: number;
  readonly lockHalf: number;
  readonly steerRate: number;
  /** Rear grip left with the handbrake on (fraction). */
  readonly handbrakeGrip: number;
  /** Top reverse speed (m/s). */
  readonly reverse: number;
  /** Gear change speeds (m/s): gear n runs up to shift[n - 1]. */
  readonly shift: readonly number[];
  /** All-wheel drive: the share of the drive at the front (0 or absent: rear-wheel drive). */
  readonly awd?: number;
  /** Turbo: seconds for the boost to build (absent: none); off boost the engine makes 55% of its power. */
  readonly turbo?: number;
  /** Limited-slip differential 0-1: how much sideways grip the rear keeps while spinning (open: half). */
  readonly lsd?: number;
  /** Half length and half width for walls (absent: a car's, 2.15 x 0.85; a motorcycle is far smaller). */
  readonly size?: readonly [number, number];
  /** A motorcycle: its "handbrake" is the rear brake, held through any bend, so holding it never spins it round. */
  readonly twoWheels?: boolean;
}

export interface Assists {
  /** How much the car steers into its own slide (0 none, 1 a lot). */
  readonly countersteer: number;
  /** The largest slide angle (rad) before the car is held (no spin-outs). */
  readonly maxSlide: number;
  /** Largest yaw rate (rad/s). */
  readonly maxYaw: number;
  /**
   * Traction help (0-1): while the car grips, the throttle alone doesn't spin the rear (no accidental spins
   * off a keyboard's all-or-nothing throttle); once sideways, or just after the handbrake, full power is yours.
   */
  readonly traction: number;
}

/** An 80s/90s rear-drive coupe: light, lively, happy to go sideways. */
export const COUPE: CarSpec = {
  mass: 1150,
  a: 1.15,
  b: 1.3,
  cgHeight: 0.5,
  inertia: 1.0,
  power: 135000,
  maxDrive: 8200,
  brake: 1.0,
  brakeFront: 0.62,
  drag: 0.72,
  rolling: 160,
  // Planted unless provoked: the rear grips a little better (full throttle in a low gear or the handbrake
  // still breaks it loose).
  gripFront: 1.0,
  gripRear: 1.12,
  B: 9,
  C: 1.35,
  lock: 0.6,
  lockHalf: 26,
  steerRate: 3.2,
  handbrakeGrip: 0.42,
  reverse: 20,
  shift: [13, 22, 31, 41, 999],
};

/** Venues: assists that let you hold a drift. */
export const DRIFT_ASSISTS: Assists = { countersteer: 0.55, maxSlide: (48 * Math.PI) / 180, maxYaw: 3.2, traction: 1 };
/** The city: calmer. */
export const ROAD_ASSISTS: Assists = { countersteer: 0.8, maxSlide: (25 * Math.PI) / 180, maxYaw: 2.4, traction: 1 };

export interface Controls {
  /** 0-1 */
  throttle: number;
  /** 0-1: brakes, and reverses from a stop. */
  brake: number;
  /** -1 (right) to 1 (left). */
  steer: number;
  handbrake: boolean;
}

/** What the car stands on: height, surface normal and grip under a point; walls to keep it in. */
export interface Ground {
  height(x: number, z: number): number;
  /** Unit normal (x, y, z). */
  normal(x: number, z: number): [number, number, number];
  /** Surface grip factor (1 on tarmac). */
  grip(x: number, z: number): number;
  /**
   * The push (world x, z) that takes a car of half length hl and half width hw at (x, z) heading h back inside,
   * with the wall's normal (pointing inside); null when it's clear.
   */
  collide(x: number, z: number, h: number, hl: number, hw: number): { px: number; pz: number; nx: number; nz: number; friction?: number } | null;
}

export const FLAT: Ground = {
  height: () => 0,
  normal: () => [0, 1, 0],
  grip: () => 1,
  collide: () => null,
};

const G = 9.81;
export const STEP = 1 / 120;
/**
 * A burnout starts with both pedals held for `BURNOUT_HOLD` s under `BURNOUT_FROM` m/s (all but stopped), and holds
 * under `BURNOUT_SPEED`. Out of it the rears stay lit (a donut) while the throttle's down, the car's under
 * `LIT_SPEED` and the wheel's hard over (or was within `DONUT_GRACE` s: time to swap sides); `LIT_HOLD` s after, they bite.
 */
const BURNOUT_FROM = 2.5;
const BURNOUT_HOLD = 0.25;
const BURNOUT_SPEED = 6;
const LIT_SPEED = 16;
const LIT_HOLD = 0.35;
const DONUT_GRACE = 0.5;
/** What spinning rears push with (a share of their grip), and how hard they walk sideways in a burnout as you steer. */
const LIT_PUSH = 0.8;
const LIT_TURN = 0.3;
/** How hard a handbrake turn is brought to its half turn, for the angle left (1/s). */
const CATCH = 6;
/** The rears' sideways grip while lit up (a share). */
const LIT_SIDE = 0.15;
/** A J-turn: the tyres' sideways grip through it (a share), how hard it turns for the angle left (1/s) and how fast at most (rad/s). */
const J_GRIP = 0.5;
const J_GAIN = 4;
const J_RATE = 3.6;
const BURNOUT_WALK = 0.3;
/** The fastest the tail swings round in a burnout (rad/s). */
const BURNOUT_TURN = 1.3;
/** The handbrake held this long (s) with the wheel over is a handbrake turn (shorter: a drift's flick). */
const HANDBRAKE_HOLD = 0.3;
/** A stunt may turn the car this many times faster than the assists' yaw cap. */
const SPIN_YAW = 1.7;
/**
 * A handbrake turn: how fast the slide it's allowed opens while the handbrake's held and closes once it's let go
 * (rad/s), the slide past which the car is spinning freely (rad), and how quickly its turning dies when you let go (1/s).
 */
const SPIN_OPEN = 1.1;
const SPIN_CLOSE = 1.5;
const FREE_SLIDE = 1.35;
const RELEASE = 9;
/** A handbrake turn brought this far round (rad) goes on to a half turn; and the fastest one turns (rad/s). */
const FLIP_COMMIT = 2.1;
const SPIN_TOP = 3.3;
/** Backing up: the sideways pull (g) the steering's kept to, the engine's drag feet off (m/s^2), a J-turn's least speed (m/s). */
const REVERSE_PULL = 0.45;
const REVERSE_DRAG = 1.5;
/** (And more the faster it backs, per m/s: at a good pace the engine's braking is a lot, so feet off it still stops short.) */
const REVERSE_DRAG_SPEED = 0.4;
const J_SPEED = 5.5;

export class Car {
  x = 0;
  z = 0;
  y = 0;
  h = 0;
  u = 0;
  w = 0;
  r = 0;
  /** Road wheel angle (rad, positive left). */
  steer = 0;
  gear = 1;
  /** 0-1 across the gear's range, for the engine note. */
  rev = 0;
  /** Smoothed longitudinal and lateral acceleration (m/s^2), for load transfer and body pitch and roll. */
  ax = 0;
  ay = 0;
  /** Rear wheels spinning up (0-1), the handbrake on: for sound and smoke. */
  spin = 0;
  handbrake = false;
  /** Impact speed this step (m/s): a knock. */
  bump = 0;
  private acc = 0;
  /** The throttle as the engine sees it (a keyboard's 0/1 ramped), and time since the handbrake (s). */
  private throttle = 0;
  private sinceHandbrake = 99;
  /** Seconds the handbrake's been held, seconds since the car was last being reversed on purpose. */
  private handbrakeHeld = 0;
  private sinceReverse = 99;
  /** Seconds both pedals have been down together, and since the wheel was last hard over. */
  private bothHeld = 0;
  private sinceLock = 99;
  /** Seconds left of the rears being lit up on purpose (a burnout, a donut), and of a J-turn. */
  private lit = 0;
  private jturn = 0;
  /** The way a J-turn swings the nose (the yaw's sign). */
  private jdir = 0;
  /** The slide and spin limits are lifted (a stunt's under way) until the car's straight again. */
  private free = false;
  /** How far round the car may slide now (rad): the assists' cap, or more in a stunt. */
  private open = 0;
  /**
   * A handbrake turn's under way: the heading it began at and the way it turns, and once it's past a quarter turn
   * the heading it's being brought round to (a half turn on) and for how long it has been.
   */
  private flip = false;
  private pulledAt = 0;
  private flipFrom = 0;
  private flipWay = 0;
  private flipTo: number | null = null;
  private flipFor = 0;
  private flipped = false;
  /** Turbo boost 0-1 (for the sound and the dashboard). */
  boost = 0;
  /** Grip left at the front and rear axles (1 whole; a damaged or flat tyre less: district/crash.ts). */
  gripMul: [number, number] = [1, 1];

  constructor(
    /** (Replaceable while driving: the tuning panel re-specs the car, race/tuning.ts.) */
    public spec: CarSpec = COUPE,
    public assists: Assists = DRIFT_ASSISTS,
  ) {}

  /** Speed (m/s) and the slide angle (rad; positive: travelling left of where it points). */
  get speed(): number {
    return Math.hypot(this.u, this.w);
  }

  get slide(): number {
    return Math.abs(this.u) < 1 ? 0 : Math.atan2(this.w, Math.abs(this.u));
  }

  /** A stunt under way: the rears lit up on purpose (a burnout, a donut), or the car let spin (a handbrake turn, a J-turn). */
  get stunt(): 'burnout' | 'spin' | null {
    return this.lit > 0 ? 'burnout' : this.free ? 'spin' : null;
  }

  get fx(): number {
    return Math.sin(this.h);
  }

  get fz(): number {
    return Math.cos(this.h);
  }

  place(x: number, z: number, h: number, ground: Ground = FLAT): void {
    this.x = x;
    this.z = z;
    this.h = h;
    this.u = this.w = this.r = this.steer = 0;
    this.lit = this.jturn = this.bothHeld = 0;
    this.free = this.flip = false;
    this.flipTo = null;
    this.open = 0;
    this.y = ground.height(x, z);
  }

  /** Advance by dt seconds (in fixed steps; any remainder carries over). */
  update(dt: number, c: Controls, ground: Ground = FLAT): void {
    this.bump = 0;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP, c, ground);
    }
  }

  private step(dt: number, c: Controls, ground: Ground): void {
    const S = this.spec;
    const A = this.assists;
    const m = S.mass;
    const L = S.a + S.b;
    const I = m * S.a * S.b * S.inertia;
    const fx = Math.sin(this.h);
    const fz = Math.cos(this.h);
    const lx = Math.cos(this.h);
    const lz = -Math.sin(this.h);
    let { u, w, r } = this;
    // The throttle builds over a third of a second (and comes off quicker).
    const thr = c.throttle > this.throttle ? Math.min(c.throttle, this.throttle + dt * 3) : Math.max(c.throttle, this.throttle - dt * 6);
    this.throttle = thr;
    this.sinceHandbrake = c.handbrake ? 0 : this.sinceHandbrake + dt;
    // (Where it pointed when the handbrake went on: a half turn is from there.)
    if (c.handbrake && this.handbrakeHeld === 0) this.pulledAt = this.h;
    this.handbrakeHeld = c.handbrake ? this.handbrakeHeld + dt : 0;
    const reversing = u < 0.5 && c.brake > 0 && c.throttle === 0;
    // (Going backwards at speed with the pedals off, after a half turn on the handbrake, is backing up too.)
    const backing = reversing || (u < -J_SPEED && c.throttle === 0 && !c.handbrake);
    this.sinceReverse = backing ? 0 : this.sinceReverse + dt;
    // Stunts (see the header). The rears lit up: throttle against the brake at a standstill, or against the
    // handbrake at low speed; they stay lit while the throttle's down and the car's slow.
    const speed = Math.hypot(u, w);
    // On purpose only: both pedals held a moment with the car all but stopped (not the brake coming off as the
    // throttle goes on, pulling away from a junction), and a donut only for as long as the wheel's kept hard over
    // (lit up, the rears have next to no sideways grip: left on, the next corner taken on the throttle was a spin).
    this.bothHeld = c.throttle > 0.5 && c.brake > 0.5 ? this.bothHeld + dt : 0;
    this.sinceLock = Math.abs(c.steer) > 0.5 ? 0 : this.sinceLock + dt;
    const burnout = c.throttle > 0.5 && c.brake > 0.5 && u > -1 && (this.lit > 0 ? speed < BURNOUT_SPEED : speed < BURNOUT_FROM && this.bothHeld > BURNOUT_HOLD);
    if (burnout) this.lit = LIT_HOLD;
    else if (this.lit > 0 && c.throttle > 0.5 && c.brake === 0 && speed < LIT_SPEED && this.sinceLock < DONUT_GRACE) this.lit = LIT_HOLD;
    else this.lit = Math.max(0, this.lit - dt);
    const lit = this.lit > 0;
    // A J-turn: backing at speed (on purpose, a moment ago), the wheel over and the throttle down, or the handbrake
    // (a half turn either way, so the 180 out of a reverse is the same move as the 180 into one).
    const jask = c.throttle > 0.5 || c.handbrake;
    if (u < -J_SPEED && jask && Math.abs(c.steer) > 0.5 && this.sinceReverse < 2.5 && !S.twoWheels) {
      if (this.jturn <= 0) this.jdir = -Math.sign(c.steer);
      this.jturn = 1.6;
    } else this.jturn = jask ? Math.max(0, this.jturn - dt) : 0;
    const jturn = this.jturn > 0;
    // A handbrake turn: held, with the wheel over.
    // (One turn a pull: once it's been brought right round, the handbrake has to come off before another.)
    if (!c.handbrake) this.flipped = false;
    const spun = !S.twoWheels && !jturn && !this.flipped && this.handbrakeHeld > HANDBRAKE_HOLD && Math.abs(c.steer) > 0.3 && speed < 34;
    if (spun && !this.flip) {
      this.flip = true;
      this.flipFrom = this.pulledAt;
      this.flipWay = Math.sign(c.steer);
    }
    // Brought past a quarter turn and a bit, it goes on right round: a 180 from the way it was pointing.
    if (this.flip && this.flipTo === null && this.free && (this.h - this.flipFrom) * this.flipWay > FLIP_COMMIT) {
      this.flipTo = this.flipFrom + this.flipWay * Math.PI;
      this.flipFor = 0;
    }
    if (lit || jturn) this.flipTo = null;
    // How far round the car may slide (`open`): the assists' cap; in a burnout, a donut or a J-turn, all the way;
    // in a handbrake turn, further the longer the handbrake's held (`SPIN_OPEN` a second), so a short pull is a
    // quarter turn and only a long one goes right round. Let go, it closes again from the slide the car's in
    // (`SPIN_CLOSE` a second): the car grips up the way it points.
    const sliding = speed > 2.5 ? Math.abs(Math.atan2(w, Math.abs(u))) : 0;
    if (lit || jturn || this.flipTo !== null) this.open = Math.PI;
    else if (spun) this.open = Math.min(Math.PI, Math.max(this.open, A.maxSlide) + SPIN_OPEN * dt);
    // (Still spinning at a crawl: it's let finish.)
    else if (speed > 2.5 || (Math.abs(r) < 0.6 && Math.abs(w) < 0.6)) this.open = Math.max(A.maxSlide, Math.min(this.open, sliding + 0.05) - SPIN_CLOSE * dt);
    this.free = this.open > A.maxSlide + 1e-3;
    const released = this.free && !spun && !lit && !jturn && this.flipTo === null;
    // Gravity along the ground's slope, in the car's frame.
    const [nx, ny, nz] = ground.normal(this.x, this.z);
    const gx = G * nx * ny;
    const gz = G * nz * ny;
    const gu = gx * fx + gz * fz;
    const gw = gx * lx + gz * lz;
    const surf = ground.grip(this.x, this.z);
    // Steering: less lock with speed; into the slide automatically while sliding.
    const slide = Math.abs(u) > 4 ? Math.atan2(w, Math.abs(u)) : 0;
    // Speed-sensitive lock (keyboard steering is all or nothing): no more than the front tyres can take at
    // this speed (a turn pulling a little over their grip), but more once sliding, to countersteer.
    // The extra is only toward the way the car is travelling (countersteer), never further into the slide.
    const gripLock = Math.atan((L * S.gripFront * G * 1.2) / Math.max(u * u, 1));
    // A handbrake turn: more lock while it's pulled.
    let base = Math.min(S.lock / (1 + (Math.abs(u) / S.lockHalf) ** 2), c.handbrake ? Math.max(gripLock, 0.32) : gripLock);
    // Backing up, the steered wheels trail: only the lock they can take without whipping the nose round.
    if (u < -0.5 && !this.free) base = Math.min(base, Math.atan((L * G * REVERSE_PULL) / (u * u)));
    // A stunt has all the lock there is.
    if (lit || jturn) base = S.lock;
    const counter = Math.max(base, Math.min(S.lock, Math.abs(slide) + 0.12));
    const hiLeft = slide > 0 ? counter : base;
    const hiRight = slide < 0 ? counter : base;
    // (Holding the wheel into a spin you asked for, the car doesn't steer out of it for you.)
    const into = c.steer !== 0 && Math.sign(c.steer) === -Math.sign(slide);
    const help = into && spun ? 0 : into && lit ? 0.25 : 1;
    const assist = Math.abs(slide) > 0.06 ? A.countersteer * slide * help : 0;
    const target = Math.max(-S.lock, Math.min(S.lock, c.steer * (c.steer > 0 ? hiLeft : hiRight) + (u >= 0 ? assist : 0)));
    const rate = S.steerRate * (c.steer === 0 ? 1.4 : 1);
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    const d = this.steer;
    // Loads, front and rear, shifting with acceleration.
    const shift = (m * this.ax * S.cgHeight) / L;
    const Nf = Math.max(0.15 * m * G, (m * G * S.b) / L - shift);
    const Nr = Math.max(0.15 * m * G, (m * G * S.a) / L + shift);
    // Drive (rear), brakes, the handbrake, reversing from a stop.
    let drive = 0;
    let brakeF = 0;
    let brakeR = 0;
    if (burnout) {
      // (The fronts hold it, below; the rears are the engine's.)
    } else if (reversing && u > -S.reverse) {
      // (Strong off the line, power-limited after, easing off over the last 2 m/s to the top reverse speed.)
      drive = -c.brake * Math.min(S.maxDrive * 0.75, (S.power * 0.8) / Math.max(-u, 4)) * Math.min(1, (u + S.reverse) / 2);
    }
    else if (c.brake > 0 && u > 0.5) {
      const B = c.brake * S.brake * m * G;
      brakeF = B * S.brakeFront;
      brakeR = B * (1 - S.brakeFront);
    } else if (c.throttle > 0 && u < -0.5 && !jturn && !lit) {
      brakeF = c.throttle * S.brake * m * G * S.brakeFront;
      brakeR = c.throttle * S.brake * m * G * (1 - S.brakeFront);
    }
    // Turbo: boost builds under throttle once the revs are up, and bleeds off when you lift.
    if (S.turbo) {
      const want = thr > 0.5 && this.rev > 0.35 ? 1 : 0;
      this.boost += (want - this.boost) * Math.min(1, dt / (want ? S.turbo : 0.25));
    } else this.boost = 1;
    const power = S.power * (S.turbo ? 0.55 + 0.45 * this.boost : 1);
    // (Lit up, the rears are driven whichever way the car's sliding; in a J-turn, as the nose comes round.)
    if (thr > 0 && (u >= -0.5 || lit || (jturn && u > -J_SPEED))) drive = thr * Math.min(S.maxDrive, power / Math.max(u, 4));
    // All-wheel drive: the front takes its share (pulling the car through, at the cost of front grip).
    const driveF = drive > 0 && S.awd && !burnout ? drive * S.awd : 0;
    drive -= driveF;
    // (Not in a J-turn on the handbrake: that's a pivot that keeps its speed, not a stop.)
    if (c.handbrake && !jturn) brakeR += 0.55 * Nr;
    const sgn = u >= 0 ? 1 : -1;
    // Rear: drive or braking shares the tyre's grip with cornering (a friction ellipse: pulling costs less
    // cornering than sliding does), and past the traction limit the wheels spin and the rear lets go.
    const Dr = S.gripRear * this.gripMul[1] * Nr * surf * (c.handbrake && !jturn ? S.handbrakeGrip : 1);
    const cap = Dr * 1.1;
    let Fxr = drive - brakeR * sgn;
    const sideways = Math.abs(u) > 3 && Math.abs(Math.atan2(w, Math.abs(u))) > 0.14;
    if (A.traction > 0 && drive > 0 && !sideways && this.sinceHandbrake > 0.8 && !lit) Fxr = Math.min(Fxr, cap * (1 - 0.12 * A.traction));
    // (Lit up on purpose, they spin whatever the engine: the clutch dumped.)
    const alight = lit && drive > 0;
    const spinning = Math.abs(Fxr) > cap || alight;
    this.spin = alight ? 1 : Math.max(0, Math.min(1, (Math.abs(Fxr) - cap) / (0.3 * cap + 1)));
    Fxr = Math.max(-cap, Math.min(cap, Fxr));
    // (A spinning tyre pushes less than one that bites, and with the wheel over less again: the car goes round, not off.)
    if (alight) Fxr = Math.min(Fxr, cap * (LIT_PUSH - LIT_TURN * Math.abs(c.steer)));
    const Df = S.gripFront * this.gripMul[0] * Nf * surf;
    // A burnout: the front brakes hold the car against the rears (it creeps forward).
    const hold = burnout ? Math.max(0, 0.97 * Fxr + 3 * m * u) : 0;
    const Fxf = Math.max(-Df * 1.1, Math.min(Df * 1.1, driveF - brakeF * sgn));
    const ellipse = (F: number, D: number): number => D * Math.sqrt(Math.max(0, 1 - (F / (D * 1.35)) ** 2));
    // (Lit up, the rears have little sideways grip left: the tail goes round. In a J-turn the tyres let the car
    // carry on the way it was going while it comes round.)
    const latR = ellipse(Fxr, Dr) * (alight ? LIT_SIDE : spinning ? 0.5 + 0.25 * (S.lsd ?? 0) : 1) * (jturn ? J_GRIP : 1);
    const latF = ellipse(Fxf, Df) * (jturn ? J_GRIP : 1);
    const curve = (alpha: number): number => Math.sin(S.C * Math.atan(S.B * alpha));
    let Fyf = 0;
    let Fyr = 0;
    const au = Math.max(Math.abs(u), 1.5);
    if (Math.abs(u) > 0.5 || Math.abs(w) > 0.5 || this.free) {
      const af = d * sgn - Math.atan2(w + S.a * r, au);
      const ar = -Math.atan2(w - S.b * r, au);
      Fyf = latF * curve(af);
      Fyr = latR * curve(ar);
    }
    // In a burnout the fronts are locked (they hold the nose where it is, whichever way they're turned), and the
    // spinning rears walk sideways as you steer: the tail swings round the nose, at a walk.
    if (burnout) {
      Fyf = -Df * Math.tanh((w + S.a * r) / 0.4);
      Fyr -= c.steer * BURNOUT_WALK * Dr * Math.max(0, 1 - Math.abs(r) / BURNOUT_TURN);
    }
    // (Backing up with your feet off, the engine slows the car: a tap of reverse is a short move.)
    const coasting = u < -0.5 && thr === 0 && c.brake === 0 && !this.free ? -(REVERSE_DRAG + REVERSE_DRAG_SPEED * -u) * m : 0;
    const resist = S.drag * u * Math.abs(u) + (Math.abs(u) > 0.05 ? S.rolling * sgn : 0) + coasting;
    const cd = burnout ? 1 : Math.cos(d);
    const sd = burnout ? 0 : Math.sin(d);
    let du = (Fxr + Fxf * cd - Fyf * sd - resist - hold) / m + w * r + gu;
    let dw = (Fyf * cd + Fxf * sd + Fyr) / m - u * r + gw;
    let dr = (S.a * (Fyf * cd + Fxf * sd) - S.b * Fyr) / I;
    // Standing still on the flat: no creeping. (Not mid-spin, side on to the way it's going.)
    if (Math.abs(u) < 0.05 && thr === 0 && !reversing && Math.abs(gu) < 0.3 && !(this.free && (Math.abs(w) > 0.3 || Math.abs(r) > 0.2))) {
      du = -u / dt;
      dw = -w / dt;
      dr = -r / dt;
    }
    u += du * dt;
    w += dw * dt;
    r += dr * dt;
    // Walking pace: the kinematic car (rolling wheels, no slip), blended in below 4 m/s (backing up, below 6: it
    // goes where it's pointed). Not in a stunt: that's all slip.
    const k = u < 0 ? Math.max(0, Math.min(1, (-u - 2) / 4)) : Math.max(0, Math.min(1, (u - 1) / 3));
    if (k < 1 && !this.free) {
      r = k * r + (1 - k) * ((u * Math.tan(d)) / L);
      w *= k + (1 - k) * 0.5;
    }
    // Assists: the slide is held short of a spin; the yaw rate is capped. (A stunt has neither, but turns no faster
    // than `SPIN_YAW` times the cap; a handbrake turn no faster than `SPIN_TOP`.)
    const most = this.free ? this.open : A.maxSlide;
    if (Math.abs(u) > 3 && most < FREE_SLIDE) {
      const lim = Math.abs(u) * Math.tan(most);
      if (Math.abs(w) > lim) {
        w = Math.sign(w) * lim;
        // Held at the limit: the rotation eases (it doesn't keep winding up).
        if (Math.sign(r) === -Math.sign(w)) r *= 0.96;
      }
    }
    // A handbrake turn taken right round is brought to rest facing back the way it came (however long the
    // handbrake's held, however little speed is left).
    if (this.flipTo !== null) {
      const left = this.flipTo - this.h;
      r += (Math.max(-SPIN_TOP, Math.min(SPIN_TOP, CATCH * left)) - r) * Math.min(1, dt * 8);
      this.flipFor += dt;
      if ((Math.abs(left) < 0.05 && Math.abs(r) < 0.5) || this.flipFor > 1.8) {
        this.flipTo = null;
        this.flip = false;
        this.flipped = true;
      }
    }
    // Let go part way round, it stops turning: the turn ends about where you let go.
    else if (released) r *= Math.exp(-RELEASE * dt);
    if (!this.free) this.flip = false;
    // A J-turn swings the nose round to the way the car's going (the way the wheel was turned), and is done
    // once it's there.
    if (jturn && Math.hypot(u, w) > 1.5) {
      let off = Math.atan2(w, u);
      if (Math.abs(off) > 2.4) off = this.jdir * Math.abs(off);
      r += (Math.max(-J_RATE, Math.min(J_RATE, J_GAIN * off)) - r) * Math.min(1, dt * 8);
      if (Math.abs(off) < 0.12 && u > 1) this.jturn = 0;
    }
    // (A handbrake turn no faster than `SPIN_TOP`, whatever the assists: it's the same turn on a pass as in town.)
    const maxYaw = !this.free ? A.maxYaw : lit || jturn ? A.maxYaw * SPIN_YAW : Math.max(A.maxYaw, SPIN_TOP);
    r = Math.max(-maxYaw, Math.min(maxYaw, r));
    this.ax += ((du - w * r) - this.ax) * Math.min(1, dt * 8);
    this.ay += ((dw + u * r) - this.ay) * Math.min(1, dt * 8);
    // Move.
    this.h += r * dt;
    const nfx = Math.sin(this.h);
    const nfz = Math.cos(this.h);
    const nlx = Math.cos(this.h);
    const nlz = -Math.sin(this.h);
    this.x += (nfx * u + nlx * w) * dt;
    this.z += (nfz * u + nlz * w) * dt;
    // Walls: pushed back inside, the velocity into the wall taken off (a little bounce), the spin damped.
    const hit = ground.collide(this.x, this.z, this.h, S.size?.[0] ?? 2.15, S.size?.[1] ?? 0.85);
    if (hit) {
      this.x += hit.px;
      this.z += hit.pz;
      let vx = nfx * u + nlx * w;
      let vz = nfz * u + nlz * w;
      const vn = vx * hit.nx + vz * hit.nz;
      if (vn < 0) {
        this.bump = Math.max(this.bump, -vn);
        vx -= 1.25 * vn * hit.nx;
        vz -= 1.25 * vn * hit.nz;
        // Scraping along it slows you (by default hard: the passes' guardrails; the city lets you slide on).
        const f = hit.friction ?? 0.97;
        vx *= f;
        vz *= f;
        r *= 0.6;
      }
      u = vx * nfx + vz * nfz;
      w = vx * nlx + vz * nlz;
    }
    this.u = u;
    this.w = w;
    this.r = r;
    this.y = ground.height(this.x, this.z);
    this.handbrake = c.handbrake;
    // Automatic gears.
    const sp = Math.abs(u);
    let g = 1;
    while (g < S.shift.length && sp > S.shift[g - 1]) g++;
    this.gear = u < -0.5 ? 0 : g;
    const lo = g > 1 ? S.shift[g - 2] : 0;
    const hi = S.shift[g - 1] < 900 ? S.shift[g - 1] : lo + 14;
    this.rev = Math.max(0, Math.min(1, (sp - lo * 0.72) / (hi - lo * 0.72)));
  }
}
