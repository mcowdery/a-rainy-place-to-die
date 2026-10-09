import * as THREE from 'three';
import { ARM_L, ARM_R, BONES, FOOT_L, FOOT_R, FORE_L, FORE_R, HEAD, PARENT, PELVIS, pivotsOf, PROPORTIONS, ROOT, SHIN_L, SHIN_R, SPINE, THIGH_L, THIGH_R } from './mobRig';
import { isTeen, TEEN_SCALE } from './mobShape';
import { templateGeometry, templateIndex } from './people';
import { allScenes, catsOf, CATS, DEPTH_EYE, depthScale, holdAt, isShopKind, itemParts, isWindowScene, ITEMS, PART_STEPS, PARTS, posesOf, poseValue, PROPS, shadyTable, periodOf, shopScenes, whoOf, WINDOW_ATLAS, WINDOW_ROWS, windowLayout, windowScenes, windowTables, type CastName, type Fig, type Hold, type Item, type PartName, type PartStep, type Pen, type Pose, type Scene, type SceneFrame, type Who } from './windowScenes';

/**
 * The rooms behind the upper floors' glass, painted (windowScenes.ts has what's in them; city.ts stands them in the
 * rooms). The people are the mob's own figures: each one's template (people.ts: the same bodies, clothes and hair as
 * the street's) is posed here on its skeleton by the scene's angles, skinned on the CPU and drawn as its outline
 * from the street's side, so a figure can hold any pose a scene asks for (the mob's material only has the street's).
 * Furniture and what the hands hold are plain dark shapes.
 *
 * Each scene is a cell of four layers, one to a channel (R back furniture, G the people, B the furniture they're
 * at, A the people's second pose or people at the back), and its further poses fill frame slots in the cells after
 * the scenes'; all written into a byte array that shopAtlas.ts lays under the storefronts' masks in one texture.
 * The people's layers are written as distance fields (Layer.field), so the shader can blend one pose's outline into
 * the next's instead of cutting between them.
 */

