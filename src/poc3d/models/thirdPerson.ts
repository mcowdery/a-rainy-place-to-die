import * as THREE from 'three';
import { AIM_RANGE } from './firstPerson';

/**
 * Mack in third person: the camera over his right shoulder, always behind him. His body faces where you
 * look (models/firstPerson.ts poses it from the view), so the camera never comes round to his face; the face
 * itself stays in shadow anyway (models/faceShadow.ts). The page keeps the camera at his eyes for everything
 * it does (walking, streaming, sound, aiming) and calls `place` just before rendering, `restore` just after
 * (or at the start of the next frame): the view is rendered from behind him, the eyes stay where they were.
 */

/** Where the camera sits behind the eyes (metres): `back` along the view, `side` to the right, `up`. */
export interface ThirdOffset {
  back: number;
  side: number;
  up: number;
}

/** On foot, raising a gun (closer, more over the shoulder) and riding (behind the bike, higher). */
export const THIRD: { foot: ThirdOffset; aim: ThirdOffset; ride: ThirdOffset } = {
  foot: { back: 2.3, side: 0.42, up: 0.12 },
  aim: { back: 1.25, side: 0.5, up: 0.06 },
  ride: { back: 3.4, side: 0, up: 0.55 },
};

/** The on-foot offset with a gun raised by `aim` (0..1). */
export function footOffset(aim: number): ThirdOffset {
  const f = THIRD.foot;
  const a = THIRD.aim;
  return { back: f.back + (a.back - f.back) * aim, side: f.side + (a.side - f.side) * aim, up: f.up + (a.up - f.up) * aim };
}

/** How far the way is clear from `from` along the unit `dir`, up to `max` (metres). */
export type ClearFn = (from: THREE.Vector3, dir: THREE.Vector3, max: number) => number;

export class ThirdPersonCamera {
  private saved: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  private dist = 0;

  /** The eyes while the camera is behind him (between `place` and `restore`), else null. */
  get eyes(): THREE.Vector3 | null {
    return this.saved?.p ?? null;
  }

  /**
   * Moves the camera from the eyes to behind him for this frame's render: the shoulder point first (a wall at
   * his side pulls it in), then straight back from it (a wall behind pulls it in at once; it eases back out),
   * aimed at the point AIM_RANGE along the view so the crosshair in the middle of the screen is where the gun
   * points.
   */
  place(camera: THREE.Camera, at: ThirdOffset, dt: number, clear: ClearFn): void {
    if (this.saved) this.restore(camera);
    const eye = camera.position.clone();
    const q = camera.quaternion.clone();
    this.saved = { p: eye, q };
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const target = eye.clone().addScaledVector(back, -AIM_RANGE);
    const shoulder = eye.clone().addScaledVector(up, at.up);
    if (at.side > 0) shoulder.addScaledVector(right, Math.max(0, Math.min(at.side, clear(shoulder, right, at.side + 0.15) - 0.15)));
    const most = Math.max(0.3, Math.min(at.back, clear(shoulder, back, at.back + 0.2) - 0.2));
    this.dist = this.dist <= 0 || most < this.dist ? most : this.dist + (most - this.dist) * Math.min(1, dt * 5);
    camera.position.copy(shoulder).addScaledVector(back, this.dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  /** Puts the camera back at the eyes; returns whether it had been moved. */
  restore(camera: THREE.Camera): boolean {
    if (!this.saved) return false;
    camera.position.copy(this.saved.p);
    camera.quaternion.copy(this.saved.q);
    camera.updateMatrixWorld();
    this.saved = null;
    return true;
  }

  /** Forgets the distance (after a teleport: the next frame starts at the full distance). */
  reset(): void {
    this.dist = 0;
  }
}
