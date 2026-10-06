import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Box } from './block';

const EYE = 1.7;
const RADIUS = 0.4;
const WALK = 4.5; // m/s: brisk game-walk, not realistic 1.4 m/s
const RUN = 9;
const FLY = 36;
const MAX_SHEAR = 1.6;
/** Jump: take-off speed (m/s) and gravity (m/s^2): about 0.8 m high, 0.7 s in the air. */
const JUMP_V = 4.4;
const GRAVITY = 12;
/** How far the view bobs with each step (metres either way). */
const BOB = 0.04;
/** Longest frame step: after a hitch the walker doesn't leap (or tunnel through a wall). */
const MAX_DT = 0.05;
/**
 * Mouse look: radians per pixel (three's PointerLockControls default), and the largest believable move in
 * one event. Chromium on Windows sometimes reports a huge bogus movement under pointer lock (right after
 * locking, or at random), which snapped the view round; those events are dropped.
 */
const MOUSE = 0.002;
const SPIKE = 300;

/** Collision query: is a circle of this radius at (x, z) blocked? floor: the walker's floor height (0 at
 * street level, negative in a basement), so a building can collide differently underground. */
export type Blocker = (x: number, z: number, radius: number, floor?: number) => boolean;

/** Floor height at (x, z): 0 on the street, a ramp on stairs, negative in a basement, raised on a
 * platform. current is the walker's floor now, to pick between levels that overlap. */
export type FloorAt = (x: number, z: number, current: number) => number;

/** A Blocker over a fixed list of footprints inside a square bound. */
export function boxBlocker(boxes: readonly Box[], bounds: number): Blocker {
  return (x, z, r) =>
    Math.abs(x) > bounds || Math.abs(z) > bounds || boxes.some((b) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);
}

/**
 * First-person WASD + mouse-look, with circle-vs-AABB collision resolved per axis (so you slide along walls).
 *
 * Look up/down has two modes:
 * - shear (default): the camera never pitches; the image shifts vertically instead (classic raycaster
 *   "y-shearing"). Verticals stay exactly vertical, so facade columns stay locked to character columns,
 *   which is what the reference ASCII cities do.
 * - pitch: a true camera rotation (verticals converge when looking up).
 */