const rad = (d: number): number => (d * Math.PI) / 180;
const _a = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const rx = (d: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(rad(d));
const ry = (d: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(rad(d));
const rz = (d: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(rad(d));

/**
 * The hands' own joints: the mob's skeleton has none (a hand is its forearm's), so the painter makes one here for
 * these rooms only, after the rig's bones: the wrist, a child of the forearm. Nothing of the mob's templates, its
 * bones or its shader knows of it.
 */
const HAND_L = BONES, HAND_R = BONES + 1;
const ALL_BONES = BONES + 2;
const PARENT_OF: readonly number[] = [...PARENT, FORE_L, FORE_R];

interface Skin {
  readonly pos: Float32Array;
  readonly bone: Float32Array;
  /**
   * How much of each vertex is the hand's (0 to 1: the hand past its wrist, easing in over the first centimetre so
   * nothing parts there), and whose: -1 the left's, 1 the right's. Only skin (or a glove) on a forearm's bone past
   * the wrist: a sleeve, a cuff and a kimono's hanging sleeve stay the forearm's.
   */
  readonly hand: Float32Array;
  readonly handSide: Int8Array;
  /** The triangles, less what the template carries in a hand (a suit's briefcase: it would fly about with the arm). */
  readonly idx: Uint32Array;
  readonly pivot: readonly (readonly [number, number, number])[];
  readonly armOut: number;
  /** The hands' and the head's places in the bind pose. */
  readonly handL: THREE.Vector3;
  readonly handR: THREE.Vector3;
}

const skins = new Map<string, Skin>();
function skinOf(name: CastName | Who): Skin {
  const c = whoOf(name);
  const key = `${c.body}|${c.outfit}|${c.hair}`;
  let s = skins.get(key);
  if (s) return s;
  const g = templateGeometry(templateIndex({ body: c.body, hair: c.hair, long: false, outfit: c.outfit }));
  const rig = pivotsOf(c.body);
  const P = PROPORTIONS[c.body];
  // (A teen's template is the adult's scaled down whole, its joints with it: mobShape.ts.)
  const [kx, ky] = isTeen(c.body, c.outfit) ? TEEN_SCALE[c.body] : [1, 1];
  // The wrist is where the rig has it (mobRig.ts: the arm hangs from the shoulder to it), after the rig's own joints.
  const wristY = 0.865 * P.ys * ky;
  const pivot: (readonly [number, number, number])[] = [...rig.pivot.map((v): [number, number, number] => [v[0] * kx, v[1] * ky, v[2] * kx]), [-P.wristX * kx, wristY, 0], [P.wristX * kx, wristY, 0]];
  const pos = g.getAttribute('position').array as Float32Array;
  const bone = g.getAttribute('aBone').array as Float32Array;
  const shade = g.getAttribute('aShade').array as Float32Array;
  const all = g.getIndex()!.array;
  // Carried things hang from a forearm below the hand.
  const carried = (v: number): boolean => (bone[v * 3] === FORE_L || bone[v * 3] === FORE_R) && bone[v * 3 + 2] > 0.5 && pos[v * 3 + 1] < 0.66 * P.ys * ky;
  const kept: number[] = [];
  for (let t = 0; t < all.length; t += 3) if (!carried(all[t]) && !carried(all[t + 1]) && !carried(all[t + 2])) kept.push(all[t], all[t + 1], all[t + 2]);
  // The hand: what is wholly a forearm's, skin (or the politician's white gloves), from the wrist on down.
  const n = pos.length / 3;
  const hand = new Float32Array(n), handSide = new Int8Array(n);
  const ease = 0.012 * P.ys * ky;
  for (let v = 0; v < n; v++) {
    const b = bone[v * 3];
    if ((b !== FORE_L && b !== FORE_R) || bone[v * 3 + 2] < 0.999 || carried(v)) continue;
    const tag = Math.floor(shade[v] / 100);
    if (tag !== 1 && !(tag === 4 && c.outfit === 'boss')) continue;
    const t = Math.min(1, Math.max(0, (wristY + 0.004 * P.ys * ky - pos[v * 3 + 1]) / ease));
    if (t <= 0) continue;
    hand[v] = t * t * (3 - 2 * t);
    handSide[v] = b === FORE_L ? -1 : 1;
  }
  s = {
    pos,
    bone,
    hand,
    handSide,
    idx: Uint32Array.from(kept),
    pivot,
    armOut: (rig.armOut * 180) / Math.PI,
    handL: new THREE.Vector3(-P.wristX * kx, 0.8 * P.ys * ky, 0),
    handR: new THREE.Vector3(P.wristX * kx, 0.8 * P.ys * ky, 0),
  };
  skins.set(key, s);
  return s;
}

const mats = Array.from({ length: ALL_BONES }, () => new THREE.Matrix4());
const rot = Array.from({ length: ALL_BONES }, () => new THREE.Matrix4());

/** The bone each part turns (the whole body: the root). */
const PART_BONE: Record<PartName, number> = { body: ROOT, chest: SPINE, head: HEAD, armL: ARM_L, foreL: FORE_L, handL: HAND_L, armR: ARM_R, foreR: FORE_R, handR: HAND_R, thighL: THIGH_L, shinL: SHIN_L, footL: FOOT_L, thighR: THIGH_R, shinR: SHIN_R, footR: FOOT_R };
const TURN = { x: rx, y: ry, z: rz };
/** How far a step turns its part about its axis (degrees, signed) in a pose. */
const stepAngle = (st: PartStep, p: Pose, S: Skin): number => st.sign * (st.fixed === undefined ? poseValue(p, st) : st.fixed === 'armOut' ? S.armOut : st.fixed);
/** A part's rotation in its parent's frame: its turns (windowScenes.ts PART_STEPS), outermost first. */
function partRotation(out: THREE.Matrix4, part: PartName, p: Pose, S: Skin): THREE.Matrix4 {
  out.identity();
  for (const st of PART_STEPS[part]) {
    const a = stepAngle(st, p, S);
    if (a !== 0) out.multiply(TURN[st.axis](a));
  }
  return out;
}

/** Each bone's matrix (bind pose to posed, the figure's own frame before it's placed) for a pose. */
function poseBones(S: Skin, p: Pose): THREE.Matrix4[] {
  for (const m of rot) m.identity();
  for (const part of PARTS) if (part !== 'body') partRotation(rot[PART_BONE[part]], part, p, S);
  const root = partRotation(_a, 'body', p, S);
  // (The hands' joints last: their forearms are done by then.)
  for (let i = 0; i < ALL_BONES; i++) {
    const q = S.pivot[i];
    _b.makeTranslation(q[0], q[1], q[2]).multiply(rot[i]).multiply(new THREE.Matrix4().makeTranslation(-q[0], -q[1], -q[2]));
    if (i === ROOT) mats[i].copy(root);
    else if (i === PELVIS) mats[i].multiplyMatrices(root, _b);
    else mats[i].multiplyMatrices(mats[PARENT_OF[i] === -1 ? ROOT : PARENT_OF[i]], _b);
  }
  return mats;
}
/** Whether a pose turns a wrist at all (if not, the hands are their forearms' as they always were: nothing more is worked out). */
const wristTurned = (p: Pose): boolean => !!(p.hL?.some((v) => v !== 0) || p.hR?.some((v) => v !== 0));

/** A figure posed and skinned: its bones, its vertices as the street sees them, and how far it's moved to its place. */
interface Posed {
  readonly S: Skin;
  readonly M: THREE.Matrix4[];
  /** x, y of each vertex at the size it's drawn, before the move. */
  readonly xy: Float32Array;
  /** How much smaller it's drawn for standing further back than its layer (1: in its layer). */
  readonly sc: number;
  readonly dx: number;
  readonly dy: number;
}

/**
 * Poses and places a figure: by its hips across the room; sitting, the hips on the seat, else the lowest of it on
 * the floor; and, standing further back than its layer (`depth`), as that looks from the street's side: smaller
 * about the horizon (windowScenes.ts depthPoint). A point p of the figure's own (a bone's) is drawn at p * sc +
 * (dx, dy). (The bones' matrices are shared: use them before posing another.)
 */
function posed(f: Fig): Posed {
  const S = skinOf(f.who);
  const M = poseBones(S, f.pose);
  const n = S.pos.length / 3;
  const xy = new Float32Array(n * 2);
  const wrists = wristTurned(f.pose);
  let low = Infinity;
  for (let i = 0; i < n; i++) {
    const x = S.pos[i * 3], y = S.pos[i * 3 + 1], z = S.pos[i * 3 + 2];
    const e0 = M[S.bone[i * 3]].elements, e1 = M[S.bone[i * 3 + 1]].elements;
    const w = S.bone[i * 3 + 2], u = 1 - w;
    let px = w * (e0[0] * x + e0[4] * y + e0[8] * z + e0[12]) + u * (e1[0] * x + e1[4] * y + e1[8] * z + e1[12]);
    let py = w * (e0[1] * x + e0[5] * y + e0[9] * z + e0[13]) + u * (e1[1] * x + e1[5] * y + e1[9] * z + e1[13]);
    if (wrists && S.hand[i] > 0) {
      // (The hand past a turned wrist: toward where its own joint carries it.)
      const eh = M[S.handSide[i] < 0 ? HAND_L : HAND_R].elements, k = S.hand[i];
      px += (eh[0] * x + eh[4] * y + eh[8] * z + eh[12] - px) * k;
      py += (eh[1] * x + eh[5] * y + eh[9] * z + eh[13] - py) * k;
    }
    xy[i * 2] = px;
    xy[i * 2 + 1] = py;
    if (py < low) low = py;
  }
  const hip = new THREE.Vector3(0, S.pivot[THIGH_L][1], 0).applyMatrix4(M[PELVIS]);
  const dx = f.x - hip.x, dy = f.seat !== undefined ? f.seat + 0.085 - hip.y : (f.floor ?? 0) - low;
  const sc = depthScale(f.depth);
  if (sc === 1) return { S, M, xy, sc, dx, dy };
  for (let i = 0; i < xy.length; i++) xy[i] *= sc;
  return { S, M, xy, sc, dx: dx * sc, dy: DEPTH_EYE.y * (1 - sc) + dy * sc };
}

/**
 * Where a held thing is anchored on a posed figure, before the figure is moved to its place: the point its drawing
 * starts from, the angle it lies at (the hold's own, or `auto`: along the forearm), and that automatic angle. The
 * painter and placeFigure share it. (The hold's dx, dy and scale are applied from here by whoever draws it.)
 */
function holdPlace(S: Skin, M: THREE.Matrix4[], hold: Hold): { x: number; y: number; ang: number; auto: number } {
  const [hand, prop] = hold;
  const at = hold[2] ?? undefined;
  // Named by a hand, drawn on the pelvis: along the body's front, so it reads in profile and when he lies back.
  if (prop === 'cock') {
    const q = S.pivot[PELVIS];
    const Mpel = M[PELVIS];
    const origin = new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(Mpel);
    const front = new THREE.Vector3(q[0], q[1], q[2] + 1).applyMatrix4(Mpel);
    const head = new THREE.Vector3(q[0], q[1] + 1, q[2]).applyMatrix4(Mpel);
    let fx = front.x - origin.x, fy = front.y - origin.y;
    const fl = Math.hypot(fx, fy) || 1;
    fx /= fl; fy /= fl;
    let hx = head.x - origin.x, hy = head.y - origin.y;
    const hl = Math.hypot(hx, hy) || 1;
    hx /= hl; hy /= hl;
    const ftx = -hx;
    if (fy > 0.45 && Math.abs(fy) >= Math.abs(fx)) {
      // On his back: up and toward the thighs, into the gap beside whoever sits over him.
      fx = ftx;
      fy = 0.85;
    } else if (fy < -0.45 && Math.abs(fy) >= Math.abs(fx)) {
      // Face-down over her: out toward the feet, just clear of the pile.
      fx = ftx;
      fy = -0.15;
    } else {
      // Upright in profile: forward, a little down, so it clears the belt and the thigh.
      const droop = fx >= 0 ? -0.45 : 0.45;
      const c = Math.cos(droop), s = Math.sin(droop);
      const nx = fx * c - fy * s, ny = fx * s + fy * c;
      fx = nx; fy = ny;
    }
    const fl2 = Math.hypot(fx, fy) || 1;
    const auto = Math.atan2(fy / fl2, fx / fl2);
    const base = new THREE.Vector3(q[0], q[1] - 0.1, q[2] + 0.16).applyMatrix4(Mpel);
    return { x: base.x, y: base.y, ang: at !== undefined ? rad(at) : auto, auto };
  }
  // (At the hand, lying as the hand does: with the wrist straight that is along the forearm, from the elbow. The
  // hand's joint is its forearm's until a wrist is turned, so nothing is changed where none is.)
  const mine = M[hand === 'L' ? HAND_L : HAND_R];
  const h = (hand === 'L' ? S.handL : S.handR).clone().applyMatrix4(mine);
  const el = S.pivot[hand === 'L' ? FORE_L : FORE_R];
  const e = new THREE.Vector3(el[0], el[1], el[2]).applyMatrix4(mine);
  const auto = Math.atan2(h.y - e.y, h.x - e.x);
  return { x: h.x, y: h.y, ang: at !== undefined ? rad(at) : auto, auto };
}

/** The joints of a figure the scene editor shows and takes hold of (showroom/scenes.ts, real/sceneIk.ts). */
export const JOINTS = ['pelvis', 'chest', 'neck', 'head', 'shoulderL', 'elbowL', 'wristL', 'handL', 'shoulderR', 'elbowR', 'wristR', 'handR', 'hipL', 'kneeL', 'footL', 'toeL', 'hipR', 'kneeR', 'footR', 'toeR'] as const;
export type JointName = (typeof JOINTS)[number];
export interface PlacedFigure {
  /** Each joint in the scene's metres (x from the room's middle, y up from the floor), as the street sees it. */
  readonly joints: Record<JointName, [number, number]>;
  /** What the figure covers: [x0, y0, x1, y1]. */
  readonly box: [number, number, number, number];
  /** What its hands hold, in its `hold` list's order. */
  readonly holds: PlacedHold[];
  /** How much smaller than life it's drawn (a figure further back than its layer; 1 otherwise). */
  readonly scale: number;
}
/** A held thing where it's drawn: PROPS[prop] at `at`, turned by `angle` (radians, anticlockwise) and `scale` times its size. */
export interface PlacedHold {
  readonly at: [number, number];
  readonly angle: number;
  readonly scale: number;
  /** Where it would be with nothing set: its anchor (the hand) and the angle along the forearm. */
  readonly anchor: [number, number];
  readonly auto: number;
}

/** Where a foot's toes are from its ankle, in the bind pose. */
const toeOf = (ankle: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(ankle[0], ankle[1] * 0.3, ankle[2] + 0.17);

/** One of a part's turns as it stands in a pose: its number, and the axis a positive turn goes round now. */
export interface PlacedAxis {
  readonly step: PartStep;
  readonly value: number;
  /** Right-handed about this (x across the room, y up, z toward the street). */
  readonly n: [number, number, number];
}
/** A part of a placed figure: where it's jointed and where it ends in the picture, its turns, and its own axes now. */
export interface PlacedPart {
  readonly joint: [number, number];
  readonly end: [number, number];
  readonly axes: PlacedAxis[];
  /** The part's own x, y and z as they point now. */
  readonly frame: [[number, number, number], [number, number, number], [number, number, number]];
  /** The figure's size in the picture (a figure further back is drawn smaller). */
  readonly scale: number;
}
/** A part of a figure as the painter poses it: for the scene editor's rings (each ring is one of the pose's own numbers). */
export function placePart(f: Fig, part: PartName): PlacedPart {
  const { S, M, sc, dx, dy } = posed(f);
  const bone = PART_BONE[part];
  const P = S.pivot;
  const v = new THREE.Vector3();
  const at = (p: readonly [number, number, number] | THREE.Vector3, b: number): [number, number] => {
    if (p instanceof THREE.Vector3) v.copy(p);
    else v.set(p[0], p[1], p[2]);
    v.applyMatrix4(M[b]);
    return [v.x * sc + dx, v.y * sc + dy];
  };
  const ends: Record<PartName, [readonly [number, number, number] | THREE.Vector3, number]> = {
    body: [P[SPINE], PELVIS],
    chest: [P[HEAD], SPINE],
    head: [new THREE.Vector3(P[HEAD][0], P[HEAD][1] + 0.17 * (P[HEAD][1] / 1.5), P[HEAD][2]), HEAD],
    armL: [P[FORE_L], ARM_L],
    armR: [P[FORE_R], ARM_R],
    foreL: [P[HAND_L], FORE_L],
    foreR: [P[HAND_R], FORE_R],
    // (To the fingertips.)
    handL: [new THREE.Vector3(S.handL.x, S.handL.y * 0.86, 0), HAND_L],
    handR: [new THREE.Vector3(S.handR.x, S.handR.y * 0.86, 0), HAND_R],
    thighL: [P[SHIN_L], THIGH_L],
    thighR: [P[SHIN_R], THIGH_R],
    shinL: [P[FOOT_L], SHIN_L],
    shinR: [P[FOOT_R], SHIN_R],
    footL: [toeOf(P[FOOT_L]), FOOT_L],
    footR: [toeOf(P[FOOT_R]), FOOT_R],
  };
  // The frame its turns are made in: its parent's, as posed; each turn's axis rides on the turns before it.
  const Q = new THREE.Matrix4();
  if (bone !== ROOT) Q.extractRotation(M[PARENT_OF[bone] === -1 ? ROOT : PARENT_OF[bone]]);
  const axes: PlacedAxis[] = [];
  for (const st of PART_STEPS[part]) {
    if (st.fixed === undefined) {
      v.set(st.axis === 'x' ? st.sign : 0, st.axis === 'y' ? st.sign : 0, st.axis === 'z' ? st.sign : 0).transformDirection(Q);
      axes.push({ step: st, value: poseValue(f.pose, st), n: [v.x, v.y, v.z] });
    }
    const a = stepAngle(st, f.pose, S);
    if (a !== 0) Q.multiply(TURN[st.axis](a));
  }
  const e = Q.elements;
  return {
    joint: at(bone === ROOT ? P[PELVIS] : P[bone], bone === ROOT ? PELVIS : bone),
    end: at(ends[part][0], ends[part][1]),
    axes,
    frame: [[e[0], e[1], e[2]], [e[4], e[5], e[6]], [e[8], e[9], e[10]]],
    scale: sc,
  };
}

/** Where a figure's joints come out in the room: the same posing and placing the painter does (no drawing; pure). */
export function placeFigure(f: Fig): PlacedFigure {
  const { S, M, xy, sc, dx, dy } = posed(f);
  const v = new THREE.Vector3();
  const at = (p: readonly [number, number, number] | THREE.Vector3, bone: number, up = 0): [number, number] => {
    if (p instanceof THREE.Vector3) v.copy(p);
    else v.set(p[0], p[1] + up, p[2]);
    v.applyMatrix4(M[bone]);
    return [v.x * sc + dx, v.y * sc + dy];
  };
  const P = S.pivot;
  const joints: Record<JointName, [number, number]> = {
    pelvis: at(P[PELVIS], PELVIS),
    chest: at([0, P[ARM_L][1], 0], SPINE),
    neck: at(P[HEAD], SPINE),
    head: at(P[HEAD], HEAD, 0.17 * (P[HEAD][1] / 1.5)),
    shoulderL: at(P[ARM_L], SPINE),
    elbowL: at(P[FORE_L], ARM_L),
    wristL: at(P[HAND_L], FORE_L),
    handL: at(S.handL, HAND_L),
    shoulderR: at(P[ARM_R], SPINE),
    elbowR: at(P[FORE_R], ARM_R),
    wristR: at(P[HAND_R], FORE_R),
    handR: at(S.handR, HAND_R),
    hipL: at(P[THIGH_L], PELVIS),
    kneeL: at(P[SHIN_L], THIGH_L),
    footL: at(P[FOOT_L], SHIN_L),
    toeL: at(toeOf(P[FOOT_L]), FOOT_L),
    hipR: at(P[THIGH_R], PELVIS),
    kneeR: at(P[SHIN_R], THIGH_R),
    footR: at(P[FOOT_R], SHIN_R),
    toeR: at(toeOf(P[FOOT_R]), FOOT_R),
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    if (xy[i] < x0) x0 = xy[i];
    if (xy[i] > x1) x1 = xy[i];
    if (xy[i + 1] < y0) y0 = xy[i + 1];
    if (xy[i + 1] > y1) y1 = xy[i + 1];
  }
  const holds = (f.hold ?? []).map((hold): PlacedHold => {
    const p = holdPlace(S, M, hold);
    const h = holdAt(hold);
    return { at: [(p.x + h.dx) * sc + dx, (p.y + h.dy) * sc + dy], angle: p.ang, scale: h.scale * sc, anchor: [p.x * sc + dx, p.y * sc + dy], auto: p.auto };
  });
  return { joints, box: [x0 + dx, y0 + dy, x1 + dx, y1 + dy], holds, scale: sc };
}

/**
 * A figure posed and placed as the painter has it, in three dimensions (x across the room, y up from the floor, z
 * toward the street), with each vertex's shade tag: for review tools that look at the body itself rather than its
 * outline (debug-shots/bodysheet.mjs).
 */
export function posedMesh(f: Fig): { position: Float32Array; index: Uint32Array; shade: Float32Array } {
  const { S, M, sc, dx, dy } = posed(f);
  const c = whoOf(f.who);
  const shade = templateGeometry(templateIndex({ body: c.body, hair: c.hair, long: false, outfit: c.outfit })).getAttribute('aShade').array as Float32Array;
  const n = S.pos.length / 3;
  const wrists = wristTurned(f.pose);
  const position = new Float32Array(n * 3);
  const v = new THREE.Vector3(), u = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const w = S.bone[i * 3 + 2];
    v.set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]).applyMatrix4(M[S.bone[i * 3]]).multiplyScalar(w);
    u.set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]).applyMatrix4(M[S.bone[i * 3 + 1]]).multiplyScalar(1 - w);
    v.add(u);
    if (wrists && S.hand[i] > 0) v.lerp(u.set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]).applyMatrix4(M[S.handSide[i] < 0 ? HAND_L : HAND_R]), S.hand[i]);
    position[i * 3] = v.x * sc + dx;
    position[i * 3 + 1] = v.y * sc + dy;
    position[i * 3 + 2] = v.z * sc;
  }
  return { position, index: S.idx, shade };
}

