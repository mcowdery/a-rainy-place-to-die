import * as THREE from 'three';
import { loadCharacterModel } from './characters';
import type { Bike } from './bikeKit';
import { buildHelmet, HELMET_LOOK, type HelmetLook } from './helmet';
import { buildGlasses, type GlassesKind } from './sunglasses';
import type { FaceOnScreen } from './censorPass';
import { type FaceStyle, setFaceMode } from './faceShadow';
import { buildRoboHelmet } from './roboHelmet';
import { buildShotgun, SHOTGUN_KINDS, type HandHold, type Shotgun, type ShotgunKind } from './shotgun';
import { buildKatana, type Katana } from './katana';
import { Footfalls, gaitBob, legPose, STRIDE_HZ, type Foot } from './gait';
import { swordQuat, type Hitter, type Melee, type MeleePose, type SwordKey } from './melee';

/**
 * Seeing yourself in first person (full-body awareness), for the fights: a cast model (Mack) under the
 * camera with its head folded away, the upper body bending with the view so the arms keep up, the hands on
 * the gun by two-bone IK with the fingers closed round it, and the legs standing or walking, so looking
 * down shows the jacket, the jeans and the boots. The gun is held in the camera's frame, low or raised to
 * aim, two-handed or in the right hand alone (`oneHand`: the arm out to aim, the left arm hanging, a harder
 * kick), and kicks when fired. The lever-action's lever is thrown after each shot with the right hand riding
 * it, or held one-handed, the gun is spun forward round the loop to work it (the flip-cock). Not in the
 * district yet: reviewed in the showroom's first-person mode.
 */

/** How far the body stands behind the eyes, so the chest isn't in the view looking ahead (metres). */
const BACK = 0.03;
/** And this much further per radian of looking down, so the view down clears the collar. */
const BACK_DOWN = 0.08;
/** And this much more per radian past about 40 degrees down. */
const BACK_STEEP = 0.32;
/** Where the gun is held, in the camera's frame: low (at the hip, muzzle down) and raised to aim, with both
 * hands, and in the right hand alone (low: upright at his side, muzzle to the sky, the forearm forward, as
 * in the films; aimed: swung down level, the arm out straight). */
const HOLD = {
  low: { pos: new THREE.Vector3(0.15, -0.22, -0.23), rot: new THREE.Euler(-0.14, 0.12, 0.12, 'YXZ') },
  aim: { pos: new THREE.Vector3(0.08, -0.16, -0.25), rot: new THREE.Euler(0.014, 0.007, -0.05, 'YXZ') },
  oneLow: { pos: new THREE.Vector3(0.25, -0.29, -0.2), rot: new THREE.Euler(1.48, -0.05, 0, 'YXZ') },
  // Running, in the body's frame (heading only): low at the right hip, muzzle forward and down.
  run: { pos: new THREE.Vector3(0.22, -0.6, -0.12), rot: new THREE.Euler(-0.45, 0.08, 0.12, 'YXZ') },
  oneAim: { pos: new THREE.Vector3(0.16, -0.2, -0.5), rot: new THREE.Euler(0.012, 0.016, -0.12, 'YXZ') },
};
/** How straight the arm is aimed one-handed: the wrist at this share of the arm's full reach. */
const EXTEND = 0.995;
/** How far ahead the crosshair's target is taken to be, for the raised gun to point at (metres). */
export const AIM_RANGE = 25;
/** The flip-cock: how long the spin takes, the point it turns about (gun frame: the loop, round the fingers
 * in it), and its axis, the gun's x tipped so the barrel swings round outside the forearm, not through it. */
const FLIP_TIME = 0.6;
const FLIP_PIVOT = new THREE.Vector3(0, -0.065, 0.07);
const FLIP_AXIS = new THREE.Vector3(Math.cos(-0.3), 0, Math.sin(-0.3));
/** From where a hold says the palm goes to where the wrist (the hand bone) goes: back along the hand and
 * off the gun's surface. */
const PALM_BACK = 0.055;
const PALM_OFF = 0.032;

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
/** Closing the fingers on a hold: a finger's thickness, the step each knuckle turns by, how far each of the
 * three knuckles may turn (times the hold's `curl`), and the trigger finger's looser limits. */
const FINGER_R = 0.008;
const CURL_STEP = 0.06;
const CURL_LIMIT = [1.3, 1.5, 1.1];
const TRIGGER_LIMIT = [0.55, 0.85, 0.5];
/** How much of the hand's roll the forearm takes. */
const TWIST_SHARE = 0.6;
/** A relaxed hand's finger joints (index to little finger, knuckle to tip), radians. */
const RELAXED = [[0.3, 0.45, 0.3], [0.38, 0.55, 0.35], [0.45, 0.62, 0.4], [0.55, 0.7, 0.45]];
/** Riding: the pelvis this far above the seat's middle (and back of it), the ankle above the peg. */
const RIDE_SEAT_UP = 0.11;
const RIDE_SEAT_BACK = 0.0;
const RIDE_ANKLE = 0.09;
/** How far the hand on a grip tips down over it (the slope of its forward, per unit forward). */
const GRIP_TIP = 0.25;
/** How far the arms swing forward and back running (metres at the hand). */
const RUN_PUMP = 0.13;
/** How far each thumb joint may turn closing over a hold (times twice the hold's `thumb`). */
const THUMB_LIMIT = [1.0, 0.9, 0.9];
/** A fist: each finger's joints closed tight (index to little), the thumb across the front. */
const FIST = [[1.35, 1.65, 1.0], [1.4, 1.7, 1.0], [1.45, 1.7, 1.0], [1.5, 1.6, 0.95]];
/** The saya at the left hip (the body's frame, metres at Mack's size, +x his left, +z ahead): its mouth ahead
 * of the hip, the scabbard running back and down, the edge up, as a katana is worn through the belt. */
const SAYA_MOUTH = new THREE.Vector3(0.17, 0.98, 0.16);
const SAYA_DIR = new THREE.Vector3(0.1, -0.36, -1).normalize();
const SAYA_EDGE = new THREE.Vector3(0, 1, -0.36).normalize();
const FIGURE_BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];

interface Turnable {
  readonly bone: THREE.Bone;
  /** The figure's x, y and z axes in the bone's parent space at rest. */
  readonly axes: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

interface Arm {
  readonly side: 'l' | 'r';
  readonly upper: THREE.Bone;
  readonly lower: THREE.Bone;
  readonly hand: THREE.Bone;
  /** The hand's world orientation at rest and its rest frame (columns: forward, across, palm normal). */
  readonly q0: THREE.Quaternion;
  readonly frame0: THREE.Matrix4;
  readonly fingers: THREE.Bone[][];
  readonly thumb: THREE.Bone[];
}

const _foot = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/** A gun's turn so its bore (-z) lies along `dir`, its top toward `up`, rolled by `roll` about the bore. */
/** The world's own frame, for a hold given in world space. */
const WORLD = new THREE.Object3D();

function aimQuaternion(dir: THREE.Vector3, up: THREE.Vector3, roll: number): THREE.Quaternion {
  const z = dir.clone().normalize().negate();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
}

/** An arm's upper and lower lengths as it stands (world units, so they follow any scale on the body). */
type Limb = Pick<Arm, 'upper' | 'lower' | 'hand'>;

function armLengths(arm: Limb): [number, number] {
  const S = arm.upper.getWorldPosition(new THREE.Vector3());
  const E = arm.lower.getWorldPosition(new THREE.Vector3());
  return [S.distanceTo(E), E.distanceTo(arm.hand.getWorldPosition(new THREE.Vector3()))];
}

/** Rotates a bone so the world direction `from` points along `to`, about the bone's own pivot. */
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  const parent = bone.parent!.getWorldQuaternion(_q2);
  _q.setFromUnitVectors(_a.copy(from).normalize(), _b.copy(to).normalize());
  bone.quaternion.premultiply(parent.clone().invert().multiply(_q).multiply(parent));
}

