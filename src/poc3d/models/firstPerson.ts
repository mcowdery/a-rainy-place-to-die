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
import { buildBat, type Bat } from './bat';
import type { AnimLibrary } from './characterAnims';
import type { CityMoves } from './cityMoves';
import { Footfalls, gaitBob, legPose, strikePhase, STRIDE_HZ, type Foot } from './gait';
import { swordQuat, type Hitter, type Melee, type MeleePose, type MeleeWeapon, type SwordKey } from './melee';
import { Smoking, type Hands, type SmokeCtx } from './smoking';

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
/**
 * Raised with nowhere to shoot (`pulledBack`): where the gun hand is held, from the gun shoulder in the body's
 * frame (the model faces +z, his right is -x: in front of his chest, inside a car's window), and how the gun's
 * tipped there (muzzle up).
 */
const PULLED_AT = new THREE.Vector3(0.13, -0.1, 0.24);
const PULLED_TILT = new THREE.Euler(1.0, Math.PI, 0.2, 'YXZ');
/**
 * The gun is drawn and put away, not conjured: seconds to draw it and to put it away; the share of that the empty
 * hand takes to get to it (the gun shows from then); and how far out (0-1) counts as in hand, to fire. It's kept at
 * his belt, at the front of the right hip (`HOLSTER`, from the pelvis in the body's frame: +x his left, +z forward,
 * metres on the unscaled rig), the muzzle down (`HOLSTER_TIP`: the pitch from level), and comes up in front of the
 * chest (`DRAW_VIA`) on its way to the hold.
 */
const DRAW_TIME = 0.42;
const HOLSTER_TIME = 0.4;
const GRAB = 0.4;
const DRAWN = 0.97;
const HOLSTER = new THREE.Vector3(-0.17, 0.05, 0.1);
const HOLSTER_TIP = 1.3;
const DRAW_VIA = new THREE.Vector3(-0.15, 0.4, 0.3);
/**
 * Reloading the pistol: the gun's brought in in front of him, where he's looking (`RELOAD_AT`, `RELOAD_TILT`: in
 * the view's frame, as the holds are: low and a little right, tipped muzzle up and canted), the empty magazine drops out of the grip, the
 * left hand goes to his belt for a fresh one (`MAG_POUCH`), brings it up under the grip and pushes it home, the slide
 * (locked back on the last round) runs forward, the hand goes back to what it was doing and the gun back out. The
 * times are shares of the reload: `R`.
 */
const RELOAD_AT = new THREE.Vector3(0.05, -0.11, -0.4);
const RELOAD_TILT = new THREE.Euler(0.55, 0.4, -0.45, 'YXZ');
const MAG_POUCH = new THREE.Vector3(0.15, 0.06, 0.11);
const R = { in: 0.14, drop: 0.08, toBelt: 0.3, toGun: 0.5, home: 0.58, slide: 0.66, away: 0.7, back: 0.86, out: 0.8 } as const;
const MAG_SIZE = [0.02, 0.1, 0.03] as const;
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
const RELAXED = [[0.2, 0.38, 0.2], [0.26, 0.46, 0.24], [0.33, 0.54, 0.28], [0.4, 0.6, 0.32]];
/**
 * An arm hanging at his side (m at the model's size): the wrist this far below the shoulder (the arm all but
 * straight: its reach is 0.564, so the elbow is some 20 degrees off straight), out from it and ahead of it; how far
 * the hand swings with the walk; and how far the palm, which faces the thigh, is turned to the back.
 */
const HANG = { down: 0.552, out: 0.065, ahead: 0.03, swing: 0.11, back: 0.3 } as const;
/**
 * Squatting on his heels (the Japanese squat, as the city's shady do: feet flat, knees apart, the seat down between
 * the heels): the thigh brought up forward and the knee folded (rad; the shin is left leaning forward over the
 * foot, which is turned back level), the knees out to the sides, the back leant forward over them; the forearms
 * rest on the knees, the hands hanging in front of them (ahead of the knee, in toward the other, below it: m).
 */
/**
 * His legs are brought in under his hips (rad at the hip, standing, and that much more walking): the model's own
 * stance is an A-pose's, the ankles 41 cm apart, and the walk swung the legs from there, which read as too wide
 * (the user, 2026-10-05). Standing they're now about 22 cm apart, walking about 17. Nothing else of the walk and
 * the run is changed: the user tried a rebuilt gait (feet planted by IK, the default pace a run) and preferred this
 * one ("the old walking animation was much better, just his gait was too wide"); that he covers more ground than
 * his strides is his not being quite human.
 */
const STANCE_IN = 0.099;
const STANCE_WALK = 0.026;
/**
 * A jump (the legs' angles in the air, rad: the thigh forward and the knee's bend, each as he leaves the ground and
 * so much more at the top; the leading leg, then the trailing one; the toes pointed), and how hard he lands (the
 * knees give by a spring: its stiffness, its damping, and the push of each m/s he lands at).
 */
const JUMP = { lead: { thigh: [0.12, 0.6], knee: [0.15, 0.95] }, trail: { thigh: [-0.12, 0.3], knee: [0.2, 0.75] }, point: 0.45, spring: 200, damp: 24, push: 1.15, takeoff: 4.4 } as const;
// (Not right down on his heels: the first version sat lower, the back bent well over, and looked uncomfortable (the
// user, 2026-10-06). The seat is some 10 cm higher, the back straighter and the knees a little wider.)
const SQUAT = { thigh: 1.8, knee: 2.25, apart: 0.58, lean: 0.48, hand: [0.17, 0.05, 0.03] } as const;
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
/** A weapon raised in first person: from this far below the eyes' level (the keys' y, metres), over this much more,
 * its hands go this much further up and back, out of the view; only while they're this near the face (the keys'
 * z: not at all at `far`, wholly `near` it), so a swing coming through at arm's length is as keyed. */
const FP_RAISE = { from: 0, over: 0.12, up: 0.14, back: 0.2, far: -0.36, near: -0.2 } as const;
/** The bat carried (the body's frame, as the saya): the top of its handle by his right thigh, in the right hand,
 * the barrel down and ahead; how far it swings with his stride (m). */
const BAT_CARRY = new THREE.Vector3(-0.27, 0.86, 0.06);
const BAT_CARRY_DIR = new THREE.Vector3(0.04, -0.72, 0.7).normalize();
const BAT_CARRY_EDGE = new THREE.Vector3(0, -0.7, -0.72).normalize();
const BAT_CARRY_SWING = 0.07;
/** A swing's lower body (models/melee.ts' `LegsKey`): how much of the hips' sinking the eyes go down by (the page
 * lowers the camera by `eyeDrop`); how far a foot follows the hips round on its ball as its own hip comes forward,
 * and how far its heel comes up with that; the ball ahead of the ankle (m, at Mack's size). */
const EYE_SINK = 0.4;
const FOOT_PIVOT = 0.9;
const HEEL_UP = 0.55;
const BALL_AHEAD = 0.14;
/** Frames a second the library's fitted clips are sampled at (characterAnims.ts' RATE); how far his fingers close
 * on a handle his hand is given by a clip (of a fist). */