/** How many samples across a pixel the figures are rasterised with. */
const SS = 3;

/**
 * One layer of a scene being painted, in the scene's metres (x from the middle, y up from the floor): furniture and
 * props through a canvas, the figures' triangles straight into a coverage buffer (SS x SS samples a pixel), the two
 * joined as one alpha.
 */
class Layer implements Pen {
  readonly g: CanvasRenderingContext2D;
  private readonly cov: Uint8Array;
  private readonly out: Uint8Array;
  private drawn = false;
  private figured = false;
  private dist: Float32Array | null = null;
  private fieldOut: Uint8Array | null = null;
  /** The samples the figures reach (only these are cleared and read back). */
  private fx0 = 0;
  private fx1 = 0;
  private fy0 = 0;
  private fy1 = 0;

  constructor(
    readonly ppm: number,
    readonly w: number,
    readonly h: number,
  ) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    this.g = cv.getContext('2d', { willReadFrequently: true })!;
    this.cov = new Uint8Array(w * SS * h * SS);
    this.out = new Uint8Array(w * h);
  }

  clear(): void {
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.drawn) this.g.clearRect(0, 0, this.w, this.h);
    if (this.figured) for (let y = this.fy0, W = this.w * SS; y <= this.fy1; y++) this.cov.fill(0, y * W + this.fx0, y * W + this.fx1 + 1);
    this.drawn = this.figured = false;
    this.fx0 = this.fy0 = 1e9;
    this.fx1 = this.fy1 = -1;
    this.g.setTransform(this.ppm, 0, 0, -this.ppm, this.w / 2, this.h);
    this.g.fillStyle = '#000';
  }

  /**
   * The layer as a distance field, for the people's poses: 128 at the outline, rising inside and falling outside by
   * 16 a pixel (so the shader's blend of two poses moves the outline between them). A chamfer transform out from the
   * outline's own pixels, whose coverage places the edge within them. The array is reused.
   */
  field(): Uint8Array {
    const { w, h } = this;
    const al = this.alpha();
    const d = this.dist ?? (this.dist = new Float32Array(w * h));
    const out = this.fieldOut ?? (this.fieldOut = new Uint8Array(w * h));
    if (!this.drawn && !this.figured) return out.fill(0);
    const FAR = 1e3;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = al[i];
        const inside = a >= 128;
        // An outline pixel: partly covered, or beside one of the other kind.
        const edge = (a > 0 && a < 255) || (x > 0 && al[i - 1] >= 128 !== inside) || (x < w - 1 && al[i + 1] >= 128 !== inside) || (y > 0 && al[i - w] >= 128 !== inside) || (y < h - 1 && al[i + w] >= 128 !== inside);
        d[i] = edge ? Math.abs(a / 255 - 0.5) : FAR;
      }
    }
    const D = 1.4142;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = d[i];
        if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
        if (y > 0) {
          if (d[i - w] + 1 < v) v = d[i - w] + 1;
          if (x > 0 && d[i - w - 1] + D < v) v = d[i - w - 1] + D;
          if (x < w - 1 && d[i - w + 1] + D < v) v = d[i - w + 1] + D;
        }
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        let v = d[i];
        if (x < w - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
        if (y < h - 1) {
          if (d[i + w] + 1 < v) v = d[i + w] + 1;
          if (x < w - 1 && d[i + w + 1] + D < v) v = d[i + w + 1] + D;
          if (x > 0 && d[i + w - 1] + D < v) v = d[i + w - 1] + D;
        }
        d[i] = v;
        const s = 128 + (al[i] >= 128 ? v : -v) * 16;
        out[i] = s < 0 ? 0 : s > 255 ? 255 : s;
      }
    }
    return out;
  }

  /** The layer as painted so far: how covered each pixel is (0 to 255; rows from the top). The array is reused. */
  alpha(): Uint8Array {
    const { w, h, out, cov } = this;
    if (this.drawn) {
      const px = this.g.getImageData(0, 0, w, h).data;
      for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3];
    } else out.fill(0);
    if (this.figured) {
      const W = w * SS;
      const xa = Math.floor(this.fx0 / SS), xb = Math.floor(this.fx1 / SS);
      for (let y = Math.floor(this.fy0 / SS), yb = Math.floor(this.fy1 / SS); y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          let n = 0;
          for (let j = 0; j < SS; j++) {
            const o = (y * SS + j) * W + x * SS;
            for (let i = 0; i < SS; i++) n += cov[o + i];
          }
          const a = Math.round((n * 255) / (SS * SS));
          if (a > out[y * w + x]) out[y * w + x] = a;
        }
      }
    }
    return out;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.drawn = true;
    this.g.fillRect(x, y, w, h);
  }

  rr(x: number, y: number, w: number, h: number, r: number): void {
    this.drawn = true;
    this.g.beginPath();
    this.g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    this.g.fill();
  }

  ell(cx: number, cy: number, rx_: number, ry_: number): void {
    this.drawn = true;
    this.g.beginPath();
    this.g.ellipse(cx, cy, Math.abs(rx_), Math.abs(ry_), 0, 0, Math.PI * 2);
    this.g.fill();
  }

  poly(pts: readonly number[]): void {
    this.drawn = true;
    this.g.beginPath();
    this.g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) this.g.lineTo(pts[i], pts[i + 1]);
    this.g.closePath();
    this.g.fill();
  }

  line(x0: number, y0: number, x1: number, y1: number, t: number): void {
    this.drawn = true;
    this.g.beginPath();
    this.g.moveTo(x0, y0);
    this.g.lineTo(x1, y1);
    this.g.lineWidth = t;
    this.g.lineCap = 'round';
    this.g.strokeStyle = '#000';
    this.g.stroke();
  }

  items(list: readonly Item[] | undefined): void {
    for (const it of list ?? []) {
      const { kind, x, args, depth } = itemParts(it);
      const draw = ITEMS[kind] as (p: Pen, x: number, ...a: number[]) => void;
      if (depth <= 0) {
        draw(this, x, ...args);
        continue;
      }
      // Further back than its layer: smaller about the horizon, as the street would see it there.
      const k = depthScale(depth);
      this.g.save();
      this.g.translate(0, DEPTH_EYE.y * (1 - k));
      this.g.scale(k, k);
      draw(this, x, ...args);
      this.g.restore();
    }
  }

  /** One of the mob, posed and placed: its outline as the street sees it, and what its hands hold. */
  figure(f: Fig): void {
    // (Placed by the hips across the room; sitting, the hips on the seat, else the lowest of them on the floor.)
    const { S, M, xy, sc, dx, dy } = posed(f);
    // Its triangles into the coverage buffer, sampled at the samples' centres (edges inclusive, so neighbours leave
    // no gap between them).
    const k = this.ppm * SS, W = this.w * SS, H = this.h * SS;
    const ox = W / 2 + dx * k, oy = H - dy * k;
    const cov = this.cov;
    const idx = S.idx;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2;
      const ax = ox + xy[a] * k, ay = oy - xy[a + 1] * k;
      let bx = ox + xy[b] * k, by = oy - xy[b + 1] * k, cx = ox + xy[c] * k, cy = oy - xy[c + 1] * k;
      let area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      if (area < 0) {
        [bx, by, cx, cy] = [cx, cy, bx, by];
        area = -area;
      }
      if (area < 1e-6) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x1 < x0 || y1 < y0) continue;
      if (x0 < this.fx0) this.fx0 = x0;
      if (x1 > this.fx1) this.fx1 = x1;
      if (y0 < this.fy0) this.fy0 = y0;
      if (y1 > this.fy1) this.fy1 = y1;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) >= 0 && (cx - bx) * (py - by) - (cy - by) * (px - bx) >= 0 && (ax - cx) * (py - cy) - (ay - cy) * (px - cx) >= 0) cov[y * W + x] = 1;
        }
      }
    }
    this.figured = this.fx1 >= this.fx0;
    const g = this.g;
    for (const hold of f.hold ?? []) {
      // Where it's anchored (the hand; one prop the pelvis), then moved and sized as the hold says.
      const at = holdPlace(S, M, hold);
      const { dx: hx, dy: hy, scale } = holdAt(hold);
      this.drawn = true;
      g.save();
      g.translate((at.x + hx) * sc + dx, (at.y + hy) * sc + dy);
      g.rotate(at.ang);
      if (scale * sc !== 1) g.scale(scale * sc, scale * sc);
      PROPS[hold[1]](this);
      g.restore();
    }
  }

  figures(list: readonly Fig[] | undefined): void {
    for (const f of list ?? []) this.figure(f);
  }
}

