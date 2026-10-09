import * as THREE from 'three';
import { bonePoint, CHAR_PARTS, CHAR_STEPS, characterBones, DIGIT_RANGE, digitValue, PART_BONE, parentBone, partTurn, TOE_RANGE, toeValue, withDigit, withToe, type CharacterPose, type CharPart, type PosedBones } from '../real/characterPose';
import type { CharacterDef } from '../real/mobCharacters';
import { addFigure, figureTemplate, GhostBuilder, posedMaterial, setMobLook, type FigureSpec, type GhostLight, type MobLook } from '../real/people';
import { ARM_L, ARM_R, digitBone, fingerTip, FOOT_L, FOOT_R, FORE_L, FORE_R, handBone, HEAD, PELVIS, SHIN_L, SHIN_R, SPINE, spineBone, THIGH_L, THIGH_R, toeDigit, type Template } from '../real/mobRig';
import { poseValue, poseWith, type PartStep } from '../real/windowScenes';

/**
 * Posing a named character by hand (the characters' page, characters.html, its Pose tab): one figure drawn with the
 * characters' posed material (real/people.ts `posedMaterial`), its pose the rooms' own format with a character's
 * fingers and toes (real/characterPose.ts), set a part at a time by sliders, each one of that part's turns
 * (windowScenes.ts CHAR_STEPS, so what's saved here is what a scene would hold). Poses are kept by name in the
 * browser (localStorage `rainyplace.poses`) and copied out as JSON.
 *
 * **In the view** there is a dot at every joint (HANDLES), shown while Shift is held. Three things are done with one:
 *  - **dragged**, it moves across the view and the limb follows (`limb`: the upper arm or thigh turned by the smallest
 *    turn that takes it there, never about its own length, and the elbow or knee bent; the turn is then written as
 *    that part's own numbers, `fitUpper`), so a limb doesn't twist as it's dragged;
 *  - **Alt-dragged** sideways, it turns the limb about its own line (a hand or foot: about the line from the
 *    shoulder or hip to it, so it stays where it is and the elbow or knee goes round), or the head, chest or body
 *    about its upright;
 *  - **clicked**, its part is in hand, and three rings stand round the joint, red, green and blue for the part's own
 *    x, y and z as they lie now (`rings`): dragging a ring turns the part about that axis (`turnPart`, the turn fitted
 *    back into the part's numbers: `fitTurns`).
 *
 * **On the floor or not** (`free`): on the floor (as it starts) the figure stands on its lowest point, a foot that is
 * down stays where it is while something else is dragged (`Pin`: the figure is moved over it, `offset`, and the foot
 * kept flat, `levelFoot`), and the hips' dot crouches and rises over planted feet. Free, the figure stays where it is
 * put whatever its legs do (both lifted, it hangs there), and the hips' dot moves the whole of it, up off the floor
 * too. Every change is a step that can be undone (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y).
 *
 * **The whole of her**: with Z held a drag anywhere moves her, with X held it turns her (sideways about the upright,
 * up and down tipping her toward and away). **Locks** (Ctrl-click a dot, or the panel): a locked dot stays where it
 * is on the stage while the rest of her is moved or turned (`kept`: its limb solved again to it after every change).
 * **Finger and toe joints** (Space shows and hides them): a dot at each finger's middle joint and its tip and at each
 * toe's tip, dragged like the others; they are the pose's `dL`, `dR` and `eL`, `eR`. The first steps toward a scene builder: keyframes, props and a second figure come after.
 */
const STORE = 'rainyplace.poses';
type PartPick = CharPart | 'digits';
type V3 = [number, number, number];
type Turn = readonly [CharPart, string];
type Side = 0 | 1;
const S = ['L', 'R'] as const;
const FOOT = [FOOT_L, FOOT_R] as const;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** An arm or a leg: its upper part and the bones at its three joints, and the turn that bends it. */
interface Limb {
  readonly upper: CharPart;
  readonly top: number;
  readonly mid: number;
  readonly end: number;
  readonly bend: Turn;
  /** A leg's side (an arm has none). */
  readonly leg?: Side;
}
const ARMS: readonly Limb[] = [
  { upper: 'armL', top: ARM_L, mid: FORE_L, end: handBone(0), bend: ['foreL', 'elbow'] },
  { upper: 'armR', top: ARM_R, mid: FORE_R, end: handBone(1), bend: ['foreR', 'elbow'] },
];
const LEGS: readonly Limb[] = [
  { upper: 'thighL', top: THIGH_L, mid: SHIN_L, end: FOOT_L, bend: ['shinL', 'knee'], leg: 0 },
  { upper: 'thighR', top: THIGH_R, mid: SHIN_R, end: FOOT_R, bend: ['shinR', 'knee'], leg: 1 },
];
/**
 * A dot at a joint: where it is on the posed figure, the part that begins there (the one its rings turn), and what
 * dragging it does: a limb's end or middle carried there, a couple of turns solved (`turns`), the hips moved, or
 * nothing (a shoulder, a hip, the waist: only picked). `spin`: the one turn a Shift-drag changes, where it isn't a limb's.
 */
interface Handle {
  readonly name: string;
  readonly part: CharPart;
  readonly at: (b: PosedBones, T: Template) => V3;
  readonly color: number;
  readonly small?: boolean;
  readonly limb?: Limb;
  readonly drag?: 'end' | 'mid' | 'aim' | 'turns' | 'hips';
  /** A dot of the spine: the parts under it that a drag turns, from the joint the chain begins at (`root`) up. */
  readonly chain?: readonly CharPart[];
  readonly turns?: readonly Turn[];
  /** The numbers a drag solves, where they aren't parts' turns (a finger's joints). */
  readonly knobs?: readonly Knob[];
  readonly spin?: Turn;
  /** A finger's or a toe's: shown only when their joints are. */
  readonly finger?: boolean;
  /**
   * The bone at whose joint the chain a dot is on begins; and, for a finger's, the least share of its length at rest a
   * drag may bring the dot to that joint (the finger curled): a drag is held to that reach (`inReach`).
   */
  readonly root?: number;
  readonly slack?: number;
}
/** A number of the pose a drag may change: how to read it, how to write it, how far it goes. */
interface Knob {
  readonly get: (p: CharacterPose) => number;
  readonly put: (p: CharacterPose, v: number) => CharacterPose;
  readonly range: readonly [number, number];
}
const joint = (bone: number) => (b: PosedBones): V3 => [...b.joints[bone]] as V3;
const END = 0xffd060, MID = 0x60c8ff, CORE = 0xff7ac8, ROOTED = 0x9aa0b0, FINGER = 0xffe9a8, KNUCKLE = 0xa8e0ff, LOCKED = 0xff3838;
const RIBS = spineBone(0), UPPER = spineBone(1), SKULL = spineBone(2);
const HANDLES: readonly Handle[] = [
  ...ARMS.flatMap((l, s): Handle[] => [
    { name: `hand ${S[s]}`, part: `hand${S[s]}`, at: joint(l.end), color: END, limb: l, drag: 'end' },
    { name: `elbow ${S[s]}`, part: `fore${S[s]}`, at: joint(l.mid), color: MID, limb: l, drag: 'mid' },
    { name: `shoulder ${S[s]}`, part: `arm${S[s]}`, at: joint(l.top), color: ROOTED, small: true, limb: l },
  ]),
  ...LEGS.flatMap((l, s): Handle[] => [
    { name: `foot ${S[s]}`, part: `foot${S[s]}`, at: joint(l.end), color: END, limb: l, drag: 'end' },
    { name: `knee ${S[s]}`, part: `shin${S[s]}`, at: joint(l.mid), color: MID, limb: l, drag: 'mid' },
    { name: `hip ${S[s]}`, part: `thigh${S[s]}`, at: joint(l.top), color: ROOTED, small: true, limb: l },
  ]),
  // The spine: each dot is moved by the joints under it (a drag of the neck's base bends the whole back, shared
  // between its joints: `aim`), and its rings turn the part that begins at it.
  { name: 'head', part: 'skull', root: HEAD, at: (b, T) => bonePoint(b.bones, SKULL, [T.pivot[SKULL][0], T.pivot[SKULL][1] + 0.15, T.pivot[SKULL][2]]), color: CORE, drag: 'aim', chain: ['head', 'skull'], spin: ['skull', 'turn'] },
  { name: 'skull', part: 'skull', root: HEAD, at: joint(SKULL), color: CORE, small: true, drag: 'aim', chain: ['head'], spin: ['skull', 'turn'] },
  { name: 'neck', part: 'head', root: SPINE, at: joint(HEAD), color: CORE, drag: 'aim', chain: ['chest', 'ribs', 'upper'], spin: ['head', 'turn'] },
  { name: 'chest', part: 'upper', root: SPINE, at: joint(UPPER), color: CORE, small: true, drag: 'aim', chain: ['chest', 'ribs'], spin: ['upper', 'twist'] },
  { name: 'ribs', part: 'ribs', root: SPINE, at: joint(RIBS), color: CORE, small: true, drag: 'aim', chain: ['chest'], spin: ['ribs', 'twist'] },
  { name: 'waist', part: 'chest', at: joint(SPINE), color: ROOTED, small: true, spin: ['chest', 'twist'] },
  { name: 'hips', part: 'body', at: joint(PELVIS), color: 0xf4f4f4, drag: 'hips', spin: ['body', 'yaw'] },
];
const turnOf = ([part, name]: Turn): PartStep => CHAR_STEPS[part].find((st) => st.name === name)!;
const knobOf = (t: Turn): Knob => {
  const st = turnOf(t);
  return { get: (p) => poseValue(p, st), put: (p, v) => poseWith(p, st, v) as CharacterPose, range: st.range };
};
const knobsOf = (h: Handle): readonly Knob[] => h.knobs ?? (h.turns ?? []).map(knobOf);
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
/**
 * The fingers' dots for a figure: at each finger's middle joint (dragged, the finger's root closes and spreads) and at
 * its tip (the middle joint closes too). The tip is the finger's furthest point from that joint.
 */
