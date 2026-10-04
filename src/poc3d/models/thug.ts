import * as THREE from 'three';
import { loadCharacterModel } from './characters';
import { collapse, cutPart } from './dismember';
import { buildKatana, type Katana } from './katana';
import { FIST_BLOCK, FIST_GUARD, lerpHand, lerpSword, Melee, partFactor, swordQuat, type Capsule, type HandKey, type Hitter, type HitInfo, type MeleeTarget, type MeleeWeapon, type MoveId, type SwordKey } from './melee';

/**
 * An ordinary fighter (models/melee.ts): a cast model (the salaryman's for now) posed procedurally, fighting
 * with the same moves as you (`Melee`, its keys placed from his own eyes and scaled to his size), only slower
 * (`RATE`) and after a tell you can read (`TELL`: the fist drawn back, a breath you hear from where he is).
 * Not hard one to one (`HEALTH`: a few blows), but he hits as hard as you do, and a group tries to get round
 * you: each closes to arm's length, drifting toward your back while he waits his turn.
 *
 * Hits spring his head and body the way they came, shove him and stagger him out of his move; a kick can put
 * him on the floor (he gets up); out of health he falls the way he was hit, pivoting over his heels. Kill
 * moves (models/killMoves.ts) take him over (`beginScript`): they pose him through his own tools (`turn`,
 * `reach`, `leg`, `fightPose`, `tip`) and end him (`endScript`), and can take his head off (`severHead`).
 *
 * An elite (`tier: 'elite'`, a boss or a terminator: the duel) is another matter: far more health, a katana or
 * fists, and a guard held to one side (`guard`: his left, his right or high), which he shifts every so often and,
 * when he reads your swing (`noticeSwing`, by his `skill`), moves to meet it. A blow at the side he covers is
 * blocked (`defend`), now and then deflected; one he doesn't is a hit. Blocks and hits fill his posture
 * (`addPosture`; it drains when he's left alone), and when it's full his guard breaks (`broken`): down on one
 * knee, open, for a moment, and your next blow is a deathblow. His swings come from a side too (`sideOf`), read
 * slower and harder.
 */

type V3 = THREE.Vector3;
type Bones = Map<string, THREE.Bone>;

interface Spring {
  x: number;
  v: number;
}

const SPRING_K = 140;
const SPRING_C = 13;
export const HEALTH = 50;
/** His moves play at this share of your speed; his windup before each. */
const RATE = 0.72;
export const TELL = 0.34;
/** His pace closing in, the distance he fights at, too close; how far off he waits to get round you. */
const WALK = 1.7;
const RANGE = 0.85;
const CLOSE = 0.62;
/** On the floor this long, then up over this long. */
const FLOORED = 1.9;
const GETUP = 0.9;
/** His choice of blows (weights). */
const BLOWS: [MoveId, number][] = [
  ['jab', 3],
  ['cross', 3],
  ['hook', 1.5],
  ['hookR', 1],
  ['kick', 1.5],
];
const FIST = [[1.35, 1.65, 1.0], [1.4, 1.7, 1.0], [1.45, 1.7, 1.0], [1.5, 1.6, 0.95]];
/** How long a kill move's last pose takes to give way to the fall. */
const BLEND = 0.35;
const NO_SHEATH: SwordKey = { p: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), edge: new THREE.Vector3(0, -1, 0) };

export type ThugState = 'fight' | 'stagger' | 'floored' | 'getup' | 'broken' | 'dead' | 'scripted';
export type Tier = 'mook' | 'elite';
/** A man's guard: his left, his right, or high. */
export type GuardSide = 'left' | 'right' | 'high';
/** Where a blow comes at the one it's aimed at: his left, his right, high, or straight in. */
export type Side = GuardSide | 'center';

export interface ThugOpts {
  readonly tier?: Tier;
  readonly weapon?: MeleeWeapon;
  /** For the boss bar. */
  readonly name?: string;
}

/** An elite's numbers: health, posture, his moves' pace and tell, his ranges, how often he reads your swing and
 * how often a block is a deflect, how fast his posture drains, and how hard he hits (of the move's damage). */
export const ELITE = {
  health: 180,
  posture: 100,
  rate: 0.55,
  tell: 0.14,
  range: { katana: 1.3, fists: 0.85 },
  close: { katana: 0.95, fists: 0.62 },
  skill: 0.6,
  deflect: 0.25,
  drain: 16,
  damage: { katana: 0.45, fists: 1.2 },
  /** Of a blow's damage, what he takes (he rolls with it): breaking his posture is the way in. */
  taken: 0.35,
  broken: 2.6,
};

/** Which side of the one it's aimed at each move reaches (his right-to-left cut comes at your left). */
export function sideOf(m: MoveId): Side {
  if (m === 'slashR' || m === 'hookR') return 'left';
  if (m === 'slashL' || m === 'hook') return 'right';
  if (m === 'overhead') return 'high';
  return 'center';
}

const vk = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z);
const nk = (x: number, y: number, z: number): V3 => new THREE.Vector3(x, y, z).normalize();
/** An elite's sword guard on each side (his view's frame: his left is -x): the blade upright on that side, edge
 * out; or across over his head, edge up. */