/** A scene's four layers, in its channels' order: back furniture, people, the furniture they're at, the second frame or the people at the back. */
function paintLayer(L: Layer, s: Scene, ch: number): void {
  L.clear();
  if (ch === 0) L.items(s.back);
  else if (ch === 1) {
    L.figures(s.a);
    L.items(s.aItems);
  } else if (ch === 2) L.items(s.front);
  else if (s.anim) {
    // (The people's last pose: with a second frame only, that one.)
    const poses = posesOf(s);
    L.figures(poses[poses.length - 1].a);
    L.items(poses[poses.length - 1].aItems);
  } else L.figures(s.deep);
}

/** One of a scene's layers: its back furniture, the furniture the people are at, the people at the back, or one of the people's poses. */
function paintPart(L: Layer, s: Scene, part: 'back' | 'front' | 'deep' | SceneFrame): void {
  L.clear();
  if (part === 'back') L.items(s.back);
  else if (part === 'front') L.items(s.front);
  else if (part === 'deep') L.figures(s.deep);
  else {
    L.figures(part.a);
    L.items(part.aItems);
  }
}

/**
 * One layer of a scene as an image for the shop atlas (shopAtlas.ts: the shady rooms at street level): 4 m wide
 * and `height` m high at the atlas's 64 px a metre, the shapes in `rgb`. `part`: the furniture on the far wall
 * (`back` without `near`), what stands close behind the people (`deep`, and `back` with `near`), the people, or the
 * furniture in front of them.
 */
