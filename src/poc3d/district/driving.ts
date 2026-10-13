import * as THREE from 'three';
import { CITY_VIEWS, DRIVE_VIEWS, Head, loadView, lookInto, nextView, outside, placeInCar, saveView, turnedEye, within, type DriveViewId } from '../../race/driveCam';
import type { Controls } from '../../race/vehicle';
import type { CarInterior } from '../models/carInterior';
import type { DrivenVehicle } from '../real/traffic';
import type { OwnCar } from './ownCar';

const _orbit = new THREE.Vector3();
const _vel = new THREE.Vector3();
/** How long the chase camera trails the car's motion (s). */
const TRAIL = 0.2;

/**
 * Driving a vehicle you've taken the wheel of (E by a car stopped in traffic). A kinematic bicycle model: the
 * rear wheels don't slide, the front ones steer, so the car turns about a point on the rear axle's line (no
 * drifting), the steering winds in at a finite rate and has less lock at speed. W accelerates, S brakes and
 * then reverses, A/D steer, Space is the handbrake, Q cycles the cameras (race/driveCam.ts: chase, far chase, the
 * cockpit (the car's cabin, `interior`, models/carInterior.ts), the bonnet, the bumper; remembered), Z looks back,
 * the mouse looks round (the view swings back to straight ahead). The page places the camera (`placeCamera`) once
 * the car's been posed for the frame. You get out by the driver's door, on the
 * right (Japan drives on the left). Aiming a gun from your car's seat (`startAim`, district/carGun.ts: the right
 * button) the view is the driver's eyes along the aim, which holds its place in the world while the car turns.
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

/** The keys that drive: any of them takes the wheel back from auto drive. */
const DRIVE_KEYS: ReadonlySet<string> = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export type Collide = (x: number, z: number, r: number) => boolean;

