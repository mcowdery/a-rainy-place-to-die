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
  reverse: 8,
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
    const base = Math.min(S.lock / (1 + (Math.abs(u) / S.lockHalf) ** 2), c.handbrake ? Math.max(gripLock, 0.32) : gripLock);
    const counter = Math.max(base, Math.min(S.lock, Math.abs(slide) + 0.12));
    const hiLeft = slide > 0 ? counter : base;
    const hiRight = slide < 0 ? counter : base;
    const assist = Math.abs(slide) > 0.06 ? A.countersteer * slide : 0;
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
    const reversing = u < 0.5 && c.brake > 0 && c.throttle === 0;
    if (reversing && u > -S.reverse) drive = -c.brake * 3200;
    else if (c.brake > 0 && u > 0.5) {
      const B = c.brake * S.brake * m * G;
      brakeF = B * S.brakeFront;
      brakeR = B * (1 - S.brakeFront);
    } else if (c.throttle > 0 && u < -0.5) {
      brakeF = c.throttle * S.brake * m * G * S.brakeFront;
      brakeR = c.throttle * S.brake * m * G * (1 - S.brakeFront);
    }
    // Turbo: boost builds under throttle once the revs are up, and bleeds off when you lift.
    if (S.turbo) {
      const want = thr > 0.5 && this.rev > 0.35 ? 1 : 0;
      this.boost += (want - this.boost) * Math.min(1, dt / (want ? S.turbo : 0.25));
    } else this.boost = 1;
    const power = S.power * (S.turbo ? 0.55 + 0.45 * this.boost : 1);
    if (thr > 0 && u >= -0.5) drive = thr * Math.min(S.maxDrive, power / Math.max(u, 4));
    // All-wheel drive: the front takes its share (pulling the car through, at the cost of front grip).
    const driveF = drive > 0 && S.awd ? drive * S.awd : 0;
    drive -= driveF;
    if (c.handbrake) brakeR += 0.55 * Nr;
    const sgn = u >= 0 ? 1 : -1;
    // Rear: drive or braking shares the tyre's grip with cornering (a friction ellipse: pulling costs less
    // cornering than sliding does), and past the traction limit the wheels spin and the rear lets go.
    const Dr = S.gripRear * this.gripMul[1] * Nr * surf * (c.handbrake ? S.handbrakeGrip : 1);
    const cap = Dr * 1.1;
    let Fxr = drive - brakeR * sgn;
    const sideways = Math.abs(u) > 3 && Math.abs(Math.atan2(w, Math.abs(u))) > 0.14;
    if (A.traction > 0 && drive > 0 && !sideways && this.sinceHandbrake > 0.8) Fxr = Math.min(Fxr, cap * (1 - 0.12 * A.traction));
    const spinning = Math.abs(Fxr) > cap;
    this.spin = Math.max(0, Math.min(1, (Math.abs(Fxr) - cap) / (0.3 * cap + 1)));
    Fxr = Math.max(-cap, Math.min(cap, Fxr));
    const Df = S.gripFront * this.gripMul[0] * Nf * surf;
    const Fxf = Math.max(-Df * 1.1, Math.min(Df * 1.1, driveF - brakeF * sgn));
    const ellipse = (F: number, D: number): number => D * Math.sqrt(Math.max(0, 1 - (F / (D * 1.35)) ** 2));
    const latR = ellipse(Fxr, Dr) * (spinning ? 0.5 + 0.25 * (S.lsd ?? 0) : 1);
    const latF = ellipse(Fxf, Df);
    const curve = (alpha: number): number => Math.sin(S.C * Math.atan(S.B * alpha));
    let Fyf = 0;
    let Fyr = 0;
    const au = Math.max(Math.abs(u), 1.5);
    if (Math.abs(u) > 0.5 || Math.abs(w) > 0.5) {
      const af = d * sgn - Math.atan2(w + S.a * r, au);
      const ar = -Math.atan2(w - S.b * r, au);
      Fyf = latF * curve(af);
      Fyr = latR * curve(ar);
    }
    const resist = S.drag * u * Math.abs(u) + (Math.abs(u) > 0.05 ? S.rolling * sgn : 0);
    const cd = Math.cos(d);
    const sd = Math.sin(d);
    let du = (Fxr + Fxf * cd - Fyf * sd - resist) / m + w * r + gu;
    let dw = (Fyf * cd + Fxf * sd + Fyr) / m - u * r + gw;
    let dr = (S.a * (Fyf * cd + Fxf * sd) - S.b * Fyr) / I;
    // Standing still on the flat: no creeping.
    if (Math.abs(u) < 0.05 && thr === 0 && !reversing && Math.abs(gu) < 0.3) {
      du = -u / dt;
      dw = -w / dt;
      dr = -r / dt;
    }
    u += du * dt;
    w += dw * dt;
    r += dr * dt;
    // Walking pace: the kinematic car (rolling wheels, no slip), blended in below 4 m/s.
    const k = Math.max(0, Math.min(1, (Math.abs(u) - 1) / 3));
    if (k < 1) {
      r = k * r + (1 - k) * ((u * Math.tan(d)) / L);
      w *= k + (1 - k) * 0.5;
    }
    // Assists: the slide is held short of a spin; the yaw rate is capped.
    if (Math.abs(u) > 3) {
      const lim = Math.abs(u) * Math.tan(A.maxSlide);
      if (Math.abs(w) > lim) {
        w = Math.sign(w) * lim;
        // Held at the limit: the rotation eases (it doesn't keep winding up).
        if (Math.sign(r) === -Math.sign(w)) r *= 0.96;
      }
    }
    r = Math.max(-A.maxYaw, Math.min(A.maxYaw, r));
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
    const hit = ground.collide(this.x, this.z, this.h, 2.15, 0.85);
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