export function sceneLayerImage(s: Scene, part: 'wall' | 'behind' | 'people' | 'front', height: number, rgb: readonly [number, number, number]): HTMLCanvasElement {
  const w = WINDOW_ATLAS.cellW, h = Math.round(height * WINDOW_ATLAS.ppm);
  const L = new Layer(WINDOW_ATLAS.ppm, w, h);
  L.clear();
  if (part === 'wall' && !s.near) L.items(s.back);
  else if (part === 'behind') {
    L.figures(s.deep);
    if (s.near) L.items(s.back);
  } else if (part === 'people') {
    L.figures(s.a);
    L.items(s.aItems);
  } else if (part === 'front') L.items(s.front);
  const al = L.alpha();
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let i = 0; i < al.length; i++) {
    img.data[i * 4] = rgb[0];
    img.data[i * 4 + 1] = rgb[1];
    img.data[i * 4 + 2] = rgb[2];
    img.data[i * 4 + 3] = al[i];
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * A painter for the scene editor (showroom/scenes.ts): the same posing, placing and rasterising the atlas gets, at
 * any size. Each call gives the layer as bytes, rows from the top, in an array that the next call reuses (copy what
 * you keep). `alpha`: how covered each pixel is; `field`: the distance field the people's poses are stored as (128
 * at the outline, 16 a pixel), which the shader blends between poses.
 */