export class FirstPerson {
  readonly look: PointerLockControls;
  private keys = new Set<string>();
  private bob = 0;
  /** Vertical image shift in NDC; positive looks up. */
  private shear = 0;
  private shearOn = true;
  /** Debug: fast, ignores collision, moves along the view direction and holds its altitude. */
  fly = false;
  /** Floor heights (stairs, basements); street level everywhere if unset. */
  floorAt: FloorAt | null = null;
  /** Movement off (riding a train): the view still turns, the camera is placed by someone else. */
  held = false;
  /** Mouse look off (driving: the driving camera takes the mouse). */
  mouseLook = true;
  /** Invert the mouse's up and down (mouse up looks down). */
  invertY = false;
  /** The walker's floor height (y of the feet). */
  private level = 0;
  /** Height above the floor while jumping, and the vertical speed. */
  private air = 0;
  private vy = 0;
  /** Footsteps: called on each step (running or walking), and on landing (with the fall speed, m/s). */
  onStep: ((run: boolean) => void) | null = null;
  onLand: ((speed: number) => void) | null = null;
  /**
   * The walker's body, when it's drawn (models/firstPerson.ts): how it rides its stride, -1 as each foot lands and
   * 1 between. The view bobs with it, and the steps are the body's own footfalls (onStep isn't called).
   */
  gaitBob: (() => number) | null = null;
  /** How far the eyes are below standing height (m): his body squatting. */
  drop = 0;
  /** Ignore the first mouse event after locking (often a jump from where the cursor was). */
  private settle = true;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    /** Collision (swapped while walking inside a moving vehicle: real/cabinRider.ts). */
    public blocked: Blocker,
  ) {
    this.look = new PointerLockControls(camera, dom);
    // Mouse look is handled here (filtered); PointerLockControls only does the locking.
    this.look.enabled = false;
    camera.position.set(0, EYE, 38);
    this.setShearMode(true);
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space' && this.look.isLocked) {
        e.preventDefault();
        if (!this.fly && !this.held && this.air === 0) this.vy = JUMP_V;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.look.addEventListener('lock', () => (this.settle = true));
    document.addEventListener('mousemove', (e) => this.mouse(e));
  }

  /** Locks the pointer, with raw mouse input where the browser offers it (it avoids the bogus jumps). */
  lock(): void {
    const el = this.look.domElement as HTMLElement;
    // Without a user gesture (or raw input) the request is refused; that's fine, a click locks it later.
    const plain = (): void => {
      try {
        (el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined);
      } catch {
        /* not now */
      }
    };
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
      p?.catch?.(plain);
    } catch {
      plain();
    }
  }

  private mouse(e: MouseEvent): void {
    if (!this.look.isLocked || !this.mouseLook) return;
    if (this.settle) {
      this.settle = false;
      return;
    }
    const mx = e.movementX;
    const my = this.invertY ? -e.movementY : e.movementY;
    if (Math.abs(mx) > SPIKE || Math.abs(my) > SPIKE) return;
    const k = MOUSE * this.look.pointerSpeed;
    const eu = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    eu.y -= mx * k;
    if (this.shearOn) {
      this.shear = THREE.MathUtils.clamp(this.shear - my * k, -MAX_SHEAR, MAX_SHEAR);
      eu.x = 0;
    } else {
      eu.x = THREE.MathUtils.clamp(eu.x - my * k, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    }
    eu.z = 0;
    this.camera.quaternion.setFromEuler(eu);
  }

  /** Put the walker on a floor (after a teleport). */
  setLevel(y: number): void {
    this.level = y;
  }

  /** The floor under the walker's feet (no bob, no jump). */
  get feet(): number {
    return this.level;
  }

  get shearMode(): boolean {
    return this.shearOn;
  }

  /** Switch look mode, keeping the same apparent view direction. */
  setShearMode(on: boolean): void {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    const pitch = on ? e.x : Math.atan(this.shear * this.tanHalfFov());
    this.shearOn = on;
    // Shear mode pins the camera's pitch at the horizon; mouse Y drives the shift instead.
    this.look.minPolarAngle = on ? Math.PI / 2 : 0;
    this.look.maxPolarAngle = on ? Math.PI / 2 : Math.PI;
    this.setView((e.y * 180) / Math.PI, (pitch * 180) / Math.PI);
  }

  /** Point the view: yaw and pitch in degrees (pitch becomes a shift in shear mode). */
  setView(yawDeg: number, pitchDeg: number): void {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    this.shear = this.shearOn ? THREE.MathUtils.clamp(Math.tan(pitch) / this.tanHalfFov(), -MAX_SHEAR, MAX_SHEAR) : 0;
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.shearOn ? 0 : pitch, yaw, 0, 'YXZ'));
    this.applyProjection();
  }

  /** In the air (a jump, a drop): how high the feet are above the floor (m) and how fast he's rising (m/s). */
  get airHeight(): number {
    return this.air;
  }
  get airSpeed(): number {
    return this.vy;
  }

  update(dt: number): void {
    this.applyProjection();
    dt = Math.min(dt, MAX_DT);
    const k = this.keys;
    const f = Number(k.has('KeyW') || k.has('ArrowUp')) - Number(k.has('KeyS') || k.has('ArrowDown'));
    const r = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    const pos = this.camera.position;
    if (this.held) {
      this.air = this.vy = 0;
      return;
    }
    const floor = (x: number, z: number): number => (this.floorAt ? this.floorAt(x, z, this.level) : 0);
    if (this.fly) {
      // Space rises, Ctrl sinks.
      const up = Number(k.has('Space')) - Number(k.has('ControlLeft') || k.has('ControlRight'));
      pos.y = Math.max(EYE, pos.y + up * FLY * 0.5 * dt);
      this.air = this.vy = 0;
    } else if (this.vy !== 0 || this.air > 0) {
      // In the air: a ballistic hop over the floor below (it doesn't get you onto things).
      this.vy -= GRAVITY * dt;
      this.air += this.vy * dt;
      if (this.air <= 0) {
        this.onLand?.(-this.vy);
        this.air = this.vy = 0;
      }
    }
    if (f === 0 && r === 0) {
      // (The body's stride eases out as it stops, and the bob with it.)
      if (!this.fly) pos.y = (this.level = floor(pos.x, pos.z)) + EYE - this.drop + this.air + (this.gaitBob && this.air === 0 ? this.gaitBob() * BOB : 0);
      return;
    }
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    if (this.fly && !this.shearOn) {
      pos.addScaledVector(fwd, f * FLY * dt);
      const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
      pos.addScaledVector(right, r * FLY * dt);
      pos.y = Math.max(EYE, pos.y);
      return;
    }
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize();
    const running = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = this.fly ? FLY : running ? RUN : WALK;
    const dx = move.x * speed * dt;
    const dz = move.z * speed * dt;
    const level = this.level;
    if (this.fly || !this.blocked(pos.x + dx, pos.z, RADIUS, level)) pos.x += dx;
    if (this.fly || !this.blocked(pos.x, pos.z + dz, RADIUS, level)) pos.z += dz;
    if (!this.fly) {
      // Without a body, a step at each low point of the bob (two per cycle); none in the air.
      const before = Math.floor(this.bob / Math.PI + 0.5);
      if (this.air === 0) this.bob += dt * speed * 1.8;
      if (!this.gaitBob && Math.floor(this.bob / Math.PI + 0.5) !== before) this.onStep?.(running);
      this.level = floor(pos.x, pos.z);
      pos.y = this.level + EYE - this.drop + this.air + (this.air === 0 ? (this.gaitBob ? this.gaitBob() : Math.sin(this.bob)) * BOB : 0);
    }
  }

  /** Off the ground (a jump): no footfalls. */
  get airborne(): boolean {
    return this.air > 0 || this.vy !== 0;
  }

  /** The view's pitch (radians, up positive) when it's a shift of the image rather than the camera's own
   * (shear mode); undefined when the camera pitches. */
  get viewPitch(): number | undefined {
    return this.shearOn ? Math.atan(this.shear * this.tanHalfFov()) : undefined;
  }

  /** Rebuild the projection with the vertical shift (an off-axis frustum; depth is unaffected). */
  private applyProjection(): void {
    this.camera.updateProjectionMatrix();
    if (this.shear === 0) return;
    // Column-major element 9 = row 1, column 2: adds shear * z to clip y, i.e. shifts NDC y by -shear.
    this.camera.projectionMatrix.elements[9] = this.shear;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private tanHalfFov(): number {
    return Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
  }

}
