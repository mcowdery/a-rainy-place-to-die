import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Bike } from '../poc3d/models/bikeKit';
import { setCharacterEnvironment } from '../poc3d/models/characters';
import { FirstPersonRig } from '../poc3d/models/firstPerson';
import { rollWindows, type CarView } from './carView';
import { EYE } from './shooting';
import type { Car } from './vehicle';

/**
 * Mack at the wheel of your car on the race page (models/firstPerson.ts): seated with his eyes at the driver's
 * eye (`EYE`, right-hand drive), feet to the pedals, both hands on the steering wheel, which turns with the
 * steering. Raising his shotgun (the page's weapon 'shotgun') takes the right hand off the wheel and the gun out
 * of whichever window you aim through, arm straight; the window rolls down first and back up after. The other
 * weapons' arm (shooting.ts) still rolls the windows. Shown with his head except in the driver's-eye view.
 */

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** In the seat's frame (the car's turned half round, so -z is forward and +x the driver's right, as a bike's). */
const WHEEL_C = v(-EYE.x, 0.9, -0.44);
const WHEEL_N = v(0, 0.343, -0.94).normalize();
const WHEEL_UP = v(0, 0.94, 0.343).normalize();
const WHEEL_R = 0.18;
/** Steering wheel turns per road-wheel turn. */
const RATIO = 4;
/** How fast a window winds (fraction a second), and how long after the gun's down it waits to wind up (s). */
const WIND = 1.8;
const WIND_UP_AFTER = 1.5;
const ENV_GAIN = 0.35;

export interface DriveView {
  /** The gun's up (aimed or fired from the hip) and Mack's to hold (the shotgun). */
  readonly raised: boolean;
  /** Any weapon out of a window (for the windows): which. */
  readonly window: 'driver' | 'across' | null;
  /** What he aims at. */
  readonly aimPoint: THREE.Vector3 | null;
  /** 0 outside, 1 the driver's-eye view (his head folded away). */
  readonly pov: number;
}

export class CarDriver {
  rig: FirstPersonRig | null = null;
  readonly mount: Bike;
  private readonly seat = new THREE.Group();
  private readonly eye = new THREE.PerspectiveCamera();
  private shots = 0;
  private winL = 0;
  private winR = 0;
  private sinceL = 99;
  private sinceR = 99;
  private wasRaised = false;

  private constructor(private readonly view: CarView) {
    this.seat.rotation.y = Math.PI;
    view.obj.add(this.seat);
    const steer = new THREE.Group();
    steer.position.copy(WHEEL_C);
    const inner = new THREE.Group();
    inner.position.copy(WHEEL_C).negate();
    steer.add(inner);
    this.seat.add(steer);
    const across = new THREE.Vector3().crossVectors(WHEEL_UP, WHEEL_N).normalize();
    const dummy = new THREE.MeshStandardMaterial();
    this.mount = {
      root: this.seat,
      steer,
      steerAxis: WHEEL_N.clone(),
      frontWheel: new THREE.Group(),
      rearWheel: new THREE.Group(),
      wheelRadius: { front: 0.3, rear: 0.3 },
      rider: {
        seat: v(-EYE.x, 0.35, 0.05),
        // Quarter to three: the rim either side of the hub, its tangent up the wheel.
        gripL: WHEEL_C.clone().addScaledVector(across, -WHEEL_R),
        gripR: WHEEL_C.clone().addScaledVector(across, WHEEL_R),
        gripAxisL: WHEEL_UP.clone(),
        gripAxisR: WHEEL_UP.clone(),
        palmL: across.clone().addScaledVector(WHEEL_N, 0.3).normalize(),
        palmR: across.clone().negate().addScaledVector(WHEEL_N, 0.3).normalize(),
        pegL: v(-EYE.x - 0.14, 0.18, -0.85),
        pegR: v(-EYE.x + 0.12, 0.18, -0.85),
        eye: v(-EYE.x, EYE.y, -EYE.z),
      },
      lamps: { head: dummy, tail: dummy },
    };
  }

  static create(view: CarView, scene: THREE.Scene, renderer: THREE.WebGLRenderer): CarDriver {
    const d = new CarDriver(view);
    const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    setCharacterEnvironment(env);
    void FirstPersonRig.load('mack', env).then((rig) => {
      rig.object.remove(rig.flashLight);
      rig.armed = false;
      rig.mounted = d.mount;
      rig.object.traverse((c) => {
        const m = (c as THREE.Mesh).material;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.envMap && !s.userData.dimmed) {
            s.envMapIntensity *= ENV_GAIN;
            s.userData.dimmed = true;
          }
        }
      });
      scene.add(rig.object);
      d.rig = rig;
      d.shots = rig.shotsFired;
    });
    return d;
  }

  /** Shots his gun fired since the last call. */
  newShots(): number {
    if (!this.rig) return 0;
    const n = this.rig.shotsFired - this.shots;
    this.shots = this.rig.shotsFired;
    return n;
  }

  /** The trigger: fires if the gun's up and ready (it's raised at once when you fire from the hip). */
  fire(): void {
    if (!this.rig) return;
    if (!this.rig.armed) this.rig.raise();
    this.rig.fire();
  }

  update(car: Car, dv: DriveView, dt: number, realDt: number): void {
    // The windows: down while a weapon is out of one, wound up a moment after.
    this.sinceL = dv.window === 'across' ? 0 : this.sinceL + realDt;
    this.sinceR = dv.window === 'driver' ? 0 : this.sinceR + realDt;
    const wind = (cur: number, since: number): number => {
      const want = since < WIND_UP_AFTER ? 1 : 0;
      return cur + Math.max(-WIND * realDt, Math.min(WIND * realDt, want - cur));
    };
    this.winL = wind(this.winL, this.sinceL);
    this.winR = wind(this.winR, this.sinceR);
    rollWindows(this.view, this.winL, this.winR);
    const rig = this.rig;
    if (!rig) return;
    this.view.obj.updateMatrixWorld(true);
    // The steering wheel turns with the road wheels (a left turn winds it anticlockwise, as the driver sees it).
    this.mount.steer.quaternion.setFromAxisAngle(WHEEL_N, -car.steer * RATIO);
    // Raised: the gun up at once (no upright hold in a car), the right hand off the wheel.
    if (dv.raised && !this.wasRaised) rig.raise();
    rig.armed = dv.raised;
    rig.aiming = dv.raised;
    this.wasRaised = dv.raised;
    // His eyes: the driver's, looking at what he aims at, else ahead.
    this.eye.position.copy(this.view.obj.localToWorld(v(EYE.x, EYE.y, EYE.z)));
    const ahead = this.eye.position.clone().add(v(Math.sin(car.h), -0.08, Math.cos(car.h)));
    this.eye.lookAt(dv.raised && dv.aimPoint ? dv.aimPoint : ahead);
    this.eye.updateMatrixWorld();
    rig.setHeadless(dv.pov > 0.5);
    rig.update(dt, this.eye, 0, 0);
  }
}