export interface ScenePainter {
  readonly ppm: number;
  readonly w: number;
  readonly h: number;
  alpha(figs: readonly Fig[] | undefined, items?: readonly Item[]): Uint8Array;
  field(figs: readonly Fig[] | undefined, items?: readonly Item[]): Uint8Array;
}
export function scenePainter(ppm: number = WINDOW_ATLAS.ppm): ScenePainter {
  const w = Math.round(WINDOW_ATLAS.w * ppm), h = Math.round(WINDOW_ATLAS.h * ppm);
  const L = new Layer(ppm, w, h);
  const paint = (figs: readonly Fig[] | undefined, items?: readonly Item[]): void => {
    L.clear();
    L.figures(figs);
    L.items(items);
  };
  return {
    ppm,
    w,
    h,
    alpha: (figs, items) => (paint(figs, items), L.alpha()),
    field: (figs, items) => (paint(figs, items), L.field()),
  };
}

export interface WindowAtlasData {
  /** RGBA rows of the scenes' numbers and cells (WINDOW_ATLAS.maskW wide). */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scenes: readonly Scene[];
  /** How long it took to pose and paint (ms). */
  readonly ms: number;
}

/** Every scene of this edition, painted: the bytes that go under the storefronts' masks (shopAtlas.ts). */
export function paintWindowAtlas(): WindowAtlasData {
  const t0 = performance.now();
  const A = WINDOW_ATLAS;
  const scenes = windowScenes();
  const width = A.maskW;
  const height = WINDOW_ROWS;
  const data = new Uint8Array(width * height * 4);
  // The numbers the shader reads, a texel each (windowTables), in the rows above the cells.
  const T = windowTables(scenes);
  const put = (row: number, x: number, v: readonly number[]): void => data.set([v[0], v[1] ?? 0, v[2] ?? 0, v[3] ?? 0], (row * width + x) * 4);
  T.play.forEach((v, n) => put(0, n, v));
  T.ranges.forEach((v, n) => put(1, n, v));
  T.picks.slice(0, width).forEach((n, k) => put(2, k, [n]));
  shadyTable(shopScenes()).forEach((v, t) => put(3, t, v));
  const L = new Layer(A.ppm, A.cellW, A.cellH);
  const lay = windowLayout(scenes);
  T.more.forEach((v, n) => put(4, n, v));
  // A layer into a channel of a cell: the furniture as coverage, the people as a distance field.
  const write = (cell: number, ch: number, px: Uint8Array): void => {
    const ox = (cell % A.cols) * A.cellW;
    const oy = A.dataRows + Math.floor(cell / A.cols) * A.cellH;
    for (let y = 0; y < A.cellH; y++) {
      let o = ((oy + y) * width + ox) * 4 + ch;
      let i = y * A.cellW;
      for (let x = 0; x < A.cellW; x++, o += 4, i++) data[o] = px[i];
    }
  };
  scenes.forEach((s, n) => {
    const poses = lay.poses[n];
    if (s.back) {
      paintPart(L, s, 'back');
      write(n, 0, L.alpha());
    }
    if (s.front) {
      paintPart(L, s, 'front');
      write(n, 2, L.alpha());
    }
    paintPart(L, s, poses[0]);
    write(n, 1, L.field());
    if (poses.length > 1 || s.deep) {
      paintPart(L, s, poses.length > 1 ? poses[1] : 'deep');
      write(n, 3, L.field());
    }
    for (let k = 2; k < poses.length; k++) {
      const sl = lay.slot[n] + k - 2;
      paintPart(L, s, poses[k]);
      write(lay.pool + Math.floor(sl / 4), sl % 4, L.field());
    }
  });
  return { data, width, height, scenes, ms: Math.round(performance.now() - t0) };
}