const CLIP_RATE = 30;
const CLIP_GRIP = 0.85;
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
  /** How far the gun's out: 0 put away at his belt, 1 in hand. */
  private draw = 0;
  /** How long the reload under way takes in all (s), and whether the gun was empty (its slide locked back). */
  private reloadFull = 1;
  private reloadEmpty = false;
  /** The pistol's magazine, seen out of the gun while it's changed. */
  private mag: THREE.Mesh | null = null;
  /**
   * The draw's own time step this frame, where the rest of him runs slower (the car's slow motion: he draws in
   * real time); null: the frame's. Set before `update`, used once.
   */
  drawDt: number | null = null;
  /** For checks: the draw held part way (0-1), to look at it. */
  drawHold: number | null = null;
  /** The rig draws its own plain muzzle flash (off where the page draws a better one: the city, real/gunfire.ts). */
  ownFlash = true;
  /**
   * Raised, but with nowhere to shoot (a car's driver aiming at his own windscreen: race/carDriver.ts): the gun's
   * pulled back in and held up by his shoulder, muzzle to the roof, until there's a line of fire again.
   */
  pulledBack = false;
  private pulled = 0;
  /** For checks: a reload held part way (0-1). */
  reloadHold: number | null = null;
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
  /** His smoking: lighting up, the drags, flicking it away (models/smoking.ts; the page draws the smoke from `smoking.out`). */
  readonly smoking: Smoking = new Smoking(this.handTools());
  private handsFree = false;
  private runNow = 0;
  /** His leg's length, hip to ankle (m at the model's size). */
  private legLen = 0.974;
  /**
   * In the air (the page's: a jump or a drop): how high his feet are above the ground (m) and how fast he's rising
   * (m/s; falling: negative). The body is already that high (the floor he's given is his feet's); this is for the
   * legs and arms, and for the knees giving as he lands.
   */
  air = 0;
  airV = 0;
  private airK = 0;
  private fell = 0;
  private landSink = 0;
  private landV = 0;
  /** Asked to squat on his heels (he does with his hands free, standing still; he's up again to move or draw). */
  squatting = false;
  private sq = 0;
  private dropped = 0;
  private ankleRest = 0;
  private readonly neckRest = new THREE.Vector3();
  private smokeFrame: Pick<SmokeCtx, 'dt' | 'eye' | 'viewQ' | 'fx' | 'fz' | 'floor' | 'idle' | 'running' | 'squat'> | null = null;
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
  /** The bat (models/bat.ts), placed by the same keys. */
  readonly bat: Bat;
  /** The animation library (models/characterAnims.ts), if the page has given it: a fighting move may be one of its
   * clips, played over his whole body (`overlayClip`). */
  anims: AnimLibrary | null = null;
  /** What of the library is his own on foot (models/cityMoves.ts: his walk, and his body's stance with the pistol
   * out), if the page has given it (with `anims`): laid over the keyed pose each frame (`layMoves`). */
  moves: CityMoves | null = null;
  private readonly clipTracks = new Map<THREE.AnimationClip, { bone: THREE.Bone; q: Float32Array | null; p: Float32Array | null }[]>();
  private bonesByName: Map<string, THREE.Bone> | null = null;
  private pelvisBone: THREE.Bone | null = null;
  private readonly pelvisLocal = new THREE.Vector3();
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
    this.ankleRest = this.legs.l.hand.getWorldPosition(new THREE.Vector3()).y;
    {
      const [thigh, shin] = armLengths(this.legs.l);
      this.legLen = thigh + shin;
    }
    this.neck.getWorldPosition(this.neckRest);
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
    this.bat = buildBat(env);
    this.bat.root.visible = false;
    this.object.add(this.bat.root);
    this.object.add(this.katana.sword, this.katana.saya);
    this.object.add(this.smoking.group);
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
    this.smoking.takeOver(old.smoking);
    this.squatting = old.squatting;
    this.sq = old.sq;
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
    this.anims = old.anims;
    this.moves = old.moves;
    if (old.fitHeight !== null) this.fitEye(old.fitHeight);
    if (!old.object.children.includes(old.flashLight)) this.object.remove(this.flashLight);
    this.object.visible = old.object.visible;
  }

  /** How far his eyes are below their standing height (m): squatting. The page lowers the camera by it. */
  get eyeDrop(): number {
    return this.dropped;
  }

  /** The eyes' height above the feet. */
  get eyeHeight(): number {
    return this.eyeY;
  }

  /** How the body rides its stride: -1 as each foot lands, 1 between, nothing standing (for the camera's bob). */
  get bob(): number {
    return this.mounted || this.airK > 0.5 ? 0 : gaitBob(this.walk, this.runNow, this.stride);
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
    // Still on its way out of his belt: it fires as soon as it's in hand.
    if (this.draw < DRAWN) {
      this.queued = this.armed;
      return false;
    }
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
    if (this.loaded === 0) {
      this.reloadT = this.reloadFull = this.reloadTime();
      this.reloadEmpty = true;
    }
    return true;
  }

  /** His gun arm, for whoever needs to know where a straight arm puts the gun (a car's driver: is it out of the window?): the shoulder (world) and its reach. */
  gunArm(): { shoulder: THREE.Vector3; reach: number } {
    const [la, lb] = armLengths(this.arms.r);
    return { shoulder: this.arms.r.upper.getWorldPosition(new THREE.Vector3()), reach: (la + lb) * EXTEND };
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
    if (this.loaded < this.guns[this.kind].shells && this.reloadT <= 0 && this.draw >= DRAWN) {
      this.reloadT = this.reloadFull = this.reloadTime();
      this.reloadEmpty = false;
    }
  }

  /** Reloading now. */
  get reloading(): boolean {
    return this.reloadT > 0;
  }

  /** Seconds to reload: shells one at a time into the lever-action, two into the double, a magazine. */
  private reloadTime(): number {
    return this.kind === 'lever' ? 2.2 : this.kind === 'double' ? 1.6 : 1.6;
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
    // The gun out of his belt, or back into it.
    const drawStep = this.drawDt ?? dt;
    this.drawDt = null;
    this.draw = this.armed ? Math.min(1, this.draw + drawStep / DRAW_TIME) : Math.max(0, this.draw - drawStep / HOLSTER_TIME);
    if (this.drawHold !== null) this.draw = this.drawHold;
    if (!this.armed) this.queued = false;
    this.pulled += ((this.pulledBack && this.armed ? 1 : 0) - this.pulled) * Math.min(1, drawStep * 10);
    // (Putting it away, it goes from where it was held: the aim stays as it was until it's gone.)
    if (this.armed || this.draw <= 0) this.aim += ((this.aiming || snapping ? 1 : 0) - this.aim) * Math.min(1, dt * (snapping ? 16 : 9));
    if (this.queued && this.draw >= DRAWN && (this.aim >= 0.96 || !(this.oneHand || this.mounted))) this.fire();
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
    if (this.reloadHold !== null) {
      this.reloadFull = this.reloadTime();
      this.reloadT = (1 - this.reloadHold) * this.reloadFull + dt;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      // (The shotguns dip and tilt in the hands; the pistol's magazine is changed, below.)
      if (this.kind !== 'pistol') reloadDip = Math.sin(Math.min(1, Math.max(0, 1 - this.reloadT / this.reloadFull)) * Math.PI);
      if (this.reloadT <= 0) this.loaded = this.guns[this.kind].shells;
    }
    this.stride += (Math.min(1, speed / 1.6) - this.stride) * Math.min(1, dt * 6);
    // How fast and how far: strides a second rise gently with speed (a walk ~0.85, a run ~1.4; the rest of a
    // run's speed is longer strides), and running swings the legs further.
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 4);
    // In the air (a jump) the stride waits and the legs are drawn up; as he lands the knees give, on a spring.
    const inAir = this.air > 0.02;
    this.airK += ((inAir ? 1 : 0) - this.airK) * Math.min(1, dt * 14);
    if (inAir) this.fell = this.airV;
    else if (this.fell !== 0) {
      this.landV += JUMP.push * Math.abs(this.fell);
      this.fell = 0;
    }
    this.landV += (-JUMP.spring * this.landSink - JUMP.damp * this.landV) * dt;
    this.landSink = Math.max(0, this.landSink + this.landV * dt);
    if (this.landSink === 0 && this.landV < 0) this.landV = 0;
    if (!inAir) this.walk += dt * Math.PI * 2 * (STRIDE_HZ[0] + STRIDE_HZ[1] * this.speedNow);
    const run = (this.runNow = THREE.MathUtils.clamp((this.speedNow - 1.8) / 2.2, 0, 1));
    // Down on his heels, or up again (half a second each way): only with his hands free, standing still.
    const down = this.squatting && !this.armed && this.draw <= 0 && !this.mounted && !this.melee && speed < 0.3;
    this.sq += ((down ? 1 : 0) - this.sq) * Math.min(1, dt * 5.5);
    if (this.sq < 0.001 && !down) this.sq = 0;
    const sq = this.sq * this.sq * (3 - 2 * this.sq);
    this.dropped = 0;
    // (The pelvis back where it rests: a library clip may have moved it last frame.)
    if (this.pelvisBone) this.pelvisBone.position.copy(this.pelvisLocal);

    // The body: under the camera, facing where it looks, the eyes BACK behind the camera.
    const fwd = camera.getWorldDirection(_a);
    const pitch = pitchOverride ?? Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const heading = Math.atan2(fwd.x, fwd.z);
    const viewQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, heading + Math.PI, 0, 'YXZ'));
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const bike = this.mounted;
    // (For his smoking, which works the arms last: models/smoking.ts, from poseShadow.)
    this.handsFree = false;
    this.smokeFrame = { dt, eye: camera.position, viewQ, fx, fz, floor, idle: speed < 0.15, running: run > 0.5, squat: sq };
    // The upper body follows the view up and down (less looking down: the body would come up under the
    // camera), so the arms keep the gun in reach. Seated, it stays upright.
    const bend = bike ? 0 : -pitch * (pitch > 0 ? 0.55 + 0.15 * this.aim : 0.3 * this.aim + 0.08);
    if (bike) {
      // On a bike: seated (the camera is at the eyes), the chest turning a little toward where you look.
      const bf = new THREE.Vector3(0, 0, -1).applyQuaternion(bike.root.getWorldQuaternion(new THREE.Quaternion()));
      const rel = Math.atan2(fx * bf.z - fz * bf.x, fx * bf.x + fz * bf.z);
      // (In a car's seat he leans to the window he shoots from instead, and turns little: carDriver.ts.)
      this.rideTwist = THREE.MathUtils.clamp(-rel, -1.0, 1.0) * this.aim * (bike.rider.pedals ? 0.25 : 1);
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
    // (Squatting, his back leans forward over his knees.)
    this.turn('spine_01', 0, SQUAT.lean * 0.42 * sq);
    this.turn('spine_02', 0, SQUAT.lean * 0.33 * sq);
    this.turn('spine_03', 0, SQUAT.lean * 0.25 * sq);
    // A shooter's stance: the chest turned toward the gun hand, bringing the left shoulder forward to the
    // forend (more when it's raised); one-handed, the other way, the gun shoulder forward behind the arm.
    const twist = this.armed && !bike ? -(0.22 + 0.12 * this.aim) * (1 - this.one) + 0.14 * this.aim * this.one : 0;
    this.turn('spine_02', 1, twist * 0.45);
    this.turn('spine_03', 1, twist * 0.55);
    // Legs: a stance, or a walk (seated: none, the pegs have them).
    const s = Math.sin(this.walk);
    const k = bike ? 0 : this.stride;
    if (!bike) {
      // On the ground: the walk's swing. In the air: drawn up (all but straight as he leaves the ground and comes
      // down to it, most at the top), the leg that was leading ahead. Landing: the knees give.
      const g = k * (1 - sq) * (1 - this.airK);
      const tuck = THREE.MathUtils.clamp(1 - Math.abs(this.airV) / JUMP.takeoff, 0, 1);
      const give = Math.acos(THREE.MathUtils.clamp(1 - this.landSink / (this.legLen * this.body.scale.y), -1, 1));
      // (Brought in under the hips from the model's wide stance, the feet kept flat.)
      const narrow = (STANCE_IN + STANCE_WALK * k) * (1 - sq);
      for (const foot of ['l', 'r'] as const) {
        const out = foot === 'l' ? 1 : -1;
        const leg = legPose(this.walk, run, foot);
        const J = (s > 0) === (foot === 'l') ? JUMP.lead : JUMP.trail;
        const thigh = leg.thigh * g + SQUAT.thigh * sq + (J.thigh[0] + J.thigh[1] * tuck) * this.airK + give;
        const knee = leg.knee * g + SQUAT.knee * sq + (J.knee[0] + J.knee[1] * tuck) * this.airK + 2 * give;
        this.turn(`thigh_${foot}`, 2, -out * narrow);
        this.turn(`foot_${foot}`, 2, out * narrow);
        this.turn(`thigh_${foot}`, 0, -thigh);
        // (Squatting: the knees apart; the feet flat, turned back level against the thigh and the shin.)
        this.turn(`thigh_${foot}`, 1, out * SQUAT.apart * sq);
        this.turn(`calf_${foot}`, 0, knee);
        this.turn(`foot_${foot}`, 0, (SQUAT.thigh - SQUAT.knee) * sq - give + JUMP.point * this.airK);
      }
      this.turn('pelvis', 1, 0.06 * s * k);
      // Running, the body leans into it; landing, over his knees.
      this.turn('spine_01', 0, 0.12 * run * k + 1.2 * this.landSink);
    }
    this.object.updateMatrixWorld(true);
    if (sq > 0 && !bike) {
      // Squatting: the body let down until his feet are on the ground again, and moved so his neck stays under the
      // eyes (his weight over his feet); how far that has brought his eyes down is the page's to lower the camera by.
      const sc = this.body.scale.y;
      const sole = Math.min(this.legs.l.hand.getWorldPosition(_a).y, this.legs.r.hand.getWorldPosition(_b).y) - (floor + this.ankleRest * sc);
      const n = this.neck.getWorldPosition(_c);
      const ahead = ((n.x - this.body.position.x) * fx + (n.z - this.body.position.z) * fz - this.neckRest.z * sc) * sq;
      this.body.position.x -= fx * ahead;
      this.body.position.y -= sole;
      this.body.position.z -= fz * ahead;
      this.dropped = Math.max(0, floor + this.neckRest.y * sc - (n.y - sole)) * sq;
      this.object.updateMatrixWorld(true);
    } else if (!bike && this.landSink > 0 && this.airK < 0.5) {
      // Landing: the knees have given, and the body comes down on them until his feet are on the ground.
      const sole = Math.min(this.legs.l.hand.getWorldPosition(_a).y, this.legs.r.hand.getWorldPosition(_b).y) - (floor + this.ankleRest * this.body.scale.y);
      this.body.position.y -= Math.max(0, sole) * Math.min(1, this.landSink / 0.01);
      this.dropped = 0.6 * this.landSink;
      this.object.updateMatrixWorld(true);
    }
    // The feet landing (seated or in the air, none; the next waits for a fresh swing).
    if (bike || this.airK > 0.5) this.footfalls.reset();
    else for (const foot of this.footfalls.step(this.walk, run, k)) this.onFootfall?.(foot, this.legs[foot].hand.getWorldPosition(_foot), run, k);

    if (this.melee && !bike) {
      for (const g of Object.values(this.guns)) g.root.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.fight(this.melee, camera, viewQ, fx, fz, s * k, k, run);
      this.poseShadow(pitch, bend);
      return;
    }
    this.katana.sword.visible = this.katana.saya.visible = this.bat.root.visible = false;
    const away = !this.armed && this.draw <= 0;
    if (away && bike) {
      for (const g of Object.values(this.guns)) g.root.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.gripHand('r', bike);
      this.gripHand('l', bike);
      this.poseShadow(pitch, 0);
      return;
    }
    if (away) {
      // Hands free: both arms swing with the walk (each against its own leg) and pump running, hands relaxed.
      this.handsFree = true;
      for (const g of Object.values(this.guns)) g.root.visible = false;
      this.flash.visible = false;
      this.flashLight.intensity = 0;
      this.freeArms(fx, fz, Math.sin(this.walk) * k, s * k, run * k, sq, this.airK);
      this.layMoves(dt, speed, false, 0, { at: (this.walk - strikePhase(run, k)) / (2 * Math.PI), k: k * (1 - sq) * (1 - this.airK), run });
      // (His head stays up over the squat's lean.)
      this.poseShadow(pitch, bend + SQUAT.lean * sq);
      return;
    }
    if (!bike) this.layMoves(dt, speed, true, bend, { at: (this.walk - strikePhase(run, k)) / (2 * Math.PI), k: k * (1 - sq) * (1 - this.airK), run });
    // The gun, in the camera's frame (unseen until the hand has it: it's drawn from his belt).
    for (const g of Object.values(this.guns)) g.root.visible = g.kind === this.kind && this.draw > GRAB;
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
    // A pistol's slide snaps back with the shot; on the last round it stays back, until the fresh magazine's in.
    const rp = this.reloadT > 0 && gun.kind === 'pistol' ? 1 - this.reloadT / this.reloadFull : -1;
    const locked = rp >= 0 && this.reloadEmpty ? 1 - THREE.MathUtils.smoothstep(rp, R.slide, R.slide + 0.04) : 0;
    if (gun.slide) gun.slide.position.z = Math.max(THREE.MathUtils.clamp(this.kick * 0.35, 0, 0.028), 0.028 * locked);
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
    // Nowhere to shoot: the gun pulled back in, held up by his shoulder.
    if (this.pulled > 0.001) {
      const bodyQ = this.body.getWorldQuaternion(new THREE.Quaternion());
      const q = bodyQ.clone().multiply(_q.setFromEuler(PULLED_TILT));
      const wrist = this.arms.r.upper.getWorldPosition(new THREE.Vector3()).add(PULLED_AT.clone().multiplyScalar(this.body.scale.x).applyQuaternion(bodyQ));
      const k = THREE.MathUtils.smoothstep(this.pulled, 0, 1);
      gun.root.position.lerp(wrist.sub(wristLocal.clone().applyQuaternion(q)), k);
      gun.root.quaternion.slerp(q, k);
    }
    gun.root.position.add(kickPush.applyQuaternion(viewQ));
    gun.root.updateMatrixWorld(true);
    this.flash.visible = this.flashT > 0 && this.ownFlash;
    if (this.flash.visible) this.flash.scale.setScalar(0.22 + Math.random() * 0.12);
    this.flashLight.intensity = this.flashT > 0 ? 6 : 0;

    // Reloading the pistol: brought in in front of him, muzzle up, for the magazine to be changed.
    let leftAt: { at: THREE.Vector3; palm: THREE.Vector3; fwd: THREE.Vector3; curl: number } | null = null;
    if (this.mag) this.mag.visible = false;
    if (rp >= 0 && gun.grip.wrap) {
      const ease = (k: number): number => THREE.MathUtils.smoothstep(k, 0, 1);
      const sc = this.body.scale.x;
      const bodyQ = this.body.getWorldQuaternion(new THREE.Quaternion());
      const hip = this.body.localToWorld(this.pelvisRest.clone());
      const w = ease(rp / R.in) * (1 - ease((rp - R.out) / (1 - R.out)));
      gun.root.position.lerp(RELOAD_AT.clone().applyQuaternion(viewQ).add(camera.position), w);
      gun.root.quaternion.slerp(viewQ.clone().multiply(_q.setFromEuler(RELOAD_TILT)), w);
      gun.root.updateMatrixWorld(true);
      // The magazine's place in the grip, and the way out of it (down the grip), in the world.
      const m = gun.gripParent.matrixWorld;
      const gq = gun.gripParent.getWorldQuaternion(new THREE.Quaternion());
      const axis = gun.grip.wrap.b.clone().sub(gun.grip.wrap.a).normalize().applyQuaternion(gq);
      const seated = gun.grip.wrap.a.clone().lerp(gun.grip.wrap.b, 0.5).applyMatrix4(m);
      const below = seated.clone().addScaledVector(axis, MAG_SIZE[1] + 0.02);
      if (!this.mag) {
        this.mag = new THREE.Mesh(new THREE.BoxGeometry(...MAG_SIZE), new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.7, roughness: 0.4 }));
        this.mag.castShadow = true;
        gun.root.parent?.add(this.mag);
      }
      const mag = this.mag;
      mag.quaternion.copy(gq).multiply(_q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), gun.grip.wrap.b.clone().sub(gun.grip.wrap.a).normalize()));
      // The left hand: to his belt for the fresh magazine, up under the grip with it, then back to what it was at.
      const pouch = hip.clone().add(MAG_POUCH.clone().multiplyScalar(sc).applyQuaternion(bodyQ));
      const usual = bike
        ? bike.rider.gripL.clone().applyMatrix4((bike.steer.children[0] ?? bike.steer).matrixWorld)
        : one < 0.5
          ? gun.fore.at.clone().applyMatrix4(gun.root.children[0].matrixWorld)
          : this.arms.l.upper.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.07 * fz, -0.52, -0.07 * fx).multiplyScalar(sc));
      const up = axis.clone().negate();
      const across = new THREE.Vector3(-0.5, 0, 0.85).applyQuaternion(bodyQ);
      const under = { palm: up, fwd: across.clone().addScaledVector(up, -across.dot(up)).normalize() };
      const atBelt = { palm: new THREE.Vector3(0, 0, -1).applyQuaternion(bodyQ), fwd: new THREE.Vector3(0.25, -1, 0).normalize().applyQuaternion(bodyQ) };
      const mix = (a: typeof under, b: typeof under, k: number): typeof under => {
        const palm = a.palm.clone().lerp(b.palm, k).normalize();
        const fwd = a.fwd.clone().lerp(b.fwd, k);
        return { palm, fwd: fwd.addScaledVector(palm, -fwd.dot(palm)).normalize() };
      };
      // (The hand under the magazine's base: a palm's depth below it.)
      const hand = (base: THREE.Vector3): THREE.Vector3 => base.clone().addScaledVector(axis, MAG_SIZE[1] / 2 + 0.012);
      if (rp > R.in && rp < R.back) {
        if (rp < R.toBelt) {
          const k = ease((rp - R.in) / (R.toBelt - R.in));
          leftAt = { at: usual.clone().lerp(pouch, k), ...mix(under, atBelt, k), curl: 0.5 };
        } else if (rp < R.toGun) {
          const k = ease((rp - R.toBelt) / (R.toGun - R.toBelt));
          leftAt = { at: pouch.clone().lerp(hand(below), k), ...mix(atBelt, under, k), curl: 0.7 };
        } else if (rp < R.away) {
          const k = ease((rp - R.toGun) / (R.home - R.toGun));
          leftAt = { at: hand(below.clone().lerp(seated, k)), ...under, curl: 0.35 };
        } else {
          const k = ease((rp - R.away) / (R.back - R.away));
          leftAt = { at: hand(seated).lerp(usual, k), ...under, curl: 0.5 };
        }
      }
      // The magazine: the empty one slides out and falls; the fresh one comes up in his hand and goes home.
      if (rp > R.drop && rp < R.toBelt) {
        const t = (rp - R.drop) * this.reloadFull;
        mag.visible = true;
        mag.position.copy(seated).addScaledVector(axis, Math.min(MAG_SIZE[1] + 0.02, t * 1.2)).add(new THREE.Vector3(0, -4.9 * Math.max(0, t - 0.1) ** 2, 0));
      } else if (rp >= R.toBelt && rp < R.home && leftAt) {
        mag.visible = true;
        mag.position.copy(leftAt.at).addScaledVector(axis, -(MAG_SIZE[1] / 2 + 0.012));
      }
    }
    // Drawn from his belt, and put back there: the empty hand goes to it first (the gun unseen, waiting at the
    // hip, muzzle down), then it comes up in front of the chest and out to the hold.
    if (this.draw < 1) {
      const sc = this.body.scale.x;
      const bodyQ = this.body.getWorldQuaternion(new THREE.Quaternion());
      const hip = this.body.localToWorld(this.pelvisRest.clone());
      const holsterQ = bodyQ.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(HOLSTER_TIP, Math.PI, 0, 'YXZ')));
      const holster = hip.clone().add(HOLSTER.clone().multiplyScalar(sc).applyQuaternion(bodyQ));
      const ease = (k: number): number => k * k * (3 - 2 * k);
      if (this.draw <= GRAB) {
        // (From where the hand was: on the wheel or the bar, or hanging at his side.)
        const grip = bike ? bike.rider.gripR.clone().applyMatrix4((bike.steer.children[0] ?? bike.steer).matrixWorld) : this.arms.r.upper.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.07 * fz, -0.52, 0.07 * fx).multiplyScalar(sc));
        const from = grip.sub(gun.grip.at.clone().applyQuaternion(holsterQ));
        gun.root.position.copy(from).lerp(holster, ease(this.draw / GRAB));
        gun.root.quaternion.copy(holsterQ);
      } else {
        const k = ease((this.draw - GRAB) / (1 - GRAB));
        const via = hip.clone().add(DRAW_VIA.clone().multiplyScalar(sc).applyQuaternion(bodyQ));
        const to = gun.root.position.clone();
        gun.root.position.copy(holster).multiplyScalar((1 - k) * (1 - k)).addScaledVector(via, 2 * k * (1 - k)).addScaledVector(to, k * k);
        gun.root.quaternion.copy(holsterQ.slerp(gun.root.quaternion, k));
      }
      gun.root.updateMatrixWorld(true);
    }
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
    const tuck = Math.max(one * (1 - a), carry, this.pulled);
    const pole = (side: 1 | -1): THREE.Vector3 => {
      const t = side > 0 ? tuck : 0;
      return new THREE.Vector3().addScaledVector(up, -1).addScaledVector(right, (0.8 - 0.5 * t) * side).addScaledVector(behind, 0.25 + 0.5 * t).normalize();
    };
    this.hold('r', gun.grip, gun.gripParent, pole(1));
    // (Changing the magazine, the left hand is at that, off the wheel or the gun for a moment.)
    if (leftAt) this.hold('l', { at: leftAt.at, palm: leftAt.palm, fwd: leftAt.fwd, curl: leftAt.curl, thumb: 0.4 }, WORLD, new THREE.Vector3().addScaledVector(up, -1).addScaledVector(right, -0.7).addScaledVector(behind, 0.3).normalize());
    else if (bike) this.gripHand('l', bike);
    // (The other hand takes the forend once the gun's out.)
    else if (one < 0.5 && carry < 0.5 && this.draw > 0.85) this.hold('l', gun.fore, gun.root.children[0], pole(-1));
    else {
      // The free arm hangs by the side, the elbow soft, swinging with the walk against the left leg (forward as
      // the right leg comes forward); running, it pumps, the elbow bent near square, the hand at the ribs.
      const S = this.arms.l.upper.getWorldPosition(new THREE.Vector3());
      const fwdH = new THREE.Vector3(fx, 0, fz);
      const hang = S.clone().addScaledVector(up, -HANG.down * this.body.scale.y).addScaledVector(right, -HANG.out).addScaledVector(fwdH, HANG.ahead - HANG.swing * s * k);
      // Against the gun arm: forward as it goes back.
      const pumped = S.clone().addScaledVector(up, -0.34).addScaledVector(right, -0.01).addScaledVector(fwdH, 0.06 - 1.3 * RUN_PUMP * pump);
      const poleL = new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, -0.3).normalize()
        .lerp(new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(up, -0.7).addScaledVector(right, -0.35).normalize(), carry);
      this.reach(this.arms.l, hang.lerp(pumped, carry), poleL);
      // The wrist straight, in line with the forearm, the palm toward the body (thumb up, running).
      const arm = this.arms.l;
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
      const along = arm.hand.getWorldPosition(new THREE.Vector3()).sub(elbow).normalize();
      this.orientHand(arm, along, right.clone().lerp(behind, HANG.back * (1 - carry)).lerp(behind.clone().negate(), 0.15 * carry).normalize());
      this.relaxHand(this.arms.l, 1 + 0.9 * carry);
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
   * the kicking foot by IK; the fists placed in the view's frame and closed, or the sword or the bat placed there
   * with both hands on its handle (the left on the saya's mouth while drawing and sheathing; free while the bat
   * comes up or goes down). Nothing drawn, the arms swing free; the bat hangs in the right hand.
   */
  private fight(m: Melee, camera: THREE.Camera, viewQ: THREE.Quaternion, fx: number, fz: number, swing: number, k: number, run: number): void {
    this.fightKeyed(m, camera, viewQ, fx, fz, swing, k, run);
    const clip = this.poseOverride ? null : this.lastPose?.clip;
    if (clip && clip.weight > 0) this.overlayClip(clip, m.weapon);
  }

  /**
   * A clip from the animation library over the whole body (a swing that's one of its: `MeleePose.clip`), blended
   * in over the keyed pose by its weight: every bone the clip has, and the pelvis's place; the weapon then goes
   * with his right hand, held as its hold has it, his fingers closed on it (bare hands are closed as fists). In first person the body moves under
   * the eyes (his neck stays where it was, the eyes going down with it: `eyeDrop`); in third it moves as the clip
   * has it, over his feet. The clips are fitted to his skeleton when first asked for; until the library is in,
   * the keyed pose stands.
   */
  private overlayClip(c: { name: string; time: number; weight: number }, weapon: MeleeWeapon): void {
    if (!this.layClip(c)) return;
    // The weapon in his right hand (the hold's frame turned as the hand has turned from its rest), his fingers
    // closed on it; the left hand as the clip has it, loose.
    const arm = this.arms.r;
    // (Bare hands are as the clip has them, fists and all, and there's nothing to carry.)
    if (weapon === 'fists') return;
    // The hand on the weapon is closed from its rest, not on top of the clip's own fingers (curled already, they'd
    // come round straight again).
    for (const f of [...arm.fingers.flat(), ...arm.thumb]) f.quaternion.copy(this.rest.get(f)!);
    this.relaxHand(arm, CLIP_GRIP, FIST, [0, 0]);
    this.thumbOver(arm);
    const h = weapon === 'bat' ? this.bat.single : this.katana.grip;
    const held = weapon === 'bat' ? this.bat.root : this.katana.sword;
    arm.hand.updateWorldMatrix(true, false);
    const turned = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.q0.clone().invert());
    const holdFrame = handFrame(h.fwd, h.palm, new THREE.Matrix4());
    const q = turned.multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().copy(arm.frame0).multiply(holdFrame.transpose())));
    const wrist = h.at.clone().addScaledVector(h.palm, -(h.seat?.[1] ?? PALM_OFF)).addScaledVector(h.fwd, -(h.seat?.[0] ?? PALM_BACK));
    held.quaternion.copy(q);
    held.position.copy(arm.hand.getWorldPosition(new THREE.Vector3())).sub(wrist.applyQuaternion(q));
    held.visible = true;
    held.updateMatrixWorld(true);
  }

  /**
   * What of the library is his own on foot (models/cityMoves.ts: his walk; with the pistol out, his body's stance)
   * over the pose he's in, each clip in turn. `armed`: a gun is out, and his arms go to it after this.
   */
  private layMoves(dt: number, gait: number, armed: boolean, bend: number, stride: { at: number; k: number; run: number }): void {
    if (!this.moves || !this.anims) return;
    // (The pistol out, or on its way: standing, his body is the library's, and his hands go to the gun after it.)
    const gun = armed && this.kind === 'pistol' && !this.mounted ? { out: this.draw, aim: this.aim, shots: this.shotsFired, reload: this.reloadT > 0 ? 1 - this.reloadT / this.reloadFull : -1 } : null;
    const layers = this.moves.update({ dt, gait, air: this.air, gun, stride });
    let laid = false;
    for (const l of layers) if (l.weight > 0) laid = this.layClip(l, false, l.steady) || laid;
    // (A hand that goes to a gun next is closed on it from its rest, not from the clip's own fingers.)
    if (laid && armed) for (const arm of [this.arms.l, this.arms.r]) for (const f of [...arm.fingers.flat(), ...arm.thumb]) f.quaternion.copy(this.rest.get(f)!);
    // His back still goes with the view up and down, over the stance, so the arms keep the gun in reach.
    const k = gun ? this.moves.gunWeight * this.draw : 0;
    if (k > 0 && bend !== 0) {
      this.turn('spine_01', 0, bend * 0.2 * k);
      this.turn('spine_02', 0, bend * 0.35 * k);
      this.turn('spine_03', 0, bend * 0.45 * k);
      this.object.updateMatrixWorld(true);
    }
  }

  /**
   * A clip from the animation library laid over the pose he's in, by its weight: every bone the clip has, and the
   * pelvis's place (`open`: with the hands at ease, not as the clip has them). In first person the body moves under
   * the eyes (his neck stays where it was, the eyes going down with it: `eyeDrop`; `steady`: the eyes stay too, the
   * body taking up what the clip does to his neck); in third it moves as the clip has it, over his feet. False if
   * the library hasn't the clip, or isn't in yet.
   */
  private layClip(c: { name: string; time: number; weight: number }, open = false, steady = false): boolean {
    const fitted = this.anims?.clipFor(this.model, this.body, c.name, open);
    if (!fitted || fitted.tracks.length === 0) return false;
    let tracks = this.clipTracks.get(fitted);
    if (!tracks) {
      if (!this.bonesByName) {
        const byName = new Map<string, THREE.Bone>();
        this.body.traverse((o) => {
          if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
        });
        this.bonesByName = byName;
        this.pelvisBone = byName.get('pelvis') ?? null;
        if (this.pelvisBone) this.pelvisLocal.copy(this.pelvisBone.position);
      }
      tracks = [];
      for (const tr of fitted.tracks) {
        const dot = tr.name.lastIndexOf('.');
        const bone = this.bonesByName.get(tr.name.slice(0, dot));
        const prop = tr.name.slice(dot + 1);
        if (!bone) continue;
        if (prop === 'quaternion') tracks.push({ bone, q: tr.values as Float32Array, p: null });
        else if (prop === 'position' && bone === this.pelvisBone) tracks.push({ bone, q: null, p: tr.values as Float32Array });
      }
      this.clipTracks.set(fitted, tracks);
    }
    const frames = fitted.tracks[0].times.length;
    const at = THREE.MathUtils.clamp(c.time * CLIP_RATE, 0, frames - 1);
    const i = Math.min(frames - 2, Math.floor(at));
    const u = at - i;
    const w = c.weight;
    const neckWas = this.neck.getWorldPosition(new THREE.Vector3());
    for (const tr of tracks) {
      if (tr.q) tr.bone.quaternion.slerp(_q.fromArray(tr.q, i * 4).slerp(_q2.fromArray(tr.q, (i + 1) * 4), u), w);
      else if (tr.p) tr.bone.position.lerp(_a.fromArray(tr.p, i * 3).lerp(_b.fromArray(tr.p, (i + 1) * 3), u), w);
    }
    this.object.updateMatrixWorld(true);
    if (this.headless) {
      const n = this.neck.getWorldPosition(new THREE.Vector3());
      this.body.position.x -= n.x - neckWas.x;
      this.body.position.z -= n.z - neckWas.z;
      // (His stride doesn't move the eyes: the view has its own bob for it. Anything else that lowers his neck lowers them.)
      if (steady) this.body.position.y -= n.y - neckWas.y;
      else this.dropped = Math.max(this.dropped, neckWas.y - n.y);
      this.object.updateMatrixWorld(true);
    } else if (!steady) {
      // (With his head shown the body stays over his feet; the page still wants to know how far his eyes have come
      // down, as it does for the squat, so the third-person camera goes down with him.)
      this.dropped = Math.max(this.dropped, neckWas.y - this.neck.getWorldPosition(new THREE.Vector3()).y);
    }
    return true;
  }

  private fightKeyed(m: Melee, camera: THREE.Camera, viewQ: THREE.Quaternion, fx: number, fz: number, swing: number, k: number, run: number): void {
    const kt = this.katana;
    const katana = m.weapon === 'katana';
    const bat = m.weapon === 'bat';
    const right = new THREE.Vector3(-fz, 0, fx);
    const up = new THREE.Vector3(0, 1, 0);
    const fwdH = new THREE.Vector3(fx, 0, fz);
    const bodyQ = this.body.quaternion;
    // The saya on the left hip (the body's +x is his left), and the sword as it sits in it.
    const sc = this.body.scale.x;
    const mouth = SAYA_MOUTH.clone().multiplyScalar(sc).applyQuaternion(bodyQ).add(this.body.position);
    const sayaQ = bodyQ.clone().multiply(swordQuat({ p: SAYA_MOUTH, dir: SAYA_DIR, edge: SAYA_EDGE }));
    const viewInv = viewQ.clone().invert();
    // Where the weapon is put away: the sword in the saya; the bat hanging by his right thigh, swinging a little
    // with his stride (forward as that arm would).
    const awayAt = bat ? BAT_CARRY.clone().add(new THREE.Vector3(0, 0, BAT_CARRY_SWING * swing)).multiplyScalar(sc).applyQuaternion(bodyQ).add(this.body.position) : mouth;
    const awayQ = bat ? bodyQ.clone().multiply(swordQuat({ p: BAT_CARRY, dir: BAT_CARRY_DIR, edge: BAT_CARRY_EDGE })) : sayaQ;
    const sheath: SwordKey = {
      p: awayAt.clone().sub(camera.position).applyQuaternion(viewInv),
      dir: new THREE.Vector3(0, 0, -1).applyQuaternion(awayQ).applyQuaternion(viewInv),
      edge: new THREE.Vector3(0, -1, 0).applyQuaternion(awayQ).applyQuaternion(viewInv),
    };
    let P = this.poseOverride ?? m.pose(sheath);
    this.lastPose = P;
    // In first person a weapon raised over his head goes further up and back than it's keyed (third person has it
    // as keyed): held in front of his forehead, his hands and forearms would fill the view.
    if (this.headless && P.sword && P.sword.p.y > FP_RAISE.from) {
      const k = Math.min(1, (P.sword.p.y - FP_RAISE.from) / FP_RAISE.over) * THREE.MathUtils.clamp((P.sword.p.z - FP_RAISE.far) / (FP_RAISE.near - FP_RAISE.far), 0, 1);
      P = { ...P, sword: { ...P.sword, p: P.sword.p.clone().add(new THREE.Vector3(0, FP_RAISE.up * k, FP_RAISE.back * k)) } };
    }
    // The lower body: where his feet stand now (as his stance or his stride has them), before the hips move;
    // then the hips turned, let down and moved over them (the saya goes with them); the feet are put back below.
    const L = P.legs && this.airK < 0.2 ? P.legs : null;
    const feet = (['l', 'r'] as const).map((side) => ({ side, at: this.legs[side].hand.getWorldPosition(new THREE.Vector3()), q: this.legs[side].hand.getWorldQuaternion(new THREE.Quaternion()) }));
    if (L) {
      this.turn('pelvis', 1, L.hips);
      this.body.position.addScaledVector(right, L.shift[0] * sc).addScaledVector(fwdH, L.shift[1] * sc);
      this.body.position.y -= L.sink * sc;
      this.dropped = Math.max(this.dropped, L.sink * sc * EYE_SINK);
      const hipQ = bodyQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, L.hips));
      mouth.copy(SAYA_MOUTH).multiplyScalar(sc).applyQuaternion(hipQ).add(this.body.position);
      sayaQ.copy(hipQ).multiply(swordQuat({ p: SAYA_MOUTH, dir: SAYA_DIR, edge: SAYA_EDGE }));
    }
    kt.saya.visible = katana;
    kt.saya.position.copy(mouth);
    kt.saya.quaternion.copy(sayaQ);
    this.turn('spine_02', 1, P.twist * 0.45);
    this.turn('spine_03', 1, P.twist * 0.55);
    this.turn('spine_01', 0, P.lean * 0.4);
    this.turn('spine_02', 0, P.lean * 0.6);
    // (His head stays on what's ahead of him while the hips and the chest turn under it.)
    const turned = (L?.hips ?? 0) + P.twist;
    this.turn('neck_01', 1, -turned * 0.4);
    this.turn('head', 1, -turned * 0.4);
    this.object.updateMatrixWorld(true);
    if (L) {
      for (const f of feet) {
        const leg = this.legs[f.side];
        const step = L[f.side];
        // A foot follows the hips round on its ball as its own hip comes forward (the right as they turn left, the
        // left as they turn right), the heel coming up: the back foot of a swing.
        const yaw = (f.side === 'r' ? Math.max(0, L.hips) : Math.min(0, L.hips)) * FOOT_PIVOT;
        const round = new THREE.Quaternion().setFromAxisAngle(up, yaw);
        const pivot = new THREE.Quaternion().setFromAxisAngle(right.clone().applyQuaternion(round), -Math.abs(yaw) * HEEL_UP).multiply(round);
        const ball = f.at.clone().addScaledVector(fwdH, BALL_AHEAD * sc);
        ball.y = this.body.position.y + L.sink * sc;
        const ankle = ball.clone().add(f.at.clone().sub(ball).applyQuaternion(pivot)).addScaledVector(right, step.x * sc).addScaledVector(up, step.y * sc).addScaledVector(fwdH, step.z * sc);
        this.reach(leg, ankle, fwdH.clone().applyQuaternion(round).addScaledVector(right, f.side === 'r' ? 0.2 : -0.2).normalize());
        leg.hand.quaternion.copy(leg.hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(pivot.multiply(f.q)));
        leg.hand.updateWorldMatrix(false, true);
      }
    }
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
    // The elbows down and out; with the weapon raised over his head, out to the sides (not up in front of his face).
    const raised = P.sword ? THREE.MathUtils.clamp((P.sword.p.y + 0.12) / 0.3, 0, 1) : 0;
    const pole = (side: 1 | -1): THREE.Vector3 => new THREE.Vector3().addScaledVector(up, -1 + 0.8 * raised).addScaledVector(right, (0.8 + 0.9 * raised) * side).addScaledVector(behind, 0.25).normalize();
    // The weapon: the sword (in or out of the saya) or the bat, in his hands or put away.
    kt.sword.visible = katana;
    this.bat.root.visible = bat;
    const held = bat ? this.bat.root : kt.sword;
    const holds = bat ? this.bat : kt;
    if ((katana || bat) && !P.sword) {
      held.position.copy(awayAt);
      held.quaternion.copy(awayQ);
      held.updateMatrixWorld(true);
    }
    if (P.sword) {
      held.position.copy(toWorld(P.sword.p));
      held.quaternion.copy(viewQ).multiply(swordQuat(P.sword));
      held.updateMatrixWorld(true);
      this.hold('r', bat && P.single ? this.bat.single : holds.grip, held, pole(1));
      if (P.leftOnSaya && katana) {
        // The left hand holds the saya by its mouth as the sword comes out or goes home.
        const along = new THREE.Vector3(0, 0, -1).applyQuaternion(sayaQ);
        const at = mouth.clone().addScaledVector(along, 0.06).addScaledVector(up, -0.03);
        this.reach(this.arms.l, at, new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, -0.6).normalize());
        this.orientHand(this.arms.l, along.clone().lerp(fwdH, 0.3).normalize(), right.clone());
        this.relaxHand(this.arms.l, 2.2);
      } else if (P.leftOnSaya) this.freeArms(fx, fz, Math.sin(this.walk) * k, swing, run * k, 0, 0, [-1]);
      else this.hold('l', holds.fore, held, pole(-1));
      return;
    }
    // The bat hanging in his right hand, whatever the left is doing (swinging free, or up as a fist).
    const carried = bat && !P.sword;
    if (carried) this.hold('r', this.bat.grip, this.bat.root, new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, 0.3).normalize());
    if (P.r || P.l) {
      const bob = 0.012 * Math.sin(this.walk * 2) * k;
      const hands: ['r' | 'l', typeof P.r][] = [['r', carried ? null : P.r], ['l', P.l]];
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
    this.freeArms(fx, fz, Math.sin(this.walk) * k, swing, run * k, 0, 0, carried ? [-1] : [1, -1]);
  }

  /** A hand's wrist now (world). */
  handWorld(side: 'l' | 'r'): THREE.Vector3 {
    return this.arms[side].hand.getWorldPosition(new THREE.Vector3());
  }

  /** Where a striking part is now (world): a fist from the wrist to past the knuckles, the right foot from the
   * ankle to the ball and past, the blade from the habaki to the point, the bat's barrel; with its thickness. */
  strike(h: Hitter): { a: THREE.Vector3; b: THREE.Vector3; r: number } {
    if (h === 'bat') {
      const s = this.bat.root;
      s.updateMatrixWorld(true);
      return { a: s.localToWorld(this.bat.base.clone()), b: s.localToWorld(this.bat.tip.clone()), r: 0.03 };
    }
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
  private freeArms(fx: number, fz: number, pump: number, swingS: number, run: number, sq = 0, air = 0, sides: readonly (1 | -1)[] = [1, -1]): void {
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3(-fz, 0, fx);
    const behind = new THREE.Vector3(-fx, 0, -fz);
    const fwdH = new THREE.Vector3(fx, 0, fz);
    for (const side of sides) {
      const arm = side > 0 ? this.arms.r : this.arms.l;
      const S = arm.upper.getWorldPosition(new THREE.Vector3());
      // Each arm forward as the other side's leg is (the right as the left leg comes forward).
      const sw = side * swingS;
      const pp = side * pump;
      const hang = S.clone().addScaledVector(up, -HANG.down * this.body.scale.y).addScaledVector(right, side * HANG.out).addScaledVector(fwdH, HANG.ahead + HANG.swing * sw);
      const pumped = S.clone().addScaledVector(up, -0.34 * this.body.scale.y).addScaledVector(right, side * 0.01).addScaledVector(fwdH, 0.06 + 1.3 * RUN_PUMP * pp);
      const pole = new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(right, side * 0.3).normalize()
        .lerp(new THREE.Vector3().addScaledVector(behind, 1).addScaledVector(up, -0.7).addScaledVector(right, side * 0.35).normalize(), run);
      const at = hang.lerp(pumped, run);
      // (In the air they come up and out a little, for his balance.)
      if (air > 0) at.lerp(S.clone().addScaledVector(up, -0.36 * this.body.scale.y).addScaledVector(right, side * 0.2).addScaledVector(fwdH, 0.14), 0.75 * air);
      if (sq > 0) {
        // Squatting: the forearm across the knee, the hand hanging in front of it.
        const knee = (side > 0 ? this.legs.r : this.legs.l).lower.getWorldPosition(new THREE.Vector3());
        at.lerp(knee.addScaledVector(fwdH, SQUAT.hand[0]).addScaledVector(right, -side * SQUAT.hand[1]).addScaledVector(up, -SQUAT.hand[2]), sq);
        pole.lerp(new THREE.Vector3().addScaledVector(up, -1).addScaledVector(right, side * 0.9).addScaledVector(behind, 0.4).normalize(), sq).normalize();
      }
      this.reach(arm, at, pole);
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
      const along = arm.hand.getWorldPosition(new THREE.Vector3()).sub(elbow).normalize();
      // (Over a knee the hand droops from the wrist, its palm down and in.)
      if (sq > 0) along.lerp(new THREE.Vector3().addScaledVector(up, -0.8).addScaledVector(fwdH, 0.5).addScaledVector(right, -side * 0.3).normalize(), 0.6 * sq).normalize();
      // The wrist straight, the palm to the thigh and turned a little to the back (as a hand hangs: from in front
      // you see its thumb and first knuckle, not its palm); running, the thumb comes up.
      this.orientHand(arm, along, right.clone().multiplyScalar(-side).lerp(behind, HANG.back * (1 - run)).lerp(behind.clone().negate(), 0.15 * run).lerp(new THREE.Vector3().addScaledVector(behind, 0.8).addScaledVector(up, -0.5).addScaledVector(right, -side * 0.4).normalize(), sq).normalize());
      this.relaxHand(arm, 1 + 0.9 * run);
    }
  }

  /** The shadow's body: the same pose, but with its head, nodding the rest of the way to the view's pitch.
   * With the head shown, the body's own head nods instead. */
  private poseShadow(pitch: number, bend: number): void {
    // His smoking has the arms last (so the shadow's copy has them too), and its cigarette goes in once the head is posed.
    const sm = this.smokeFrame;
    const ctx = (face: SmokeCtx['face']): SmokeCtx => ({ ...sm!, sc: this.body.scale.x, free: this.handsFree, face });
    const nod = -pitch - bend;
    // With the head shown (third person) it nods itself, and casts its own shadow: the copy is hidden. (The head
    // first, then the arms: his hand goes to his mouth as the head has it, not as the view would.)
    if (!this.headless) {
      this.turn('neck_01', 0, nod * 0.4);
      this.turn('head', 0, nod * 0.6);
      this.body.updateMatrixWorld(true);
      if (sm) {
        this.smoking.pose(ctx(this.faceNow()));
        this.body.updateMatrixWorld(true);
        this.smoking.place(ctx(this.faceNow()));
      }
      return;
    }
    if (sm) this.smoking.pose(ctx(null));
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
    if (sm) this.smoking.place(ctx(null));
  }

  /** His hands' posing, lent to his smoking (models/smoking.ts). */
  private handTools(): Hands {
    const frame = (side: 'l' | 'r'): { fwd: THREE.Vector3; palm: THREE.Vector3 } => {
      const a = this.arms[side];
      a.hand.updateWorldMatrix(true, false);
      const turn = a.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(a.q0.clone().invert());
      return { fwd: new THREE.Vector3().setFromMatrixColumn(a.frame0, 0).applyQuaternion(turn), palm: new THREE.Vector3().setFromMatrixColumn(a.frame0, 2).applyQuaternion(turn) };
    };
    return {
      arm: (side) => this.arms[side],
      reset: (side) => {
        const a = this.arms[side];
        for (const b of [a.upper, a.lower, a.hand, ...a.fingers.flat(), ...a.thumb]) b.quaternion.copy(this.rest.get(b)!);
        a.upper.updateWorldMatrix(true, true);
      },
      reach: (side, wrist, pole) => this.reach(this.arms[side], wrist, pole),
      orient: (side, fwd, palm) => this.orientHand(this.arms[side], fwd, palm),
      relax: (side, amount, table) => this.relaxHand(this.arms[side], amount, table),
      frame,
    };
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
