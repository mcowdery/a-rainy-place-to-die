import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Bike } from '../models/bikeKit';
import { Crosshair } from '../models/crosshair';
import { FirstPersonRig } from '../models/firstPerson';
import { SHOTGUN_KINDS } from '../models/shotgun';

/**
 * The showroom's first-person mode, for reviewing Mack's body and guns as the player will see them:
 * click to capture the mouse, mouse to look, WASD to walk (Shift faster), right button to raise the gun,
 * left to fire, R reload, G the other gun, H one hand or two, V back to orbiting. `__fp` scripts it for screenshots.
 * E by one of the showroom's bikes gets on (and off): W throttle, S brake (and back, slowly, from a stop),
 * A/D steer; the bike leans into the turn, the view rides with half the lean, the mouse looks about; X draws
 * the shotgun (in the right hand, the left on the bars: raised with the right button, fired with the left).
 */

/** A bike being ridden: where it is, its heading (0 faces -z), speed (m/s), steering and lean (radians). */
interface Ride {
  readonly bike: Bike;
  x: number;
  z: number;
  yaw: number;
  u: number;
  steer: number;
  lean: number;
}

/** The ride's numbers: wheelbase, top speed, throttle, brakes, drag, gravity. */
const RIDE = { wheelbase: 1.64, top: 22, accel: 3.2, brake: 8, drag: 0.35, airDrag: 0.01, g: 9.81, maxLean: (30 * Math.PI) / 180 };
export class FpMode {
  active = false;
  /** Holds the pose and lets the camera go (scripted shots from outside). */
  frozen = false;
  private rig: FirstPersonRig | null = null;
  private yaw = 0;
  private pitch = 0;
  private speed = 0;
  private readonly keys = new Set<string>();
  private savedFov = 50;
  private readonly invertY: boolean;
  /** Bikes you can get on (E by one), and the one you're on. */
  bikes: Bike[] = [];
  private riding: Ride | null = null;
  private armedOnFoot = true;
  private readonly crosshair = new Crosshair();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly controls: OrbitControls,
    private readonly env: THREE.Texture | null,
    private readonly floorAt: (x: number, z: number) => number,
  ) {
    let inv = false;
    try {
      inv = localStorage.getItem('citypop.invertY') === '1';
    } catch {
      /* no storage */
    }
    this.invertY = inv;
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'KeyG' && this.rig) this.rig.setKind(SHOTGUN_KINDS[(SHOTGUN_KINDS.indexOf(this.rig.kind) + 1) % SHOTGUN_KINDS.length]);
      if (e.code === 'KeyR') this.rig?.reload();
      if (e.code === 'KeyH' && this.rig) this.rig.oneHand = !this.rig.oneHand;
      if (e.code === 'KeyV') this.exit();
      if (e.code === 'KeyE') this.toggleRide();
      if (e.code === 'KeyX' && this.rig) {
        this.rig.armed = !this.rig.armed;
        if (!this.rig.armed) this.rig.aiming = false;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', (e) => {
      if (!this.active || !this.rig) return;
      if (document.pointerLockElement !== dom) {
        void dom.requestPointerLock();
        return;
      }
      if (e.button === 2 && this.rig.armed) this.rig.aiming = true;
      if (e.button === 0 && this.rig.armed && this.rig.fire()) this.crosshair.fired();
    });
    dom.addEventListener('mouseup', (e) => {
      if (e.button === 2 && this.rig) this.rig.aiming = false;
    });
    dom.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || document.pointerLockElement !== dom) return;
      this.look(e.movementX * 0.0022, e.movementY * 0.0022 * (this.invertY ? -1 : 1));
    });
  }

  private look(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.35, 1.2);
  }

  /** Into first person at (x, z), facing `yaw` (0 looks along -z). */
  async enter(x: number, z: number, yaw: number): Promise<void> {
    if (!this.rig) {
      this.rig = await FirstPersonRig.load('mack', this.env);
      this.scene.add(this.rig.object);
    }
    this.rig.object.visible = true;
    this.active = true;
    this.controls.enabled = false;
    this.savedFov = this.camera.fov;
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.order = 'YXZ';
    this.yaw = yaw;
    this.pitch = 0;
    this.camera.position.set(x, this.floorAt(x, z) + this.rig.eyeHeight, z);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    if (this.rig) this.rig.object.visible = false;
    this.crosshair.update(false, 0, 0);
    this.controls.enabled = true;
    this.camera.fov = this.savedFov;
    this.camera.updateProjectionMatrix();
    const f = this.camera.getWorldDirection(new THREE.Vector3());
    this.controls.target.copy(this.camera.position).addScaledVector(f, 3);
    this.camera.rotation.order = 'XYZ';
    this.controls.update();
  }

  /** Gets on the nearest bike within reach, or off the one you're on (stepping off on its left). */
  private toggleRide(): void {
    if (this.riding) {
      const r = this.riding;
      const left = new THREE.Vector3(-Math.cos(r.yaw), 0, Math.sin(r.yaw));
      this.camera.position.set(r.x + left.x * 0.9, 0, r.z + left.z * 0.9);
      this.camera.position.y = this.floorAt(this.camera.position.x, this.camera.position.z) + (this.rig?.eyeHeight ?? 1.8);
      // Parked: upright, the bars turned a little.
      r.bike.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw);
      r.bike.steer.quaternion.setFromAxisAngle(r.bike.steerAxis, 0.25);
      this.yaw += r.yaw;
      this.riding = null;
      if (this.rig) {
        this.rig.mounted = null;
        this.rig.armed = this.armedOnFoot;
      }
      return;
    }
    const p = this.camera.position;
    let best: Bike | null = null;
    let bestD = 2.8;
    for (const b of this.bikes) {
      const w = b.root.getWorldPosition(new THREE.Vector3());
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d < bestD) {
        best = b;
        bestD = d;
      }
    }
    if (!best) return;
    const w = best.root.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(best.root.quaternion, 'YXZ').y;
    this.riding = { bike: best, x: w.x, z: w.z, yaw, u: 0, steer: 0, lean: 0 };
    // On the bike with both hands on the bars; X draws the shotgun.
    if (this.rig) {
      this.armedOnFoot = this.rig.armed;
      this.rig.armed = false;
      this.rig.aiming = false;
      this.rig.mounted = best;
    }
    // The view: ahead along the bike.
    this.yaw = 0;
    this.pitch = -0.12;
  }

  /** The ride's step: throttle, brakes, steering that winds in less at speed, the lean the turn wants. */
  private rideStep(r: Ride, dt: number): void {
    const k = this.keys;
    const throttle = k.has('KeyW');
    const brake = k.has('KeyS');
    if (throttle) r.u += RIDE.accel * (r.u < 3 ? 1.2 : 1) * dt;
    if (brake) r.u = r.u > 0.05 ? Math.max(0, r.u - RIDE.brake * dt) : Math.max(-1, r.u - 1.5 * dt);
    if (!brake && r.u < 0) r.u = Math.min(0, r.u + 2 * dt);
    r.u -= Math.sign(r.u) * Math.min(Math.abs(r.u), (RIDE.drag + RIDE.airDrag * r.u * r.u) * dt);
    r.u = Math.min(RIDE.top, r.u);
    const input = Number(k.has('KeyD')) - Number(k.has('KeyA'));
    const most = 0.55 / (1 + 0.35 * Math.abs(r.u));
    r.steer += (input * most - r.steer) * Math.min(1, dt * 6);
    // Turning right (steer > 0) turns the heading clockwise from above; no tighter than the lean a cruiser
    // has before its floorboards touch down.
    let turn = (r.u * Math.tan(r.steer)) / RIDE.wheelbase;
    const most2 = (RIDE.g * Math.tan(RIDE.maxLean)) / Math.max(0.1, Math.abs(r.u));
    turn = THREE.MathUtils.clamp(turn, -most2, most2);
    r.yaw -= turn * dt;
    const want = Math.atan((r.u * turn) / RIDE.g);
    r.lean += (want - r.lean) * Math.min(1, dt * 4);
    r.x -= Math.sin(r.yaw) * r.u * dt;
    r.z -= Math.cos(r.yaw) * r.u * dt;
    const b = r.bike;
    b.root.position.set(r.x, this.floorAt(r.x, r.z), r.z);
    // Leaning right tips the top toward the rider's right (+x in the bike's frame): a turn about -z.
    b.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -r.lean));
    b.steer.quaternion.setFromAxisAngle(b.steerAxis, -r.steer);
    b.frontWheel.rotation.x -= (r.u * dt) / b.wheelRadius.front;
    b.rearWheel.rotation.x -= (r.u * dt) / b.wheelRadius.rear;
  }

  update(dt: number): void {
    const rig = this.rig;
    if (!this.active || !rig || this.frozen) return;
    this.crosshair.update(rig.armed, rig.aim, dt);
    if (this.riding) {
      const r = this.riding;
      this.rideStep(r, dt);
      const eye = rig.seatBody(r.bike);
      this.camera.position.copy(eye);
      // The view: the bike's heading with half its lean, then where you look (the head turns only so far).
      this.yaw = THREE.MathUtils.clamp(this.yaw, -1.7, 1.7);
      this.camera.quaternion
        .setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -r.lean * 0.5))
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')));
      this.camera.updateMatrixWorld();
      rig.update(dt, this.camera, 0, 0);
      return;
    }
    const move = new THREE.Vector3();
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    if (this.keys.has('KeyW')) move.add(new THREE.Vector3(fx, 0, fz));
    if (this.keys.has('KeyS')) move.sub(new THREE.Vector3(fx, 0, fz));
    if (this.keys.has('KeyD')) move.add(new THREE.Vector3(-fz, 0, fx));
    if (this.keys.has('KeyA')) move.sub(new THREE.Vector3(-fz, 0, fx));
    const want = move.lengthSq() > 0 ? (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4.2 : 1.5) * (rig.aiming ? 0.6 : 1) : 0;
    this.speed += (want - this.speed) * Math.min(1, dt * 8);
    if (move.lengthSq() > 0) this.camera.position.addScaledVector(move.normalize(), this.speed * dt);
    const floor = this.floorAt(this.camera.position.x, this.camera.position.z);
    this.camera.position.y += (floor + rig.eyeHeight - this.camera.position.y) * Math.min(1, dt * 12);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    rig.update(dt, this.camera, this.speed, floor);
  }

  hud(): string {
    const r = this.rig;
    if (r && this.riding) {
      return `RIDING · ${Math.round(Math.abs(this.riding.u) * 3.6)} km/h · lean ${Math.round((this.riding.lean * 180) / Math.PI)}° · ${r.armed ? `shotgun, ${r.shells} in` : 'hands on the bars'}\nW throttle · S brake (and back from a stop) · A/D steer · mouse look · X shotgun · right button aim · left fire · E get off · V back to orbiting`;
    }
    return r
      ? `FIRST PERSON · ${r.kind} · ${r.oneHand ? 'one hand' : 'two hands'} · ${r.shells} in · ${document.pointerLockElement === this.dom ? 'mouse look' : 'click to capture the mouse'}\nWASD walk (Shift faster) · E get on a bike · X shotgun / hands free · right button aim · left fire · R reload · G other gun · H one hand / two · Esc frees the mouse · V back to orbiting`
      : 'FIRST PERSON · loading Mack...';
  }

  /** For scripted screenshots: set the view, aim, fire, switch guns. */
  script(): Record<string, unknown> {
    return {
      enter: (x: number, z: number, yaw: number) => this.enter(x, z, yaw),
      look: (yaw: number, pitch: number) => {
        this.yaw = yaw;
        this.pitch = pitch;
      },
      aim: (on: boolean) => this.rig && (this.rig.aiming = on),
      fire: () => this.rig?.fire(),
      kind: (k: (typeof SHOTGUN_KINDS)[number]) => this.rig?.setKind(k),
      oneHand: (on: boolean) => this.rig && (this.rig.oneHand = on),
      walk: (on: boolean) => (on ? this.keys.add('KeyW') : this.keys.delete('KeyW')),
      run: (on: boolean) => (on ? this.keys.add('ShiftLeft') : this.keys.delete('ShiftLeft')),
      exit: () => this.exit(),
      freeze: (on: boolean) => (this.frozen = on),
      rig: () => this.rig,
      ride: () => this.toggleRide(),
      riding: () => this.riding,
      key: (code: string, on: boolean) => (on ? this.keys.add(code) : this.keys.delete(code)),
      armed: (on: boolean) => this.rig && (this.rig.armed = on),
    };
  }
}
