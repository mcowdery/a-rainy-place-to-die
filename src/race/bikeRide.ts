import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Bike } from '../poc3d/models/bikeKit';
import { buildBosozoku } from '../poc3d/models/bosozoku';
import { setCharacterEnvironment } from '../poc3d/models/characters';
import { buildCruiser, CRUISER_LOOKS } from '../poc3d/models/cruiser';
import type { FirstPersonRig } from '../poc3d/models/firstPerson';
import { loadDressed } from '../poc3d/models/wardrobe';
import type { ShotgunKind } from '../poc3d/models/shotgun';
import { buildSportBike, SPORT_LOOKS } from '../poc3d/models/sportbike';
import type { SoundProfile } from './catalog';
import type { Car, CarSpec, Ground } from './vehicle';

/**
 * Riding a motorcycle on the race page (`?ride=cruiser|cruiser-silver|bosozoku`): the bike runs on the same
 * handling model as the cars (vehicle.ts is a bicycle model: a motorcycle is the real thing), so it grips,
 * slides and drifts like they do, with a spec of its own (`BIKES`). This draws it: the bike posed from the car
 * model's state (leaning into the lateral acceleration, so it lays over in a drift; pitched with the ground;
 * the bars turning with the steering, countersteer and all; the wheels rolling), Mack seated on it
 * (models/firstPerson.ts) with the shotgun when it's out (X), and the camera: first person from his eyes, or
 * third person behind the bike with his head shown.
 */

export type BikeId = 'cruiser' | 'cruiser-silver' | 'bosozoku' | 'hayate' | 'hayate-white' | 'hayate-red';

export interface BikeDef {
  readonly name: string;
  readonly spec: CarSpec;
  readonly sound: SoundProfile;
  readonly build: (env: THREE.Texture | null) => Bike;
  /** The gun Mack carries on it (X draws it): the cruiser's shotgun, the sports bike's Type 54. */
  readonly gun: ShotgunKind;
}

/** The Kaiun Raijin 1600: heavy, torquey, long; slides when provoked and holds a slide on the throttle. */
const CRUISER_SPEC: CarSpec = {
  mass: 390,
  a: 0.86,
  b: 0.78,
  cgHeight: 0.62,
  inertia: 1.0,
  power: 55000,
  maxDrive: 4300,
  brake: 0.95,
  brakeFront: 0.68,
  drag: 0.3,
  rolling: 60,
  gripFront: 1.05,
  gripRear: 1.08,
  B: 9,
  C: 1.35,
  lock: 0.55,
  lockHalf: 20,
  steerRate: 3.0,
  handbrakeGrip: 0.42,
  reverse: 3,
  shift: [11, 19, 27, 35, 999],
  size: [1.15, 0.45],
  twoWheels: true,
};

/** The Ōmi Hayate 900RR: light, short, a lot of power, quick to turn; grips harder, slides when you make it. */
const SPORT_SPEC: CarSpec = {
  ...CRUISER_SPEC,
  mass: 290,
  a: 0.72,
  b: 0.68,
  cgHeight: 0.6,
  power: 95000,
  maxDrive: 4200,
  brake: 1.15,
  brakeFront: 0.72,
  drag: 0.26,
  gripFront: 1.15,
  gripRear: 1.14,
  lock: 0.5,
  lockHalf: 26,
  steerRate: 3.6,
  shift: [16, 27, 37, 47, 56, 999],
  size: [1.05, 0.4],
};

/** The bōsōzoku 400: lighter, revvier, less pull. */
const BOSO_SPEC: CarSpec = { ...CRUISER_SPEC, mass: 300, a: 0.74, b: 0.7, power: 38000, maxDrive: 3300, gripRear: 1.04, lock: 0.6, shift: [12, 20, 28, 36, 999], size: [1.05, 0.42] };

export const BIKES: Record<BikeId, BikeDef> = {
  cruiser: { name: 'Kaiun Raijin 1600', spec: CRUISER_SPEC, sound: { maxRpm: 5600, fire: 1, buzz: 0.2 }, build: (env) => buildCruiser(env, CRUISER_LOOKS.black), gun: 'lever' },
  'cruiser-silver': { name: 'Kaiun Raijin 1600 (silver)', spec: CRUISER_SPEC, sound: { maxRpm: 5600, fire: 1, buzz: 0.2 }, build: (env) => buildCruiser(env, CRUISER_LOOKS.silver), gun: 'lever' },
  bosozoku: { name: 'Seika Shiden 400F', spec: BOSO_SPEC, sound: { maxRpm: 10500, fire: 2, buzz: 0.6 }, build: (env) => buildBosozoku(env), gun: 'lever' },
  hayate: { name: 'Ōmi Hayate 900RR', spec: SPORT_SPEC, sound: { maxRpm: 11500, fire: 2, buzz: 0.75 }, build: (env) => buildSportBike(env, SPORT_LOOKS.black), gun: 'pistol' },
  'hayate-white': { name: 'Ōmi Hayate 900RR (white)', spec: SPORT_SPEC, sound: { maxRpm: 11500, fire: 2, buzz: 0.75 }, build: (env) => buildSportBike(env, SPORT_LOOKS.white), gun: 'pistol' },
  'hayate-red': { name: 'Ōmi Hayate 900RR (red and black)', spec: SPORT_SPEC, sound: { maxRpm: 11500, fire: 2, buzz: 0.75 }, build: (env) => buildSportBike(env, SPORT_LOOKS.redblack), gun: 'pistol' },
};