function fingerHandles(T: Template): Handle[] {
  const out: Handle[] = [];
  for (const h of [0, 1] as const) {
    for (let d = 0; d < 5; d++) {
      const j1 = digitBone(h, d, 1), j2 = fingerTip(h, d);
      const q = T.pivot[j1];
      if (!q) continue;
      let tip: V3 = [q[0], q[1], q[2]], far = 0;
      for (let i = 0; i < T.b0.length; i++) {
        if ((T.b0[i] === j2 ? T.w[i] : T.b1[i] === j2 ? 1 - T.w[i] : 0) < 0.6) continue;
        const x = T.pos[i * 3], y = T.pos[i * 3 + 1], z = T.pos[i * 3 + 2];
        const off = Math.hypot(x - q[0], y - q[1], z - q[2]);
        if (off > far) [far, tip] = [off, [x, y, z]];
      }
      const knob = (turn: 0 | 1 | 2): Knob => ({ get: (p) => digitValue(p, h, d, turn), put: (p, v) => withDigit(p, h, d, turn, v), range: DIGIT_RANGE[turn] });
      const end = tip;
      const j0 = digitBone(h, d, 0);
      out.push({ name: `${DIGITS[d]} ${S[h]} tip`, root: j0, slack: 0.35, part: `hand${S[h]}`, at: (b) => bonePoint(b.bones, j2, end), color: FINGER, finger: true, drag: 'turns', knobs: [knob(0), knob(1), knob(2)] });
      out.push({ name: `${DIGITS[d]} ${S[h]} mid`, root: j0, slack: 0.99, part: `hand${S[h]}`, at: joint(j1), color: KNUCKLE, finger: true, drag: 'turns', knobs: [knob(0), knob(1)] });
    }
  }
  return out;
}
/** The toes' dots for a figure: one at each toe's tip (dragged, the toe turns up and to the side at its root). */
function toeHandles(T: Template): Handle[] {
  const out: Handle[] = [];
  for (const f of [0, 1] as const) {
    for (let t = 0; t < 5; t++) {
      const bone = toeDigit(f, t);
      const q = T.pivot[bone];
      if (!q) continue;
      let tip: V3 = [q[0], q[1], q[2]], far = 0;
      for (let i = 0; i < T.b0.length; i++) {
        if ((T.b0[i] === bone ? T.w[i] : T.b1[i] === bone ? 1 - T.w[i] : 0) < 0.6) continue;
        const x = T.pos[i * 3], y = T.pos[i * 3 + 1], z = T.pos[i * 3 + 2];
        const off = Math.hypot(x - q[0], y - q[1], z - q[2]);
        if (off > far) [far, tip] = [off, [x, y, z]];
      }
      if (!far) continue;
      const knob = (turn: 0 | 1): Knob => ({ get: (p) => toeValue(p, f, t, turn), put: (p, v) => withToe(p, f, t, turn, v), range: TOE_RANGE[turn] });
      const end = tip;
      out.push({ name: `${t === 0 ? 'big toe' : `toe ${t + 1}`} ${S[f]}`, root: bone, slack: 0.97, part: `foot${S[f]}`, at: (b) => bonePoint(b.bones, bone, end), color: FINGER, finger: true, drag: 'turns', knobs: [knob(0), knob(1)] });
    }
  }
  return out;
}
/** A dot that can be locked where it is: one a drag can bring back there. */
const lockable = (h: Handle): boolean => h.drag === 'end' || h.drag === 'mid' || h.drag === 'aim';
/** The parts of a limb. */
const limbParts = (l: Limb): CharPart[] => [l.upper, l.bend[0], l.upper.replace(/^arm/, 'hand').replace(/^thigh/, 'foot') as CharPart];
/** An upper arm's and a thigh's turns are solved as one turn (`fitUpper`). */
const isUpper = (part: CharPart): boolean => /^(arm|thigh)/.test(part);
/**
 * How far a turn may go here. An upper arm's and a thigh's swing and twist go all the way round: they are both turns
 * about the limb's own line when it hangs, so a limb carried out to the side without twisting is a swing one way and
 * a twist back the other, further than either goes alone.
 */
const rangeOf = (part: CharPart, st: PartStep): readonly [number, number] =>
  isUpper(part) && st.axis === 'y' ? [Math.min(st.range[0], -190), Math.max(st.range[1], 190)] : st.range;
/** A foot that stays where it is on the floor while something else is dragged: which, where its ankle is (the stage's frame), and whether it was flat. */
interface Pin {
  readonly foot: Side;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly level: boolean;
}
/** A foot counts as on the floor within this of the lower one's height (m). */
const PLANTED = 0.03;
/** The rings' radius, as a share of how far off they are (a steady size on the screen), and their colours: x, y, z. */
const GIZMO = 0.05;
const AXIS_COLORS = [0xff5a5a, 0x6adf6a, 0x5a9aff] as const;
/** How much a turn of the limb about its own line counts against missing the target (m a radian): it isn't turned so unless nothing else will do. */
const ROLL = 0.5;
/**
 * Where a dragged hand may not take its elbow: behind the shoulder (the upper arm's line, in the chest's frame, further
 * back than the first) unless it is well down (lower than the second). A shoulder doesn't go there, and a hand
 * drawn up past its shoulder would take the elbow over the top the back way.
 */
const ELBOW_BACK = [-0.35, -0.55] as const;
/** X held: radians a pixel the whole of her turns. */
const TURN_ALL = 0.01;
/** Shift-drag: radians, and degrees, a pixel. */
const SPIN = 0.012, SPIN_DEG = 0.5;

/** The rotation in a bone's matrix (-1: none). */
const rotOf = (bones: Float32Array, b: number): THREE.Matrix4 => (b < 0 ? new THREE.Matrix4() : new THREE.Matrix4().fromArray(bones, b * 16).setPosition(0, 0, 0));
/** A rotation as its axis times its angle. */
function rotVec(m: THREE.Matrix4): V3 {
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const s = Math.hypot(q.x, q.y, q.z);
  if (s < 1e-9) return [0, 0, 0];
  const k = (2 * Math.atan2(s, q.w)) / s;
  return [q.x * k, q.y * k, q.z * k];
}
/** Damped least squares: the x that best makes the columns times x equal e (each column as long as e). */
function solve(cols: readonly (readonly number[])[], e: readonly number[], damp: number): number[] {
  const n = cols.length;
  const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((sum, v, k) => sum + v * b[k], 0);
  const A = cols.map((ci, i) => cols.map((cj, j) => dot(ci, cj) + (i === j ? damp : 0)));
  const g = cols.map((c) => dot(c, e));
  for (let i = 0; i < n; i++) {
    let top = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[top][i])) top = r;
    [A[i], A[top]] = [A[top], A[i]];
    [g[i], g[top]] = [g[top], g[i]];
    const d = A[i][i] || 1e-14;
    for (let r = 0; r < n; r++) {
      const k = r === i ? 0 : A[r][i] / d;
      if (!k) continue;
      for (let c = i; c < n; c++) A[r][c] -= k * A[i][c];
      g[r] -= k * g[i];
    }
  }
  return g.map((v, i) => v / (A[i][i] || 1e-14));
}

/** What the view gives the poser to drag in it. */
export interface PoserView {
  readonly camera: THREE.PerspectiveCamera;
  readonly dom: HTMLElement;
  /** The orbit controls, switched off while a dot is dragged. */
  readonly controls: { enabled: boolean };
  /** The height the figure stands at. */
  readonly floorY: number;
  /** Something changed that the panel shows. */
  readonly onChange: () => void;
}
const LABEL: Record<PartPick, string> = {
  body: 'whole body', chest: 'waist', ribs: 'lower chest', upper: 'upper chest', head: 'neck', skull: 'head',
  armL: 'upper arm L', foreL: 'forearm L', handL: 'hand L', armR: 'upper arm R', foreR: 'forearm R', handR: 'hand R',
  thighL: 'thigh L', shinL: 'shin L', footL: 'foot L', thighR: 'thigh R', shinR: 'shin R', footR: 'foot R',
  digits: 'fingers, toes, seat',
};
const PRESETS: [string, CharacterPose][] = [
  ['standing', {}],
  ['on a chair', { lL: [88, 0, 88], lR: [88, 0, 88], aL: [20, 0, 40], aR: [20, 0, 40], seat: 0.45 }],
  ['a stride', { lL: [26, 0, 6], lR: [-18, 0, 30], aL: [-20, 0, 20], aR: [24, 0, 30] }],
  ['arms out', { aL: [0, 90, 0, 0], aR: [0, 90, 0, 0] }],
  ['kneeling', { lL: [6, 0, 96], lR: [6, 0, 96], fL: [50], fR: [50] }],
  ['a hand raised', { aR: [150, 20, 30], gR: 0.1, turn: -12 }],
];

const load = (): Record<string, CharacterPose> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, CharacterPose>;
  } catch {
    return {};
  }
};
/** The panel's sections that are folded shut (kept while the page is open). */
const SHUT = new Set<string>(['Start from', 'Saved poses']);