const SWORD_GUARDS: Record<GuardSide, SwordKey> = {
  left: { p: vk(-0.1, -0.27, -0.36), dir: nk(-0.3, 0.92, -0.25), edge: nk(-1, -0.1, -0.2) },
  right: { p: vk(0.14, -0.27, -0.36), dir: nk(0.3, 0.92, -0.25), edge: nk(1, -0.1, -0.2) },
  high: { p: vk(0.14, -0.08, -0.34), dir: nk(-1, 0.25, -0.15), edge: nk(0, 1, 0) },
};
/** His fists' guard on each side: shifted that way and up, or high over the face. */
const shiftHand = (h: HandKey, dx: number, dy: number): HandKey => ({ ...h, p: h.p.clone().add(vk(dx, dy, 0)) });
const FIST_GUARDS: Record<GuardSide, { r: HandKey; l: HandKey }> = {
  left: { r: shiftHand(FIST_GUARD.r, -0.1, 0.08), l: shiftHand(FIST_GUARD.l, -0.06, 0.12) },
  right: { r: shiftHand(FIST_GUARD.r, 0.06, 0.12), l: shiftHand(FIST_GUARD.l, 0.1, 0.08) },
  high: FIST_BLOCK,
};
/** An elite's blows. */
const ELITE_BLOWS: Record<MeleeWeapon, [MoveId, number][]> = {
  katana: [
    ['slashR', 3],
    ['slashL', 3],
    ['overhead', 2],
    ['thrust', 1.2],
  ],
  fists: [
    ['hook', 2],
    ['hookR', 2],
    ['cross', 2],
    ['uppercut', 1],
    ['kick', 1],
  ],
};

/** What the group and you are to him this frame. */
export interface FightCtx {
  /** Your eyes, and which way you face (yaw: 0 looks along -z). */
  readonly you: V3;
  readonly youYaw: number;
  readonly others: readonly Thug[];
  readonly floorAt: (x: number, z: number) => number;
  /** Whether he may start a blow now (the page spaces them a little), and telling it he has. */
  mayAttack(): boolean;
  attacked(): void;
}

export interface ThugEvents {
  /** He began a windup (the page plays the tell from where he is). */
  tell: boolean;
}

/** Turns `bone` so the world direction `from` points along `to`. */
function aimBone(bone: THREE.Bone, from: V3, to: V3): void {
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  bone.quaternion.premultiply(parent.clone().invert().multiply(q).multiply(parent));
}