export function bikeIdOf(p: string | null): BikeId | null {
  return p && p in BIKES ? (p as BikeId) : null;
}

/** How bright the studio-light reflections are at the venues (their nights are dark). */
const ENV_GAIN = 0.35;
/** The most the bike leans over (rad). */
const MAX_LEAN = 0.85;

export interface RideView {
  /** First person (Mack's eyes) or third (behind the bike). */
  readonly third: boolean;
  /** Raising the gun, and where (world yaw: 0 along +z; pitch up positive). */
  readonly aiming: boolean;
  readonly aimYaw: number;
  readonly aimPitch: number;
  /** Looking about, relative to the bike (yaw left positive; pitch up positive). */
  readonly orbitYaw: number;
  readonly lookPitch: number;
}

export class BikeRide {
  readonly bike: Bike;
  readonly def: BikeDef;
  rig: FirstPersonRig | null = null;
  /** Mack's eyes, oriented where he looks (the rig places the gun from it); the render camera follows it in
   * first person. */
  private readonly eye = new THREE.PerspectiveCamera();
  lean = 0;
  private shots = 0;
  /** The gun he had before he got on, back in his hand when he gets off. */
  private footGun: ShotgunKind = 'lever';
  private readonly chase = new THREE.Vector3();
  private chaseSet = false;

  private constructor(readonly id: BikeId, bike: Bike) {
    this.def = BIKES[id];
    this.bike = bike;
  }

  /** Seats a rider on this bike: its gun to hand (put away), its helmet on if it has one. */
  mount(rig: FirstPersonRig): void {
    this.rig = rig;
    this.shots = rig.shotsFired;
    rig.mounted = this.bike;
    rig.armed = false;
    rig.aiming = false;
    this.footGun = rig.kind;
    rig.setKind(this.def.gun);
    rig.setHelmet(this.bike.rider.helmet ?? rig.wornHelmet ?? false);
  }

  /** The rider gets off: the bike's helmet comes off (his own stays on), his own gun back in hand. */
  unmount(): void {
    if (!this.rig) return;
    this.rig.mounted = null;
    this.rig.setHelmet(this.rig.wornHelmet ?? false);
    this.rig.setKind(this.footGun);
  }

  /** Over a bike and a rider made elsewhere (the city's: its own rig, the bike in its parent). */
  static from(id: BikeId, bike: Bike, rig: FirstPersonRig | null): BikeRide {
    const r = new BikeRide(id, bike);
    r.rig = rig;
    if (rig) r.shots = rig.shotsFired;
    return r;
  }

  /** The bike's model, its reflections dimmed for the night. */
  static buildBike(id: BikeId, env: THREE.Texture | null): Bike {
    const b = BIKES[id].build(env);
    dimEnv(b.root);
    return b;
  }

  static specOf(id: BikeId): CarSpec {
    return BIKES[id].spec;
  }

  static create(id: BikeId, scene: THREE.Scene, renderer: THREE.WebGLRenderer): BikeRide {
    const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const ride = new BikeRide(id, BikeRide.buildBike(id, env));
    scene.add(ride.bike.root);
    setCharacterEnvironment(env);
    void loadDressed(env).then((rig) => {
      // Its own muzzle light stays out (a new light recompiles every shader); the page's shooting flashes.
      rig.object.remove(rig.flashLight);
      dimEnv(rig.object);
      scene.add(rig.object);
      ride.mount(rig);
    });
    return ride;
  }

  /** Shots that went off since the last call (the rig can fire inside its update, swinging down first). */
  newShots(): number {
    if (!this.rig) return 0;
    const n = this.rig.shotsFired - this.shots;
    this.shots = this.rig.shotsFired;
    return n;
  }