type Drag =
  | { readonly kind: 'dot'; readonly handle: number; readonly target: THREE.Vector3; last: [number, number]; readonly pin: Pin | null; readonly other: V3 | null; moved: boolean }
  | { readonly kind: 'ring'; readonly axis: 0 | 1 | 2; readonly along: [number, number]; readonly perRad: number; last: [number, number] }
  | { readonly kind: 'move'; last: [number, number] }
  | { readonly kind: 'turn'; last: [number, number] };

export class Poser {
  readonly object = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  pose: CharacterPose = {};
  /** Where the figure stands, from the stage's middle (x, z), and free of the floor how high (y). */
  readonly offset = new THREE.Vector3();
  /** Free of the floor: the figure stays where it's put, whatever its legs do. */
  free = false;
  private who = 0;
  private part: PartPick = 'body';
  private template!: Template;
  private mesh: THREE.Mesh | null = null;
  /** Whether its dots are shown and can be dragged (its stage is the one looked at). */
  active = false;
  private handles: readonly Handle[] = HANDLES;
  private readonly dots: THREE.Mesh[] = [];
  /** The dots locked where they are: each one's place on the stage. */
  readonly locks = new Map<string, V3>();
  /** How far each dot on a chain is from the chain's first joint, at rest. */
  private readonly reachOf = new Map<string, number>();
  /** The dot last taken hold of (the panel's lock button is for it). */
  private picked = '';
  /** Whether the fingers' and toes' joints are shown (Space). */
  fingers = false;
  /** Z and X while they are held. */
  private readonly held = new Set<string>();
  /** Whether the joints' dots are shown: only while Shift (or Alt, which turns a limb by its dot) is held. */
  private shown = false;
  private readonly gizmo = new THREE.Group();
  private posed!: PosedBones;
  private drag: Drag | null = null;
  /** The steps that can be undone: each the pose and where the figure stood. */
  private history: string[] = [];
  private step = -1;