/** Two-bone IK: `end` to `target`, the middle joint toward `pole`. */
function twoBone(upper: THREE.Bone, lower: THREE.Bone, end: THREE.Bone, target: V3, pole: V3): void {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E0 = lower.getWorldPosition(new THREE.Vector3());
  const W0 = end.getWorldPosition(new THREE.Vector3());
  const la = S.distanceTo(E0);
  const lb = E0.distanceTo(W0);
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-4);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const E = S.clone().addScaledVector(dir, la * cosA).addScaledVector(perp, la * Math.sqrt(1 - cosA * cosA));
  aimBone(upper, E0.clone().sub(S), E.clone().sub(S));
  upper.updateWorldMatrix(false, true);
  const E2 = lower.getWorldPosition(new THREE.Vector3());
  aimBone(lower, end.getWorldPosition(new THREE.Vector3()).sub(E2), S.clone().addScaledVector(dir, d).sub(E2));
  lower.updateWorldMatrix(false, true);
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export class Thug implements MeleeTarget {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  health = HEALTH;
  state: ThugState = 'fight';
  /** Facing (0 looks along +z, his model's front). */
  yaw = 0;
  /** His moves (fists, always up). */
  readonly melee = new Melee();
  /** Seconds left of his windup, and the blow it's for. */
  tell = 0;
  private tellMove: MoveId = 'jab';
  private readonly bones: Bones;
  private readonly rest = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly axes = new Map<string, [V3, V3, V3]>();
  /** His head's height at rest; his size against yours (the moves' keys scale by it). */
  private readonly headY: number;
  readonly size: number;
  private readonly springs = { pitch: { x: 0, v: 0 }, yaw: { x: 0, v: 0 }, bend: { x: 0, v: 0 }, twist: { x: 0, v: 0 }, side: { x: 0, v: 0 } };
  private readonly push = new THREE.Vector3();
  private staggerT = 0;
  private flooredT = 0;
  private cooldown = 1.5;
  private walkPhase = 0;
  private moving = 0;
  /** Which way he drifts round you, and the random pick. */
  private strafe = 1;
  private rand: () => number;
  /** Falling or lying: the way he goes, how far over (radians), how fast. */
  private fall: { dir: V3; a: number; v: number } | null = null;
  /** A kill move's last pose is kept (slumped against a wall). */
  private frozen = false;
  /** The floor under him (his falls lie on it). */
  private groundY = 0;
  /** His neck broken (a kill move): the head stays turned as he falls and lies. */
  brokenNeck = false;
  /** The pose a kill move left him in, blended out into his fall over a moment (no snap to rest). */
  private blendFrom: { bones: Map<THREE.Bone, THREE.Quaternion>; root: THREE.Quaternion; t: number } | null = null;
  private readonly cuts: THREE.Object3D[] = [];
  private readonly scaled: THREE.Bone[] = [];
  readonly tier: Tier;
  readonly weapon: MeleeWeapon;
  readonly name: string;
  readonly maxHealth: number;
  /** An elite's posture (0 to `ELITE.posture`), its guard, when it next shifts, a shift on its way. */
  posture = 0;
  guard: GuardSide = 'high';
  private guardT = 1;
  private guardTo: { side: GuardSide; t: number } | null = null;
  private sincePosture = 99;
  private brokenT = 0;
  /** His sword (an elite with a katana), and where his guard and his sword are now (eased between sides). */
  readonly katana: Katana | null;
  private swordNow: SwordKey | null = null;
  private handsNow: { r: HandKey; l: HandKey } | null = null;
  private swingSeen = 0;
  private fromPose: { sword: SwordKey | null; hands: { r: HandKey; l: HandKey } | null; t: number } | null = null;

  private constructor(model: THREE.Object3D, seed: number, opts: ThugOpts) {
    this.root.name = 'thug';
    this.model = model;
    this.root.add(model);
    let s = seed * 9301 + 49297;
    this.rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    this.strafe = this.rand() < 0.5 ? -1 : 1;
    this.bones = new Map();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.bones.set(o.name, o as THREE.Bone);
        this.rest.set(o as THREE.Bone, o.quaternion.clone());
      }
    });
    model.updateMatrixWorld(true);
    const inv = new THREE.Quaternion();
    for (const [n, b] of this.bones) {
      b.parent!.getWorldQuaternion(inv).invert();
      this.axes.set(n, [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(inv)) as [V3, V3, V3]);
    }
    this.headY = this.bone('head').getWorldPosition(new THREE.Vector3()).y;
    this.size = this.headY / 1.72;
    this.tier = opts.tier ?? 'mook';
    this.weapon = opts.weapon ?? 'fists';
    this.name = opts.name ?? (this.tier === 'elite' ? 'swordsman' : 'thug');
    this.maxHealth = this.tier === 'elite' ? ELITE.health : HEALTH;
    this.health = this.maxHealth;
    this.melee.setWeapon(this.weapon);
    this.melee.drawn = true;
    this.melee.rate = this.tier === 'elite' ? ELITE.rate : RATE;
    this.katana = this.weapon === 'katana' ? buildKatana(null) : null;
    if (this.katana) {
      this.katana.saya.visible = false;
      this.root.add(this.katana.sword);
    }
  }

  static async load(name = 'salaryman', seed = 1, opts: ThugOpts = {}): Promise<Thug> {
    return new Thug(await loadCharacterModel(name), seed, opts);
  }

  /** An elite's guard broken: open for a deathblow. */
  get broken(): boolean {
    return this.state === 'broken';
  }

  /** Where his blow comes at you from, while he's winding up or striking (an elite's: the duel's indicator). */
  get incoming(): Side | null {
    if (this.tell > 0) return sideOf(this.tellMove);
    const m = this.melee.move;
    if (m && this.melee.phase < m.active[1]) return sideOf(m.id);
    return null;
  }

  /** A blow at `side` of him: an elite guarding that side blocks it (now and then deflects it); otherwise it
   * lands. A high guard covers a straight blow too. */
  defend(side: Side): 'none' | 'block' | 'deflect' {
    if (this.tier !== 'elite' || this.state !== 'fight' || this.melee.move || this.tell > 0) return 'none';
    const covers = side === this.guard || (side === 'center' && this.guard === 'high');
    if (!covers) return 'none';
    return this.rand() < ELITE.deflect ? 'deflect' : 'block';
  }

  /** Fills his posture; full, his guard breaks. */
  addPosture(x: number): void {
    if (this.tier !== 'elite' || !this.alive) return;
    this.posture = Math.max(0, this.posture + x);
    this.sincePosture = 0;
    if (this.posture >= ELITE.posture && this.state !== 'broken') {
      this.posture = ELITE.posture;
      this.state = 'broken';
      this.brokenT = ELITE.broken;
      this.holdSword(true);
      this.tell = 0;
      this.melee.cancel();
    }
  }

  /** He sees your swing coming at `side`: by his skill he moves his guard to meet it, a beat later. */
  noticeSwing(side: Side): void {
    if (this.tier !== 'elite' || this.state !== 'fight' || this.melee.move || this.tell > 0) return;
    if (this.rand() > ELITE.skill) return;
    this.guardTo = { side: side === 'center' ? 'high' : side, t: 0.09 + this.rand() * 0.08 };
  }

  get alive(): boolean {
    return this.state !== 'dead' && this.state !== 'scripted';
  }

  /** On the floor (a stomp's for him). */
  get floored(): boolean {
    return this.state === 'floored';
  }

  /** Stands him at (x, z) facing `yaw`, fresh (his head back on). */
  place(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    this.groundY = y;
    this.yaw = yaw;
    this.health = this.maxHealth;
    this.posture = 0;
    this.brokenT = 0;
    this.guardTo = null;
    this.state = 'fight';
    this.fall = null;
    this.frozen = false;
    this.tell = 0;
    this.melee.cancel();
    this.cooldown = 0.6 + this.rand() * 1.4;
    this.staggerT = 0;
    this.push.set(0, 0, 0);
    for (const sp of Object.values(this.springs)) sp.x = sp.v = 0;
    for (const c of this.cuts) c.removeFromParent();
    this.cuts.length = 0;
    for (const b of this.scaled) b.scale.setScalar(1);
    this.scaled.length = 0;
    this.root.visible = true;
    this.brokenNeck = false;
    this.blendFrom = null;
    this.holdSword(false);
  }

  /** His sword: in his hands as he fights (placed each frame), or held in his right hand as it falls with him. */
  private holdSword(inHand: boolean): void {
    const k = this.katana;
    if (!k) return;
    const hand = this.bone('hand_r');
    if (inHand && k.sword.parent !== hand) hand.attach(k.sword);
    if (!inHand && k.sword.parent !== this.root) this.root.attach(k.sword);
  }

  bone(name: string): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`thug: no bone ${name}`);
    return b;
  }

  /** The bone a part's hits stick to (wounds). */
  boneOf(part: string): THREE.Bone {
    const map: Record<string, string> = { head: 'head', neck: 'neck_01', torso: 'spine_02' };
    return this.bones.get(map[part] ?? part) ?? this.bone('spine_02');
  }

  /** The middle of his head (world). */
  headCentre(): V3 {
    const h = this.bone('head').getWorldPosition(new THREE.Vector3());
    const n = this.bone('neck_01').getWorldPosition(new THREE.Vector3());
    return h.clone().addScaledVector(h.clone().sub(n).normalize(), 0.1);
  }

  turn(name: string, axis: 0 | 1 | 2, angle: number): void {
    const b = this.bones.get(name);
    const ax = this.axes.get(name);
    if (!b || !ax || angle === 0) return;
    b.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(ax[axis], angle));
  }

  parts(): Capsule[] {
    const p = (n: string): V3 => this.bone(n).getWorldPosition(new THREE.Vector3());
    const head = p('head');
    const neck = p('neck_01');
    const up = head.clone().sub(neck).normalize();
    const out: Capsule[] = [
      { name: 'neck', a: neck, b: head, r: 0.06 },
      { name: 'torso', a: p('pelvis'), b: p('spine_03').addScaledVector(up, 0.08), r: 0.17 },
    ];
    if (this.bone('head').scale.x > 0.5) out.unshift({ name: 'head', a: head.clone().addScaledVector(up, 0.05), b: head.clone().addScaledVector(up, 0.16), r: 0.105 });
    for (const s of ['l', 'r']) {
      out.push({ name: `upperarm_${s}`, a: p(`upperarm_${s}`), b: p(`lowerarm_${s}`), r: 0.055 });
      out.push({ name: `lowerarm_${s}`, a: p(`lowerarm_${s}`), b: p(`hand_${s}`), r: 0.045 });
      out.push({ name: `thigh_${s}`, a: p(`thigh_${s}`), b: p(`calf_${s}`), r: 0.08 });
      out.push({ name: `calf_${s}`, a: p(`calf_${s}`), b: p(`foot_${s}`), r: 0.06 });
    }
    return out;
  }

  /** What a blow would leave him with. */
  healthAfter(h: Pick<HitInfo, 'damage' | 'part'>): number {
    return this.health - h.damage * partFactor(h.part) * (this.tier === 'elite' ? ELITE.taken : 1);
  }

  hit(h: HitInfo): void {
    if (this.state === 'dead' || this.state === 'scripted') return;
    // The blow in his frame: x his left, z his front.
    const inv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
    const d = h.dir.clone().applyQuaternion(inv);
    const k = 0.6 + 0.12 * h.force;
    const sp = this.springs;
    if (h.part === 'head' || h.part === 'neck') {
      sp.pitch.v += (-d.z * 9 - Math.max(0, d.y) * 12) * k;
      sp.yaw.v += d.x * 10 * k;
      sp.side.v += -d.x * 3 * k;
      sp.bend.v += -d.z * 2 * k;
    } else if (h.part === 'torso') {
      sp.bend.v += Math.max(0, -d.z) * 7 * k;
      sp.twist.v += d.x * 5 * k;
    } else {
      sp.twist.v += d.x * 3 * k;
      sp.bend.v += 1.5 * k;
    }
    const flat = new THREE.Vector3(h.dir.x, 0, h.dir.z);
    if (flat.lengthSq() > 1e-6) this.push.addScaledVector(flat.normalize(), h.force * (h.part === 'torso' ? 1 : 0.6));
    this.health = this.healthAfter(h);
    this.tell = 0;
    this.melee.cancel();
    if (this.health <= 0) {
      this.die(flat, h.force);
      return;
    }
    if (this.state === 'floored' || this.state === 'getup') return;
    if (h.move === 'kick' && this.rand() < 0.65) {
      this.knockDown(flat);
      return;
    }
    if (this.state === 'broken') return;
    this.state = 'stagger';
    this.staggerT = (0.3 + 0.06 * h.force + (h.part === 'head' ? 0.15 : 0)) * (this.tier === 'elite' ? 0.5 : 1);
    this.cooldown = Math.max(this.cooldown, 0.5);
  }

  /** A blow of his you guarded: it bounces off, and he's knocked back out of his rhythm. */
  blocked(): void {
    this.melee.cancel();
    this.tell = 0;
    this.state = 'stagger';
    this.staggerT = 0.35;
    this.springs.bend.v -= 2;
    this.cooldown = Math.max(this.cooldown, 0.7);
  }

  private die(dir: V3, force: number): void {
    const d = dir.lengthSq() > 1e-6 ? dir.clone().normalize() : new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.state = 'dead';
    this.holdSword(true);
    this.fall = { dir: this.fall?.dir ?? d, a: this.fall?.a ?? 0, v: this.fall ? 0 : 0.6 + 0.2 * force };
  }

  /** Knocked to the floor (he gets up after a while). */
  knockDown(dir: V3): void {
    this.holdSword(true);
    this.state = 'floored';
    this.flooredT = FLOORED;
    this.fall = { dir: dir.clone().normalize(), a: 0, v: 1.2 };
  }

  // ---- Kill moves' handles ----

  /** A kill move takes him over: nothing of his own runs until it ends him. */
  beginScript(): void {
    this.holdSword(true);
    this.state = 'scripted';
    this.tell = 0;
    this.melee.cancel();
    this.frozen = false;
    this.push.set(0, 0, 0);
  }

  /** Each frame of a kill move: his bones back to rest, standing at the root, facing `yaw`. */
  resetPose(): void {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.root.updateMatrixWorld(true);
  }

  /** His fighting pose (stance and guard, toward `you`), for a kill move's first beat. */
  fightPose(you: V3): void {
    this.poseFight(you, 0);
  }

  /** A hand to `target` (world), the elbow toward `pole`. */
  reach(side: 'l' | 'r', target: V3, pole: V3): void {
    this.root.updateMatrixWorld(true);
    twoBone(this.bone(`upperarm_${side}`), this.bone(`lowerarm_${side}`), this.bone(`hand_${side}`), target, pole);
  }

  /** A foot to `target` (world), the knee toward `pole`. */
  leg(side: 'l' | 'r', target: V3, pole: V3): void {
    this.root.updateMatrixWorld(true);
    twoBone(this.bone(`thigh_${side}`), this.bone(`calf_${side}`), this.bone(`foot_${side}`), target, pole);
  }

  /** Tipped over his heels toward `dir` by `angle` (radians: π/2 is flat on the floor). */
  tip(dir: V3, angle: number): void {
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    this.root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    this.root.updateMatrixWorld(true);
  }

  /** The kill move is done with him: he falls from here the way `dir` goes (`fall`), or stays as he is, dead
   * (`hold`: slumped against a wall). */
  endScript(how: 'fall' | 'hold', dir = new THREE.Vector3(0, 0, 1), push = 1): void {
    this.state = 'dead';
    const bones = new Map<THREE.Bone, THREE.Quaternion>();
    for (const b of this.rest.keys()) bones.set(b, b.quaternion.clone());
    this.blendFrom = { bones, root: this.root.quaternion.clone(), t: BLEND };
    if (how === 'hold') {
      this.frozen = true;
      return;
    }
    // Already on the floor, he stays the way he lies.
    if (this.fall && this.fall.a > 0.5) return;
    this.fall = { dir: dir.clone().setY(0).normalize(), a: 0, v: 0.5 + 0.4 * push };
  }

  /** Lying where the fall left him (a stomp on him plays over this). */
  holdFallen(): void {
    if (this.fall) this.poseFall(0, true);
  }

  /** Takes his head off: the head as a loose piece (world placed), the neck capped. */
  severHead(): THREE.Group {
    this.model.updateMatrixWorld(true);
    const head = cutPart(this.model, 'head');
    const bone = this.bone('head');
    this.cuts.push(collapse(bone, 0.055));
    this.scaled.push(bone);
    return head;
  }

  /** Blows his head apart (a shot under the jaw): gone, the neck capped. */
  destroyHead(): void {
    const bone = this.bone('head');
    this.cuts.push(collapse(bone, 0.055));
    this.scaled.push(bone);
  }

  /** Crushes his head (a stomp): flattened. */
  crushHead(): void {
    const bone = this.bone('head');
    bone.scale.set(1.35, 0.4, 1.3);
    this.scaled.push(bone);
  }

  // ---- His own fighting ----

  /** Steps him on against you. */
  update(dt: number, f: FightCtx): ThugEvents {
    const ev: ThugEvents = { tell: false };
    for (const s of Object.values(this.springs) as Spring[]) {
      s.v += (-SPRING_K * s.x - SPRING_C * s.v) * dt;
      s.x += s.v * dt;
    }
    if (this.state === 'scripted') return ev;
    this.push.multiplyScalar(Math.exp(-6 * dt));
    if (this.state !== 'dead' || (this.fall && this.fall.a < 0.3)) this.root.position.addScaledVector(this.push, dt);
    // Keep apart from the others.
    if (this.alive)
      for (const o of f.others) {
        if (o === this || !o.alive) continue;
        const dx = this.root.position.x - o.root.position.x;
        const dz = this.root.position.z - o.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.75 && d > 1e-4) {
          this.root.position.x += (dx / d) * (0.75 - d) * 0.5;
          this.root.position.z += (dz / d) * (0.75 - d) * 0.5;
        }
      }
    if (!this.frozen) this.root.position.y = this.groundY = f.floorAt(this.root.position.x, this.root.position.z);
    if (this.state === 'dead') {
      if (!this.frozen) this.poseFall(dt, false);
      return ev;
    }
    // An elite's posture drains when he's left alone; his guard shifts now and then, or to meet your swing.
    if (this.tier === 'elite') {
      this.sincePosture += dt;
      if (this.sincePosture > 1.2 && this.state !== 'broken') this.posture = Math.max(0, this.posture - ELITE.drain * dt);
      if (this.guardTo) {
        this.guardTo.t -= dt;
        if (this.guardTo.t <= 0) {
          this.guard = this.guardTo.side;
          this.guardTo = null;
          this.guardT = 0.8 + this.rand();
        }
      }
      this.guardT -= dt;
      if (this.guardT <= 0) {
        const sides: GuardSide[] = ['left', 'right', 'high'];
        this.guard = sides[Math.floor(this.rand() * 3)];
        this.guardT = 0.9 + this.rand() * 1.3;
      }
    }
    if (this.state === 'broken') {
      this.brokenT -= dt;
      if (this.brokenT <= 0) {
        this.state = 'fight';
        this.posture = ELITE.posture * 0.5;
        this.sincePosture = 0;
        this.cooldown = 0.4;
        this.holdSword(false);
      } else {
        this.poseBroken(dt);
        return ev;
      }
    }
    if (this.state === 'floored' || this.state === 'getup') {
      if (this.state === 'floored') {
        this.flooredT -= dt;
        if (this.flooredT <= 0) this.state = 'getup';
        this.poseFall(dt, false);
      } else {
        const fl = this.fall!;
        fl.a -= dt * (Math.PI / 2 / GETUP);
        if (fl.a <= 0) {
          this.fall = null;
          this.state = 'fight';
          this.cooldown = 0.6;
          this.holdSword(false);
        } else this.poseFall(0, true);
      }
      return ev;
    }
    const toYou = new THREE.Vector3(f.you.x - this.root.position.x, 0, f.you.z - this.root.position.z);
    const dist = toYou.length();
    const dirYou = toYou.clone().divideScalar(Math.max(1e-4, dist));
    if (this.state === 'stagger') {
      this.staggerT -= dt;
      if (this.staggerT <= 0) this.state = 'fight';
    }
    let step = new THREE.Vector3();
    if (this.state === 'fight') {
      const want = Math.atan2(toYou.x, toYou.z);
      let dy = want - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += THREE.MathUtils.clamp(dy, -6 * dt, 6 * dt);
      const busy = this.tell > 0 || this.melee.move !== null;
      const elite = this.tier === 'elite';
      const range = elite ? ELITE.range[this.weapon] : RANGE;
      const close = elite ? ELITE.close[this.weapon] : CLOSE;
      if (!busy) {
        if (dist > range) step.addScaledVector(dirYou, Math.min(WALK, (dist - range) * 4));
        else if (dist < close) step.addScaledVector(dirYou, -0.9);
        // Round toward your back (with others in on you too): if he's in front of you, he drifts to the side
        // away from your view.
        const youF = new THREE.Vector3(-Math.sin(f.youYaw), 0, -Math.cos(f.youYaw));
        const fromYou = dirYou.clone().negate();
        const near = f.others.filter((o) => o.alive && o.root.visible && o.root.position.distanceTo(f.you) < 3).length;
        if (!elite && near >= 2 && dist < 2.2 && fromYou.dot(youF) > -0.3) {
          const side = new THREE.Vector3(-dirYou.z, 0, dirYou.x);
          const way = Math.sign(side.dot(youF)) || this.strafe;
          step.addScaledVector(side, -way * 0.55);
        }
      }
      this.root.position.addScaledVector(step, dt);
      this.cooldown -= dt;
      if (!busy && this.cooldown <= 0 && dist < range + 0.35 && f.mayAttack()) {
        f.attacked();
        this.tell = elite ? ELITE.tell : TELL;
        this.tellMove = this.pick();
        ev.tell = true;
      }
    }
    if (this.tell > 0) {
      this.tell -= dt;
      if (this.tell <= 0) {
        this.tell = 0;
        if (this.state === 'fight') this.melee.play(this.tellMove);
      }
    }
    const before = this.melee.move;
    this.melee.update(dt);
    if (before && !this.melee.move) {
      // An elite strings his cuts together half the time.
      if (this.tier === 'elite' && this.rand() < 0.45 && this.state === 'fight' && dist < ELITE.range[this.weapon] + 0.4) {
        this.tellMove = this.pick();
        this.tell = ELITE.tell * 0.6;
        ev.tell = true;
      } else this.cooldown = this.tier === 'elite' ? 1.0 + this.rand() * 1.4 : 0.7 + this.rand() * 1.3;
    }
    this.moving += ((step.length() > 0.05 ? 1 : 0) - this.moving) * Math.min(1, dt * 8);
    this.walkPhase += dt * Math.PI * 2 * 1.7 * this.moving;
    this.poseFight(f.you, this.tell > 0 ? 1 - this.tell / (this.tier === 'elite' ? ELITE.tell : TELL) : 0, dt);
    return ev;
  }

  private pick(): MoveId {
    const blows = this.tier === 'elite' ? ELITE_BLOWS[this.weapon] : BLOWS;
    const total = blows.reduce((a, [, w]) => a + w, 0);
    let r = this.rand() * total;
    for (const [id, w] of blows) {
      r -= w;
      if (r <= 0) return id;
    }
    return 'jab';
  }

  /** Where a striking part of his is now (world), as `FirstPersonRig.strike` gives yours. */
  strike(h: Hitter): { a: V3; b: V3; r: number } {
    if (h === 'blade' && this.katana) {
      const sw = this.katana.sword;
      sw.updateMatrixWorld(true);
      return { a: sw.localToWorld(this.katana.base.clone()), b: sw.localToWorld(this.katana.tip.clone()), r: 0.012 };
    }
    if (h === 'foot_r') {
      const a = this.bone('foot_r').getWorldPosition(new THREE.Vector3());
      const ballB = this.bones.get('ball_r');
      const ball = ballB ? ballB.getWorldPosition(new THREE.Vector3()) : a.clone();
      return { a, b: ball.clone().add(ball.clone().sub(a).multiplyScalar(0.4)), r: 0.06 };
    }
    const s = h === 'fist_l' ? 'l' : 'r';
    const a = this.bone(`hand_${s}`).getWorldPosition(new THREE.Vector3());
    const k = this.bone(`middle_01_${s}`).getWorldPosition(new THREE.Vector3());
    return { a, b: k.clone().add(k.clone().sub(a).multiplyScalar(0.25)), r: 0.045 };
  }

  /** His eyes (world). */
  eye(): V3 {
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return this.bone('head').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.07, 0.09).applyQuaternion(yawQ));
  }

  /** Squared up and fighting: his stance, his move (or guard) from his own eyes toward you, his fists; `tell`
   * 0..1 into a windup. */
  private poseFight(you: V3, tell: number, dt = 0): void {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.root.quaternion.copy(yawQ);
    const sp = this.springs;
    const sw = Math.sin(this.walkPhase) * this.moving;
    this.turn('thigh_l', 0, -0.12 - 0.35 * sw);
    this.turn('thigh_r', 0, -0.12 + 0.35 * sw);
    this.turn('calf_l', 0, 0.22 + 0.4 * Math.max(0, Math.sin(this.walkPhase + 1.3)) * this.moving);
    this.turn('calf_r', 0, 0.22 + 0.4 * Math.max(0, -Math.sin(this.walkPhase + 1.3)) * this.moving);
    let P = this.melee.pose(NO_SHEATH);
    // An elite's guard: on his side, eased round; out of it into a move, blended (no snap to the centre).
    if (this.tier === 'elite') {
      const k = Math.min(1, dt * 12);
      if (this.katana) {
        const want = SWORD_GUARDS[this.guard];
        this.swordNow = this.swordNow ? lerpSword(this.swordNow, want, k) : want;
      } else {
        const want = FIST_GUARDS[this.guard];
        this.handsNow = this.handsNow ? { r: lerpHand(this.handsNow.r, want.r, k), l: lerpHand(this.handsNow.l, want.l, k) } : want;
      }
      if (this.melee.swing !== this.swingSeen) {
        this.swingSeen = this.melee.swing;
        this.fromPose = { sword: this.swordNow, hands: this.handsNow, t: 0.14 };
      }
      if (!this.melee.move) P = { ...P, sword: this.katana ? this.swordNow : null, r: this.katana ? null : this.handsNow!.r, l: this.katana ? null : this.handsNow!.l };
      else if (this.fromPose && this.fromPose.t > 0) {
        this.fromPose.t -= dt;
        const u = 1 - Math.max(0, this.fromPose.t) / 0.14;
        const fp = this.fromPose;
        P = {
          ...P,
          sword: P.sword && fp.sword ? lerpSword(fp.sword, P.sword, u) : P.sword,
          r: P.r && fp.hands ? lerpHand(fp.hands.r, P.r, u) : P.r,
          l: P.l && fp.hands ? lerpHand(fp.hands.l, P.l, u) : P.l,
        };
        if (this.melee.move && this.katana) this.swordNow = P.sword;
      }
    }
    // The windup: drawn back, turned away from the blow to come.
    const tm = this.tellMove;
    const rightHand = tm === 'cross' || tm === 'hookR' || tm === 'uppercut';
    const coil = tell * (tm === 'kick' ? 0 : rightHand ? -0.35 : 0.3);
    this.turn('spine_01', 0, 0.08 + sp.bend.x * 0.4 + P.lean * 0.4 - (tm === 'kick' ? 0.15 * tell : 0));
    this.turn('spine_02', 0, 0.04 + sp.bend.x * 0.6 + P.lean * 0.6);
    this.turn('spine_02', 1, sp.twist.x * 0.5 + (P.twist + coil) * 0.45);
    this.turn('spine_03', 1, sp.twist.x * 0.5 + (P.twist + coil) * 0.55);
    this.turn('spine_03', 2, sp.side.x);
    this.turn('neck_01', 0, 0.1 + sp.pitch.x * 0.4);
    this.turn('head', 0, sp.pitch.x * 0.6);
    this.turn('neck_01', 1, sp.yaw.x * 0.4);
    this.turn('head', 1, sp.yaw.x * 0.6);
    this.root.updateMatrixWorld(true);
    // His view: from his eyes toward your face.
    const eye = this.eye();
    const to = you.clone().sub(eye);
    const pitch = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.45, 0.45);
    const viewQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, this.yaw + Math.PI, 0, 'YXZ'));
    const s = this.size;
    const place = (key: HandKey, side: 'l' | 'r'): void => {
      const p = key.p.clone();
      // Drawn back in the windup.
      if (tell > 0 && (side === 'r') === rightHand && tm !== 'kick') p.add(new THREE.Vector3(side === 'r' ? 0.04 : -0.04, 0.03, 0.12).multiplyScalar(smooth(tell)));
      const target = p.multiplyScalar(s).applyQuaternion(viewQ).add(eye);
      const elbow = (key.elbow ?? new THREE.Vector3(0.8 * (side === 'r' ? 1 : -1), -1, 0.25)).clone().applyQuaternion(viewQ);
      twoBone(this.bone(`upperarm_${side}`), this.bone(`lowerarm_${side}`), this.bone(`hand_${side}`), target, elbow);
    };
    if (P.r) place(P.r, 'r');
    if (P.l) place(P.l, 'l');
    // His sword, placed from his eyes, both hands on the tsuka.
    if (this.katana && P.sword) {
      const k = this.katana;
      const pos = P.sword.p.clone().multiplyScalar(s).applyQuaternion(viewQ).add(eye);
      const q = viewQ.clone().multiply(swordQuat(P.sword));
      k.sword.position.copy(this.root.worldToLocal(pos));
      k.sword.quaternion.copy(this.root.quaternion.clone().invert().multiply(q));
      k.sword.updateMatrixWorld(true);
      const pole = (side: number): V3 => new THREE.Vector3(0.8 * side, -1, 0.25).applyQuaternion(viewQ);
      twoBone(this.bone('upperarm_r'), this.bone('lowerarm_r'), this.bone('hand_r'), k.sword.localToWorld(k.grip.at.clone()), pole(1));
      twoBone(this.bone('upperarm_l'), this.bone('lowerarm_l'), this.bone('hand_l'), k.sword.localToWorld(k.fore.at.clone()), pole(-1));
    }
    if (P.foot) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ);
      const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(yawQ);
      const standing = this.bone('foot_r').getWorldPosition(new THREE.Vector3());
      const want = this.root.position.clone().addScaledVector(right, P.foot.p.x * s).addScaledVector(new THREE.Vector3(0, 1, 0), P.foot.p.y * s).addScaledVector(fwd, P.foot.p.z * s);
      twoBone(this.bone('thigh_r'), this.bone('calf_r'), this.bone('foot_r'), standing.lerp(want, P.foot.w), fwd.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize());
    }
    this.fist('l');
    this.fist('r');
  }

  /** Guard broken: down on one knee, the sword's point to the ground, his head hanging, open. */
  private poseBroken(dt: number): void {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    const k = Math.min(1, (ELITE.broken - this.brokenT) / 0.3);
    this.root.position.y = this.groundY - 0.3 * k;
    this.turn('thigh_r', 0, -1.4 * k);
    this.turn('calf_r', 0, 2.1 * k);
    this.turn('thigh_l', 0, -0.2 * k);
    this.turn('calf_l', 0, 1.5 * k);
    this.turn('spine_01', 0, 0.3 * k);
    this.turn('spine_02', 0, 0.25 * k);
    this.turn('neck_01', 0, 0.35 * k);
    this.turn('head', 0, 0.2 * k + Math.sin(this.brokenT * 9) * 0.02);
    this.root.updateMatrixWorld(true);
    const yawQ = this.root.quaternion;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(yawQ);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(yawQ);
    const knee = this.bone('calf_r').getWorldPosition(new THREE.Vector3());
    twoBone(this.bone('upperarm_r'), this.bone('lowerarm_r'), this.bone('hand_r'), knee.clone().addScaledVector(fwd, 0.25).addScaledVector(right, 0.15).add(new THREE.Vector3(0, 0.15, 0)), new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.6));
    twoBone(this.bone('upperarm_l'), this.bone('lowerarm_l'), this.bone('hand_l'), this.bone('calf_l').getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, 0)).addScaledVector(fwd, 0.1), new THREE.Vector3(0, -1, 0).addScaledVector(right, -0.6));
    this.fist('l', 0.8);
    this.fist('r', 0.8);
    void dt;
  }

  /** Going down, lying there, or (`still`) held at the angle the fall is at: the knees go, he tips over his heels
   * the way he was hit, arms flung. */
  private poseFall(dt: number, still: boolean): void {
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.root.quaternion.copy(yawQ);
    const f = this.fall!;
    if (!still) {
      if (f.a < Math.PI / 2) {
        f.v += 9.8 * Math.sin(f.a + 0.15) * dt * 1.1;
        f.a += f.v * dt;
        if (f.a >= Math.PI / 2) {
          f.a = Math.PI / 2;
          f.v = -f.v * 0.18;
        }
      } else {
        f.v -= 9.8 * dt;
        f.a = Math.min(Math.PI / 2, f.a + f.v * dt);
      }
    }
    const u = Math.min(1, f.a / (Math.PI / 2));
    const backward = f.dir.clone().applyQuaternion(yawQ.clone().invert()).z < 0;
    this.tip(f.dir, f.a);
    this.root.position.y = this.groundY + 0.1 * Math.sin(f.a);
    const buckle = Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.9;
    this.turn('thigh_l', 0, -buckle * 0.6);
    this.turn('thigh_r', 0, -buckle * 0.5);
    this.turn('calf_l', 0, buckle);
    this.turn('calf_r', 0, buckle * 0.8);
    const fling = (backward ? 1 : -1) * Math.min(1, u * 1.4);
    this.turn('upperarm_l', 2, 0.9 * Math.abs(fling));
    this.turn('upperarm_r', 2, -0.9 * Math.abs(fling));
    this.turn('upperarm_l', 0, -0.6 * fling);
    this.turn('upperarm_r', 0, -0.5 * fling);
    this.turn('lowerarm_l', 0, -0.3);
    this.turn('lowerarm_r', 0, -0.4);
    this.turn('neck_01', 1, 0.3 * u);
    this.turn('head', 0, (backward ? -0.3 : 0.3) * u);
    this.turn('head', 1, 0.4 * u);
    if (this.brokenNeck) {
      this.turn('neck_01', 1, 0.6);
      this.turn('head', 1, 1.3);
      this.turn('head', 0, 0.25);
    }
    // Out of a kill move's pose, not snapped from it.
    const bf = this.blendFrom;
    if (bf) {
      bf.t -= dt;
      const k = Math.max(0, bf.t / BLEND);
      const w = k * k * (3 - 2 * k);
      for (const [b, q] of bf.bones) b.quaternion.slerp(q, w);
      this.root.quaternion.slerp(bf.root, w);
      if (bf.t <= 0) this.blendFrom = null;
    }
    this.root.updateMatrixWorld(true);
  }

  /** Closes a hand into a fist (the closing way found by trying it: the hands mirror). */
  fist(s: 'l' | 'r', amount = 1): void {
    const b = (n: string): THREE.Bone => this.bone(`${n}_${s}`);
    const hand = b('hand');
    hand.updateWorldMatrix(true, true);
    const p = (x: THREE.Bone): V3 => x.getWorldPosition(new THREE.Vector3());
    const fwd = p(b('middle_01')).sub(p(hand)).normalize();
    const across = p(b('pinky_01')).sub(p(b('index_01'))).normalize();
    const palm = new THREE.Vector3().crossVectors(fwd, across).normalize();
    if (p(b('thumb_03')).sub(p(hand)).dot(palm) < 0) palm.negate();
    const axis = new THREE.Vector3().crossVectors(palm, fwd).normalize();
    const curl = (bone: THREE.Bone, angle: number): void => {
      const local = axis.clone().applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
      bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(local, -angle));
      bone.updateWorldMatrix(false, true);
    };
    const mid = b('middle_03');
    const t0 = p(mid);
    curl(b('middle_01'), 0.2);
    const sgn = p(mid).sub(t0).dot(palm) > 0 ? 1 : -1;
    curl(b('middle_01'), -0.2);
    ['index', 'middle', 'ring', 'pinky'].forEach((f, i) => [1, 2, 3].forEach((j) => curl(b(`${f}_0${j}`), sgn * FIST[i][j - 1] * amount)));
    curl(b('thumb_02'), sgn * 0.5 * amount);
    curl(b('thumb_03'), sgn * 0.5 * amount);
  }
}