  /** Poses the bike from the car model's state. */
  pose(car: Car, ground: Ground, dt: number): void {
    const b = this.bike.root;
    // Lean into the lateral acceleration (left positive), as far as gravity balances it.
    const want = THREE.MathUtils.clamp(Math.atan2(car.ay, 9.81), -MAX_LEAN, MAX_LEAN);
    this.lean += (want - this.lean) * Math.min(1, dt * 6);
    // Pitch with the ground under the wheels.
    const L = 0.82;
    const hf = ground.height(car.x + Math.sin(car.h) * L, car.z + Math.cos(car.h) * L);
    const hr = ground.height(car.x - Math.sin(car.h) * L, car.z - Math.cos(car.h) * L);
    const pitch = Math.atan2(hf - hr, 2 * L);
    b.position.set(car.x, car.y, car.z);
    // The bike's forward is its -z: turned by h + pi it lies along (sin h, cos h). Leaning left tips its top
    // toward -x, a turn about +z.
    b.quaternion
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.h + Math.PI)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean));
    this.bike.steer.quaternion.setFromAxisAngle(this.bike.steerAxis, car.steer);
    this.bike.frontWheel.rotation.x -= (car.u * dt) / this.bike.wheelRadius.front;
    this.bike.rearWheel.rotation.x -= (car.u * dt) / this.bike.wheelRadius.rear;
    b.updateMatrixWorld(true);
  }

  /** Seats Mack, works his gun and places the camera. `dt` is the world's step (slow motion slows the gun). */
  update(car: Car, camera: THREE.PerspectiveCamera, v: RideView, dt: number, realDt: number, groundAt: (x: number, z: number) => number): void {
    const rig = this.rig;
    const h = car.h;
    const up = new THREE.Vector3(0, 1, 0);
    const bikeQ = new THREE.Quaternion().setFromAxisAngle(up, h + Math.PI).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.lean * 0.5));
    const aimDir = new THREE.Vector3(Math.sin(v.aimYaw) * Math.cos(v.aimPitch), Math.sin(v.aimPitch), Math.cos(v.aimYaw) * Math.cos(v.aimPitch));
    // Mack's eyes: on the seat, looking along the aim when the gun's up, else ahead and wherever you look.
    const eyePos = rig ? rig.seatBody(this.bike) : this.bike.root.localToWorld(new THREE.Vector3(0, 1.55, 0.2));
    this.eye.position.copy(eyePos);
    if (v.aiming && rig?.armed) this.eye.quaternion.setFromEuler(new THREE.Euler(v.aimPitch, v.aimYaw + Math.PI, 0, 'YXZ'));
    // (Tucked in on a sports bike the view drops a little, the screen and the dash at its foot.)
    else this.eye.quaternion.copy(bikeQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(v.lookPitch - 0.08 - 0.12 * (this.bike.rider.tuck ?? 0), v.orbitYaw, 0, 'YXZ')));
    this.eye.updateMatrixWorld();
    if (rig) {
      rig.setHeadless(!v.third);
      rig.update(dt, this.eye, 0, 0);
    }
    if (!v.third) {
      camera.position.copy(this.eye.position);
      camera.quaternion.copy(this.eye.quaternion);
      this.chaseSet = false;
      return;
    }
    // Third person: behind the bike (or over Mack's right shoulder with the gun up, looking at what he aims at).
    if (v.aiming && rig?.armed) {
      const right = new THREE.Vector3(-Math.cos(v.aimYaw), 0, Math.sin(v.aimYaw)).negate();
      const at = eyePos.clone().addScaledVector(aimDir, 25);
      const p = eyePos.clone().addScaledVector(right, 0.55).addScaledVector(up, 0.22).addScaledVector(aimDir, -1.7);
      this.chase.lerp(p, this.chaseSet ? 1 - Math.exp(-realDt * 14) : 1);
      camera.position.copy(this.chase);
      camera.lookAt(at);
    } else {
      const a = h + v.orbitYaw;
      const back = 3.9 * Math.cos(v.lookPitch);
      const p = new THREE.Vector3(car.x - Math.sin(a) * back, car.y + 1.75 - Math.sin(v.lookPitch) * 3.5, car.z - Math.cos(a) * back);
      p.y = Math.max(p.y, groundAt(p.x, p.z) + 0.5);
      this.chase.lerp(p, this.chaseSet ? 1 - Math.exp(-realDt * 6) : 1);
      camera.position.copy(this.chase);
      camera.lookAt(car.x + Math.sin(a) * 4, car.y + 1.15, car.z + Math.cos(a) * 4);
    }
    this.chaseSet = true;
  }
}

/** Studio reflections down for the venues' night. */
function dimEnv(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.envMap && !s.userData.dimmed) {
        s.envMapIntensity *= ENV_GAIN;
        s.userData.dimmed = true;
      }
    }
  });
}
