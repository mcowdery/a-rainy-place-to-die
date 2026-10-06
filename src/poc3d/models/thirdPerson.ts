import * as THREE from 'three';
import { AIM_RANGE } from './firstPerson';

/**
 * Mack in third person: the camera over his right shoulder, turning freely round him (the user's direction,
 * 2026-10-05: the camera mustn't force him to turn). He faces the way he last went (`BodyFacing`), turning to
 * where you look only when he has to: a gun raised or fired. So the camera can come round to his front; his
 * face stays in shadow whatever the angle (models/faceShadow.ts). The page keeps the camera at his eyes for
 * everything it does (walking, streaming, sound, aiming) and calls `place` just before rendering, `restore`
 * just after (or at the start of the next frame): the view is rendered from behind the eyes, which stay where
 * they were.
 */

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Which way his body faces, apart from where the camera looks. `update` returns a stand-in for the camera to pose
 * the rig with (models/firstPerson.ts `update` reads the eyes and the facing from the camera it's given): at his
 * eyes, turned the way his body is. In first person ('eyes') that is the view itself. In third person he turns to
 * the way he's moving ('free': walking toward the camera you see his front) and stands as he was when he stops;
 * with a gun raised he turns to the view ('view'), and `snap` puts him there at once (a shot from the hip).
 */
export class BodyFacing {
  /** His heading (rad: 0 faces +z, as the rig's). */
  yaw = 0;
  private known = false;
  private readonly stand = new THREE.PerspectiveCamera();
  private readonly dir = new THREE.Vector3();

  /** Turned to the view now. */
  snap(camera: THREE.Camera, pitch?: number): void {
    const f = camera.getWorldDirection(this.dir);
    this.yaw = Math.atan2(f.x, f.z);
    this.known = true;
    void pitch;
  }

  private shots = -1;
  private hold = 0;
  /**
   * How he should face this frame: in first person as the view; in third person the way he goes, unless he has a
   * gun up, his fists or a sword out, or has just fired (he turns to the shot and stays on it a moment).
   */
  modeFor(third: boolean, rig: { readonly aiming: boolean; readonly aim: number; readonly shotsFired: number; readonly melee: unknown }, dt: number): 'eyes' | 'view' | 'free' {
    if (this.shots >= 0 && rig.shotsFired !== this.shots) this.hold = 1.5;
    this.shots = rig.shotsFired;
    this.hold = Math.max(0, this.hold - dt);
    if (!third) return 'eyes';
    return rig.aiming || rig.aim > 0.05 || !!rig.melee || this.hold > 0 ? 'view' : 'free';
  }

  /** Forgotten (he wasn't on foot: next time he starts out facing the view). */
  reset(): void {
    this.known = false;
  }

  /**
   * `mode`: 'eyes' first person, 'view' third person facing where you look, 'free' third person facing the way he
   * goes. (vx, vz): his velocity (m/s). `pitch`: the view's, where the camera itself doesn't pitch.
   */
  update(dt: number, camera: THREE.Camera, mode: 'eyes' | 'view' | 'free', vx: number, vz: number, pitch?: number): THREE.Camera {
    const f = camera.getWorldDirection(this.dir);
    const viewYaw = Math.atan2(f.x, f.z);
    const viewPitch = pitch ?? Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
    if (mode === 'eyes' || !this.known) {
      this.yaw = viewYaw;
      this.known = true;
    } else if (mode === 'view') this.yaw += wrap(viewYaw - this.yaw) * Math.min(1, dt * 16);
    else if (Math.hypot(vx, vz) > 0.5) this.yaw += wrap(Math.atan2(vx, vz) - this.yaw) * Math.min(1, dt * 9);
    // His head and chest go with the view up and down only as far as he's facing it.
    const facing = Math.max(0, Math.cos(viewYaw - this.yaw));
    this.stand.position.copy(camera.position);
    this.stand.rotation.set(viewPitch * (mode === 'free' ? 0.7 * facing : 1), this.yaw + Math.PI, 0, 'YXZ');
    this.stand.updateMatrixWorld(true);
    return this.stand;
  }
}

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
