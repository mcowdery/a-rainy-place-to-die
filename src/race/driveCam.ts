import * as THREE from 'three';

/**
 * Driving cameras shared by the race page and the city (district/driving.ts): the views Q cycles through,
 * remembered in the browser (`citypop.driveView`); the driver's head in the cockpit, thrown about by the car's
 * accelerations on a spring and jolted by knocks; where the driver looks (into a bend, along a slide); placing the
 * cockpit and bonnet cameras in a car's frame; and the rear-view mirror's picture.
 *
 * A car's frame: +x its left, y up, +z forward (race/carView.ts' `obj`).
 */

export type DriveViewId = 'chase' | 'far' | 'cockpit' | 'hood' | 'bumper';
export const DRIVE_VIEWS: readonly DriveViewId[] = ['chase', 'far', 'cockpit', 'hood', 'bumper'];
export const VIEW_NAMES: Record<DriveViewId, string> = {
  chase: 'Chase',
  far: 'Far chase',
  cockpit: 'Cockpit',
  hood: 'Bonnet',
  bumper: 'Bumper',
};

const KEY = 'citypop.driveView';

/** The next view. On a bike only two: behind it, and his eyes (`cockpit`). */
export function nextView(v: DriveViewId, bike = false): DriveViewId {
  if (bike) return v === 'chase' || v === 'far' ? 'cockpit' : 'chase';
  return DRIVE_VIEWS[(DRIVE_VIEWS.indexOf(v) + 1) % DRIVE_VIEWS.length];
}

export function parseView(s: string | null | undefined): DriveViewId | null {
  return s && (DRIVE_VIEWS as readonly string[]).includes(s) ? (s as DriveViewId) : null;
}

/** The view last picked (on either page), else the chase camera. */
export function loadView(): DriveViewId {
  try {
    return parseView(localStorage.getItem(KEY)) ?? 'chase';
  } catch {
    return 'chase';
  }
}

export function saveView(v: DriveViewId): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // (No storage: the view isn't remembered.)
  }
}

/** Behind the car (the chase views): the body's seen from outside. */
export const outside = (v: DriveViewId): boolean => v === 'chase' || v === 'far';

const clamp = THREE.MathUtils.clamp;

/**
 * The driver's head in the cockpit: an offset from the eyes (car frame) on a spring, pushed by the car's
 * accelerations (out of a bend, forward under braking, back accelerating), jolted by knocks, with a road shiver
 * that grows with speed.
 */
export class Head {
  readonly offset = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private t = 0;

  reset(): void {
    this.offset.set(0, 0, 0);
    this.vel.set(0, 0, 0);
  }

  /** ax forward, ay to the left (m/s^2), speed (m/s), a knock (m/s). */
  update(dt: number, ax: number, ay: number, speed: number, bump = 0): void {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    this.t += dt;
    const tx = clamp(-ay * 0.0045, -0.065, 0.065);
    const tz = clamp(-ax * 0.004, -0.05, 0.055);
    const ty = -Math.min(0.025, (Math.abs(ay) + Math.abs(ax)) * 0.0012);
    const K = 70;
    const C = 2 * 0.72 * Math.sqrt(K);
    this.vel.x += ((tx - this.offset.x) * K - this.vel.x * C) * dt;
    this.vel.y += ((ty - this.offset.y) * K - this.vel.y * C) * dt;
    this.vel.z += ((tz - this.offset.z) * K - this.vel.z * C) * dt;
    if (bump > 1.5) {
      const k = Math.min(1.2, bump * 0.12);
      this.vel.y -= k;
      this.vel.x += (Math.random() - 0.5) * k;
      this.vel.z += k * 0.6;
    }
    this.offset.addScaledVector(this.vel, dt);
    this.offset.clampScalar(-0.12, 0.12);
    // The road's shiver at speed (not on the spring: it's the seat, not the body's sway).
    const sh = 0.0007 * Math.min(1, speed / 30);
    this.offset.y += (Math.sin(this.t * 37) + Math.sin(this.t * 23.3)) * sh;
    this.offset.x += Math.sin(this.t * 29.1) * sh * 0.5;
  }
}

/**
 * Where a driver looks (rad, to the left positive): into the bend the wheel is turned toward, more at speed, and
 * along a slide (the way the car's going).
 */
export function lookInto(steer: number, speed: number, slide: number): number {
  return clamp(steer * 1.1 * Math.min(1, speed / 10) + slide * 0.6, -0.55, 0.55);
}

const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * The camera at `at` in the car's frame (its object `obj`, posed), looking `yaw` round (to the left positive) and
 * `pitch` up from the car's forward. `level` (0-1) is how much of the body's roll and pitch the view holds level
 * against (a driver's head does; a camera on the bonnet doesn't).
 */
/** How far ahead of the neck the eyes are (m): what they swing round when the head turns. */
export const NECK = 0.09;

/**
 * The driver's eyes with his head turned `yaw` (rad, car frame) from straight ahead: swung round his neck, as a
 * head turns, not spun in place. Looking back over a shoulder they're then behind the neck, so the view never
 * looks down into his own collar (his head isn't drawn from his eyes). Moves `eye` and returns it.
 */
