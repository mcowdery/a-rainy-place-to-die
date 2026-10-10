import * as THREE from 'three';
import { CITY_VIEWS, DRIVE_VIEWS, Head, loadView, lookInto, nextView, outside, placeInCar, saveView, turnedEye, within, type DriveViewId } from '../../race/driveCam';
import type { Controls } from '../../race/vehicle';
import type { CarInterior } from '../models/carInterior';
import type { DrivenVehicle } from '../real/traffic';
import type { OwnCar } from './ownCar';

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

  private chaseTarget(turn = 0): THREE.Vector3 {
    const c = this.car!;
    const far = this.view === 'far' && !this.bike;
    const back = (c.bus ? 12 : 6.4) * (far ? 1.45 : 1);
    const up = (c.bus ? 4.4 : 2.5) + (far ? 1.2 : 0);
    const a = Math.atan2(c.dx, c.dz) + this.orbitYaw + turn;
    // Looking up swings the camera down behind the car (and looking down lifts it), about the car.
    const elev = -this.lookPitch;
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
    if (this.mouseIdle > 1.2) {
      const ease = 1 - Math.exp(-dt * 2.5);
      this.orbitYaw -= this.orbitYaw * ease;
      if (outside(this.view)) this.lookPitch -= this.lookPitch * ease;
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
    const view: DriveViewId = this.bike ? (outside(this.view) ? 'chase' : 'bumper') : aimed ? 'cockpit' : this.view;
    const inside = view === 'cockpit' && (!!L || c.bus);
    c.hideBody = view === 'bumper' || (view === 'cockpit' && !inside);
    if (this.interior) this.interior.group.visible = inside;
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
          const rpm = sim ? 900 + sim.rev * (this.interior.redline - 900) : 800 + Math.min(1, Math.abs(c.v) / 20) * 2600;
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
      this.camPos.copy(this.chaseTarget());
      return;
    }
    if (view === 'bumper' || view === 'cockpit') {
      // Low at the front of the car, looking out along the road (and a car without a cabin's cockpit view).
      const h = (c.bus ? 1.9 : 0.95) + this.floor;
      cam.position.set(c.x + c.dx * (c.half - 0.2) + jolt(), h + jolt(), c.z + c.dz * (c.half - 0.2));
      const a = Math.atan2(c.dx, c.dz) + this.orbitYaw + back;
      cam.lookAt(cam.position.x + Math.sin(a), h + Math.tan(this.lookPitch - 0.02), cam.position.z + Math.cos(a));
      this.camPos.copy(this.chaseTarget());
      return;
    }
    // Chase: follow a point behind (eased, so turns and stops show), pulled in if a wall is in the way.
    const want = this.chaseTarget(back);
    this.camPos.lerp(want, 1 - Math.exp(-dt * (this.lookBack > 0.05 ? 12 : 5)));
    const pivot = new THREE.Vector3(c.x, (c.bus ? 2.6 : 1.3) + this.floor, c.z);
    let t = 1;
    while (this.floor < 2 && t > 0.25 && this.collide(pivot.x + (this.camPos.x - pivot.x) * t, pivot.z + (this.camPos.z - pivot.z) * t, 0.3)) t -= 0.08;
    cam.position.set(pivot.x + (this.camPos.x - pivot.x) * t + jolt(), pivot.y + (this.camPos.y - pivot.y) * t + jolt(), pivot.z + (this.camPos.z - pivot.z) * t);
    const la = Math.atan2(c.dx, c.dz) + back;
    cam.lookAt(c.x + Math.sin(la) * 3, (c.bus ? 2.2 : 1.1) + this.floor, c.z + Math.cos(la) * 3);
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