export class Driving {
  car: DrivenVehicle | null = null;
  /** Your own car, when it's the one you're driving (the racing model). */
  own: OwnCar | null = null;
  /** Held at the line (a race's countdown): the car kept still, the throttle ignored. */
  hold = false;
  /** The camera (race/driveCam.ts). On a bike, 'cockpit' is his eyes and the chase views behind it. */
  view: DriveViewId = within(loadView(), this.views);
  /** The debug menu's switch: every camera (chase, bonnet, bumper too), not just the far chase and the cockpit. */
  allViews = false;
  /** The views Q cycles through in a car. */
  get views(): readonly DriveViewId[] {
    return this.allViews ? DRIVE_VIEWS : CITY_VIEWS;
  }
  /** Turn every camera on or off; a view no longer offered gives way to the far chase. */
  setAllViews(on: boolean): void {
    this.allViews = on;
    if (!this.bike) this.view = within(this.view, this.views);
  }
  /** On a bike: Q switches between his eyes and behind it. */
  bike = false;
  /** The cabin of the car you're driving (shown in the cockpit view), when it has one. */
  interior: CarInterior | null = null;
  /** The lamps (0 day, 1 night), for the dials' backlight. */
  lamps = 0;
  /** Called when Q changes the view. */
  onView: ((v: DriveViewId) => void) | null = null;
  /** The pedals as they're pressed now (0-1; yours or auto drive's), for the cabin's pedals and the driver's feet. */
  readonly pedals = { throttle: 0, brake: 0, handbrake: false };
  /**
   * Auto drive (district/autoDrive.ts): the controls for your own car this step, in place of the keys (null: the
   * keys). A driving key while it's on calls `onOverride`: you take the wheel back.
   */
  pilot: ((dt: number) => Controls | null) | null = null;
  onOverride: (() => void) | null = null;
  private readonly head = new Head();
  private lookBack = 0;
  private bendYaw = 0;
  private readonly frame = new THREE.Object3D();
  private baseFov = 0;
  /** A knock this frame (speed of the impact, m/s), for a sound and a shake; 0 if none. */
  bump = 0;
  /** Where the driver's eyes are from the seat's own (the car's frame): he leans to the window he shoots from (race/carDriver.ts). */
  readonly eyeShift = new THREE.Vector3();
  /** Aiming from the driver's seat: where (world yaw, 0 along +z, and pitch, rad); null when not. */
  aim: { yaw: number; pitch: number } | null = null;
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
  /** How far out along the chase camera's arm it sits (1 free, less when a wall pulls it in; eased). */
  private camT = 1;
  /** The chase camera's offset from the car (x and z; y is the height), and the car's smoothed velocity. */
  private readonly camOff = new THREE.Vector3();
  private readonly velSm = new THREE.Vector3();
  /** Observing from the seat (no gun out, the right button held): the view is his eyes, as aiming's, the pistol not raised. */
  observing = false;
  private beforeObserve: { yaw: number; pitch: number } | null = null;
  /** The chase cameras' distance (1 as built; the mouse wheel changes it). */
  private zoom = (() => {
    try {
      return THREE.MathUtils.clamp(Number(localStorage.getItem('rainyplace.chaseZoom')) || 1, 0.35, 3);
    } catch {
      return 1;
    }
  })();
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
      if (this.pilot && DRIVE_KEYS.has(e.code)) this.onOverride?.();
      if (e.code === 'KeyQ') {
        this.view = nextView(this.view, this.bike, this.views);
        if (!this.bike) saveView(this.view);
        this.head.reset();
        this.onView?.(this.view);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // The wheel brings the chase cameras nearer or further (remembered).
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.car || !document.pointerLockElement || this.aim || !outside(this.view)) return;
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.001), 0.35, 3);
        try {
          localStorage.setItem('rainyplace.chaseZoom', this.zoom.toFixed(2));
        } catch {
          /* no storage */
        }
      },
      { passive: true },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.car || !document.pointerLockElement) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      const my = this.invertY ? -e.movementY : e.movementY;
      if (this.aim) {
        this.aim.yaw -= e.movementX * 0.0018;
        this.aim.pitch = THREE.MathUtils.clamp(this.aim.pitch - my * 0.0018, -0.45, 0.4);
        return;
      }
      this.orbitYaw -= e.movementX * 0.003;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - my * 0.003, -0.6, 0.5);
      this.mouseIdle = 0;
    });
  }

  private get spec(): (typeof SPECS)['car' | 'bus'] {
    return this.car?.bus ? SPECS.bus : SPECS.car;
  }

  /** Take the wheel of `car` (already handed over by the traffic system); on a bike, his eyes to begin with. */
  enter(car: DrivenVehicle, own: OwnCar | null = null, bike = false): void {
    this.car = car;
    this.own = own;
    this.bike = bike;
    this.view = bike ? 'cockpit' : within(loadView(), this.views);
    this.head.reset();
    this.baseFov = this.camera.fov;
    if (own) {
      own.sound.start();
      // Getting in turns the key (a running engine just carries on); an empty tank won't start.
      own.setEngine(true);
    }
    this.yaw = Math.atan2(car.dx, car.dz);
    this.steer = 0;
    this.orbitYaw = 0;
    this.lookPitch = 0;
    this.keys.clear();
    this.restChase();
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

  /** Raise the aim: from where the view looks now (a little up from the chase camera's downward look). */
  startAim(): void {
    if (this.aim || !this.car) return;
    const d = this.camera.getWorldDirection(new THREE.Vector3());
    this.aim = { yaw: Math.atan2(d.x, d.z), pitch: THREE.MathUtils.clamp(Math.asin(d.y) + (outside(this.view) ? 0.12 : 0), -0.1, 0.2) };
  }

  /** Lower it: the view carries on looking where you were aiming, then eases back ahead. */
  stopAim(): void {
    const a = this.aim;
    this.aim = null;
    if (!a || !this.car) return;
    const rel = a.yaw - Math.atan2(this.car.dx, this.car.dz);
    this.orbitYaw = Math.atan2(Math.sin(rel), Math.cos(rel));
    this.lookPitch = outside(this.view) ? 0 : THREE.MathUtils.clamp(a.pitch, -0.6, 0.5);
    this.mouseIdle = 0;
  }

  /**
   * Observe from the seat: the cockpit view for as long as it's held, then the chase camera as it was (from outside, the
   * look round the car is kept for it). Does nothing on a bike.
   */
  setObserve(on: boolean): void {
    on = on && !!this.car && !this.bike && !this.aim;
    if (on === this.observing) return;
    this.observing = on;
    if (on && outside(this.view)) {
      this.beforeObserve = { yaw: this.orbitYaw, pitch: this.lookPitch };
      this.orbitYaw = 0;
      this.lookPitch = 0;
    } else if (!on && this.beforeObserve) {
      this.orbitYaw = this.beforeObserve.yaw;
      this.lookPitch = this.beforeObserve.pitch;
      this.beforeObserve = null;
      this.mouseIdle = 0;
    }
  }

  /** A jolt to the view (a hit on the car, a ram): 0-1. */
  jolt(amount: number): void {
    this.shake = Math.max(this.shake, Math.min(1, amount));
  }

  /** A shot's kick on the aim (rad up). */
  kick(up: number): void {
    if (this.aim) this.aim.pitch = Math.min(0.4, this.aim.pitch + up);
    this.shake = Math.max(this.shake, 0.3);
  }

  leave(): void {
    this.aim = null;
    if (this.car) this.car.hideBody = false;
    if (this.interior) this.interior.group.visible = false;
    if (this.own) for (const w of this.own.view.wheels) w.m.visible = true;
    this.interior = null;
    this.setFov(this.baseFov || this.camera.fov);
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
      const auto = this.hold ? null : (this.pilot?.(dt) ?? null);
      const c = auto ?? (this.hold ? { throttle: 0, brake: 0, steer: -turn, handbrake: false } : { throttle: gas ? 1 : 0, brake: brake ? 1 : 0, steer: -turn, handbrake: hand });
      Object.assign(this.pedals, { throttle: c.throttle, brake: c.brake, handbrake: c.handbrake });
      this.own.drive(dt, c);
      // His hand on the ignition key, and the key's turn (the cabin shows the key, the driver's hand goes to it).
      if (this.interior) {
        this.interior.motion.key = this.own.keyHand;
        this.interior.motion.keyTurn = this.own.keyTurn;
      }
      // Held at the line: still (the brake at a standstill would engage reverse).
      if (this.hold) this.own.sim.u = this.own.sim.w = this.own.sim.r = 0;
      const knock = this.own.knock;
      if (knock > 1.5) {
        this.bump = knock;
        this.shake = Math.min(1, knock / 8);
      }
      return;
    }
    Object.assign(this.pedals, { throttle: gas ? 1 : 0, brake: brake ? 1 : 0, handbrake: hand });
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
  }

  /** The car's velocity in the world (m/s, x and z). */
  private carVelocity(out: THREE.Vector3): THREE.Vector3 {
    const c = this.car!;
    const s = this.own?.sim;
    if (s) return out.set(Math.sin(s.h) * s.u + Math.cos(s.h) * s.w, 0, Math.cos(s.h) * s.u - Math.sin(s.h) * s.w);
    return out.set(c.dx * c.v, 0, c.dz * c.v);
  }

  /** The chase camera at rest behind the car (the other views keep it ready, and getting in starts from it). */
  private restChase(): void {
    const c = this.car!;
    const t = this.chaseTarget(0, false);
    this.camPos.copy(t);
    this.camOff.set(t.x - c.x, t.y, t.z - c.z);
    this.carVelocity(this.velSm);
  }

  private chaseTarget(turn = 0, look = true): THREE.Vector3 {
    const c = this.car!;
    const far = this.view === 'far' && !this.bike;
    const back = (c.bus ? 12 : 6.4) * (far ? 1.45 : 1) * this.zoom;
    const up = (c.bus ? 4.4 : 2.5) + (far ? 1.2 : 0);
    const a = Math.atan2(c.dx, c.dz) + (look ? this.orbitYaw : 0) + turn;
    // Looking up swings the camera down behind the car (and looking down lifts it), about the car.
    const elev = look ? -this.lookPitch : 0;
    return new THREE.Vector3(c.x - Math.sin(a) * back * Math.cos(elev), this.floor + up + Math.sin(elev) * back, c.z - Math.cos(a) * back * Math.cos(elev));
  }

  private setFov(f: number): void {
    if (Math.abs(this.camera.fov - f) < 0.01) return;
    this.camera.fov = f;
    this.camera.updateProjectionMatrix();
  }

  /**
   * The car's frame, posed: your car's own object (posed by its owner before this is called); a vehicle the
   * traffic draws is posed later in the frame, so its frame is made here from where it is.
   */
  private carFrame(): THREE.Object3D {
    const c = this.car!;
    if (this.own) return this.own.view.obj;
    const f = this.frame;
    f.position.set(c.x, this.floor, c.z);
    f.rotation.set(0, Math.atan2(c.dx, c.dz), 0);
    f.updateMatrixWorld();
    return f;
  }

  /** Places the camera for the view (call once the car's been posed this frame). */
  placeCamera(dt: number): void {
    const c = this.car;
    if (!c) return;
    this.mouseIdle += dt;
    // Let go of the mouse and the view swings back to straight ahead.
    // (From outside it stays where you put it: a full turn round the car, not pulled back behind it.)
    if (this.mouseIdle > 1.2 && !outside(this.view)) {
      const ease = 1 - Math.exp(-dt * 2.5);
      this.orbitYaw -= this.orbitYaw * ease;
    }
    this.shake = Math.max(0, this.shake - dt * 3);
    const jolt = (): number => (Math.random() - 0.5) * this.shake * 0.25;
    const cam = this.camera;
    // Z or C, held, looks back (from inside, turned in the seat to see out of the rear screen; the chase cameras
    // swing round in front).
    this.lookBack += ((this.keys.has('KeyZ') || this.keys.has('KeyC') ? 1 : 0) - this.lookBack) * Math.min(1, dt * 9);
    const back = this.lookBack * this.lookBack * (3 - 2 * this.lookBack) * Math.PI;
    const L = this.interior?.layout ?? null;
    // Aiming from your car's seat: his eyes, whatever the camera was.
    const aimed = this.aim && L && !this.bike ? this.aim : null;
    const view: DriveViewId = this.bike ? (outside(this.view) ? 'chase' : 'bumper') : aimed || (this.observing && !!L) ? 'cockpit' : this.view;
    const inside = view === 'cockpit' && (!!L || c.bus);
    c.hideBody = view === 'bumper' || (view === 'cockpit' && !inside);
    if (this.interior) this.interior.group.visible = inside;
    // From the seat his own car's wheels are left out: the front ones reach into the footwell and show through it
    // when steered (the user's snapshot); from outside they're drawn as ever.
    if (this.own) for (const w of this.own.view.wheels) w.m.visible = !inside;
    const speed = Math.abs(this.own ? this.own.sim.u : c.v);
    const base = this.baseFov || 68;
    // (The cockpit keeps the walker's field of view: any wider shows more city, and the city's cost is its geometry.)
    if (!this.bike) this.setFov(aimed ? base - 8 : base + (view === 'far' ? -6 : 0) + Math.min(6, speed * 0.14));
    if (inside || view === 'hood') {
      const frame = this.carFrame();
      const sim = this.own?.sim;
      // Accelerations in the car's frame (forward, and to the left: a right-hand bend's is to the right).
      const ax = sim ? sim.ax : c.acc;
      const ay = sim ? sim.ay : -c.v * c.v * c.curv;
      if (inside) {
        this.head.update(dt, ax, ay, speed, this.bump);
        this.bendYaw += (lookInto(sim ? sim.steer : this.steer, speed, sim ? sim.slide : 0) - this.bendYaw) * Math.min(1, dt * 3);
        // (A bus has no cabin of ours: its driver's seat, front right, over the new bus's own inside.)
        const eye = L ? L.eye.clone().add(this.eyeShift) : new THREE.Vector3(-0.72, 2.3, c.half - 1.15);
        if (aimed) {
          // Along the aim, level with the world (the aim stays put while the car turns and leans under it).
          const rel = aimed.yaw - Math.atan2(c.dx, c.dz);
          frame.updateMatrixWorld();
          cam.position.copy(turnedEye(eye, Math.atan2(Math.sin(rel), Math.cos(rel))).add(this.head.offset).applyMatrix4(frame.matrixWorld));
          cam.position.x += jolt() * 0.3;
          cam.position.y += jolt() * 0.3;
          const cp = Math.cos(aimed.pitch);
          cam.up.set(0, 1, 0);
          cam.lookAt(cam.position.x + Math.sin(aimed.yaw) * cp, cam.position.y + Math.sin(aimed.pitch), cam.position.z + Math.cos(aimed.yaw) * cp);
        } else {
          const look = THREE.MathUtils.clamp(this.orbitYaw, -2.2, 2.2) + this.bendYaw + back;
          // Looking back he turns in his seat and leans to the middle of the car, so he sees between the seats and
          // out of the rear screen (from where he sits his own seat's back fills the view).
          const turn = this.lookBack * this.lookBack * (3 - 2 * this.lookBack);
          const between = new THREE.Vector3(eye.x * 0.1, eye.y + 0.04, eye.z + 0.04);
          placeInCar(cam, frame, turnedEye(eye, look).lerp(between, turn).add(this.head.offset), look, this.lookPitch - 0.06 + 0.02 * turn, 0.5);
        }
        if (this.interior) {
          const gear = sim ? sim.gear : c.v < -0.1 ? 0 : 1;
          const rpm = sim ? (this.own ? this.own.engineRpm(900 + sim.rev * (this.interior.redline - 900)) : 900 + sim.rev * (this.interior.redline - 900)) : 800 + Math.min(1, Math.abs(c.v) / 20) * 2600;
          this.interior.update(
            {
              steer: sim ? sim.steer : this.steer,
              ax,
              ay,
              kmh: speed * 3.6,
              rpm,
              gear,
              throttle: this.pedals.throttle,
              brake: this.pedals.brake,
              handbrake: this.pedals.handbrake,
              // (The city: he drives as people do, one hand on the wheel when nothing asks for two.)
              slide: sim?.slide,
              calm: true,
              lamps: this.lamps,
              bump: this.bump,
              boost: sim?.spec.turbo ? sim.boost : undefined,
            },
            dt,
          );
        }
      } else {
        // On the bonnet (a vehicle without a cabin's numbers: over its front).
        const at = L ? L.hood : new THREE.Vector3(0, c.bus ? 2.6 : 1.25, c.half - (c.bus ? 0.4 : 1.1));
        placeInCar(cam, frame, at, this.orbitYaw + back, this.lookPitch - 0.04);
      }
      this.restChase();
      return;
    }
    if (view === 'bumper' || view === 'cockpit') {
      // Low at the front of the car, looking out along the road (and a car without a cabin's cockpit view).
      const h = (c.bus ? 1.9 : 0.95) + this.floor;
      cam.position.set(c.x + c.dx * (c.half - 0.2) + jolt(), h + jolt(), c.z + c.dz * (c.half - 0.2));
      const a = Math.atan2(c.dx, c.dz) + this.orbitYaw + back;
      cam.lookAt(cam.position.x + Math.sin(a), h + Math.tan(this.lookPitch - 0.02), cam.position.z + Math.cos(a));
      this.restChase();
      return;
    }
    // Chase: follow a point behind (eased, so turns and stops show), pulled in if a wall is in the way.
    // The lag is for the car's own turns and stops; the mouse's turn about the car is applied on top, unlagged, so
    // looking round (a full circle) follows the hand exactly.
    // The camera is the car's own place plus an offset that eases round with its heading, less a share of the car's
    // smoothed velocity (the trail behind it when it speeds up). It used to be the world point itself eased toward
    // the car's: each frame's length then made the camera's gap to the car jump (a car at 25 m/s and a 5 ms
    // wobble in the frame is 6 cm), which, swung round the side of the car, was the whole car shaking.
    const want = this.chaseTarget(back, false);
    const k = 1 - Math.exp(-dt * (this.lookBack > 0.05 ? 12 : 5));
    this.camOff.x += (want.x - c.x - this.camOff.x) * k;
    this.camOff.z += (want.z - c.z - this.camOff.z) * k;
    this.camOff.y += (want.y - this.camOff.y) * k;
    this.carVelocity(_vel);
    const vk = 1 - Math.exp(-dt * 5);
    this.velSm.x += (_vel.x - this.velSm.x) * vk;
    this.velSm.z += (_vel.z - this.velSm.z) * vk;
    this.camPos.set(c.x + this.camOff.x - this.velSm.x * TRAIL, this.camOff.y, c.z + this.camOff.z - this.velSm.z * TRAIL);
    const ox = this.camPos.x - c.x;
    const oz = this.camPos.z - c.z;
    const r = Math.hypot(ox, oz);
    const cd = Math.cos(this.orbitYaw);
    const sd = Math.sin(this.orbitYaw);
    const elev = -this.lookPitch;
    const ce = Math.cos(elev);
    const orbited = _orbit.set(c.x + (ox * cd + oz * sd) * ce, this.camPos.y + Math.sin(elev) * r, c.z + (oz * cd - ox * sd) * ce);
    const pivot = new THREE.Vector3(c.x, (c.bus ? 2.6 : 1.3) + this.floor, c.z);
    // How far out along the arm a wall allows: found by halving (not in steps of eight percent, whose jumps of a
    // third of a metre, as the car passed a parapet it was borderline against, shook the view when zoomed in).
    const hit = (t: number): boolean => this.collide(pivot.x + (orbited.x - pivot.x) * t, pivot.z + (orbited.z - pivot.z) * t, 0.3);
    let tWant = 1;
    if (this.floor < 2 && hit(1)) {
      let lo = 0.25;
      let hi = 1;
      if (hit(lo)) hi = lo;
      else for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (hit(mid)) hi = mid;
        else lo = mid;
      }
      tWant = lo;
    }
    // A wall pulls the camera in quickly but lets it out slowly, so sweeping past a corner doesn't flicker.
    this.camT += (tWant - this.camT) * (tWant < this.camT ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 3));
    const t = Math.min(this.camT, 1);
    cam.position.set(pivot.x + (orbited.x - pivot.x) * t + jolt(), pivot.y + (orbited.y - pivot.y) * t + jolt(), pivot.z + (orbited.z - pivot.z) * t);
    // Looking at the point ahead of the car, which gives way to the car itself as the view swings round it.
    const la = Math.atan2(c.dx, c.dz) + back;
    const ahead = 1.5 * (1 + cd);
    cam.lookAt(c.x + Math.sin(la) * ahead, (c.bus ? 2.2 : 1.1) + this.floor, c.z + Math.cos(la) * ahead);
  }

  /** How far the look back has come round (0-1: Z or C held). */
  get lookingBack(): number {
    return this.lookBack;
  }

  /** Looking about from the vehicle (rad): yaw left positive, pitch up positive (a bike's views use them). */
  get look(): { yaw: number; pitch: number } {
    return { yaw: this.orbitYaw, pitch: this.lookPitch };
  }

  /** Turns the look as the mouse would (for scripts: main.ts `__look`); it eases back ahead as after the mouse. */
  setLook(yaw: number, pitch: number): void {
    this.orbitYaw = yaw;
    this.lookPitch = THREE.MathUtils.clamp(pitch, -0.6, 0.5);
    this.mouseIdle = 0;
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