export function turnedEye(eye: THREE.Vector3, yaw: number): THREE.Vector3 {
  eye.x += Math.sin(yaw) * NECK;
  eye.z += (Math.cos(yaw) - 1) * NECK;
  return eye;
}

export function placeInCar(camera: THREE.Camera, obj: THREE.Object3D, at: THREE.Vector3, yaw: number, pitch: number, level = 0): void {
  obj.updateMatrixWorld();
  obj.getWorldQuaternion(_q);
  camera.position.copy(_p.copy(at).applyMatrix4(obj.matrixWorld));
  _f.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(_q);
  if (level > 0) {
    // Held level: the forward's climb kept, but only part of the body's pitch on top of the look.
    const flat = Math.hypot(_f.x, _f.z);
    const bodyPitch = Math.atan2(_f.y, flat) - pitch;
    const p = pitch + bodyPitch * (1 - level * 0.6);
    _f.set((_f.x / flat) * Math.cos(p), Math.sin(p), (_f.z / flat) * Math.cos(p));
  }
  _u.set(0, 1, 0).applyQuaternion(_q).lerp(new THREE.Vector3(0, 1, 0), level).normalize();
  camera.up.copy(_u);
  camera.lookAt(_p.copy(camera.position).add(_f));
  camera.up.set(0, 1, 0);
}

/**
 * The rear-view mirror's picture: a camera at the glass looking along the driver's line of sight reflected in it,
 * rendered into a texture the glass shows (flipped, as a mirror is), every `every` frames. Half-float, so the
 * picture keeps its brightness for the page's tone mapping.
 */
/** The layer of things only a mirror shows. */
export const MIRROR_LAYER = 5;

export class RearMirror {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera: THREE.PerspectiveCamera;
  readonly material: THREE.MeshBasicMaterial;
  private frame = 0;

  /** `every`: a picture each so many calls (the page may change it: how often is how much it costs). */
  constructor(width = 384, height = 100, far = 900, public every = 2, phase = 0, samples = 0) {
    this.frame = phase;
    this.camera = new THREE.PerspectiveCamera(14, width / height, 0.08, far);
    // (What's drawn only for mirrors: the markers over the cars that are after you, district/chaseCar.ts.)
    this.camera.layers.enable(MIRROR_LAYER);
    this.target = new THREE.WebGLRenderTarget(width, height, { depthBuffer: true, type: THREE.HalfFloatType, samples });
    const tex = this.target.texture;
    tex.repeat.x = -1;
    tex.offset.x = 1;
    this.material = new THREE.MeshBasicMaterial({ map: tex });
  }

  /** Renders the picture for the driver at `eye` (world); `hide` are left out of it (the glass, his head). `half`: half the glass's height (m: the cabin's mirror; a door mirror's is taller). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, glass: THREE.Mesh, eye: THREE.Vector3, hide: readonly THREE.Object3D[] = [], half = 0.031): void {
    if (this.frame++ % this.every) return;
    glass.updateMatrixWorld();
    const c = glass.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(glass.getWorldQuaternion(new THREE.Quaternion()));
    const inc = c.clone().sub(eye);
    const dist = inc.length();
    inc.normalize();
    const refl = inc.clone().addScaledVector(n, -2 * inc.dot(n));
    const cam = this.camera;
    cam.position.copy(c).addScaledVector(n, 0.01);
    cam.up.set(0, 1, 0).applyQuaternion(glass.getWorldQuaternion(new THREE.Quaternion()));
    cam.lookAt(cam.position.clone().add(refl));
    // As wide as the glass looks from the eyes, and a little more (it's slightly convex).
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(half / Math.max(0.2, dist))) * 1.7;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const was = [glass.visible, ...hide.map((o) => o.visible)];
    glass.visible = false;
    for (const o of hide) o.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.draw(renderer, scene);
    renderer.setRenderTarget(prev);
    glass.visible = was[0];
    hide.forEach((o, i) => (o.visible = was[i + 1]));
  }

  /**
   * The picture without a glass to reflect in: straight back from `at` along `toward` (world), `fov` degrees high
   * (for a mirror drawn over the view from the cameras outside the cabin). `hide` are left out (your own car).
   */
  renderBack(renderer: THREE.WebGLRenderer, scene: THREE.Scene, at: THREE.Vector3, toward: THREE.Vector3, fov: number, hide: readonly THREE.Object3D[] = []): void {
    if (this.frame++ % this.every) return;
    const cam = this.camera;
    cam.position.copy(at);
    cam.up.set(0, 1, 0);
    cam.lookAt(at.clone().add(toward));
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const was = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    this.draw(renderer, scene);
    renderer.setRenderTarget(prev);
    hide.forEach((o, i) => (o.visible = was[i]));
  }

  /**
   * The picture drawn, without the scene working out every object's place again first: the view's own render does
   * that each frame, and for a mirror it was half the cost (measured in the city: 4.7 ms a picture with it, 2.4
   * without). So a mirror shows things where they were a frame ago, which nobody can see.
   */
  private draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const auto = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    renderer.render(scene, this.camera);
    scene.matrixWorldAutoUpdate = auto;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
