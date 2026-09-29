import * as THREE from 'three';
import type { DrivenVehicle } from '../real/traffic';
import type { OwnCar } from './ownCar';

/**
 * Driving a vehicle you've taken the wheel of (E by a car stopped in traffic). A kinematic bicycle model: the
 * rear wheels don't slide, the front ones steer, so the car turns about a point on the rear axle's line (no
 * drifting), the steering winds in at a finite rate and has less lock at speed. W accelerates, S brakes and
 * then reverses, A/D steer, Space is the handbrake, Q switches between the chase camera and a bumper camera,
 * the mouse looks round (the view swings back to straight ahead). You get out by the driver's door, on the
 * right (Japan drives on the left).
 * Collisions stop the car (with a knock back); the traffic system keeps drawing it and stops for it.
 * Your own car (ownCar.ts) drives on the racing model instead: grip, slides, its tuning; the same keys.
 */

/** Per kind: top speed and reverse (m/s), acceleration and braking (m/s^2), wheelbase (m), full lock (rad). */
const SPECS = {
  car: { vmax: 24, vrev: 5, accel: 3.4, brake: 7.5, wheelbase: 2.65, lock: 0.6 },
  bus: { vmax: 15, vrev: 3.5, accel: 1.5, brake: 5, wheelbase: 5.6, lock: 0.62 },
} as const;
/** Steering speed (rad/s) toward the wheel's target, and back to centre when let go. */
const STEER_RATE = 1.9;
const CENTRE_RATE = 3.2;

export type Collide = (x: number, z: number, r: number) => boolean;