function roomFill(cat: string): string {
  return cat === 'office' || cat === 'v_office' ? '#b9cdd2' : cat === 'den' || cat === 'v_den' || cat === 'v_love' || isShopKind(cat) ? '#c9808a' : cat.startsWith('v_') ? '#c8a070' : '#d9c08e';
}

/** One frame of a scene, as the contact sheet draws it, into `g` at (x, y). `markX` ticks that figure's place. */
function drawSceneFrame(g: CanvasRenderingContext2D, L: Layer, tint: HTMLCanvasElement, img: ImageData, s: Scene, frame: number, x: number, y: number, ppm: number, markX: number | undefined, guides: boolean): void {
  const w = WINDOW_ATLAS.w * ppm, h = WINDOW_ATLAS.h * ppm;
  const cat = catsOf(s)[0];
  g.fillStyle = roomFill(cat);
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(x, y + h - 0.9 * ppm, w, 1);
  if (guides) {
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (const gx of [-1.3, -0.8, 0.8, 1.3]) g.fillRect(x + w / 2 + gx * ppm, y, 1, h);
  }
  const layers: [number, string][] = [[0, '#4d463c']];
  if (!s.anim && s.deep) layers.push([3, '#3a352e']);
  layers.push([frame === 1 && s.anim ? 3 : 1, '#16161a'], [2, '#050506']);
  const tg = tint.getContext('2d')!;
  for (const [ch, colour] of layers) {
    paintLayer(L, s, ch);
    const al = L.alpha();
    const rgb = [1, 3, 5].map((o) => parseInt(colour.slice(o, o + 2), 16));
    for (let i = 0; i < al.length; i++) {
      img.data[i * 4] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = al[i];
    }
    tg.putImageData(img, 0, 0);
    g.drawImage(tint, x, y);
  }
  if (markX !== undefined) {
    const px = x + w / 2 + markX * ppm;
    g.fillStyle = '#f3e7a2';
    g.fillRect(px - 1, y + h - 14, 3, 14);
  }
}