/** An orthonormal frame (columns: forward, across = palm x forward, palm normal) from a forward and a palm normal. */
function handFrame(fwd: THREE.Vector3, palm: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 {
  const f = _c.copy(fwd).normalize();
  const n = _d.copy(palm).addScaledVector(f, -palm.dot(f)).normalize();
  const a = new THREE.Vector3().crossVectors(n, f);
  return out.makeBasis(f, a, n);
}

export class FirstPersonRig {
  /** Add this to the scene: the body and the gun, posed in world space each update. */
  readonly object = new THREE.Group();
  readonly body = new THREE.Group();
  readonly guns: Record<ShotgunKind, Shotgun>;
  kind: ShotgunKind = 'lever';
  /** Raised to aim (0 low, 1 up); eased toward `aiming`. */
  aim = 0;
  aiming = false;
  /** Holding a gun (else hands free). */
  armed = true;
  /** Shots fired so far (a shot can go off inside `update`, the gun swung down from upright): the page
   * compares it each frame and makes the shot (`muzzle()`, `aimDir()`). */
  shotsFired = 0;
  /** The head folded away (first person); off for a third-person view, its shadow then the body's own. */
  private headless = true;
  /** The bike you're on (`update` seats you on it; the camera should be at `seatBody`'s eye point). */
  mounted: Bike | null = null;
  private rideTwist = 0;
  /** One-handed and upright, a shot waits for the gun to swing down level (`snap` holds it there a moment). */
  private queued = false;
  private snap = 0;
  /** Held in the right hand alone; `one` eases toward it. */
  oneHand = false;
  private one = 0;
  /** The lever's cycle after a shot is a spin (flip-cock), not a throw. */
  private flip = false;
  /** For checks: the finger-curl sign the last hold found. */
  lastSign = 0;
  private kick = 0;
  private kickV = 0;
  private flashT = 0;
  private lever = 0;
  private leverT = -1;
  private walk = 0;
  private speedNow = 0;
  private runNow = 0;
  /** Each foot as it lands walking or running (models/gait.ts): which, where its ankle is in the world, how much
   * of a run it is (0..1) and how full the stride (0..1). The page makes the step's sound from it. */
  onFootfall: ((foot: Foot, at: THREE.Vector3, run: number, stride: number) => void) | null = null;
  private readonly footfalls = new Footfalls();
  /** Carrying the gun running, eased (0 held, 1 carried). */
  private carry = 0;
  private stride = 0;
  private loaded: number;
  private reloadT = 0;
  private readonly rest = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly turnable = new Map<string, Turnable>();
  private readonly arms: Record<'l' | 'r', Arm>;
  private readonly head: THREE.Bone;
  /** The head bone's rest frame inverted (the model's own frame), for putting things on the head. */
  private readonly headRestInv: THREE.Matrix4;
  private helmets: [THREE.Object3D, THREE.Object3D] | null = null;
  private helmetLook: HelmetLook | null = null;
  /** The helmet he wears on foot (models/wardrobe.ts), or null: kept on riding a bike with no helmet of its own,
   * and back on when he gets off one that had its own. */
  wornHelmet: HelmetLook | null = null;
  /** Sunglasses on the head (and the shadow's head), if any: hidden under a helmet. */
  private glasses: [THREE.Object3D, THREE.Object3D] | null = null;
  glassesKind: GlassesKind | null = null;
  /** How his face is hidden (models/faceShadow.ts): the skin's style, and what goes over it here: the censor bar
   * (a black bar that always faces the camera, over his eyes) or the RoboCop helmet (on the head, and the shadow's). */
  faceStyle: FaceStyle = 'shadow';
  private faceBar: THREE.Mesh | null = null;
  private robo: [THREE.Object3D, THREE.Object3D] | null = null;
  private readonly env: THREE.Texture | null;
  /** The model it was loaded from (an outfit: models/wardrobe.ts), and the eye height it was fitted to. */
  model = 'mack';
  private fitHeight: number | null = null;
  /** Hair, brows and lashes: hidden under a helmet. */
  private readonly hairMeshes: THREE.Object3D[] = [];
  private readonly legs: Record<'l' | 'r', Limb>;
  /** The pelvis at rest, and the eyes from the neck at rest (the model's own frame, unscaled). */
  private readonly pelvisRest: THREE.Vector3;
  private readonly eyeFromNeck: THREE.Vector3;
  private readonly neck: THREE.Bone;
  /** The eyes above the feet and ahead of the body's origin, at rest. */
  private eyeY: number;
  private eyeZ: number;
  private readonly eyeY0: number;
  private readonly eyeZ0: number;
  /** A second copy of the body that keeps its head: never drawn (its materials write nothing), it only
   * casts the shadow, posed like the body each frame with the head looking where the camera does. */
  private readonly shadowBody = new THREE.Group();
  private readonly shadowPairs: [THREE.Bone, THREE.Bone][] = [];
  private readonly shadowHead: Turnable[] = [];
  readonly flash: THREE.Sprite;
  readonly flashLight = new THREE.PointLight(0xffc070, 0, 9, 2);
  /** His katana (models/katana.ts): the sword and its saya placed apart each frame. */
  readonly katana: Katana;
  /** Fighting hand to hand or with the katana (models/melee.ts): set, it poses him for it instead of the guns. */
  melee: Melee | null = null;
  /** A kill move's pose for him (models/killMoves.ts), in place of the melee's own, and its gun placement. */
  poseOverride: MeleePose | null = null;
  gunOverride: { pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;
  /** The fighting pose he was last put in (a kill move starts from it). */
  lastPose: MeleePose | null = null;
  /** The ball of the right foot, for a kick's striking part. */
  private readonly ballR: THREE.Bone | null;
  private readonly ballL: THREE.Bone | null;

  private constructor(model: THREE.Object3D, shadowModel: THREE.Object3D, env: THREE.Texture | null) {
    this.object.name = 'first-person';
    this.env = env;
    this.body.add(model);
    this.shadowBody.add(shadowModel);
    this.object.add(this.body, this.shadowBody, this.flashLight);
    // The body seen has no head, so its shadow comes from the copy instead.
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });
    const shadowBones = new Map<string, THREE.Bone>();
    shadowModel.traverse((o) => {
      const m = o as THREE.Mesh;
      if ((o as THREE.Bone).isBone) shadowBones.set(o.name, o as THREE.Bone);
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = false;
      const hide = (mat: THREE.Material): THREE.Material => {
        const c = mat.clone();
        c.colorWrite = false;
        c.depthWrite = false;
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(hide) : hide(m.material);
    });
    const bones = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        bones.set(o.name, o as THREE.Bone);
        this.rest.set(o as THREE.Bone, o.quaternion.clone());
      }
    });
    const bone = (n: string): THREE.Bone => {
      const b = bones.get(n);
      if (!b) throw new Error(`first person: no bone ${n}`);
      return b;
    };
    model.updateMatrixWorld(true);
    shadowModel.updateMatrixWorld(true);
    for (const [n, b] of bones) {
      const twin = shadowBones.get(n);
      if (twin) this.shadowPairs.push([b, twin]);
    }
    for (const n of ['neck_01', 'head']) {
      const b = shadowBones.get(n);
      if (!b) continue;
      const inv = b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.shadowHead.push({ bone: b, axes: [new THREE.Vector3(1, 0, 0).applyQuaternion(inv), new THREE.Vector3(0, 1, 0).applyQuaternion(inv), new THREE.Vector3(0, 0, 1).applyQuaternion(inv)] });
    }
    this.head = bone('head');
    this.neck = bone('neck_01');
    this.headRestInv = this.head.matrixWorld.clone().invert();
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /hair|eyebrow|eyelash/i.test(o.name)) this.hairMeshes.push(o);
    });
    const inv = new THREE.Quaternion();
    for (const n of FIGURE_BONES) {
      const b = bone(n);
      b.parent!.getWorldQuaternion(inv).invert();
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(inv)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      this.turnable.set(n, { bone: b, axes });
    }
    // The eyes: the middle of the eyeball mesh, else a little above and ahead of the head bone.
    let eye: THREE.Vector3 | null = null;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!eye && m.isMesh && /high-poly|eye/i.test(m.name)) {
        if (m.isSkinnedMesh) m.computeBoundingBox();
        eye = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3());
      }
    });
    const e = eye ?? this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0.08));
    this.legs = {
      l: { upper: bone('thigh_l'), lower: bone('calf_l'), hand: bone('foot_l') },
      r: { upper: bone('thigh_r'), lower: bone('calf_r'), hand: bone('foot_r') },
    };
    this.pelvisRest = bone('pelvis').getWorldPosition(new THREE.Vector3());
    this.eyeFromNeck = new THREE.Vector3().copy(e as THREE.Vector3).sub(this.neck.getWorldPosition(new THREE.Vector3()));
    this.eyeY = this.eyeY0 = e.y;
    this.eyeZ = this.eyeZ0 = e.z;

    const arm = (s: 'l' | 'r'): Arm => {
      const upper = bone(`upperarm_${s}`);
      const lower = bone(`lowerarm_${s}`);
      const hand = bone(`hand_${s}`);
      const p = (b: THREE.Bone): THREE.Vector3 => b.getWorldPosition(new THREE.Vector3());
      const fwd = p(bone(`middle_01_${s}`)).sub(p(hand));
      const across = p(bone(`pinky_01_${s}`)).sub(p(bone(`index_01_${s}`)));
      // The palm faces the side the thumb's tip curls toward.
      const palm = new THREE.Vector3().crossVectors(fwd, across).normalize();
      if (p(bone(`thumb_03_${s}`)).sub(p(hand)).dot(palm) < 0) palm.negate();
      return {
        side: s,
        upper,
        lower,
        hand,
        q0: hand.getWorldQuaternion(new THREE.Quaternion()),
        frame0: handFrame(fwd, palm, new THREE.Matrix4()),
        fingers: FINGERS.map((f) => [1, 2, 3].map((i) => bone(`${f}_0${i}_${s}`))),
        thumb: [1, 2, 3].map((i) => bone(`thumb_0${i}_${s}`)),
      };
    };
    this.arms = { l: arm('l'), r: arm('r') };

    this.ballR = bones.get('ball_r') ?? null;
    this.ballL = bones.get('ball_l') ?? null;
    this.katana = buildKatana(env);
    this.object.add(this.katana.sword, this.katana.saya);
    this.katana.sword.visible = this.katana.saya.visible = false;
    this.guns = Object.fromEntries(SHOTGUN_KINDS.map((k) => [k, buildShotgun(k, env)])) as Record<ShotgunKind, Shotgun>;
    for (const g of Object.values(this.guns)) this.object.add(g.root);
    this.loaded = this.guns[this.kind].shells;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,230,1)');
    grad.addColorStop(0.3, 'rgba(255,190,90,0.8)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(4, 3, 2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.object.add(this.flash);
  }

  /** Loads the body (a cast model, default Mack) and builds the guns. `env` lights the steel. */
  static async load(name = 'mack', env: THREE.Texture | null = null): Promise<FirstPersonRig> {
    const [model, shadow] = await Promise.all([loadCharacterModel(name), loadCharacterModel(name)]);
    const rig = new FirstPersonRig(model, shadow, env);
    rig.model = name;
    return rig;
  }

  /**
   * A change of clothes (models/wardrobe.ts): another model's rig takes over from `old` as it stands: the gun in
   * hand and how it's held, the fight, the bike, the helmet, the sunglasses, the head shown or folded, the fit to
   * the eye height. The page swaps `old.object` for this one's in the scene.
   */
  takeOver(old: FirstPersonRig): void {
    this.setKind(old.kind);
    this.loaded = old.loaded;
    this.armed = old.armed;
    this.oneHand = old.oneHand;
    this.melee = old.melee;
    this.mounted = old.mounted;
    this.wornHelmet = old.wornHelmet;
    this.setHelmet(old.helmetLook ?? false);
    this.setGlasses(old.glassesKind);
    this.setFaceStyle(old.faceStyle);
    this.setHeadless(old.headless);
    this.onFootfall = old.onFootfall;
    if (old.fitHeight !== null) this.fitEye(old.fitHeight);
    if (!old.object.children.includes(old.flashLight)) this.object.remove(this.flashLight);
    this.object.visible = old.object.visible;
  }

  /** The eyes' height above the feet. */
  get eyeHeight(): number {
    return this.eyeY;
  }

  /** How the body rides its stride: -1 as each foot lands, 1 between, nothing standing (for the camera's bob). */
  get bob(): number {
    return this.mounted ? 0 : gaitBob(this.walk, this.runNow, this.stride);
  }

  get shells(): number {
    return this.loaded;
  }

  setKind(k: ShotgunKind): void {
    this.kind = k;
    this.loaded = this.guns[k].shells;
    this.leverT = -1;
    this.reloadT = 0;
  }

  /** Fires if it can (aimed or from the hip); returns whether it did. Held upright in one hand, it swings
   * the gun down first and fires when it's level. */
  fire(): boolean {
    if (this.leverT >= 0 || this.reloadT > 0 || this.loaded <= 0) return false;
    const oneHanded = this.oneHand || this.mounted !== null;
    if (oneHanded && this.aim < 0.96) {
      this.queued = true;
      this.snap = 0.5;
      return false;
    }
    this.queued = false;
    // Held level through the shot and the lever, then back up.
    if (oneHanded && !this.aiming) this.snap = 0.95;
    this.loaded--;
    this.shotsFired++;
    // One hand can't hold it down: a harder kick (a pistol's far lighter).
    this.kickV += (oneHanded ? 13 : 9) * (this.guns[this.kind].recoil ?? 1);
    this.flashT = 0.05;
    const gun = this.guns[this.kind];
    // The double fires right barrel then left.
    const m = gun.muzzles[gun.muzzles.length > 1 ? this.loaded % 2 : 0];
    this.flash.position.copy(m).applyMatrix4(gun.root.matrixWorld);
    this.flashLight.position.copy(this.flash.position);
    if (gun.lever) {
      this.leverT = -0.12; // a beat, then the lever
      this.flip = this.oneHand || this.mounted !== null;
    }
    if (this.loaded === 0) this.reloadT = this.reloadTime();
    return true;
  }

  /** Raises the gun at once (out of a car window: the upright hold would go through the roof). */
  raise(): void {
    this.armed = true;
    this.aiming = true;
    this.aim = 1;
    this.one = 1;
  }

  /** The gun's muzzle now (world). */
  muzzle(out = new THREE.Vector3()): THREE.Vector3 {
    const gun = this.guns[this.kind];
    gun.root.updateMatrixWorld(true);
    return out.copy(gun.muzzles[gun.muzzles.length > 1 ? this.loaded % 2 : 0]).applyMatrix4(gun.root.matrixWorld);
  }

  /** Where the bore points now (world, unit). */
  boreDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, -1).transformDirection(this.guns[this.kind].root.matrixWorld);
  }

  /**
   * A full-face helmet on (models/helmet.ts) or off: on the head (and the shadow's), the hair, brows and lashes
   * hidden under it. With the head folded away in first person it folds away too.
   */
  setHelmet(on: boolean | HelmetLook): void {
    const look = on === true ? HELMET_LOOK : on || null;
    if (look === this.helmetLook) return;
    for (const h of this.helmets ?? []) h.removeFromParent();
    this.helmets = null;
    this.helmetLook = look;
    if (look) {
      const a = buildHelmet(null, look);
      const b = buildHelmet(null, look);
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = (m.material as THREE.Material).clone();
        (m.material as THREE.Material).colorWrite = false;
        (m.material as THREE.Material).depthWrite = false;
      });
      this.helmets = [a, b];
      this.wearOn(this.head, this.headRestInv, a);
      const sh = this.shadowHead[1]?.bone;
      if (sh) this.wearOn(sh, this.headRestInv, b);
    }
    this.headwear();
  }

  /** Puts his own helmet on (or takes it off): on the head now unless he's riding a bike that has its own. */
  wearHelmet(look: HelmetLook | null): void {
    this.wornHelmet = look;
    if (!this.mounted?.rider.helmet) this.setHelmet(look ?? false);
  }

  /** What shows on the head: the hair and sunglasses go under a helmet, the bike's or RoboCop's. */
  private headwear(): void {
    const covered = !!this.helmetLook || this.faceStyle === 'robo';
    for (const m of this.hairMeshes) m.visible = !covered;
    for (const g of this.glasses ?? []) g.visible = !covered;
    for (const r of this.robo ?? []) r.visible = !this.helmetLook;
  }

  /** How his face is hidden (models/faceShadow.ts `FaceStyle`; the skin's part is shared by every faceless model). */
  setFaceStyle(style: FaceStyle): void {
    this.faceStyle = style;
    setFaceMode(style);
    if (style === 'robo' && !this.robo) {
      const a = buildRoboHelmet();
      const b = buildRoboHelmet();
      b.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = (m.material as THREE.Material).clone();
        (m.material as THREE.Material).colorWrite = false;
        (m.material as THREE.Material).depthWrite = false;
      });
      this.robo = [a, b];
      this.wearOn(this.head, this.headRestInv, a);
      const sh = this.shadowHead[1]?.bone;
      if (sh) this.wearOn(sh, this.headRestInv, b);
    } else if (style !== 'robo' && this.robo) {
      for (const r of this.robo) r.removeFromParent();
      this.robo = null;
    }
    if (style === 'bar' && !this.faceBar) this.faceBar = this.makeFaceBar();
    else if (style !== 'bar' && this.faceBar) {
      this.faceBar.removeFromParent();
      this.faceBar = null;
    }
    this.headwear();
  }

  /**
   * The censor bar: a black bar over his eyes that always faces the camera (turned to the line of the eyes), placed
   * as it's drawn so it follows whichever camera is rendering; gone when the face is turned away or folded away.
   */
  /** The face's frame now (world): between the eyes, and the head's forward, right and up. */
  private readonly face = { eye: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
  private faceRest: { eye: THREE.Vector3; rot: THREE.Matrix4 } | null = null;
  private faceNow(): typeof this.face {
    this.faceRest ??= { eye: new THREE.Vector3(0, this.eyeY0 + 0.004, this.eyeZ0).applyMatrix4(this.headRestInv), rot: new THREE.Matrix4().extractRotation(this.headRestInv) };
    const m = this.head.matrixWorld;
    const f = this.face;
    f.eye.copy(this.faceRest.eye).applyMatrix4(m);
    f.fwd.set(0, 0, 1).applyMatrix4(this.faceRest.rot).transformDirection(m);
    f.right.set(1, 0, 0).applyMatrix4(this.faceRest.rot).transformDirection(m);
    f.up.set(0, 1, 0).applyMatrix4(this.faceRest.rot).transformDirection(m);
    return f;
  }

  /**
   * Where his face is on the screen for `camera` (pixels of a `width` x `height` render, origin bottom left): an
   * ellipse round it, turned with the head, for the censor pass (models/censorPass.ts); null when the head is
   * folded away (first person), turned away from the camera or behind it.
   */
  faceOnScreen(camera: THREE.Camera, width: number, height: number): FaceOnScreen | null {
    if (this.headless) return null;
    const f = this.faceNow();
    const cam = camera.getWorldPosition(new THREE.Vector3());
    if (f.fwd.dot(cam.sub(f.eye).normalize()) < -0.15) return null;
    const s = this.body.scale.x;
    const c = f.eye.clone().addScaledVector(f.up, -0.03 * s).addScaledVector(f.fwd, 0.02 * s);
    return this.ellipseOnScreen(camera, width, height, c, f.right, f.up, 0.085 * s, 0.115 * s);
  }

  private ellipseOnScreen(
    camera: THREE.Camera,
    width: number,
    height: number,
    c: THREE.Vector3,
    acrossDir: THREE.Vector3,
    upDir: THREE.Vector3,
    across: number,
    up: number,
  ): FaceOnScreen | null {
    const px = (p: THREE.Vector3): THREE.Vector2 | null => {
      const n = p.clone().project(camera);
      return n.z > 1 ? null : new THREE.Vector2(((n.x + 1) / 2) * width, ((n.y + 1) / 2) * height);
    };
    const pc = px(c);
    const pr = px(c.clone().addScaledVector(acrossDir, across));
    const pu = px(c.clone().addScaledVector(upDir, up));
    if (!pc || !pr || !pu) return null;
    return { centre: pc, across: pr.sub(pc), up: pu.sub(pc) };
  }

  private makeFaceBar(): THREE.Mesh {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.038), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    bar.name = 'face-bar';
    bar.matrixAutoUpdate = false;
    bar.frustumCulled = false;
    const cam = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const roll = new THREE.Quaternion();
    bar.onBeforeRender = (_r, _s, camera) => {
      const { eye, fwd, right } = this.faceNow();
      camera.getWorldPosition(cam);
      const to = cam.sub(eye).normalize();
      if (this.headless || fwd.dot(to) < -0.1) {
        bar.matrixWorld.makeScale(1e-6, 1e-6, 1e-6);
        return;
      }
      camera.getWorldQuaternion(q);
      // Turned in the screen to the line of the eyes.
      const r = right.clone().applyQuaternion(q.clone().invert());
      roll.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(r.y, r.x));
      const s = this.body.scale.x;
      bar.matrixWorld.compose(eye.clone().addScaledVector(to, 0.07 * s), q.multiply(roll), new THREE.Vector3(s, s, s));
    };
    this.object.add(bar);
    return bar;
  }

  /** Sunglasses on (models/sunglasses.ts) or off; under a helmet they stay hidden. */
  setGlasses(kind: GlassesKind | null): void {
    if (kind === this.glassesKind) return;
    for (const g of this.glasses ?? []) g.removeFromParent();
    this.glasses = null;
    this.glassesKind = kind;
    if (!kind) return;
    const a = buildGlasses(kind, this.env);
    const b = buildGlasses(kind);
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = (m.material as THREE.Material).clone();
      (m.material as THREE.Material).colorWrite = false;
      (m.material as THREE.Material).depthWrite = false;
    });
    this.glasses = [a, b];
    this.wearOn(this.head, this.headRestInv, a);
    const sh = this.shadowHead[1]?.bone;
    if (sh) this.wearOn(sh, this.headRestInv, b);
    this.headwear();
  }

  /** Puts a helmet (or sunglasses) on a head bone: centred on the head (behind and a little above the eyes),
   * facing forward, in the bone's frame at rest. */
  private wearOn(bone: THREE.Bone, restInv: THREE.Matrix4, helmet: THREE.Object3D): void {
    const centre = new THREE.Vector3(0, this.eyeY0 - 0.01, this.eyeZ0 - 0.065);
    const world = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z);
    const local = restInv.clone().multiply(world);
    local.decompose(helmet.position, helmet.quaternion, helmet.scale);
    bone.add(helmet);
  }

  /** Shows or folds the head (third person shows it); the shadow follows: the body casts its own with the head
   * shown, the headed copy casts it otherwise. */
  setHeadless(on: boolean): void {
    if (on === this.headless) return;
    this.headless = on;
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = !on;
    });
    this.shadowBody.visible = on;
  }

  reload(): void {
    if (this.loaded < this.guns[this.kind].shells && this.reloadT <= 0) this.reloadT = this.reloadTime();
  }

  /** Seconds to reload: shells one at a time into the lever-action, two into the double, a magazine. */
  private reloadTime(): number {
    return this.kind === 'lever' ? 2.2 : this.kind === 'double' ? 1.6 : 1.3;
  }

  /** The gun in hand. */
  get gun(): Shotgun {
    return this.guns[this.kind];
  }

  /** Scales the body so its eyes are `height` above its feet (the city's camera stands at a fixed height). */
  fitEye(height: number): void {
    this.fitHeight = height;
    const k = height / this.eyeY0;
    this.body.scale.setScalar(k);
    this.shadowBody.scale.setScalar(k);
    this.eyeY = this.eyeY0 * k;
    this.eyeZ = this.eyeZ0 * k;
  }

  /** Poses everything for this frame. `speed` is how fast the walker is moving (m/s); `floor` the ground's
   * height. `pitch` (radians, up positive) is the view's, where the camera itself doesn't pitch (a sheared
   * projection); otherwise the camera's own. */
  update(dt: number, camera: THREE.Camera, speed: number, floor: number, pitchOverride?: number): void {
    // Timers: aim, recoil (a stiff spring), the lever's throw, the reload.
    this.snap -= dt;
    const snapping = !this.aiming && this.snap > 0;
    this.aim += ((this.aiming || snapping ? 1 : 0) - this.aim) * Math.min(1, dt * (snapping ? 16 : 9));
    if (this.queued && this.aim >= 0.96) this.fire();
    this.one += ((this.oneHand ? 1 : 0) - this.one) * Math.min(1, dt * 7);
    this.kickV += (-this.kick * 260 - this.kickV * 22) * dt;
    this.kick += this.kickV * dt;
    this.flashT -= dt;
    const cycle = this.flip ? FLIP_TIME : 0.42;
    if (this.leverT > -1) {
      this.leverT += dt;
      if (this.leverT >= cycle) this.leverT = -1;
    }
    const lt = this.leverT >= 0 ? this.leverT / cycle : 0;
    this.lever = Math.sin(Math.PI * lt) * 0.95;
    // The flip-cock: once round, forward (muzzle down), easing in and out; the lever falls open as it goes.
    const spin = this.flip && lt > 0 ? -Math.PI * 2 * lt * lt * (3 - 2 * lt) : 0;
    let reloadDip = 0;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      reloadDip = Math.sin(Math.min(1, Math.max(0, 1 - this.reloadT / 1.8)) * Math.PI);
      if (this.reloadT <= 0) this.loaded = this.guns[this.kind].shells;
    }
    this.stride += (Math.min(1, speed / 1.6) - this.stride) * Math.min(1, dt * 6);
    // How fast and how far: strides a second rise gently with speed (a walk ~0.85, a run ~1.4; the rest of a
    // run's speed is longer strides), and running swings the legs further.
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 4);
    this.walk += dt * Math.PI * 2 * (STRIDE_HZ[0] + STRIDE_HZ[1] * this.speedNow);
    const run = (this.runNow = THREE.MathUtils.clamp((this.speedNow - 1.8) / 2.2, 0, 1));

    // The body: under the camera, facing where it looks, the eyes BACK behind the camera.
    const fwd = camera.getWorldDirection(_a);
    const pitch = pitchOverride ?? Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const heading = Math.atan2(fwd.x, fwd.z);
    const viewQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, heading + Math.PI, 0, 'YXZ'));
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const bike = this.mounted;
    // The upper body follows the view up and down (less looking down: the body would come up under the
    // camera), so the arms keep the gun in reach. Seated, it stays upright.
    const bend = bike ? 0 : -pitch * (pitch > 0 ? 0.55 + 0.15 * this.aim : 0.3 * this.aim + 0.08);
    if (bike) {
      // On a bike: seated (the camera is at the eyes), the chest turning a little toward where you look.
      const bf = new THREE.Vector3(0, 0, -1).applyQuaternion(bike.root.getWorldQuaternion(new THREE.Quaternion()));
      const rel = Math.atan2(fx * bf.z - fz * bf.x, fx * bf.x + fz * bf.z);
      this.rideTwist = THREE.MathUtils.clamp(-rel, -1.0, 1.0) * this.aim;
      this.seatBody(bike);
    } else {
      // Looking steeply down, the body slides back further, so you look past the chest at your legs and feet
      // rather than down the collar.
      // (With the head shown, in third person, the eyes are where the camera's eyes are.)
      const back = this.eyeZ + (this.headless ? BACK + BACK_DOWN * Math.max(0, -pitch) + BACK_STEEP * Math.max(0, -pitch - 0.7) : 0);
      this.body.position.set(camera.position.x - fx * back, floor, camera.position.z - fz * back);
      this.body.rotation.set(0, heading, 0);
      for (const [b, q] of this.rest) b.quaternion.copy(q);
      // The head and neck fold away into the collar: the camera is where the eyes were.
      this.neck.scale.setScalar(this.headless ? 0.001 : 1);
    }
    this.turn('spine_01', 0, bend * 0.2);
    this.turn('spine_02', 0, bend * 0.35);
    this.turn('spine_03', 0, bend * 0.45);
    // A shooter's stance: the chest turned toward the gun hand, bringing the left shoulder forward to the
    // forend (more when it's raised); one-handed, the other way, the gun shoulder forward behind the arm.
    const twist = this.armed && !bike ? -(0.22 + 0.12 * this.aim) * (1 - this.one) + 0.14 * this.aim * this.one : 0;
    this.turn('spine_02', 1, twist * 0.45);
    this.turn('spine_03', 1, twist * 0.55);
    // Legs: a stance, or a walk (seated: none, the pegs have them).
    const s = Math.sin(this.walk);
    const k = bike ? 0 : this.stride;
    if (!bike) {
      for (const foot of ['l', 'r'] as const) {
        const leg = legPose(this.walk, run, foot);
        this.turn(`thigh_${foot}`, 0, -leg.thigh * k);
        this.turn(`calf_${foot}`, 0, leg.knee * k);
      }
      this.turn('pelvis', 1, 0.06 * s * k);
      // Running, the body leans into it.
      this.turn('spine_01', 0, 0.12 * run * k);
    }
    this.object.updateMatrixWorld(true);
    // The feet landing (seated, none; the next waits for a fresh swing).
    if (bike) this.footfalls.reset();
    else for (const foot of this.footfalls.step(this.walk, run, k)) this.onFootfall?.(foot, this.legs[foot].hand.getWorldPosition(_foot), run, k);

    if (this.melee && !bike) {
      for (const g of Object.values(this.guns)) g.root.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.fight(this.melee, camera, viewQ, fx, fz, s * k, k, run);
      this.poseShadow(pitch, bend);
      return;
    }
    this.katana.sword.visible = this.katana.saya.visible = false;
    if (!this.armed && bike) {
      for (const g of Object.values(this.guns)) g.root.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.gripHand('r', bike);
      this.gripHand('l', bike);
      this.poseShadow(pitch, 0);
      return;
    }
    if (!this.armed) {
      // Hands free: both arms swing with the walk (each against its own leg) and pump running, hands relaxed.
      for (const g of Object.values(this.guns)) g.root.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.freeArms(fx, fz, Math.sin(this.walk) * k, s * k, run * k);
      this.poseShadow(pitch, bend);
      return;
    }
    // The gun, in the camera's frame.
    for (const g of Object.values(this.guns)) g.root.visible = g.kind === this.kind;
    const gun = this.guns[this.kind];
    // This gun's holds where it has its own (a pistol's), else the shotguns'.
    const H = gun.holds ? { ...HOLD, ...gun.holds } : HOLD;
    const a = this.aim;
    // Riding, the gun is always in the right hand alone (the left is on the bars).
    const one = bike ? 1 : this.one;
    const pos = _b.copy(H.low.pos).lerp(H.aim.pos, a).lerp(_c.copy(H.oneLow.pos).lerp(H.oneAim.pos, a), one);
    pos.y += -0.12 * reloadDip + (0.01 + 0.008 * run) * Math.sin(this.walk * 2) * k * (1 - 0.6 * a);
    pos.x += (0.006 + 0.004 * run) * Math.sin(this.walk) * k;
    // The recoil's push, in the camera's frame: added after the arm is straightened (below), so it still kicks.
    const kickPush = new THREE.Vector3(0, (0.015 + 0.03 * one) * this.kick, (0.07 + 0.05 * one) * this.kick);
    // Flipping, the arm drops and swings out to give the gun room.
    const flipArc = spin !== 0 ? Math.sin(Math.PI * lt) : 0;
    pos.y -= 0.14 * flipArc;
    pos.x += 0.07 * flipArc;
    pos.z += 0.08 * flipArc;
    const mix = (key: 'x' | 'y' | 'z'): number => {
      const two = H.low.rot[key] + (H.aim.rot[key] - H.low.rot[key]) * a;
      return two + (H.oneLow.rot[key] + (H.oneAim.rot[key] - H.oneLow.rot[key]) * a - two) * one;
    };
    // The lever's throw turns the gun a little in two hands; the flip-cock spins it instead (below).
    const throwTurn = this.flip ? 0 : this.lever;
    const rot = new THREE.Euler(
      mix('x') + (0.28 + 0.4 * one) * this.kick - 0.5 * reloadDip,
      mix('y') - 0.15 * throwTurn,
      mix('z') + 0.5 * reloadDip + 0.2 * throwTurn,
      'YXZ',
    );
    gun.root.position.copy(pos).applyQuaternion(viewQ).add(camera.position);
    gun.root.quaternion.copy(viewQ).multiply(_q.setFromEuler(rot));
    // Running (and not aiming), the gun is carried low in the right hand, swinging with the arm: placed in the
    // body's frame (its heading, not the view's pitch), so looking about doesn't drag it.
    this.carry += (run * (1 - a) - this.carry) * Math.min(1, dt * 6);
    const carry = this.carry;
    const pump = Math.sin(this.walk) * k;
    if (carry > 0.001) {
      const bodyQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading + Math.PI);
      const cp = H.run.pos.clone();
      // The right arm forward as the left leg is: forward (-z) and up a little at each end of the swing.
      cp.z -= RUN_PUMP * pump;
      cp.y += 0.03 * Math.abs(pump);
      const cr = new THREE.Euler(H.run.rot.x + 0.3 * pump, H.run.rot.y, H.run.rot.z, 'YXZ');
      gun.root.position.lerp(cp.applyQuaternion(bodyQ).add(camera.position), carry);
      gun.root.quaternion.slerp(bodyQ.multiply(new THREE.Quaternion().setFromEuler(cr)), carry);
    }
    // Spinning, the hand holds still with its fingers in the loop: it's put there with the lever shut.
    if (gun.lever) gun.lever.rotation.x = this.flip ? 0 : this.lever;
    // A pistol's slide snaps back with the shot.
    if (gun.slide) gun.slide.position.z = THREE.MathUtils.clamp(this.kick * 0.35, 0, 0.028);
    gun.root.updateMatrixWorld(true);
    // Raised, the gun points at what's under the crosshair (AIM_RANGE along the view), so shots converge on
    // it. One-handed, the arm goes out straight from the shoulder toward it: the wrist at the arm's full reach
    // on that line, the bore from there to the target, whichever way you look.
    const target = camera.position.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(viewQ), AIM_RANGE);
    const ext = one * a * (1 - (spin !== 0 ? Math.sin(Math.PI * lt) : 0));
    const wristLocal = gun.grip.at.clone().addScaledVector(gun.grip.palm, -PALM_OFF).addScaledVector(gun.grip.fwd, -PALM_BACK);
    // (The grip's frame is the gun's own while the lever is shut.)
    const viewUp = new THREE.Vector3(0, 1, 0).applyQuaternion(viewQ);
    if (ext > 0.001) {
      const arm = this.arms.r;
      const S = arm.upper.getWorldPosition(new THREE.Vector3());
      const [la, lb] = armLengths(arm);
      const wrist = S.clone().add(target.clone().sub(S).setLength((la + lb) * EXTEND));
      const q = aimQuaternion(target.clone().sub(wrist), viewUp, H.oneAim.rot.z);
      const pos = wrist.clone().sub(wristLocal.clone().applyQuaternion(q));
      gun.root.position.lerp(pos, ext);
      gun.root.quaternion.slerp(q, ext);
    }
    const conv = a * (1 - one) * (1 - (spin !== 0 ? 1 : 0));
    if (conv > 0.001) {
      // Two hands: turned about the grip so the bore meets the target.
      const wrist = wristLocal.clone().applyQuaternion(gun.root.quaternion).add(gun.root.position);
      const q = aimQuaternion(target.clone().sub(wrist), viewUp, H.aim.rot.z);
      const pos = wrist.clone().sub(wristLocal.clone().applyQuaternion(q));
      gun.root.position.lerp(pos, conv);
      gun.root.quaternion.slerp(q, conv);
    }
    gun.root.position.add(kickPush.applyQuaternion(viewQ));
    gun.root.updateMatrixWorld(true);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.scale.setScalar(0.22 + Math.random() * 0.12);
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;

    // A kill move puts the gun where it wants it (under a man's jaw).
    if (this.gunOverride) {
      gun.root.position.copy(this.gunOverride.pos);
      gun.root.quaternion.copy(this.gunOverride.quat);
      gun.root.updateMatrixWorld(true);
    }
    // The arms onto the gun: elbows down and out.
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(fz, 0, -fx).negate();
    const behind = new THREE.Vector3(-fx, 0, -fz);
    // Holding it upright in one hand, or carrying it running, the gun elbow tucks down and back instead.
    const tuck = Math.max(one * (1 - a), carry);
    const pole = (side: 1 | -1): THREE.Vector3 => {
      const t = side > 0 ? tuck : 0;
      return new THREE.Vector3().addScaledVector(up, -1).addScaledVector(right, (0.8 - 0.5 * t) * side).addScaledVector(behind, 0.25 + 0.5 * t).normalize();
    };
    this.hold('r', gun.grip, gun.gripParent, pole(1));
    if (bike) this.gripHand('l', bike);
    else if (one < 0.5 && carry < 0.5) this.hold('l', gun.fore, gun.root.children[0], pole(-1));
    else {
      // The free arm hangs by the side, the elbow soft, swinging with the walk against the left leg (forward as
      // the right leg comes forward); running, it pumps, the elbow bent near square, the hand at the ribs.
      const S = this.arms.l.upper.getWorldPosition(new THREE.Vector3());
      const fwdH = new THREE.Vector3(fx, 0, fz);
      const hang = S.clone().addScaledVector(up, -0.52).addScaledVector(right, -0.07).addScaledVector(fwdH, 0.08 - 0.07 * s * k);
      // Against the gun arm: forward as it goes back.
      const pumped = S.clone().addScaledVector(up, -0.34).addScaledVector(right, -0.01).addScaledVector(fwdH, 0.06 - 1.3 * RUN_PUMP * pump);
      const poleL = new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, -0.3).normalize()
        .lerp(new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(up, -0.7).addScaledVector(right, -0.35).normalize(), carry);
      this.reach(this.arms.l, hang.lerp(pumped, carry), poleL);
      // The wrist straight, in line with the forearm, the palm toward the body (thumb up, running).
      const arm = this.arms.l;
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
      const along = arm.hand.getWorldPosition(new THREE.Vector3()).sub(elbow).normalize();
      this.orientHand(arm, along, right.clone().lerp(behind.clone().negate(), 0.15 * (1 - carry)).normalize());
      this.relaxHand(this.arms.l, 1 + 0.6 * carry);
    }

    // The flip-cock: the gun turns about the loop (FLIP_PIVOT) while the hand stays put.
    if (spin !== 0) {
      const r = _q.setFromAxisAngle(FLIP_AXIS, spin);
      const shift = FLIP_PIVOT.clone().sub(FLIP_PIVOT.clone().applyQuaternion(r)).applyQuaternion(gun.root.quaternion);
      gun.root.position.add(shift);
      gun.root.quaternion.multiply(r);
      if (gun.lever) gun.lever.rotation.x = this.lever;
      gun.root.updateMatrixWorld(true);
    }

    this.poseShadow(pitch, bend);
  }

  /**
   * Fighting (models/melee.ts): the saya at the hip with the katana; the chest turned and leaned by the move;
   * the kicking foot by IK; the fists placed in the view's frame and closed, or the sword placed there with both
   * hands on its tsuka (the left on the saya's mouth while drawing and sheathing). Nothing drawn, the arms swing
   * free.
   */
  private fight(m: Melee, camera: THREE.Camera, viewQ: THREE.Quaternion, fx: number, fz: number, swing: number, k: number, run: number): void {
    const kt = this.katana;
    const katana = m.weapon === 'katana';
    const right = new THREE.Vector3(-fz, 0, fx);
    const up = new THREE.Vector3(0, 1, 0);
    const fwdH = new THREE.Vector3(fx, 0, fz);
    const bodyQ = this.body.quaternion;
    // The saya on the left hip (the body's +x is his left), and the sword as it sits in it.
    const sc = this.body.scale.x;
    const mouth = SAYA_MOUTH.clone().multiplyScalar(sc).applyQuaternion(bodyQ).add(this.body.position);
    const sayaQ = bodyQ.clone().multiply(swordQuat({ p: SAYA_MOUTH, dir: SAYA_DIR, edge: SAYA_EDGE }));
    kt.saya.visible = katana;
    kt.saya.position.copy(mouth);
    kt.saya.quaternion.copy(sayaQ);
    const viewInv = viewQ.clone().invert();
    const sheath: SwordKey = {
      p: mouth.clone().sub(camera.position).applyQuaternion(viewInv),
      dir: new THREE.Vector3(0, 0, -1).applyQuaternion(sayaQ).applyQuaternion(viewInv),
      edge: new THREE.Vector3(0, -1, 0).applyQuaternion(sayaQ).applyQuaternion(viewInv),
    };
    const P = this.poseOverride ?? m.pose(sheath);
    this.lastPose = P;
    this.turn('spine_02', 1, P.twist * 0.45);
    this.turn('spine_03', 1, P.twist * 0.55);
    this.turn('spine_01', 0, P.lean * 0.4);
    this.turn('spine_02', 0, P.lean * 0.6);
    this.object.updateMatrixWorld(true);
    // The kick: the right ankle from where the stride has it to the move's place, the knee up and forward.
    if (P.foot || P.footWorld) {
      const leg = this.legs.r;
      const standing = leg.hand.getWorldPosition(new THREE.Vector3());
      const f = (P.footWorld ?? P.foot)!;
      const want = P.footWorld ? P.footWorld.p.clone() : this.body.position.clone().addScaledVector(right, f.p.x).addScaledVector(up, f.p.y).addScaledVector(fwdH, f.p.z);
      this.reach(leg, standing.lerp(want, f.w), fwdH.clone().addScaledVector(up, 0.6).normalize());
    }
    const toWorld = (p: THREE.Vector3): THREE.Vector3 => p.clone().applyQuaternion(viewQ).add(camera.position);
    const behind = fwdH.clone().negate();
    const pole = (side: 1 | -1): THREE.Vector3 => new THREE.Vector3().addScaledVector(up, -1).addScaledVector(right, 0.8 * side).addScaledVector(behind, 0.25).normalize();
    // The sword, in or out of the saya.
    kt.sword.visible = katana;
    if (katana && !P.sword) {
      kt.sword.position.copy(mouth);
      kt.sword.quaternion.copy(sayaQ);
    }
    if (P.sword) {
      kt.sword.position.copy(toWorld(P.sword.p));
      kt.sword.quaternion.copy(viewQ).multiply(swordQuat(P.sword));
      kt.sword.updateMatrixWorld(true);
      this.hold('r', kt.grip, kt.sword, pole(1));
      if (P.leftOnSaya) {
        // The left hand holds the saya by its mouth as the sword comes out or goes home.
        const along = new THREE.Vector3(0, 0, -1).applyQuaternion(sayaQ);
        const at = mouth.clone().addScaledVector(along, 0.06).addScaledVector(up, -0.03);
        this.reach(this.arms.l, at, new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, -0.6).normalize());
        this.orientHand(this.arms.l, along.clone().lerp(fwdH, 0.3).normalize(), right.clone());
        this.relaxHand(this.arms.l, 2.2);
      } else this.hold('l', kt.fore, kt.sword, pole(-1));
      return;
    }
    if (P.r || P.l) {
      const bob = 0.012 * Math.sin(this.walk * 2) * k;
      const hands: ['r' | 'l', typeof P.r][] = [['r', P.r], ['l', P.l]];
      for (const [side, key] of hands) {
        if (!key) continue;
        const arm = this.arms[side];
        const target = toWorld(key.p.clone().add(new THREE.Vector3(0, bob, 0)));
        this.reach(arm, target, key.elbow ? key.elbow.clone().applyQuaternion(viewQ) : pole(side === 'r' ? 1 : -1));
        this.orientHand(arm, key.f.clone().applyQuaternion(viewQ), key.n.clone().applyQuaternion(viewQ));
        this.relaxHand(arm, 1, FIST, [0, 0]);
        this.thumbOver(arm);
      }
      return;
    }
    this.freeArms(fx, fz, Math.sin(this.walk) * k, swing, run * k);
  }

  /** A hand's wrist now (world). */
  handWorld(side: 'l' | 'r'): THREE.Vector3 {
    return this.arms[side].hand.getWorldPosition(new THREE.Vector3());
  }

  /** Where a striking part is now (world): a fist from the wrist to past the knuckles, the right foot from the
   * ankle to the ball and past, the blade from the habaki to the point; with its thickness. */
  strike(h: Hitter): { a: THREE.Vector3; b: THREE.Vector3; r: number } {
    if (h === 'blade') {
      const s = this.katana.sword;
      s.updateMatrixWorld(true);
      return { a: s.localToWorld(this.katana.base.clone()), b: s.localToWorld(this.katana.tip.clone()), r: 0.012 };
    }
    if (h === 'foot_r') {
      const a = this.legs.r.hand.getWorldPosition(new THREE.Vector3());
      const ball = this.ballR ? this.ballR.getWorldPosition(new THREE.Vector3()) : a.clone().add(new THREE.Vector3(0, 0, 0.15));
      return { a, b: ball.clone().add(ball.clone().sub(a).multiplyScalar(0.4)), r: 0.06 };
    }
    const arm = this.arms[h === 'fist_l' ? 'l' : 'r'];
    const a = arm.hand.getWorldPosition(new THREE.Vector3());
    const knuckle = arm.fingers[1][0].getWorldPosition(new THREE.Vector3());
    return { a, b: knuckle.clone().add(knuckle.clone().sub(a).multiplyScalar(0.25)), r: 0.045 };
  }

  /**
   * Seated on a bike (models/bikeKit.ts' `Bike`, already placed and leaning): the pelvis on the seat, the
   * feet on the pegs or floorboards and the hands round the grips by IK (the hands in the steering's frame,
   * so they turn the bars), sitting upright; the head folded away as on foot. Returns where the eyes are,
   * for the camera. `lookPitch` nods the shadow's head.
   */
  ride(bike: Bike, lookPitch = 0): THREE.Vector3 {
    for (const g of Object.values(this.guns)) g.root.visible = false;
    this.flash.visible = false;
    this.flashLight.intensity = 0;
    const eye = this.seatBody(bike);
    this.gripHand('r', bike);
    this.gripHand('l', bike);
    this.poseShadow(lookPitch, 0);
    return eye;
  }

  /** The seated body alone (no hands): reset, seated on `bike`, legs to the pegs. Returns where the eyes are. */
  seatBody(bike: Bike): THREE.Vector3 {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.neck.scale.setScalar(this.headless ? 0.001 : 1);
    bike.root.updateMatrixWorld(true);
    const bq = bike.root.getWorldQuaternion(new THREE.Quaternion());
    // Facing the bike's forward (-z; the model faces +z).
    this.body.quaternion.copy(bq).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    const seat = bike.root.localToWorld(bike.rider.seat.clone().add(new THREE.Vector3(0, RIDE_SEAT_UP, RIDE_SEAT_BACK)));
    const pelvis = this.pelvisRest.clone().multiplyScalar(this.body.scale.x).applyQuaternion(this.body.quaternion);
    this.body.position.copy(seat).sub(pelvis);
    // Sitting up, a touch back, as on a cruiser; or tucked in over the tank on a sports bike.
    const tuck = bike.rider.tuck ?? 0;
    this.turn('spine_01', 0, -0.04 + tuck * 0.3);
    this.turn('spine_02', 0, 0.05 + tuck * 0.35);
    this.turn('spine_03', 0, tuck * 0.35);
    if (tuck) {
      // Head up to see the road over the screen.
      this.turn('neck_01', 0, -tuck * 0.7);
    }
    // Shooting one-handed, the chest turns a little toward where you look (the gun arm forward).
    if (this.armed && this.rideTwist !== 0) {
      this.turn('spine_02', 1, this.rideTwist * 0.4);
      this.turn('spine_03', 1, this.rideTwist * 0.6);
    }
    this.object.updateMatrixWorld(true);
    // A seat with its eyes given (a car's driver's eye): the body moved to put them there.
    if (bike.rider.eye) {
      const now = this.neck.getWorldPosition(new THREE.Vector3()).add(this.eyeFromNeck.clone().multiplyScalar(this.body.scale.x).applyQuaternion(this.body.quaternion));
      this.body.position.add(bike.root.localToWorld(bike.rider.eye.clone()).sub(now));
      this.object.updateMatrixWorld(true);
    }
    // A car: each foot's ball on its pedal (or the dead pedal), the heel down on the floor behind it, the foot
    // tipped up to it; the knees forward and a little out.
    const pedals = bike.rider.pedals;
    for (const side of pedals ? ([1, -1] as const) : []) {
      const leg = side > 0 ? this.legs.r : this.legs.l;
      const ballBone = side > 0 ? this.ballR : this.ballL;
      const k = this.body.scale.x;
      // The foot from the ankle to its ball (the rig's own, as it's scaled).
      const len = ballBone ? ballBone.getWorldPosition(new THREE.Vector3()).distanceTo(leg.hand.getWorldPosition(new THREE.Vector3())) : 0.17 * k;
      // (The ball joint sits a sole's thickness off the pad, toward the driver: the seat's frame has +z back.)
      const ball = (side > 0 ? pedals!.r : pedals!.l).clone().add(new THREE.Vector3(0, 0.012, 0.03 * k));
      const ankleY = pedals!.floor + RIDE_ANKLE * k;
      const rise = THREE.MathUtils.clamp(ball.y - ankleY, -len * 0.5, len * 0.92);
      const ankle = new THREE.Vector3(ball.x, ball.y - rise, ball.z + Math.sqrt(len * len - rise * rise));
      const ankleW = bike.root.localToWorld(ankle.clone());
      this.reach(leg, ankleW, new THREE.Vector3(side * 0.3, 0.55, -1).applyQuaternion(bq).normalize());
      if (ballBone) {
        const at = leg.hand.getWorldPosition(new THREE.Vector3());
        aim(leg.hand, ballBone.getWorldPosition(new THREE.Vector3()).sub(at), bike.root.localToWorld(ball.clone()).sub(at));
        leg.hand.updateWorldMatrix(false, true);
      }
    }
    // Legs to the pegs: the ankle a little above the board and behind its middle, the knees forward and out.
    for (const side of pedals ? [] : ([1, -1] as const)) {
      const peg = side > 0 ? bike.rider.pegR : bike.rider.pegL;
      const foot = bike.root.localToWorld(peg.clone().add(new THREE.Vector3(0, RIDE_ANKLE, 0.05)));
      this.reach(side > 0 ? this.legs.r : this.legs.l, foot, new THREE.Vector3(side * 0.35, 0.4, -1).applyQuaternion(bq).normalize());
    }
    // The eyes: from the neck, turned with the body.
    return this.neck.getWorldPosition(new THREE.Vector3()).add(this.eyeFromNeck.clone().multiplyScalar(this.body.scale.x).applyQuaternion(this.body.quaternion));
  }

  /** A hand round its grip, overhand: the palm on the grip's top, the knuckle line along it, the fingers over
   * its front and under it (in the steering's frame, so the hand turns the bars). */
  private gripHand(side: 'l' | 'r', bike: Bike): void {
    const s = side === 'r' ? 1 : -1;
    const grip = s > 0 ? bike.rider.gripR : bike.rider.gripL;
    const axis = (s > 0 ? bike.rider.gripAxisR : bike.rider.gripAxisL).clone().normalize();
    // The hand's forward: across the grip, ahead of it (the bars run out and back, so 'ahead' is the bike's
    // forward with the grip's own direction taken out), tipped a little down over it.
    const ahead = (s > 0 ? bike.rider.fwdR : bike.rider.fwdL) ?? new THREE.Vector3(0, -GRIP_TIP, -1);
    const fwd = ahead.clone().addScaledVector(axis, -ahead.dot(axis)).normalize();
    // The palm faces the grip's axis from above: perpendicular to both, pointing down.
    const palm = new THREE.Vector3().crossVectors(fwd, axis).normalize();
    const hint = s > 0 ? bike.rider.palmR : bike.rider.palmL;
    if (hint ? palm.dot(hint) < 0 : palm.y > 0) palm.negate();
    const hold: HandHold = {
      at: grip.clone(),
      palm,
      fwd,
      curl: 1,
      thumb: bike.rider.thumb ?? 0.5,
      wrap: { a: grip.clone().addScaledVector(axis, -0.06), b: grip.clone().addScaledVector(axis, 0.06), r: bike.rider.gripThick ?? 0.019 },
      seat: bike.rider.gripSeat,
      thumbRest: (s > 0 ? bike.rider.thumbR : bike.rider.thumbL) ? { along: axis, off: (s > 0 ? bike.rider.thumbR : bike.rider.thumbL)!, round: (s > 0 ? bike.rider.thumbRoundR : bike.rider.thumbRoundL) ?? palm } : undefined,
    };
    const bq = bike.root.getWorldQuaternion(new THREE.Quaternion());
    const frame = bike.steer.children[0] ?? bike.steer;
    const pole = new THREE.Vector3(s * 0.7, -1, 0.35).applyQuaternion(bq).normalize();
    const shift = side === 'l' ? bike.rider.shift : undefined;
    const k = shift ? THREE.MathUtils.clamp(shift.k, 0, 1) : 0;
    if (!shift || k < 0.04) {
      this.hold(side, hold, frame, pole);
      return;
    }
    // A car's gear lever: the left hand off the rim and over to the knob (lifted on the way, half open), the palm
    // down on its top, the fingers closing over it once it's there.
    const t = k * k * (3 - 2 * k);
    const m = frame.matrixWorld;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bq);
    const knob = bike.root.localToWorld(shift.at.clone());
    const from = this.arms.l.upper.getWorldPosition(new THREE.Vector3());
    const palmK = up.clone().negate();
    // (The hand lies along the forearm's way to it: from the shoulder, levelled.)
    const reachK = knob.clone().sub(from);
    const fwdK = reachK.addScaledVector(up, -reachK.dot(up)).normalize();
    // (A lever lying along the car, the handbrake: the fingers across it.)
    const turn = shift.fwd ? THREE.MathUtils.clamp(shift.turn ?? 0, 0, 1) : 0;
    if (turn > 0) fwdK.lerp(shift.fwd!.clone().applyQuaternion(bq), turn).normalize();
    const rod = turn > 0.5 && shift.rod ? shift.rod.clone().applyQuaternion(bq).normalize() : up;
    const palmW = hold.palm.clone().transformDirection(m).lerp(palmK, t).normalize();
    const fwdW = hold.fwd.clone().transformDirection(m).lerp(fwdK, t);
    fwdW.addScaledVector(palmW, -fwdW.dot(palmW)).normalize();
    const at = hold.at.clone().applyMatrix4(m).lerp(knob, t).addScaledVector(up, 0.05 * Math.sin(Math.PI * t));
    const on = t > 0.9;
    const moving: HandHold = {
      at,
      palm: palmW,
      fwd: fwdW,
      curl: on ? 0.9 : 0.45,
      thumb: 0.5,
      wrap: on ? (rod === up ? { a: at.clone().addScaledVector(up, -0.04), b: at.clone().addScaledVector(up, 0.006), r: 0.022 } : { a: at.clone().addScaledVector(rod, -0.06), b: at.clone().addScaledVector(rod, 0.06), r: 0.016 }) : undefined,
      seat: [THREE.MathUtils.lerp(hold.seat?.[0] ?? 0.055, 0.07, t), THREE.MathUtils.lerp(hold.seat?.[1] ?? 0.032, 0.036, t)],
    };
    this.hold(side, moving, WORLD, pole);
  }

  /** Both arms free: hanging and swinging walking, pumping running (`run`, 0..1 with the stride). */
  private freeArms(fx: number, fz: number, pump: number, swingS: number, run: number): void {
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(-fz, 0, fx);
    const behind = new THREE.Vector3(-fx, 0, -fz);
    const fwdH = new THREE.Vector3(fx, 0, fz);
    for (const side of [1, -1] as const) {
      const arm = side > 0 ? this.arms.r : this.arms.l;
      const S = arm.upper.getWorldPosition(new THREE.Vector3());
      // Each arm forward as the other side's leg is (the right as the left leg comes forward).
      const sw = side * swingS;
      const pp = side * pump;
      const hang = S.clone().addScaledVector(up, -0.52 * this.body.scale.y).addScaledVector(right, side * 0.07).addScaledVector(fwdH, 0.06 + 0.08 * sw);
      const pumped = S.clone().addScaledVector(up, -0.34 * this.body.scale.y).addScaledVector(right, side * 0.01).addScaledVector(fwdH, 0.06 + 1.3 * RUN_PUMP * pp);
      const pole = new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, side * 0.3).normalize()
        .lerp(new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(up, -0.7).addScaledVector(right, side * 0.35).normalize(), run);
      this.reach(arm, hang.lerp(pumped, run), pole);
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
      const along = arm.hand.getWorldPosition(new THREE.Vector3()).sub(elbow).normalize();
      this.orientHand(arm, along, right.clone().multiplyScalar(-side).lerp(behind.clone().negate(), 0.15 * (1 - run)).normalize());
      this.relaxHand(arm, 1 + 0.6 * run);
    }
  }

  /** The shadow's body: the same pose, but with its head, nodding the rest of the way to the view's pitch.
   * With the head shown, the body's own head nods instead. */
  private poseShadow(pitch: number, bend: number): void {
    const nod = -pitch - bend;
    // With the head shown (third person) it nods itself, and casts its own shadow: the copy is hidden.
    if (!this.headless) {
      this.turn('neck_01', 0, nod * 0.4);
      this.turn('head', 0, nod * 0.6);
      this.body.updateMatrixWorld(true);
      return;
    }
    this.shadowBody.position.copy(this.body.position);
    this.shadowBody.quaternion.copy(this.body.quaternion);
    for (const [b, twin] of this.shadowPairs) {
      twin.position.copy(b.position);
      twin.quaternion.copy(b.quaternion);
      twin.scale.copy(b.scale);
    }
    this.shadowHead.forEach((t, i) => {
      t.bone.scale.setScalar(1);
      t.bone.quaternion.premultiply(_q.setFromAxisAngle(t.axes[0], nod * (i === 0 ? 0.4 : 0.6)));
    });
    this.shadowBody.updateMatrixWorld(true);
  }

  /** Splits the hand's roll about the forearm between the forearm and the hand (the rig has no twist bones,
   * so a hand rolled alone wrings the wrist's skin): `TWIST_SHARE` of it goes to the forearm. */
  private shareTwist(arm: Arm): void {
    const axis = arm.hand.position.clone().normalize();
    const rest = this.rest.get(arm.hand)!;
    // The hand's turn from rest, in the forearm's space, and its twist about the forearm's axis.
    const delta = arm.hand.quaternion.clone().multiply(rest.clone().invert());
    const proj = axis.clone().multiplyScalar(axis.dot(new THREE.Vector3(delta.x, delta.y, delta.z)));
    const twist = new THREE.Quaternion(proj.x, proj.y, proj.z, delta.w).normalize();
    const part = new THREE.Quaternion().slerp(twist, TWIST_SHARE);
    arm.lower.quaternion.multiply(part);
    arm.hand.quaternion.premultiply(part.invert());
  }

  /** Turns a hand so its forward (wrist to knuckles) lies along `fwd` and its palm faces `palm`, the forearm
   * taking part of the roll. */
  private orientHand(arm: Arm, fwd: THREE.Vector3, palm: THREE.Vector3): void {
    const f1 = handFrame(fwd, palm, new THREE.Matrix4());
    const want = _q.setFromRotationMatrix(f1.multiply(_m.copy(arm.frame0).transpose())).clone().multiply(arm.q0);
    arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(_q2).invert().multiply(want));
    this.shareTwist(arm);
    arm.hand.updateWorldMatrix(false, true);
  }

  /** A free hand at rest (the model's rest hand is flat, fingers spread like a high five): the fingers drawn
   * together and half closed, the little finger most, the thumb in along the index. `amount` scales it (a
   * runner's hand closes more). */
  private relaxHand(arm: Arm, amount = 1, table: readonly (readonly number[])[] = RELAXED, thumb: readonly [number, number] = [0.35, 0.3]): void {
    arm.hand.updateWorldMatrix(true, true);
    // The hand's frame now: its rest frame carried by its turn from rest.
    const turnFromRest = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.q0.clone().invert());
    const col = (i: number): THREE.Vector3 => new THREE.Vector3().setFromMatrixColumn(arm.frame0, i).applyQuaternion(turnFromRest);
    const fwd = col(0);
    const palm = col(2);
    const across = new THREE.Vector3().crossVectors(palm, fwd).normalize();
    const curl = (b: THREE.Bone, angle: number, axis: THREE.Vector3): void => {
      const local = axis.clone().applyQuaternion(b.parent!.getWorldQuaternion(_q2).invert());
      b.quaternion.premultiply(_q.setFromAxisAngle(local, -angle));
      b.updateWorldMatrix(false, true);
    };
    const mid = arm.fingers[1];
    const tip = (): THREE.Vector3 => mid[2].getWorldPosition(new THREE.Vector3());
    const t0 = tip();
    curl(mid[0], 0.2, across);
    const sgn = tip().sub(t0).dot(palm) > 0 ? 1 : -1;
    curl(mid[0], -0.2, across);
    const toPinky = arm.side === 'r' ? 1 : -1;
    arm.fingers.forEach((chain, f) => {
      curl(chain[0], -toPinky * [0.2, 0.02, -0.12, -0.24][f], palm);
      chain.forEach((b, i) => curl(b, sgn * amount * table[f][i], across));
    });
    // The thumb comes in beside the index, its tip a little bent.
    const t1 = arm.thumb[2].getWorldPosition(new THREE.Vector3());
    curl(arm.thumb[0], 0.15, fwd);
    const way = arm.thumb[2].getWorldPosition(new THREE.Vector3()).sub(t1).dot(palm) > 0 ? 1 : -1;
    curl(arm.thumb[0], -0.15, fwd);
    curl(arm.thumb[0], way * thumb[0] * amount, fwd);
    curl(arm.thumb[2], sgn * thumb[1] * amount, across);
  }

  /** A fist's thumb: folded across the front of the closed fingers, its tip on the index's and middle's middle
   * joints. Each joint in turn is turned a little at a time, about whichever axis brings the tip nearer. */
  private thumbOver(arm: Arm): void {
    const p = (b: THREE.Bone): THREE.Vector3 => b.getWorldPosition(new THREE.Vector3());
    const tc = arm.thumb;
    const tip = (): THREE.Vector3 => {
      const a = p(tc[1]);
      const b = p(tc[2]);
      return b.clone().addScaledVector(b.clone().sub(a), 0.85);
    };
    // Over the second joints of the index and middle, a finger's thickness out from them.
    const hand = p(arm.hand);
    const mid = p(arm.fingers[0][1]).lerp(p(arm.fingers[1][1]), 0.4);
    const out = mid.clone().sub(p(arm.fingers[0][0]).lerp(p(arm.fingers[1][0]), 0.5)).normalize();
    const target = mid.addScaledVector(out, 0.012).addScaledVector(mid.clone().sub(hand).normalize(), -0.005);
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const step = 0.08;
    tc.forEach((bone, i) => {
      for (let n = 0; n < 30; n++) {
        let best = tip().distanceTo(target);
        let pick: THREE.Quaternion | null = null;
        const start = bone.quaternion.clone();
        for (const ax of axes)
          for (const sg of [1, -1]) {
            const local = ax.clone().applyQuaternion(bone.parent!.getWorldQuaternion(_q2).invert());
            bone.quaternion.copy(start).premultiply(_q.setFromAxisAngle(local, sg * step * (i === 0 ? 0.6 : 1)));
            bone.updateWorldMatrix(false, true);
            const d = tip().distanceTo(target);
            if (d < best - 1e-4) {
              best = d;
              pick = bone.quaternion.clone();
            }
          }
        bone.quaternion.copy(pick ?? start);
        bone.updateWorldMatrix(false, true);
        if (!pick) break;
      }
    });
  }

  /** Two-bone IK: the hand bone to `target`, the elbow on the circle where both segments meet, toward `pole`. */
  private reach(arm: Limb, target: THREE.Vector3, pole: THREE.Vector3): void {
    const S = arm.upper.getWorldPosition(new THREE.Vector3());
    const toT = target.clone().sub(S);
    const [lenA, lenB] = armLengths(arm);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(lenA - lenB) + 1e-3, lenA + lenB - 1e-4);
    const dir = toT.normalize();
    const cosA = THREE.MathUtils.clamp((lenA ** 2 + d * d - lenB ** 2) / (2 * lenA * d), -1, 1);
    const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = S.clone().addScaledVector(dir, lenA * cosA).addScaledVector(perp, lenA * Math.sqrt(1 - cosA * cosA));
    aim(arm.upper, arm.lower.getWorldPosition(new THREE.Vector3()).sub(S), E.clone().sub(S));
    arm.upper.updateWorldMatrix(false, true);
    const E2 = arm.lower.getWorldPosition(new THREE.Vector3());
    aim(arm.lower, arm.hand.getWorldPosition(new THREE.Vector3()).sub(E2), S.clone().addScaledVector(dir, d).sub(E2));
    arm.lower.updateWorldMatrix(false, true);
  }

  /** Turns a bone about the figure's axis (0 x, 1 y, 2 z) by `angle`, on top of this frame's pose. */
  private turn(name: string, axis: 0 | 1 | 2, angle: number): void {
    const t = this.turnable.get(name);
    if (!t || angle === 0) return;
    t.bone.quaternion.premultiply(_q.setFromAxisAngle(t.axes[axis], angle));
  }

  /** Puts a hand on a hold (in `frame`'s space) by two-bone IK, orients it and closes the fingers. */
  private hold(side: 'l' | 'r', h: HandHold, frame: THREE.Object3D, pole: THREE.Vector3): void {
    const arm = this.arms[side];
    const m = frame.matrixWorld;
    const palm = h.palm.clone().transformDirection(m);
    const fwd = h.fwd.clone().transformDirection(m);
    this.reach(arm, h.at.clone().applyMatrix4(m).addScaledVector(palm, -(h.seat?.[1] ?? PALM_OFF)).addScaledVector(fwd, -(h.seat?.[0] ?? PALM_BACK)), pole);

    // The hand: its rest frame turned onto the hold's.
    const f1 = handFrame(fwd, palm, new THREE.Matrix4());
    const R = _q.setFromRotationMatrix(f1.multiply(_m.copy(arm.frame0).transpose()));
    const want = R.clone().multiply(arm.q0);
    arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(_q2).invert().multiply(want));
    this.shareTwist(arm);
    arm.hand.updateWorldMatrix(false, true);

    // Fingers close round the gun: each joint about the hand's across axis, toward the palm.
    const across = new THREE.Vector3().crossVectors(palm, fwd).normalize();
    const curl = (b: THREE.Bone, angle: number, axis: THREE.Vector3): void => {
      const local = axis.clone().applyQuaternion(b.parent!.getWorldQuaternion(_q2).invert());
      b.quaternion.premultiply(_q.setFromAxisAngle(local, -angle));
      b.updateWorldMatrix(false, true);
    };
    // First drawn together (the rest hand has them splayed): about the palm's normal, toward the middle
    // finger. A positive turn about the normal swings a finger toward `across`, which is the pinky's side on
    // the right hand and the index's on the left.
    const toPinky = side === 'r' ? 1 : -1;
    arm.fingers.forEach((chain, f) => curl(chain[0], -toPinky * [0.2, 0.02, -0.12, -0.24][f], palm));
    // Which way about `across` closes a finger: the way that brings the middle finger's tip toward the palm's
    // side (the hands mirror each other, so it isn't the same for both).
    const mid = arm.fingers[1];
    const tipOf = (): THREE.Vector3 => mid[2].getWorldPosition(new THREE.Vector3());
    const t0 = tipOf();
    curl(mid[0], 0.2, across);
    const sgn = tipOf().sub(t0).dot(palm) > 0 ? 1 : -1;
    curl(mid[0], -0.2, across);
    let touches: ((p: THREE.Vector3) => boolean) | null = null;
    const rodDir = new THREE.Vector3();
    let rodDist = (_p: THREE.Vector3): number => 0;
    if (h.wrap) {
      // Each finger closes joint by joint until it touches what it holds (a rod in the hold's frame): the
      // knuckle turns until the next joint or the tip would be in it, then the next knuckle, and so on.
      const a = h.wrap.a.clone().applyMatrix4(m);
      const b = h.wrap.b.clone().applyMatrix4(m);
      // An oval section: r across the side plane, rx (if given) across the gun.
      const ry = h.wrap.r + FINGER_R;
      const rx = (h.wrap.rx ?? h.wrap.r) + FINGER_R;
      const xw = new THREE.Vector3(1, 0, 0).transformDirection(m);
      const seg = new THREE.Line3(a, b);
      const near = new THREE.Vector3();
      const d = new THREE.Vector3();
      const inside = (p: THREE.Vector3): boolean => {
        d.subVectors(p, seg.closestPointToPoint(p, true, near));
        const dx = d.dot(xw);
        const dp = Math.sqrt(Math.max(0, d.lengthSq() - dx * dx));
        return (dx / rx) ** 2 + (dp / ry) ** 2 < 1;
      };
      touches = inside;
      rodDir.subVectors(b, a).normalize();
      rodDist = (p: THREE.Vector3): number => seg.closestPointToPoint(p, true, near).distanceTo(p);
      const tip = new THREE.Vector3();
      const after = (chain: THREE.Bone[], i: number): THREE.Vector3[] => {
        const pts = chain.slice(i + 1).map((bn) => bn.getWorldPosition(new THREE.Vector3()));
        const p2 = chain[1].getWorldPosition(new THREE.Vector3());
        const p3 = chain[2].getWorldPosition(new THREE.Vector3());
        pts.push(tip.copy(p3).addScaledVector(p3.clone().sub(p2), 0.85));
        return pts;
      };
      arm.fingers.forEach((chain, f) => {
        // The right index lies along the trigger, looser than the rest.
        const limit = side === 'r' && f === 0 && h.trigger ? TRIGGER_LIMIT : CURL_LIMIT;
        chain.forEach((bone, i) => {
          for (let turned = 0; turned < limit[i] * h.curl; turned += CURL_STEP) {
            curl(bone, CURL_STEP * sgn, across);
            if (after(chain, i).some(inside)) {
              curl(bone, -CURL_STEP * sgn, across);
              break;
            }
          }
        });
      });
    } else for (const chain of arm.fingers) chain.forEach((b, i) => curl(b, sgn * h.curl * [0.75, 1, 0.75][i], across));
    if (h.thumbRest && touches) {
      // The thumb hooked round what's held from its near side: its root turned to lay the first joint on the
      // hold's face (at `off` on its section, a little way along it), then the two joints closed round it, about
      // its own line, until they touch.
      const tc = arm.thumb;
      const base = tc[0].getWorldPosition(new THREE.Vector3());
      const along = h.thumbRest.along.clone().transformDirection(m);
      const foot = h.at.clone().add(h.thumbRest.off).applyMatrix4(m);
      const up = base.clone().sub(foot).dot(along);
      const target = foot.clone().addScaledVector(along, up + 0.028 * this.body.scale.x);
      aim(tc[0], tc[1].getWorldPosition(new THREE.Vector3()).sub(base), target.sub(base));
      tc[0].updateWorldMatrix(false, true);
      const tipT = (): THREE.Vector3 => {
        const q1 = tc[1].getWorldPosition(new THREE.Vector3());
        const q2 = tc[2].getWorldPosition(new THREE.Vector3());
        return q2.clone().addScaledVector(q2.clone().sub(q1), 0.85);
      };
      // The middle joint swings the rest of the thumb to the side it goes round, clear of the hold; the last joint
      // then closes onto it.
      const round = h.thumbRest.round.clone().transformDirection(m);
      const k = this.body.scale.x;
      const j1 = tc[1].getWorldPosition(new THREE.Vector3());
      // (Its next joint lands on the hold's far side from the hand, a thumb's width off its middle.)
      const side2 = h.at.clone().applyMatrix4(m).addScaledVector(round, h.wrap!.r + 0.011 * k).addScaledVector(along, j1.clone().sub(h.at.clone().applyMatrix4(m)).dot(along) + 0.022 * k);
      aim(tc[1], tc[2].getWorldPosition(new THREE.Vector3()).sub(j1), side2.sub(j1));
      tc[1].updateWorldMatrix(false, true);
      const before = rodDist(tipT());
      curl(tc[2], 0.15, along);
      const way2 = rodDist(tipT()) < before ? 1 : -1;
      curl(tc[2], -0.15, along);
      for (let turned = 0; turned < 1.0; turned += CURL_STEP) {
        curl(tc[2], CURL_STEP * way2, along);
        if (touches(tipT())) {
          curl(tc[2], -CURL_STEP * way2, along);
          break;
        }
      }
    } else if (h.wrap && h.thumb > 0 && touches) {
      // The thumb closes over what it holds until it touches it: its base swings across the palm (about the
      // hand's forward), its two joints wrap round the rod (about its axis); each the way that brings the tip
      // nearer the rod.
      const tc = arm.thumb;
      const tipT = (): THREE.Vector3 => {
        const p2 = tc[1].getWorldPosition(new THREE.Vector3());
        const p3 = tc[2].getWorldPosition(new THREE.Vector3());
        return p3.clone().addScaledVector(p3.clone().sub(p2), 0.85);
      };
      const pts = (i: number): THREE.Vector3[] => [...tc.slice(i + 1).map((bn) => bn.getWorldPosition(new THREE.Vector3())), tipT()];
      tc.forEach((bone, i) => {
        const axis = i === 0 ? fwd.clone() : rodDir.clone();
        const before = rodDist(tipT());
        curl(bone, 0.15, axis);
        const way = rodDist(tipT()) < before ? 1 : -1;
        curl(bone, -0.15, axis);
        for (let turned = 0; turned < THUMB_LIMIT[i] * h.thumb * 2; turned += CURL_STEP) {
          curl(bone, CURL_STEP * way, axis);
          if (pts(i).some(touches)) {
            curl(bone, -CURL_STEP * way, axis);
            break;
          }
        }
      });
    } else {
      // The thumb comes round the other way, across the palm.
      arm.thumb.forEach((b, i) => curl(b, h.thumb * [0.2, 0.6, 0.6][i], i === 0 ? fwd : across));
    }
    this.lastSign = sgn;
  }
}