export class Driving {
  car: DrivenVehicle | null = null;
  /** Your own car, when it's the one you're driving (the racing model). */
  own: OwnCar | null = null;
  /** 'chase' behind the car, or 'bumper': low at the front looking out, the body hidden (no interior yet). */
  view: 'chase' | 'bumper' = 'chase';
  /** A knock this frame (speed of the impact, m/s), for a sound and a shake; 0 if none. */
  bump = 0;
  /** Keys held (from the keyboard; tests press them directly). */
  readonly keys = new Set<string>();
  private yaw = 0;
  private steer = 0;
  private orbitYaw = 0;
  /** How far the view looks up (rad; negative looks down). The chase camera drops lower to look up. */
  private lookPitch = 0;
  /** Invert the mouse's up and down (the walker's controls have the same setting). */
  invertY = false;
  private mouseIdle = 0;
  private readonly camPos = new THREE.Vector3();
  private shake = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly collide: Collide,
  ) {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (!this.car) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyQ') this.view = this.view === 'chase' ? 'bumper' : 'chase';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.car || !document.pointerLockElement) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.orbitYaw -= e.movementX * 0.003;
      const my = this.invertY ? -e.movementY : e.movementY;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - my * 0.003, -0.6, 0.5);
      this.mouseIdle = 0;
    });
  }

  private get spec(): (typeof SPECS)['car' | 'bus'] {
    return this.car?.bus ? SPECS.bus : SPECS.car;
  }

  /** Take the wheel of `car` (already handed over by the traffic system). */
  enter(car: DrivenVehicle, own: OwnCar | null = null): void {
    this.car = car;
    this.own = own;
    if (own) {
      own.sound.start();
      own.sound.setVolume(1);
    }
    this.yaw = Math.atan2(car.dx, car.dz);
    this.steer = 0;
    this.orbitYaw = 0;
    this.lookPitch = 0;
    this.keys.clear();
    this.camPos.copy(this.chaseTarget());
  }

  /**
   * Where to step out: by the driver's door (the right side), else the left, else behind. `free` tests a
   * walker's spot. Returns the spot and the heading to face, or null if boxed in (you stay at the wheel).
   */
  exitSpot(free: (x: number, z: number) => boolean): { x: number; z: number; yawDeg: number } | null {
    const c = this.car;
    if (!c) return null;
    const rx = -c.dz;
    const rz = c.dx;
    const out = c.width / 2 + 0.75;
    const fwd = c.bus ? c.half - 1.2 : 0.3;
    for (const [x, z] of [
      [c.x + rx * out + c.dx * fwd, c.z + rz * out + c.dz * fwd],
      [c.x - rx * out + c.dx * fwd, c.z - rz * out + c.dz * fwd],
      [c.x - c.dx * (c.half + 1), c.z - c.dz * (c.half + 1)],
      [c.x + c.dx * (c.half + 1), c.z + c.dz * (c.half + 1)],
    ] as const) {
      if (free(x, z)) return { x, z, yawDeg: (Math.atan2(-c.dx, -c.dz) * 180) / Math.PI };
    }
    return null;
  }

  leave(): void {
    if (this.car) this.car.hideBody = false;
    this.own?.park();
    this.own = null;
    this.car = null;
    this.keys.clear();
  }

  /** Whether the car's footprint at (x, z) facing (dx, dz) is clear: circles along its length. */
  private clear(x: number, z: number, dx: number, dz: number): boolean {
    const c = this.car!;
    const r = c.width / 2 + 0.05;
    const reach = c.half - r;
    const n = Math.max(2, Math.ceil((2 * reach) / r));
    for (let i = 0; i <= n; i++) {
      const f = -reach + (2 * reach * i) / n;
      if (this.collide(x + dx * f, z + dz * f, r)) return false;
    }
    return true;
  }

  update(dt: number): void {
    const c = this.car;
    this.bump = 0;
    if (!c || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const S = this.spec;
    const k = this.keys;
    const gas = k.has('KeyW') || k.has('ArrowUp');
    const brake = k.has('KeyS') || k.has('ArrowDown');
    const hand = k.has('Space');
    const turn = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    if (this.own) {
      // Your car: the racing model does it all (it collides, slides and knocks by itself).
      this.own.drive(dt, { throttle: gas ? 1 : 0, brake: brake ? 1 : 0, steer: -turn, handbrake: hand });
      const knock = this.own.sim.bump;
      if (knock > 1.5) {
        this.bump = knock;
        this.shake = Math.min(1, knock / 8);
      }
      this.placeCamera(dt);
      return;
    }
    let v = c.v;
    // Longitudinal: drive, brake, reverse, roll to a stop.
    let a: number;
    if (hand) a = -Math.sign(v) * 9;
    else if (gas && v >= -0.3) a = S.accel * (1 - (v / S.vmax) ** 2);
    else if (gas) a = S.brake;
    else if (brake && v > 0.3) a = -S.brake;
    else if (brake) a = -S.accel * 0.7 * (1 - (v / -S.vrev) ** 2);
    else a = -Math.sign(v) * (0.45 + 0.012 * v * v);
    const nv = v + a * dt;
    // Braking (or rolling, or the handbrake) stops at zero rather than carrying on the other way.
    const stopping = hand || (!gas && !brake) || (brake && v > 0.3) || (gas && v < -0.3);
    v = stopping && v !== 0 && Math.sign(nv) !== Math.sign(v) ? 0 : nv;
    v = THREE.MathUtils.clamp(v, -S.vrev, S.vmax);
    if (Math.abs(v) < 0.05 && !gas && !brake) v = 0;
    // Steering: less lock at speed; the wheel turns at a finite rate.
    const lock = S.lock / (1 + (Math.abs(v) / 9) ** 2);
    const target = turn * lock;
    const rate = turn === 0 ? CENTRE_RATE : STEER_RATE;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate * dt, rate * dt);
    // The bicycle model, about the rear axle: it moves along the heading, the heading turns by v * tan(steer) / L.
    const curv = Math.tan(this.steer) / S.wheelbase;
    const yaw = this.yaw - v * curv * dt;
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const rearX = c.x - c.dx * c.axle + dx * v * dt;
    const rearZ = c.z - c.dz * c.axle + dz * v * dt;
    const x = rearX + dx * c.axle;
    const z = rearZ + dz * c.axle;
    if (this.clear(x, z, dx, dz)) {
      this.yaw = yaw;
      c.x = x;
      c.z = z;
      c.dx = dx;
      c.dz = dz;
    } else {
      // A knock: stop, bounce back a little.
      this.bump = Math.abs(v);
      this.shake = Math.min(1, Math.abs(v) / 8);
      v = Math.abs(v) > 1.5 ? -v * 0.15 : 0;
    }
    c.acc = (v - c.v) / dt;
    c.v = v;
    c.curv = v >= 0 ? curv : -curv;
    this.placeCamera(dt);
  }

  private chaseTarget(): THREE.Vector3 {
    const c = this.car!;
    const back = c.bus ? 12 : 6.4;
    const up = c.bus ? 4.4 : 2.5;
    const a = Math.atan2(c.dx, c.dz) + this.orbitYaw;
    // Looking up swings the camera down behind the car (and looking down lifts it), about the car.
    const elev = -this.lookPitch;
    return new THREE.Vector3(c.x - Math.sin(a) * back * Math.cos(elev), this.floor + up + Math.sin(elev) * back, c.z - Math.cos(a) * back * Math.cos(elev));
  }

  private placeCamera(dt: number): void {
    const c = this.car!;
    this.mouseIdle += dt;
    // Let go of the mouse and the view swings back to straight ahead.
    if (this.mouseIdle > 1.2) {
      const ease = 1 - Math.exp(-dt * 2.5);
      this.orbitYaw -= this.orbitYaw * ease;
      if (this.view === 'chase') this.lookPitch -= this.lookPitch * ease;
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    const jolt = (): number => (Math.random() - 0.5) * this.shake * 0.25;
    const cam = this.camera;
    c.hideBody = this.view === 'bumper';
    if (this.view === 'bumper') {
      // Low at the front of the car, looking out along the road.
      const h = (c.bus ? 1.9 : 0.95) + this.floor;
      cam.position.set(c.x + c.dx * (c.half - 0.2) + jolt(), h + jolt(), c.z + c.dz * (c.half - 0.2));
      const a = Math.atan2(c.dx, c.dz) + this.orbitYaw;
      cam.lookAt(cam.position.x + Math.sin(a), h + Math.tan(this.lookPitch - 0.02), cam.position.z + Math.cos(a));
      this.camPos.copy(this.chaseTarget());
      return;
    }
    // Chase: follow a point behind (eased, so turns and stops show), pulled in if a wall is in the way.
    const want = this.chaseTarget();
    this.camPos.lerp(want, 1 - Math.exp(-dt * 5));
    const pivot = new THREE.Vector3(c.x, (c.bus ? 2.6 : 1.3) + this.floor, c.z);
    let t = 1;
    while (t > 0.25 && this.collide(pivot.x + (this.camPos.x - pivot.x) * t, pivot.z + (this.camPos.z - pivot.z) * t, 0.3)) t -= 0.08;
    cam.position.set(pivot.x + (this.camPos.x - pivot.x) * t + jolt(), pivot.y + (this.camPos.y - pivot.y) * t + jolt(), pivot.z + (this.camPos.z - pivot.z) * t);
    cam.lookAt(c.x + c.dx * 3, (c.bus ? 2.2 : 1.1) + this.floor, c.z + c.dz * 3);
  }

  /** km/h, for the dashboard. */
  get kmh(): number {
    return Math.abs(this.car?.v ?? 0) * 3.6;
  }

  /** The ground under the car (the expressway's deck is above the street). */
  private get floor(): number {
    return this.own?.sim.y ?? 0;
  }

  get gear(): string {
    if (this.own) return this.own.sim.gear === 0 ? 'R' : String(this.own.sim.gear);
    const v = this.car?.v ?? 0;
    return v < -0.1 ? 'R' : v > 0.1 ? 'D' : 'N';
  }
}
