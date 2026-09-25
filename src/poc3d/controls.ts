import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Box } from './block';

const EYE = 1.7;
const RADIUS = 0.4;
const WALK = 4.5; // m/s: brisk game-walk, not realistic 1.4 m/s
const RUN = 9;
const BOUNDS = 150;
const MAX_SHEAR = 1.6;

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

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly colliders: readonly Box[],
  ) {
    this.look = new PointerLockControls(camera, dom);
    camera.position.set(0, EYE, 38);
    this.setShearMode(true);
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.look.isLocked || !this.shearOn) return;
      this.shear = THREE.MathUtils.clamp(this.shear - e.movementY * 0.002 * this.look.pointerSpeed, -MAX_SHEAR, MAX_SHEAR);
    });
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

  update(dt: number): void {
    this.applyProjection();
    const k = this.keys;
    const f = Number(k.has('KeyW') || k.has('ArrowUp')) - Number(k.has('KeyS') || k.has('ArrowDown'));
    const r = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    const pos = this.camera.position;
    if (f === 0 && r === 0) {
      pos.y = EYE;
      return;
    }
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, this.camera.up).normalize();
    const move = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize();
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK;
    const dx = move.x * speed * dt;
    const dz = move.z * speed * dt;
    if (!this.blocked(pos.x + dx, pos.z)) pos.x += dx;
    if (!this.blocked(pos.x, pos.z + dz)) pos.z += dz;
    this.bob += dt * speed * 1.8;
    pos.y = EYE + Math.sin(this.bob) * 0.04;
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

  private blocked(x: number, z: number): boolean {
    if (Math.abs(x) > BOUNDS || Math.abs(z) > BOUNDS) return true;
    return this.colliders.some((b) => x > b.minX - RADIUS && x < b.maxX + RADIUS && z > b.minZ - RADIUS && z < b.maxZ + RADIUS);
  }
}