/**
 * Both frames of one scene, side by side, as the street sees them. `mark` ticks one figure (the pose lab).
 * `guides` draws the hotel window (±0.8 m) and the width that still reads on a narrow room (±1.3 m).
 */
/** The gap between the two frames in `paintSceneFrames`. */
export const SCENE_FRAME_PAD = 14;

export function paintSceneFrames(s: Scene, ppm = 120, mark?: { frame: 0 | 1; x: number }, guides = false): HTMLCanvasElement {
  const w = WINDOW_ATLAS.w * ppm, h = WINDOW_ATLAS.h * ppm;
  const pad = SCENE_FRAME_PAD;
  const out = document.createElement('canvas');
  out.width = w * 2 + pad;
  out.height = h;
  const g = out.getContext('2d')!;
  const L = new Layer(ppm, w, h);
  const tint = document.createElement('canvas');
  tint.width = w;
  tint.height = h;
  const img = tint.getContext('2d')!.createImageData(w, h);
  drawSceneFrame(g, L, tint, img, s, 0, 0, 0, ppm, mark?.frame === 0 ? mark.x : undefined, guides);
  drawSceneFrame(g, L, tint, img, s, 1, w + pad, 0, ppm, mark?.frame === 1 ? mark.x : undefined, guides);
  return out;
}

/**
 * A contact sheet of the scenes of some kinds, for review: each scene's two frames side by side as the street
 * sees them in a lit room (the back wall's furniture greyer, as the shader dims it), its cell number, id and what it
 * is under them.
 */
export function windowContactSheet(cats: readonly string[] = CATS, ppm = 96, perRow = 2): HTMLCanvasElement {
  const A = WINDOW_ATLAS;
  const scenes = windowScenes();
  // (Every scene the edition has: the ones behind the windows by their cells, and the ground-floor rooms.)
  const list = allScenes().map((s) => ({ s, n: scenes.indexOf(s) })).filter((e) => catsOf(e.s).some((c) => cats.includes(c)));
  const w = A.w * ppm, h = A.h * ppm;
  const pad = 10, label = 40;
  const rows = Math.ceil(list.length / perRow);
  const out = document.createElement('canvas');
  out.width = perRow * (2 * w + 3 * pad) + pad;
  out.height = rows * (h + label + pad) + pad;
  const g = out.getContext('2d')!;
  g.fillStyle = '#17181c';
  g.fillRect(0, 0, out.width, out.height);
  const L = new Layer(ppm, w, h);
  const tint = document.createElement('canvas');
  tint.width = w;
  tint.height = h;
  const tg = tint.getContext('2d')!;
  const img = tg.createImageData(w, h);
  list.forEach(({ s, n }, i) => {
    const x0 = pad + (i % perRow) * (2 * w + 3 * pad);
    const y0 = pad + Math.floor(i / perRow) * (h + label + pad);
    for (let frame = 0; frame < 2; frame++) drawSceneFrame(g, L, tint, img, s, frame, x0 + frame * (w + pad), y0, ppm, undefined, false);
    g.fillStyle = '#e8e4da';
    g.font = '15px sans-serif';
    g.textBaseline = 'top';
    const count = posesOf(s).length;
    const play = s.slide ? ` · walks ${s.slide} m/s (${count} poses)` : s.anim ? ` · ${count} poses in ${periodOf(s)} s` : ' · still';
    g.fillText(`${isWindowScene(s) ? n : 'ground floor'} · ${s.id} · ${catsOf(s).join(' + ')}${s.cat[0] === 'v' || catsOf(s)[0].startsWith('v_') ? ` · ${s.when ?? 'late'}` : ''}${s.low ? ' · glass to the floor only' : ''}${s.adult ? ' · adult: not in the demo' : ''}${play}`, x0, y0 + h + 4);
    g.fillStyle = '#a8a49a';
    g.fillText(s.label, x0, y0 + h + 21);
  });
  return out;
}
