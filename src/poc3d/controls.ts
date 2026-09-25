import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Box } from './block';

const EYE = 1.7;
const RADIUS = 0.4;
const WALK = 4.5; // m/s: brisk game-walk, not realistic 1.4 m/s
const RUN = 9;
const BOUNDS = 150;

/** First-person WASD + mouse-look, with circle-vs-AABB collision resolved per axis (so you slide along walls). */
export class FirstPerson {
  readonly look: PointerLockControls;
  private keys = new Set<string>();
  private bob = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly colliders: readonly Box[],
  ) {
    this.look = new PointerLockControls(camera, dom);
    camera.position.set(0, EYE, 38);
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  update(dt: number): void {
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

  private blocked(x: number, z: number): boolean {
    if (Math.abs(x) > BOUNDS || Math.abs(z) > BOUNDS) return true;
    return this.colliders.some((b) => x > b.minX - RADIUS && x < b.maxX + RADIUS && z > b.minZ - RADIUS && z < b.maxZ + RADIUS);
  }
}