  constructor(private readonly chars: readonly CharacterDef[], light: GhostLight | undefined, private readonly at: THREE.Vector3, private readonly view?: PoserView) {
    this.material = posedMaterial(light);
    // The rings: one round each of the part's own axes, and a stub along each from the joint.
    const ring = new THREE.TorusGeometry(1, 0.014, 6, 64);
    const stub = new THREE.CylinderGeometry(0.014, 0.014, 0.45, 6).translate(0, 0.225, 0);
    AXIS_COLORS.forEach((color, i) => {
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });
      const r = new THREE.Mesh(i === 0 ? ring.clone().rotateY(Math.PI / 2) : i === 1 ? ring.clone().rotateX(Math.PI / 2) : ring, mat);
      const s = new THREE.Mesh(i === 0 ? stub.clone().rotateZ(-Math.PI / 2) : i === 2 ? stub.clone().rotateX(Math.PI / 2) : stub, mat);
      r.renderOrder = s.renderOrder = 10;
      this.gizmo.add(r, s);
    });
    this.object.add(this.gizmo);
    this.build();
    this.commit();
    if (view) this.listen(view);
  }

  // ---- where things are ----

  /** A pose's bones, the figure on the floor or left where it is. */
  private fk(pose: CharacterPose, sample = 1): PosedBones {
    return characterBones(this.template, pose, sample, this.free);
  }
  /** A point of the figure's own frame, on its stage (from the stage's middle, above its floor). */
  private staged(p: readonly number[]): V3 {
    return [p[0] + this.offset.x, p[1] + (this.free ? this.offset.y : 0), p[2] + this.offset.z];
  }
  /** A point of the figure's own frame, in the scene. */
  private world(p: readonly number[]): THREE.Vector3 {
    const q = this.staged(p);
    return new THREE.Vector3(this.at.x + q[0], (this.view?.floorY ?? 0) + q[1], this.at.z + q[2]);
  }
  private screen(v: THREE.Vector3): [number, number] {
    const r = this.view!.dom.getBoundingClientRect();
    const q = v.clone().project(this.view!.camera);
    return [r.left + ((q.x + 1) / 2) * r.width, r.top + ((1 - q.y) / 2) * r.height];
  }
  /** Where a dot is on the screen (CSS pixels), for scripts: `__mob.poser.dotAt('hand R')`. */
  dotAt(name: string): [number, number] | null {
    const i = this.handles.findIndex((h) => h.name === name);
    return i < 0 || !this.view ? null : this.screen(this.dots[i].position);
  }
  /** A dot's place on its stage (from the stage's middle, above its floor), for scripts. */
  where(name: string): V3 | null {
    const h = this.handles.find((x) => x.name === name);
    return h ? this.staged(h.at(this.posed, this.template)) : null;
  }
  /** A dot locked where it is, or let go (a dot that can't be brought back to its place isn't locked): for the panel, Alt-click and scripts. */
  lock(name: string, on = !this.locks.has(name)): void {
    const h = this.handles.find((x) => x.name === name);
    if (!on) this.locks.delete(name);
    else if (h && lockable(h)) this.locks.set(name, this.where(name)!);
    this.commit();
  }
  /** The part in hand (its rings are shown), for scripts. */
  select(part: PartPick): void {
    this.part = part;
  }

  // ---- the rings ----

  /** The rings' place: the joint of the part in hand, the part's own axes as they lie now, and how big they are drawn. */
  private rings(): { at: THREE.Vector3; rot: THREE.Matrix4; radius: number } | null {
    if (this.part === 'digits') return null;
    const bone = PART_BONE[this.part];
    const at = this.world(this.posed.joints[this.part === 'body' ? PELVIS : bone]);
    return { at, rot: rotOf(this.posed.bones, bone), radius: this.view ? at.distanceTo(this.view.camera.position) * GIZMO : 0.12 };
  }
  /** A point of a ring (0 x, 1 y, 2 z) at an angle round it, in the scene. */
  private ringPoint(g: { at: THREE.Vector3; rot: THREE.Matrix4; radius: number }, axis: number, t: number): THREE.Vector3 {
    const c = Math.cos(t), s = Math.sin(t);
    const p = axis === 0 ? new THREE.Vector3(0, c, s) : axis === 1 ? new THREE.Vector3(s, 0, c) : new THREE.Vector3(c, s, 0);
    return p.applyMatrix4(g.rot).multiplyScalar(g.radius).add(g.at);
  }
  /** Where a ring can be taken hold of on the screen, clear of the dots and the other rings: for scripts (`ringAt('x')`). */
  ringAt(name: 'x' | 'y' | 'z'): [number, number] | null {
    const g = this.rings();
    if (!g || !this.view) return null;
    const axis = 'xyz'.indexOf(name);
    let best: [number, number] | null = null, far = -1;
    for (let k = 0; k < 64; k++) {
      const q = this.screen(this.ringPoint(g, axis, (k / 64) * Math.PI * 2));
      let near = Infinity;
      for (const d of this.dots) {
        const s = this.screen(d.position);
        near = Math.min(near, Math.hypot(s[0] - q[0], s[1] - q[1]));
      }
      for (let o = 0; o < 3; o++) {
        if (o === axis) continue;
        for (let j = 0; j < 64; j += 2) {
          const s = this.screen(this.ringPoint(g, o, (j / 64) * Math.PI * 2));
          near = Math.min(near, Math.hypot(s[0] - q[0], s[1] - q[1]));
        }
      }
      if (near > far) {
        far = near;
        best = q;
      }
    }
    return best;
  }

  // ---- undo ----

  private snapshot(): string {
    return JSON.stringify({ pose: this.pose, at: this.offset.toArray(), free: this.free, locks: [...this.locks] });
  }
  /** The pose as it is now is a step (unless nothing changed). */
  private commit(): void {
    const now = this.snapshot();
    if (this.history[this.step] === now) return;
    this.history.length = this.step + 1;
    this.history.push(now);
    if (this.history.length > 200) this.history.shift();
    this.step = this.history.length - 1;
  }
  /** Back a step (-1) or forward again (1); false where there is none. */
  undo(by: -1 | 1 = -1): boolean {
    const to = this.step + by;
    if (to < 0 || to >= this.history.length) return false;
    this.step = to;
    const s = JSON.parse(this.history[to]) as { pose: CharacterPose; at: V3; free: boolean; locks: [string, V3][] };
    this.pose = s.pose;
    this.offset.fromArray(s.at);
    this.free = s.free;
    this.locks.clear();
    for (const [name, at] of s.locks) this.locks.set(name, at);
    this.apply();
    return true;
  }
  /** A change made at once (a button's): the pose, and a step. */
  private act(pose: CharacterPose, stay = true): void {
    this.pose = pose;
    if (!stay) this.offset.set(0, this.free ? this.offset.y : 0, 0);
    this.apply();
    this.commit();
  }
  /** On the floor, or free of it: let go of the floor she stays at the height she's at. */
  setFree(free: boolean): void {
    if (free === this.free) return;
    if (free) this.offset.y = this.posed.down;
    this.free = free;
    this.apply();
    this.commit();
  }

  // ---- dragging ----

  private listen(view: PoserView): void {
    /** The dot under the pointer (the nearest within a few pixels), or -1. */
    const pickDot = (e: PointerEvent): number => {
      let best = -1, near = 13;
      this.shown = e.shiftKey || e.altKey;
      if (!this.shown) return -1;
      this.handles.forEach((h, i) => {
        if (h.finger && !this.fingers) return;
        const q = this.screen(this.dots[i].position);
        // (The small ones, and a finger's among them, give way to a bigger dot at the same place.)
        const d = Math.hypot(q[0] - e.clientX, q[1] - e.clientY) + (h.finger ? 5 : h.small ? 3 : 0);
        if (d < near) {
          near = d;
          best = i;
        }
      });
      return best;
    };
    /** The ring under the pointer, and where on it. */
    const pickRing = (e: PointerEvent): { axis: 0 | 1 | 2; t: number } | null => {
      const g = this.rings();
      if (!g) return null;
      let best: { axis: 0 | 1 | 2; t: number } | null = null, near = 8;
      for (const axis of [0, 1, 2] as const) {
        for (let k = 0; k < 96; k++) {
          const t = (k / 96) * Math.PI * 2;
          const q = this.screen(this.ringPoint(g, axis, t));
          const d = Math.hypot(q[0] - e.clientX, q[1] - e.clientY);
          if (d < near) {
            near = d;
            best = { axis, t };
          }
        }
      }
      return best;
    };
    /** Metres a pixel, at a point's depth. */
    const perPx = (p: THREE.Vector3): number => {
      const cam = view.camera;
      const depth = Math.max(0.2, p.clone().sub(cam.position).dot(cam.getWorldDirection(new THREE.Vector3())));
      return (2 * depth * Math.tan((cam.fov * Math.PI) / 360)) / view.dom.getBoundingClientRect().height;
    };
    view.dom.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      // Z or X held: the whole of her, wherever the pointer is.
      const all = this.held.has('KeyZ') ? 'move' : this.held.has('KeyX') ? 'turn' : null;
      const i = all ? -1 : pickDot(e);
      const ring = all || i >= 0 ? null : pickRing(e);
      if (!all && i < 0 && !ring) return;
      // (Before the orbit controls take the drag.)
      e.stopImmediatePropagation();
      if (i >= 0 && (e.ctrlKey || e.metaKey)) {
        // Ctrl-click: locked where it is, or let go.
        this.picked = this.handles[i].name;
        this.lock(this.picked);
        view.onChange();
        return;
      }
      view.controls.enabled = false;
      view.dom.setPointerCapture(e.pointerId);
      if (all) {
        this.drag = { kind: all, last: [e.clientX, e.clientY] };
        return;
      }
      if (ring) {
        // A ring: the pointer's move along the ring where it was taken, as a turn about its axis.
        const g = this.rings()!;
        const p = this.ringPoint(g, ring.axis, ring.t);
        const q = this.ringPoint(g, ring.axis, ring.t + 0.05);
        const a = this.screen(p), b = this.screen(q);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        // (A ring seen edge on where it was taken still turns: no slower than a third of its size on the screen.)
        const least = (g.radius / perPx(p)) * 0.35;
        this.drag = { kind: 'ring', axis: ring.axis, along: len > 1e-3 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0], perRad: Math.max(len / 0.05, least), last: [e.clientX, e.clientY] };
        return;
      }
      const h = this.handles[i];
      this.picked = h.name;
      const pin = this.pinFor(h);
      // (The hips: the other foot, if it's on the floor too, is brought back to where it was after each move.)
      const other = h.drag === 'hips' && pin && this.planted()[1 - pin.foot] ? this.where(`foot ${S[1 - pin.foot]}`) : null;
      this.drag = { kind: 'dot', handle: i, target: this.dots[i].position.clone(), last: [e.clientX, e.clientY], pin, other, moved: false };
      this.part = h.part;
    }, { capture: true });
    view.dom.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const d = this.drag;
      if (!d) {
        view.dom.style.cursor = pickDot(e) >= 0 || pickRing(e) ? 'grab' : '';
        return;
      }
      const dx = e.clientX - d.last[0], dy = e.clientY - d.last[1];
      d.last = [e.clientX, e.clientY];
      if (d.kind === 'move') {
        // Across the view; on the floor, up and down the screen is away and nearer along it.
        const cam = view.camera;
        const forward = cam.getWorldDirection(new THREE.Vector3());
        const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
        const k = perPx(this.world(this.posed.joints[PELVIS]));
        const other = this.free ? new THREE.Vector3().crossVectors(right, forward) : forward.setY(0).normalize();
        this.offset.addScaledVector(right, dx * k).addScaledVector(other, -dy * k);
        if (!this.free) this.offset.y = 0;
        this.pose = this.kept(this.pose, null, null);
        this.apply();
        return;
      }
      if (d.kind === 'turn') {
        const cam = view.camera;
        const right = new THREE.Vector3().crossVectors(cam.getWorldDirection(new THREE.Vector3()), cam.up).normalize();
        if (dx) this.turnPart('body', new THREE.Vector3(0, 1, 0), dx * TURN_ALL);
        if (dy) this.turnPart('body', right, dy * TURN_ALL);
        return;
      }
      if (d.kind === 'ring') {
        if (this.part === 'digits') return;
        const g = this.rings()!;
        const axis = new THREE.Vector3().setFromMatrixColumn(g.rot, d.axis).normalize();
        this.turnPart(this.part, axis, (dx * d.along[0] + dy * d.along[1]) / d.perRad);
        return;
      }
      if (dx || dy) d.moved = true;
      const h = this.handles[d.handle];
      if (e.altKey) {
        // Alt: turned about its own line: sideways is the turn. (Where it then is, is where a drag carries on from.)
        this.spin(h, dx, d.pin);
        d.target.copy(this.dots[d.handle].position);
        return;
      }
      // The pointer's move, as a move of the dot across the view.
      const cam = view.camera;
      const forward = cam.getWorldDirection(new THREE.Vector3());
      const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward);
      const k = perPx(d.target);
      d.target.addScaledVector(right, dx * k).addScaledVector(up, -dy * k);
      this.pull(h, [d.target.x - this.at.x, d.target.y - view.floorY, d.target.z - this.at.z], d.pin, d.other);
    });
    const end = (e: PointerEvent): void => {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      view.dom.releasePointerCapture(e.pointerId);
      view.controls.enabled = true;
      const pin = d.kind === 'dot' ? d.pin : null;
      // (Whole degrees, as the sliders have them; a planted foot still where it was.)
      if (d.kind !== 'dot' || d.moved) {
        let p: CharacterPose = this.pose;
        for (const part of CHAR_PARTS) for (const st of CHAR_STEPS[part]) if (st.key !== undefined) p = poseWith(p, st, Math.round(poseValue(p, st))) as CharacterPose;
        if (p.dL) p = { ...p, dL: p.dL.map(Math.round) };
        if (p.dR) p = { ...p, dR: p.dR.map(Math.round) };
        if (p.eL) p = { ...p, eL: p.eL.map(Math.round) };
        if (p.eR) p = { ...p, eR: p.eR.map(Math.round) };
        this.pose = p;
        this.stand(pin);
        this.apply();
        // (A locked dot that was itself dragged is locked where it was left.)
        if (d.kind === 'dot' && this.locks.has(this.handles[d.handle].name)) this.locks.set(this.handles[d.handle].name, this.where(this.handles[d.handle].name)!);
        this.commit();
      }
      view.onChange();
    };
    view.dom.addEventListener('pointerup', end);
    view.dom.addEventListener('pointercancel', end);
    window.addEventListener('keydown', (e) => {
      // (Not while a name is being typed; a slider that was last touched doesn't take the keys.)
      const on = e.target as HTMLInputElement | null;
      if (!this.active || (on?.tagName === 'INPUT' && on.type !== 'range')) return;
      this.shown = e.shiftKey || e.altKey;
      // (Alt by itself would take the browser's menu.)
      if (e.key === 'Alt') e.preventDefault();
      if (!(e.ctrlKey || e.metaKey)) {
        // Z and X held (the whole of her), Space (the fingers' and toes' joints): kept from the page's own keys.
        if (e.code !== 'KeyZ' && e.code !== 'KeyX' && e.code !== 'Space') return;
        e.stopImmediatePropagation();
        // (Space mustn't press the panel's button that was clicked last, nor scroll the panel.)
        e.preventDefault();
        if (e.code === 'Space') (document.activeElement as HTMLElement | null)?.blur?.();
        if (e.code !== 'Space') {
          this.held.add(e.code);
          view.dom.style.cursor = e.code === 'KeyZ' ? 'move' : 'ew-resize';
        } else if (!e.repeat) {
          this.fingers = !this.fingers;
          view.onChange();
        }
        return;
      }
      const back = e.code === 'KeyZ' && !e.shiftKey, again = e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey);
      if (!back && !again) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.undo(back ? -1 : 1)) view.onChange();
    }, { capture: true });
    window.addEventListener('keyup', (e) => {
      if (this.active && (e.code === 'Space' || e.key === 'Alt')) e.preventDefault();
      this.shown = e.shiftKey || e.altKey;
      if (this.held.delete(e.code)) view.dom.style.cursor = '';
    });
    window.addEventListener('blur', () => {
      this.held.clear();
      this.shown = false;
    });
  }

  /** Which feet are on the floor now: [left, right]. */
  private planted(): [boolean, boolean] {
    const j = this.posed.joints;
    const low = Math.min(j[FOOT_L][1], j[FOOT_R][1]);
    return [j[FOOT_L][1] < low + PLANTED, j[FOOT_R][1] < low + PLANTED];
  }

  /**
   * The foot that stays where it is while a dot is dragged: for a foot's dot the other foot if it's on the floor; for
   * a knee's or a hip's the other foot if it's down, else that leg's own; for the hips the lower foot; for anything
   * else none is needed (the legs don't move). None free of the floor or sitting.
   */
  private pinFor(h: Handle): Pin | null {
    if (this.free || this.pose.seat !== undefined) return null;
    const on = this.planted();
    const j = this.posed.joints;
    const leg = h.limb?.leg;
    let foot: Side;
    if (h.drag === 'hips') foot = j[FOOT_L][1] <= j[FOOT_R][1] ? 0 : 1;
    else if (leg === undefined) return null;
    else if (on[1 - leg]) foot = (1 - leg) as Side;
    else if (h.drag === 'end') return null;
    else foot = leg;
    const a = j[FOOT[foot]];
    return { foot, x: a[0] + this.offset.x, y: a[1], z: a[2] + this.offset.z, level: this.posed.bones[FOOT[foot] * 16 + 5] > 0.99 };
  }

  /** The figure moved so a pinned foot is where it was. */
  private stand(pin: Pin | null): void {
    if (!pin) return;
    const a = characterBones(this.template, this.pose, 1e9, true).joints[FOOT[pin.foot]];
    this.offset.x = pin.x - a[0];
    this.offset.z = pin.z - a[2];
  }
  /** A point of a pose's figure on the stage: from the pinned ankle where there is one (in height too: with both feet down the floor alone would hold the hips up). */
  private placed(b: PosedBones, p: readonly number[], pin: Pin | null): V3 {
    if (!pin) return this.staged(p);
    const a = b.joints[FOOT[pin.foot]];
    return [p[0] - a[0] + pin.x, p[1] - a[1] + pin.y, p[2] - a[2] + pin.z];
  }

  /** A dot dragged to a point (the stage's frame): the pose solved to follow, the feet that are planted kept so. */
  private pull(h: Handle, target: V3, pin: Pin | null, other: V3 | null): void {
    let pose = this.pose;
    if (h.drag === 'hips') {
      if (!pin) {
        // Free of the floor (or sitting): the whole figure goes with its hips.
        const now = this.where('hips')!;
        this.offset.x += target[0] - now[0];
        this.offset.z += target[2] - now[2];
        if (this.free) this.offset.y += target[1] - now[1];
        this.pose = this.kept(this.pose, h, null);
        this.apply();
        return;
      }
      // The hips are carried by the leg that stands; then the other foot is brought back to its place.
      pose = this.ik(pose, LEGS[pin.foot], target, pin, true);
      if (other) {
        const o = (1 - pin.foot) as Side;
        pose = this.levelFoot(this.ik(pose, LEGS[o], other, pin, false), o);
      }
    } else if (h.drag === 'aim') pose = this.aim(pose, h, target);
    else if (h.drag === 'turns') pose = this.reach(pose, h.at, knobsOf(h), this.inReach(h, target));
    else if (h.drag === 'end' && h.limb) pose = this.ik(pose, h.limb, target, pin, false);
    else if (h.drag === 'mid' && h.limb) pose = this.carry(pose, h.limb, target, pin);
    else return;
    if (pin?.level) pose = this.levelFoot(pose, pin.foot);
    this.pose = pose;
    this.stand(pin);
    this.pose = this.kept(this.pose, h, pin);
    this.apply();
  }

  /** A drag's target for a dot on a chain, held to where the chain can bring it: no further from its first joint than it is long, no nearer than it curls. */
  private inReach(h: Handle, target: V3): V3 {
    const long = this.reachOf.get(h.name);
    if (h.root === undefined || !long) return target;
    const c = this.staged(this.posed.joints[h.root]);
    const v = [target[0] - c[0], target[1] - c[1], target[2] - c[2]];
    const far = Math.hypot(v[0], v[1], v[2]);
    if (far < 1e-6) return target;
    const k = clamp(far, long * (h.slack ?? 1), long * 1.03) / far;
    return [c[0] + v[0] * k, c[1] + v[1] * k, c[2] + v[2] * k];
  }

  /**
   * A pose with every locked dot brought back to where it's locked (the figure standing where it now does): the
   * spine's first, then elbows and knees, then hands and feet, each by the solver a drag of it would use. Left out:
   * the dot being dragged (`moved`), an elbow's or knee's lock while its own hand or foot is dragged, a lock on the
   * limb a part being turned by hand belongs to (`part`), and the foot the floor already pins.
   */
  private kept(from: CharacterPose, moved: Handle | null, pin: Pin | null, part?: CharPart): CharacterPose {
    if (!this.locks.size) return from;
    let pose = from;
    for (const kind of ['aim', 'mid', 'end'] as const) {
      for (const [name, at] of this.locks) {
        const h = this.handles.find((x) => x.name === name);
        if (!h || h.drag !== kind || h === moved) continue;
        if (moved?.drag === 'end' && h.limb && h.limb === moved.limb) continue;
        if (part && (h.limb ? limbParts(h.limb) : (h.chain ?? [])).includes(part)) continue;
        if (pin && kind === 'end' && h.limb?.leg === pin.foot) continue;
        pose = kind === 'end' ? this.ik(pose, h.limb!, at, null, false) : kind === 'mid' ? this.carry(pose, h.limb!, at, null) : this.aim(pose, h, at);
      }
    }
    return pose;
  }

  /** Shift-drag: a limb turned about its own line, or the head, chest or body about its upright, by the pointer's move sideways. */
  private spin(h: Handle, px: number, pin: Pin | null): void {
    if (!px || (!h.limb && !h.spin)) return;
    if (h.limb) {
      const j = this.posed.joints;
      const l = h.limb;
      // (A hand or foot: about the line from the shoulder or hip to it, so it stays put. Else the upper part's own line.)
      const to = j[h.drag === 'end' ? l.end : l.mid], from = j[l.top];
      const axis = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      if (axis.lengthSq() < 1e-8) return;
      const was = characterBones(this.template, this.pose, 1e9, true).joints[l.end];
      this.pose = this.turned(this.posed, this.pose, l.upper, axis.normalize(), px * SPIN);
      // (An arm's shoulder goes a little with where the arm points, on its collar bone, so the hand has shifted:
      // the arm is swung back until the hand is on the line from the shoulder to where it was.)
      if (h.drag === 'end') {
        for (let i = 0; i < 3; i++) {
          const b = characterBones(this.template, this.pose, 1e9, true);
          const at = b.joints[l.top], now = b.joints[l.end];
          const has = new THREE.Vector3(now[0] - at[0], now[1] - at[1], now[2] - at[2]).normalize();
          const want = new THREE.Vector3(was[0] - at[0], was[1] - at[1], was[2] - at[2]).normalize();
          const about = has.clone().cross(want), angle = Math.asin(Math.min(1, about.length()));
          if (angle < 1e-4) break;
          this.pose = this.turned(b, this.pose, l.upper, about.normalize(), angle);
        }
      }
      if (pin?.level) this.pose = this.levelFoot(this.pose, pin.foot);
      this.stand(pin);
      this.pose = this.kept(this.pose, h, pin);
      this.apply();
      return;
    }
    const st = turnOf(h.spin!);
    this.holdHips(h.spin![0], () => {
      this.pose = poseWith(this.pose, st, clamp(poseValue(this.pose, st) + px * SPIN_DEG, st.range[0], st.range[1])) as CharacterPose;
    });
  }

  /** A change to a part made by hand: with the hips kept where they are if it's the whole body (which turns about the middle of the floor under it otherwise), and then the locks. */
  private holdHips(part: CharPart, change: () => void): void {
    const before = part === 'body' ? this.where('hips')! : null;
    change();
    this.apply();
    if (before) {
      const now = this.where('hips')!;
      this.offset.x += before[0] - now[0];
      this.offset.z += before[2] - now[2];
      if (this.free) this.offset.y += before[1] - now[1];
    }
    this.pose = this.kept(this.pose, null, null, part);
    this.apply();
  }

  /** The part in hand turned about an axis through its joint: a ring's drag. */
  private turnPart(part: CharPart, axis: THREE.Vector3, angle: number): void {
    this.holdHips(part, () => {
      this.pose = this.turned(this.posed, this.pose, part, axis, angle);
    });
  }
  /** A pose (and its bones) with a part turned about an axis through its joint, written as the part's own turns. */
  private turned(b: PosedBones, pose: CharacterPose, part: CharPart, axis: THREE.Vector3, angle: number, strict = false): CharacterPose {
    const up = rotOf(b.bones, parentBone(PART_BONE[part]));
    const want = up.clone().transpose().multiply(new THREE.Matrix4().makeRotationAxis(axis, angle)).multiply(up).multiply(partTurn(this.template, pose, part));
    const got = isUpper(part) ? this.fitUpper(pose, part, want) : this.fitTurns(pose, part, want);
    if (!strict) return got;
    // (Strict: a joint at its end, which could only make some other turn of it instead, is left as it is.)
    const miss = rotVec(want.multiply(partTurn(this.template, got, part).transpose()));
    return Math.hypot(miss[0], miss[1], miss[2]) > 0.4 * Math.abs(angle) ? pose : got;
  }

  /**
   * A pose with a part's turns set so that together they make a rotation (its parent's frame), as nearly as its
   * joint's ranges allow: least squares on its numbers from where they are.
   */
  private fitTurns(from: CharacterPose, part: CharPart, want: THREE.Matrix4): CharacterPose {
    const T = this.template;
    const steps = CHAR_STEPS[part].filter((st) => st.key !== undefined);
    let pose = from;
    for (let n = 0; n < 8; n++) {
      const back = partTurn(T, pose, part).transpose();
      const e = rotVec(want.clone().multiply(back));
      if (Math.hypot(e[0], e[1], e[2]) < 1e-4) break;
      const cols = steps.map((st) => {
        const c = rotVec(partTurn(T, poseWith(pose, st, poseValue(pose, st) + 0.5) as CharacterPose, part).multiply(back));
        return [c[0] * 2, c[1] * 2, c[2] * 2];
      });
      const x = solve(cols, e, 1e-8);
      steps.forEach((st, i) => {
        const v = clamp(poseValue(pose, st) + clamp(x[i], -25, 25), st.range[0], st.range[1]);
        pose = poseWith(pose, st, Math.round(v * 100) / 100) as CharacterPose;
      });
    }
    return pose;
  }

  /**
   * The same for an upper arm or a thigh, worked out exactly: its turns are a swing about the upright, a raise, and a
   * twist about its own length (with an arm's fixed lean between and after), and hanging straight the swing and the
   * twist are the same turn, so steps of the numbers can't find a limb carried out to the side: that is a swing a
   * quarter round, the raise, and a twist a quarter back. Of the two ways of writing a rotation, the nearer to how
   * it's written now.
   */
  private fitUpper(from: CharacterPose, part: CharPart, want: THREE.Matrix4): CharacterPose {
    const steps = CHAR_STEPS[part];
    const [sw, ra, tw] = steps.filter((st) => st.key !== undefined);
    const armOut = deg(this.template.armOut);
    // The fixed leans: before the twist, and after it.
    let c0 = 0, c1 = 0, after = false;
    for (const st of steps) {
      if (st === tw) after = true;
      else if (st.fixed !== undefined) {
        const a = rad(st.sign * (st.fixed === 'armOut' ? armOut : st.fixed));
        if (after) c1 += a;
        else c0 += a;
      }
    }
    const M = (): THREE.Matrix4 => new THREE.Matrix4();
    const R = want.clone().multiply(M().makeRotationZ(-c1));
    // Where the limb's own line points says the swing and the raise; what's left over is the twist.
    const v = [R.elements[4], R.elements[5], R.elements[6]];
    const ux = -Math.sin(c0), uy = Math.cos(c0);
    const B0 = Math.acos(clamp(v[1] / uy, -1, 1));
    const now = [poseValue(from, sw), poseValue(from, ra), poseValue(from, tw)];
    const ranges = [sw, ra, tw].map((st) => rangeOf(part, st));
    /** An angle written the way (a whole turn more or less) that lies in its range, nearest to how it's written now. */
    const within = (x: number, i: number): number => {
      let pick = x, off = Infinity;
      for (const c of [x - 360, x, x + 360]) {
        if (c < ranges[i][0] - 1e-6 || c > ranges[i][1] + 1e-6 || Math.abs(c - now[i]) >= off) continue;
        off = Math.abs(c - now[i]);
        pick = c;
      }
      return pick;
    };
    let best = now, least = Infinity;
    for (const B of [B0, -B0]) {
      const wz = uy * Math.sin(B);
      const A = ux * ux + wz * wz < 1e-8 ? rad(now[0] * sw.sign) : Math.atan2(v[0] * wz - v[2] * ux, v[0] * ux + v[2] * wz);
      const rest = M().makeRotationY(A).multiply(M().makeRotationX(B)).multiply(M().makeRotationZ(c0)).transpose().multiply(R);
      const E = Math.atan2(rest.elements[8], rest.elements[0]);
      const got = [deg(A) / sw.sign, deg(B) / ra.sign, deg(E) / tw.sign].map(within);
      const cost = got.reduce((sum, x, i) => sum + Math.abs(x - now[i]) + (x < ranges[i][0] - 1e-6 || x > ranges[i][1] + 1e-6 ? 1e4 : 0), 0);
      if (cost < least) {
        least = cost;
        best = got;
      }
    }
    let pose = from;
    [sw, ra, tw].forEach((st, i) => {
      pose = poseWith(pose, st, Math.round(clamp(best[i], ranges[i][0], ranges[i][1]) * 100) / 100) as CharacterPose;
    });
    return pose;
  }

  /**
   * A pose with a limb's end brought to a target (the stage's frame), worked out whole, not by small steps (which stick
   * where a hand is drawn past its own shoulder): the elbow or knee bent until the limb is as long as the target is
   * far, then the upper part turned about its joint to point the end at it. Of all the turns that do that (the
   * elbow or knee anywhere on a circle), the one with no turn about the upper part's own length: that is what kept
   * twisting a dragged arm or leg. `hips`: a leg whose foot is pinned, and the target is for the hips over it (the
   * same thing seen from the hips: the foot goes the other way).
   */
  private ik(from: CharacterPose, l: Limb, target: V3, pin: Pin | null, hips: boolean): CharacterPose {
    const T = this.template;
    const bend = turnOf(l.bend);
    const sub = (a: readonly number[], b: readonly number[]): THREE.Vector3 => new THREE.Vector3(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    /** Where the limb's end is to go, in a pose's own frame. */
    const goal = (b: PosedBones): THREE.Vector3 => {
      const end = b.joints[l.end];
      const p0 = this.placed(b, b.joints[hips ? PELVIS : l.end], pin);
      const k = hips ? -1 : 1;
      return new THREE.Vector3(end[0] + k * (target[0] - p0[0]), end[1] + k * (target[1] - p0[1]), end[2] + k * (target[2] - p0[2]));
    };
    /** How long the limb is, joint to end, for a bend. */
    const reachAt = (pose: CharacterPose, v: number): number => {
      const j = characterBones(T, poseWith(pose, bend, v) as CharacterPose, 1e9, true).joints;
      return sub(j[l.end], j[l.top]).length();
    };
    let pose = from;
    // (Twice: on the floor with nothing pinned, the figure settles again as the limb moves.)
    for (let pass = 0; pass < 2; pass++) {
      const b = this.fk(pose, 4);
      const far = goal(b).sub(new THREE.Vector3(...b.joints[l.top])).length();
      // The bend: the limb is longest straight, and shortens all the way as it bends.
      let lo = bend.range[0], hi = bend.range[1];
      if (far >= reachAt(pose, lo)) hi = lo;
      else if (far <= reachAt(pose, hi)) lo = hi;
      else {
        for (let n = 0; n < 16; n++) {
          const mid = (lo + hi) / 2;
          if (reachAt(pose, mid) > far) lo = mid;
          else hi = mid;
        }
      }
      pose = poseWith(pose, bend, Math.round(((lo + hi) / 2) * 100) / 100) as CharacterPose;
      // The turn: the least that points the end at the target...
      const b1 = this.fk(pose, 4);
      const j = b1.joints;
      const top = j[l.top];
      const to = goal(b1).sub(new THREE.Vector3(...top));
      const now = sub(j[l.end], top);
      if (to.length() < 1e-4 || now.length() < 1e-4) continue;
      to.normalize();
      const q0 = new THREE.Quaternion().setFromUnitVectors(now.normalize(), to);
      // ...then round the line to the target until nothing of it is about the upper part's own length.
      const along = sub(j[l.mid], top).normalize();
      const q = (phi: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(to, phi).multiply(q0);
      const roll = (phi: number): number => {
        const r = q(phi);
        const a = 2 * Math.atan2(r.x * along.x + r.y * along.y + r.z * along.z, r.w);
        return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
      };
      const none = roll(0);
      let p0 = 0, f0 = none;
      let p1 = Math.abs(to.dot(along)) > 0.2 ? -f0 / to.dot(along) : 0.01, f1 = roll(p1);
      for (let n = 0; n < 6 && Math.abs(f1) > 1e-5 && Math.abs(f1 - f0) > 1e-9; n++) {
        const p2 = clamp(p1 - (f1 * (p1 - p0)) / (f1 - f0), -Math.PI, Math.PI);
        p0 = p1;
        f0 = f1;
        p1 = p2;
        f1 = roll(p1);
      }
      let phi = Math.abs(f1) < Math.abs(none) ? p1 : 0;
      const up = rotOf(b1.bones, parentBone(PART_BONE[l.upper]));
      if (l.leg === undefined) {
        // An arm: its elbow not both behind the shoulder and up (ELBOW_BACK); round the line as little as keeps it so.
        const chest = up.clone().transpose();
        const bad = (at: number): boolean => {
          const e = along.clone().applyQuaternion(q(at)).applyMatrix4(chest);
          return e.z < ELBOW_BACK[0] && e.y > ELBOW_BACK[1];
        };
        if (bad(phi)) {
          for (let d = 0.04; d <= Math.PI; d += 0.04) {
            const ok = !bad(phi + d) ? phi + d : !bad(phi - d) ? phi - d : null;
            if (ok === null) continue;
            phi = ok;
            break;
          }
        }
      }
      const turn = q(phi);
      const want = up.clone().transpose().multiply(new THREE.Matrix4().makeRotationFromQuaternion(turn)).multiply(up).multiply(partTurn(T, pose, l.upper));
      pose = this.fitUpper(pose, l.upper, want);
    }
    return pose;
  }

  /**
   * A pose with a limb's middle joint (an elbow, a knee) carried to a target (the stage's frame): the upper part
   * turned about its joint by a small rotation (damped least squares), in which a turn about its own length is all
   * but ruled out (ROLL). With that leg's own foot pinned, it's the knee over the foot.
   */
  private carry(from: CharacterPose, l: Limb, target: V3, pin: Pin | null): CharacterPose {
    const onPin = !!pin && FOOT[pin.foot] === l.end;
    let pose = from;
    for (let n = 0; n < 4; n++) {
      const b = this.fk(pose, 4);
      const j = b.joints;
      const p0 = this.placed(b, j[l.mid], pin);
      const e = [target[0] - p0[0], target[1] - p0[1], target[2] - p0[2], 0];
      if (Math.hypot(e[0], e[1], e[2]) < 0.002) break;
      // What a small turn of the upper part about its joint moves: the middle joint, less the pinned ankle if it's this limb's.
      const top = j[l.top];
      const r: V3 = [j[l.mid][0] - top[0], j[l.mid][1] - top[1], j[l.mid][2] - top[2]];
      const along = new THREE.Vector3(...r).normalize();
      if (onPin) for (let i = 0; i < 3; i++) r[i] -= j[l.end][i] - top[i];
      const x = solve([
        [0, -r[2], r[1], ROLL * along.x],
        [r[2], 0, -r[0], ROLL * along.y],
        [-r[1], r[0], 0, ROLL * along.z],
      ], e, 1e-5);
      const w = new THREE.Vector3(x[0], x[1], x[2]);
      const turn = Math.min(w.length(), 0.5);
      if (turn > 1e-7) pose = this.turned(b, pose, l.upper, w.normalize(), turn);
    }
    return pose;
  }

  /**
   * A pose with a dot of the spine turned toward a target (the stage's frame): the line from the chain's first joint
   * to the dot is brought round to the line to the target, the turn shared evenly between the chain's parts (each
   * as far as its joint goes). Only ever a turn toward the target, so a target the back can't reach bends it that
   * way to its ends and no further (solved as numbers, it bent every joint whichever way shortened it).
   */
  private aim(from: CharacterPose, h: Handle, target: V3): CharacterPose {
    const parts = h.chain!;
    let pose = from;
    for (let n = 0; n < 4; n++) {
      const b = this.fk(pose, 4);
      const c = this.staged(b.joints[h.root!]), p = this.staged(h.at(b, this.template));
      const now = new THREE.Vector3(p[0] - c[0], p[1] - c[1], p[2] - c[2]).normalize();
      const to = new THREE.Vector3(target[0] - c[0], target[1] - c[1], target[2] - c[2]).normalize();
      const axis = new THREE.Vector3().crossVectors(now, to);
      const angle = Math.atan2(axis.length(), now.dot(to));
      if (angle < 2e-3 || axis.lengthSq() < 1e-12) break;
      axis.normalize();
      for (const part of parts) pose = this.turned(b, pose, part, axis, Math.min(angle, 0.4) / parts.length, true);
    }
    return pose;
  }

  /**
   * A pose with some of its numbers changed so a point of the figure comes to a target (the stage's frame): the
   * fingers' dots. Damped least squares, each number kept within its joint's range.
   */
  private reach(from: CharacterPose, at: Handle['at'], knobs: readonly Knob[], target: V3): CharacterPose {
    const T = this.template;
    const point = (pose: CharacterPose): V3 => this.staged(at(this.fk(pose, 4), T));
    let pose = from;
    for (let n = 0; n < 6; n++) {
      const p0 = point(pose);
      const e = [target[0] - p0[0], target[1] - p0[1], target[2] - p0[2]];
      if (Math.hypot(e[0], e[1], e[2]) < 0.0006) break;
      // How the point moves for a degree of each.
      const cols = knobs.map((k) => {
        const v = k.get(pose);
        const d = v + 1 <= k.range[1] ? 1 : -1;
        const p1 = point(k.put(pose, v + d));
        return [(p1[0] - p0[0]) / d, (p1[1] - p0[1]) / d, (p1[2] - p0[2]) / d];
      });
      // (Damped by how far the point moves at all: a finger's tip a millimetre a degree, the head's top a centimetre.)
      const most = Math.max(...cols.map((c) => c[0] * c[0] + c[1] * c[1] + c[2] * c[2]));
      const x = solve(cols, e, most * 0.01 + 1e-14);
      knobs.forEach((k, i) => {
        const v = clamp(k.get(pose) + clamp(x[i], -25, 25), k.range[0], k.range[1]);
        pose = k.put(pose, Math.round(v * 10) / 10);
      });
    }
    return pose;
  }

  /** A pose with a foot turned at its ankle (pitch and roll) so its sole is flat again, however its shin has gone. */
  private levelFoot(from: CharacterPose, s: Side): CharacterPose {
    const T = this.template;
    const steps = [turnOf([`foot${S[s]}`, 'pitch']), turnOf([`foot${S[s]}`, 'roll'])];
    const o = FOOT[s] * 16;
    /** How far the foot's own upright leans (x, z): none when it's flat. (No need of the floor for this.) */
    const lean = (pose: CharacterPose): [number, number] => {
      const b = characterBones(T, pose, 1e9, true).bones;
      return [b[o + 4], b[o + 6]];
    };
    let pose = from;
    for (let n = 0; n < 4; n++) {
      const e = lean(pose);
      if (Math.hypot(e[0], e[1]) < 0.003) break;
      const J = steps.map((st) => {
        const v = poseValue(pose, st);
        const d = v + 1 <= st.range[1] ? 1 : -1;
        const e1 = lean(poseWith(pose, st, v + d) as CharacterPose);
        return [(e1[0] - e[0]) / d, (e1[1] - e[1]) / d];
      });
      const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
      if (Math.abs(det) < 1e-9) break;
      const change = [(-e[0] * J[1][1] + e[1] * J[1][0]) / det, (-e[1] * J[0][0] + e[0] * J[0][1]) / det];
      steps.forEach((st, i) => {
        const v = clamp(poseValue(pose, st) + clamp(change[i], -30, 30), st.range[0], st.range[1]);
        pose = poseWith(pose, st, Math.round(v * 10) / 10) as CharacterPose;
      });
    }
    return pose;
  }

  // ---- the figure ----

  /** The look and the light the page's own material has; the dots and the rings, a steady size on the screen. */
  sync(from: THREE.ShaderMaterial, look: MobLook): void {
    const cam = this.view?.camera;
    const held = this.drag?.kind === 'dot' ? this.drag.handle : -1;
    this.dots.forEach((d, i) => {
      const h = this.handles[i];
      // (A dot left over from a figure with more of them: the bare one's toes.)
      if (!h) {
        d.visible = false;
        return;
      }
      const locked = this.locks.has(h.name);
      d.visible = this.active && (this.shown || held === i) && (!h.finger || this.fingers);
      (d.material as THREE.MeshBasicMaterial).color.setHex(locked ? LOCKED : h.color);
      d.scale.setScalar((cam ? d.position.distanceTo(cam.position) * 0.006 : 0.015) * (h.finger ? 0.4 : h.small ? 0.65 : 1) * (held === i ? 1.5 : locked ? 1.35 : 1));
    });
    const g = this.active ? this.rings() : null;
    this.gizmo.visible = !!g;
    if (g) {
      this.gizmo.position.copy(g.at);
      this.gizmo.quaternion.setFromRotationMatrix(g.rot);
      this.gizmo.scale.setScalar(g.radius);
    }
    setMobLook(this.material, look);
    for (const k of Object.keys(from.uniforms)) {
      if (k === 'uBones' || k === 'uCurl' || k === 'uToes' || !(k in this.material.uniforms)) continue;
      this.material.uniforms[k].value = from.uniforms[k].value;
    }
    this.material.wireframe = from.wireframe;
  }

  private build(): void {
    const c = this.chars[this.who];
    const spec: FigureSpec = { x: this.at.x, z: this.at.z, yaw: 0, body: c.body, pose: 'stand', hair: c.hair, long: false, outfit: c.outfit, color: c.color as FigureSpec['color'], phase: 0.25, side: 1, look: 0, fade: false, model: c.name };
    const gb = new GhostBuilder();
    addFigure(gb, spec);
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(gb.build(0, 0)!, this.material);
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    this.template = figureTemplate(spec);
    // Its dots: the joints', and its own fingers'.
    this.handles = [...HANDLES, ...fingerHandles(this.template), ...toeHandles(this.template)];
    this.locks.clear();
    const rest = characterBones(this.template, {}, 1e9, true);
    this.reachOf.clear();
    for (const h of this.handles) {
      if (h.root === undefined) continue;
      const a = h.at(rest, this.template), c = rest.joints[h.root];
      this.reachOf.set(h.name, Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]));
    }
    const ball = new THREE.SphereGeometry(1, 12, 8);
    while (this.dots.length < this.handles.length) {
      const dot = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9 }));
      dot.renderOrder = 11;
      this.dots.push(dot);
      this.object.add(dot);
    }
    this.apply();
  }

  /** The pose as it is, to the figure where it stands, and its dots to where the pose has them. */
  apply(): void {
    this.posed = this.fk(this.pose);
    (this.material.uniforms.uBones.value as Float32Array).set(this.posed.bones);
    this.mesh?.position.set(this.offset.x, this.free ? this.offset.y : 0, this.offset.z);
    this.handles.forEach((h, i) => this.dots[i].position.copy(this.world(h.at(this.posed, this.template))));
  }

  /** A pose from outside (a script's): no step is made of it. */
  set(pose: CharacterPose): void {
    this.pose = pose;
    this.apply();
  }
  /** A part's slider moved: the pose, and the locks kept (but for those on that part's own limb). */
  private tune(pose: CharacterPose, part: CharPart): void {
    this.pose = pose;
    this.apply();
    if (!this.locks.size) return;
    this.pose = this.kept(this.pose, null, null, part);
    this.apply();
  }

  /** The panel's part for posing, in sections that fold: the figure, the tools, a pose to start from, the part in hand's sliders, the saved poses. */
  panel(host: HTMLElement, refresh: () => void): void {
    let into: HTMLElement = host;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', parent: HTMLElement = into): HTMLElementTagNameMap[K] => {
      const e = document.createElement(tag);
      if (text) e.textContent = text;
      parent.appendChild(e);
      return e;
    };
    /** A section that folds shut on its heading; what follows goes in it. */
    const section = (title: string): void => {
      const d = el('details', '', host);
      d.open = !SHUT.has(title);
      d.ontoggle = () => (d.open ? SHUT.delete(title) : SHUT.add(title));
      d.style.cssText = 'margin:6px 0;border-top:1px solid #34343f';
      const s = el('summary', title, d);
      s.style.cssText = 'margin:6px 0 4px;font-size:12px;color:#9aa0b0;text-transform:uppercase;letter-spacing:1px;cursor:pointer';
      into = d;
    };
    const button = (text: string, on: boolean, fn: () => void, parent: HTMLElement = into): HTMLButtonElement => {
      const b = el('button', text, parent);
      if (on) b.className = 'on';
      b.onclick = fn;
      return b;
    };
    const grid = (cols: number): HTMLDivElement => {
      const g = el('div');
      g.style.cssText = `display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px`;
      return g;
    };
    const note = (text: string): void => {
      el('div', text).style.cssText = 'margin:4px 0;color:#9aa0b0;font-size:11px;line-height:1.4;white-space:pre-line';
    };
    /** A slider with its name and number; `put` on every move (no rebuild of the panel, so the drag carries on); a step when it's let go. */
    const slider = (name: string, lo: number, hi: number, stepBy: number, value: number, put: (v: number) => void): void => {
      const row = el('div');
      row.style.cssText = 'display:grid;grid-template-columns:74px 1fr 40px;gap:4px;align-items:center;margin:2px 0';
      el('span', name, row);
      const input = el('input', '', row);
      input.type = 'range';
      input.min = String(lo);
      input.max = String(hi);
      input.step = String(stepBy);
      input.value = String(value);
      input.style.width = '100%';
      const out = el('span', String(value), row);
      out.style.textAlign = 'right';
      input.oninput = () => {
        const v = Number(input.value);
        out.textContent = String(v);
        put(v);
      };
      input.onchange = () => this.commit();
    };

    section('Figure');
    this.chars.forEach((c, i) => button(c.title, i === this.who, () => {
      this.who = i;
      this.build();
      refresh();
    }));
    const ground = grid(2);
    button('on the floor', !this.free, () => {
      this.setFree(false);
      refresh();
    }, ground);
    button('free of it', this.free, () => {
      this.setFree(true);
      refresh();
    }, ground);
    note(this.free ? 'She stays where she is put, whatever her legs do. Drag the white dot at her hips to move her, up off the floor too.' : 'She stands on her lowest point. A foot that is down stays put; the white dot at her hips crouches her.');
    if (this.free) {
      slider('height', -1, 2.5, 0.01, Math.round(this.offset.y * 100) / 100, (v) => {
        this.offset.y = v;
        this.apply();
      });
    }
    button('back to the middle of the stage', false, () => {
      this.offset.set(0, this.free ? characterBones(this.template, this.pose).down : 0, 0);
      this.apply();
      this.commit();
      refresh();
    });

    section('In the view');
    note('hold Shift · the joints\' dots show\nShift-drag a dot · the limb follows\nAlt-drag a dot · turns the limb about itself\nShift-click a dot · its rings: red x, green y, blue z\ndrag a ring · turns that part\nhold Z and drag · moves all of her\nhold X and drag · turns all of her\nCtrl-click a dot · locks it where it is (red)\nSpace · the fingers\' and toes\' joints\nCtrl+Z · undo    Ctrl+Y · redo');
    button(this.fingers ? 'finger and toe joints: shown (Space)' : 'finger and toe joints: hidden (Space)', this.fingers, () => {
      this.fingers = !this.fingers;
      refresh();
    });
    const dot = this.handles.find((h) => h.name === this.picked);
    if (dot && lockable(dot)) {
      button(this.locks.has(dot.name) ? `unlock: ${dot.name}` : `lock where it is: ${dot.name}`, this.locks.has(dot.name), () => {
        this.lock(dot.name);
        refresh();
      });
    }
    if (this.locks.size) {
      button(`unlock all (${[...this.locks.keys()].join(', ')})`, false, () => {
        this.locks.clear();
        this.commit();
        refresh();
      });
    }
    const steps2 = grid(2);
    button('undo', false, () => {
      this.undo(-1);
      refresh();
    }, steps2).disabled = this.step <= 0;
    button('redo', false, () => {
      this.undo(1);
      refresh();
    }, steps2).disabled = this.step >= this.history.length - 1;
    const whole = grid(2);
    button('everything to rest', false, () => {
      this.act({}, false);
      refresh();
    }, whole);
    button('swap left and right', false, () => {
      const p = this.pose;
      const next: Record<string, unknown> = { ...p, aL: p.aR, aR: p.aL, lL: p.lR, lR: p.lL, fL: p.fR, fR: p.fL, hL: p.hR, hR: p.hL, gL: p.gR, gR: p.gL, dL: p.dR, dR: p.dL, tL: p.tR, tR: p.tL, eL: p.eR, eR: p.eL };
      for (const k of ['yaw', 'roll', 'bend', 'twist', 'tilt', 'turn', 'ribBend', 'ribTwist', 'upBend', 'upTwist', 'headTilt', 'headTurn'] as const) if (p[k] !== undefined) next[k] = -p[k]! || 0;
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      this.act(next as CharacterPose);
      refresh();
    }, whole);

    section('Start from');
    const pre = grid(2);
    for (const [name, pose] of PRESETS) button(name, false, () => {
      this.act(pose, false);
      refresh();
    }, pre);

    section('Part');
    const parts = grid(2);
    for (const part of [...CHAR_PARTS, 'digits'] as PartPick[]) button(LABEL[part], part === this.part, () => {
      this.part = part;
      refresh();
    }, parts);
    el('h3', LABEL[this.part]);
    if (this.part === 'digits') {
      const num = (g: number | readonly number[] | undefined): number => (typeof g === 'number' ? g : 0);
      slider('fingers L', 0, 1, 0.01, num(this.pose.gL), (v) => this.set({ ...this.pose, gL: v }));
      slider('fingers R', 0, 1, 0.01, num(this.pose.gR), (v) => this.set({ ...this.pose, gR: v }));
      slider('toes L', -20, 60, 1, this.pose.tL ?? 0, (v) => this.set({ ...this.pose, tL: v }));
      slider('toes R', -20, 60, 1, this.pose.tR ?? 0, (v) => this.set({ ...this.pose, tR: v }));
      if (this.pose.dL || this.pose.dR || this.pose.eL || this.pose.eR) {
        button('each finger and toe back to how the sliders have them', false, () => {
          const { dL, dR, eL, eR, ...rest } = this.pose;
          this.act(rest);
          refresh();
        });
      }
      if (!this.free) {
        button(this.pose.seat === undefined ? 'standing on the floor' : 'sitting: hips on a seat', this.pose.seat !== undefined, () => {
          const { seat, ...rest } = this.pose;
          this.act(seat === undefined ? { ...rest, seat: 0.45 } : rest);
          refresh();
        });
        if (this.pose.seat !== undefined) slider('seat height', 0, 1, 0.01, this.pose.seat, (v) => this.set({ ...this.pose, seat: v }));
      }
    } else {
      const part = this.part;
      const steps = CHAR_STEPS[part].filter((st): st is PartStep & { name: string } => st.key !== undefined && st.name !== undefined);
      for (const st of steps) {
        const v = Math.round(poseValue(this.pose, st));
        // (A turn the dragging has taken past where its slider ends is shown where it is, the slider reaching that far.)
        const [lo, hi] = v < st.range[0] || v > st.range[1] ? rangeOf(part, st) : st.range;
        slider(st.name, Math.min(lo, v), Math.max(hi, v), 1, v, (x) => this.tune(poseWith(this.pose, st, x) as CharacterPose, part));
      }
      button('this part back to rest', false, () => {
        let p: CharacterPose = this.pose;
        for (const st of steps) p = poseWith(p, st, st.def) as CharacterPose;
        this.act(p);
        refresh();
      });
    }

    section('Saved poses');
    const saved = load();
    const name = el('input');
    name.placeholder = 'a name for this pose';
    name.style.cssText = 'box-sizing:border-box;width:100%;margin:2px 0;padding:3px 6px;font:inherit;color:#d8d8e0;background:#16171c;border:1px solid #3a3c48';
    // (Typing here mustn't fly the camera or switch looks.)
    name.onkeydown = (e) => e.stopPropagation();
    button('save', false, () => {
      const n = name.value.trim();
      if (!n) return;
      localStorage.setItem(STORE, JSON.stringify({ ...load(), [n]: this.pose }));
      refresh();
    });
    for (const n of Object.keys(saved)) {
      const row = el('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 28px;gap:2px';
      button(n, false, () => {
        this.act(saved[n], false);
        refresh();
      }, row);
      button('×', false, () => {
        const all = load();
        delete all[n];
        localStorage.setItem(STORE, JSON.stringify(all));
        refresh();
      }, row);
    }
    const io = grid(2);
    button('copy as JSON', false, () => void navigator.clipboard?.writeText(JSON.stringify(this.pose)), io);
    button('paste JSON…', false, () => {
      const text = prompt('A pose, as JSON:');
      if (!text) return;
      try {
        this.act(JSON.parse(text) as CharacterPose, false);
        refresh();
      } catch {
        alert('That is not a pose.');
      }
    }, io);
  }
}
