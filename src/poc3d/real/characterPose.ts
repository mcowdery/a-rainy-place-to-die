import * as THREE from 'three';
import { ALL_BONES, ARM_L, ARM_R, armSwing, clavicle, digitBone, fingerTip, hipHalf, shoulderHalf, FOOT_L, FOOT_R, FORE_L, FORE_R, handBone, HEAD, PARENT, PELVIS, ROOT, SHIN_L, SHIN_R, SPINE, spineBone, THIGH_L, THIGH_R, toeBone, toeDigit, type Template } from './mobRig';
import { PART_STEPS, PARTS, poseValue, type PartName, type PartStep, type Pose } from './windowScenes';

/**
 * A named character posed freely (real/mobCharacters.ts): the pose is the rooms' own format (windowScenes.ts `Pose`:
 * every part's turns in degrees, in PART_STEPS' order, so there is one way of writing a pose down for the scene
 * editor and for this), with what a character has more of: its hands at the wrist (the format's `hL`, `hR`, on the
 * hand's own bone), its fingers and its toes, and more joints up its spine (CHAR_PARTS: the lower chest and the
 * upper chest between the waist and the neck, and the head on top of the neck). `characterBones` works out every
 * bone's matrix from the bind pose for the characters' posed material (real/people.ts `posedMaterial`, `uBones`).
 * Pure but for three's matrices.
 */
export interface CharacterPose extends Pose {
  /** A hand's fingers closed, 0 as they hang to 1 a fist: one number for all five, or thumb, index, middle, ring, little. */
  readonly gL?: number | readonly number[];
  readonly gR?: number | readonly number[];
  /**
   * A hand's finger joints, each on top of what `g` closes it: three numbers a digit (thumb first; degrees): its
   * root closed toward the palm, its root spread to the side, its middle joint closed. The list may stop early.
   */
  readonly dL?: readonly number[];
  readonly dR?: readonly number[];
  /** A foot's toes turned up at the ball of the foot (degrees). */
  readonly tL?: number;
  readonly tR?: number;
  /** A foot's toes each, on top of that: two numbers a toe (the big toe first; degrees): turned up at its root, and to the side. The list may stop early. */
  readonly eL?: readonly number[];
  readonly eR?: readonly number[];
  /** Sitting: the seat's height (m; the hips rest on it). Otherwise the lowest of the figure is on the floor. */
  readonly seat?: number;
  /** The lower chest on the waist (the bottom of the ribs): leaned forward, bent to the side, twisted (degrees), as the format's chest is at the waist. */
  readonly ribLean?: number;
  readonly ribBend?: number;
  readonly ribTwist?: number;
  /** The upper chest (the arms and the neck are on it), the same. */
  readonly upLean?: number;
  readonly upBend?: number;
  readonly upTwist?: number;
  /** The head on top of the neck (the format's `nod`, `tilt`, `turn` are the neck at its base), the same. */
  readonly headNod?: number;
  readonly headTilt?: number;
  readonly headTurn?: number;
}

/** A character's parts: the format's, and the spine's further joints. (The format's `chest` is the waist's joint; its `head` the neck's base.) */
export type CharPart = PartName | 'ribs' | 'upper' | 'skull';
export const CHAR_PARTS: readonly CharPart[] = ['body', 'chest', 'ribs', 'upper', 'head', 'skull', ...PARTS.filter((p) => p !== 'body' && p !== 'chest' && p !== 'head')];
const own = (name: string, axis: PartStep['axis'], key: keyof CharacterPose, lo: number, hi: number): PartStep => ({ axis, sign: 1, name, key: key as keyof Pose, def: 0, range: [lo, hi] });
/** Every part's turns, in the order they are applied (the format's own list, and the same again for each further joint of the spine). */
export const CHAR_STEPS: Record<CharPart, readonly PartStep[]> = {
  ...PART_STEPS,
  ribs: [own('lean', 'x', 'ribLean', -35, 50), own('bend', 'z', 'ribBend', -30, 30), own('twist', 'y', 'ribTwist', -35, 35)],
  upper: [own('lean', 'x', 'upLean', -35, 50), own('bend', 'z', 'upBend', -30, 30), own('twist', 'y', 'upTwist', -35, 35)],
  skull: [own('nod', 'x', 'headNod', -50, 50), own('tilt', 'z', 'headTilt', -35, 35), own('turn', 'y', 'headTurn', -70, 70)],
};
const RIBS = spineBone(0), UPPER = spineBone(1), SKULL = spineBone(2);

export const POSE_BONES = ALL_BONES;
const rad = (d: number): number => (d * Math.PI) / 180;
const TURN = {
  x: (d: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationX(rad(d)),
  y: (d: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationY(rad(d)),
  z: (d: number): THREE.Matrix4 => new THREE.Matrix4().makeRotationZ(rad(d)),
};
/** The bone each part turns (the whole body: the root). */
export const PART_BONE: Record<CharPart, number> = {
  body: ROOT, chest: SPINE, ribs: RIBS, upper: UPPER, head: HEAD, skull: SKULL,
  armL: ARM_L, foreL: FORE_L, handL: handBone(0), armR: ARM_R, foreR: FORE_R, handR: handBone(1),
  thighL: THIGH_L, shinL: SHIN_L, footL: FOOT_L, thighR: THIGH_R, shinR: SHIN_R, footR: FOOT_R,
};
/** Each bone's parent (-1: the root's own), and an order in which a parent always comes first. */
const PARENT_OF: number[] = [...PARENT];
// (Up the spine: the waist, the lower chest, the upper chest with the arms and the neck on it, the head on the neck.)
PARENT_OF[RIBS] = SPINE;
PARENT_OF[UPPER] = RIBS;
PARENT_OF[HEAD] = UPPER;
// (Each arm on its collar bone, which is on the upper chest; an arm's untwisted bone is worked out from the arm.)
PARENT_OF[clavicle(0)] = UPPER;
PARENT_OF[clavicle(1)] = UPPER;
PARENT_OF[ARM_L] = clavicle(0);
PARENT_OF[ARM_R] = clavicle(1);
PARENT_OF[armSwing(0)] = ARM_L;
PARENT_OF[armSwing(1)] = ARM_R;
PARENT_OF[SKULL] = HEAD;
// (A hip's half-way bone is worked out from the pelvis and its thigh once they are: `characterBones`.)
PARENT_OF[hipHalf(0)] = THIGH_L;
PARENT_OF[hipHalf(1)] = THIGH_R;
PARENT_OF[shoulderHalf(0)] = ARM_L;
PARENT_OF[shoulderHalf(1)] = ARM_R;
for (const h of [0, 1] as const) {
  PARENT_OF[handBone(h)] = h === 0 ? FORE_L : FORE_R;
  PARENT_OF[toeBone(h)] = h === 0 ? FOOT_L : FOOT_R;
  for (let t = 0; t < 5; t++) PARENT_OF[toeDigit(h, t)] = toeBone(h);
  for (let d = 0; d < 5; d++) {
    PARENT_OF[digitBone(h, d, 0)] = handBone(h);
    PARENT_OF[digitBone(h, d, 1)] = digitBone(h, d, 0);
    PARENT_OF[fingerTip(h, d)] = digitBone(h, d, 1);
  }
}
const ORDER: number[] = [];
{
  const done = new Set<number>([ROOT]);
  ORDER.push(ROOT);
  while (ORDER.length < POSE_BONES) {
    for (let b = 0; b < POSE_BONES; b++) {
      if (done.has(b)) continue;
      const p = b === PELVIS ? ROOT : PARENT_OF[b];
      if (p !== -1 && !done.has(p)) continue;
      done.add(b);
      ORDER.push(b);
    }
  }
}
/**
 * A collar bone's turn with its arm: this much of the angle the arm is raised from hanging, lifting the shoulder
 * (whichever way the arm is raised: out, forward or across), and this much of how far forward or back the arm
 * points, bringing the shoulder forward or back.
 */
const CLAVICLE = 0.22, CLAVICLE_FORWARD = 0.15;
/**
 * How far a finger's two joints turn at a full fist (radians): the thumb's less. And how much of what its middle
 * joint is closed a digit's last joint closes with it (the thumb's, a finger's): it has no number of its own.
 */
const FIST = [[0.5, 0.6], [1.4, 1.4]] as const;
const TIP_FOLLOW = [0.5, 0.6] as const;

const closed = (g: number | readonly number[] | undefined, d: number): number => (g === undefined ? 0 : typeof g === 'number' ? g : (g[d] ?? 0));

/** A finger joint's own number (degrees): `turn` 0 the root closed, 1 the root spread, 2 the middle joint closed. */
export const DIGIT_TURNS = ['closed', 'spread', 'tip closed'] as const;
/** How far each goes (degrees), on top of the hand's own closing. */
export const DIGIT_RANGE: readonly (readonly [number, number])[] = [[-40, 100], [-30, 30], [-20, 110]];
export function digitValue(p: CharacterPose, hand: 0 | 1, digit: number, turn: 0 | 1 | 2): number {
  return (hand === 0 ? p.dL : p.dR)?.[digit * 3 + turn] ?? 0;
}
/** A pose with one finger joint's number set (the list no longer than it need be; none when every joint is as the hand has it). */
export function withDigit(p: CharacterPose, hand: 0 | 1, digit: number, turn: 0 | 1 | 2, value: number): CharacterPose {
  const key = hand === 0 ? 'dL' : 'dR';
  const list = [...(p[key] ?? [])];
  while (list.length <= digit * 3 + turn) list.push(0);
  list[digit * 3 + turn] = value;
  while (list.length && !list[list.length - 1]) list.pop();
  const { [key]: _, ...rest } = p;
  return list.length ? { ...rest, [key]: list } : rest;
}

/** A toe's own number (degrees): `turn` 0 up at its root, 1 to the side. */
export const TOE_TURNS = ['up', 'to the side'] as const;
export const TOE_RANGE: readonly (readonly [number, number])[] = [[-45, 65], [-25, 25]];
export function toeValue(p: CharacterPose, foot: 0 | 1, toe: number, turn: 0 | 1): number {
  return (foot === 0 ? p.eL : p.eR)?.[toe * 2 + turn] ?? 0;
}
/** A pose with one toe's number set (the list no longer than it need be; none when every toe is as the foot has it). */
export function withToe(p: CharacterPose, foot: 0 | 1, toe: number, turn: 0 | 1, value: number): CharacterPose {
  const key = foot === 0 ? 'eL' : 'eR';
  const list = [...(p[key] ?? [])];
  while (list.length <= toe * 2 + turn) list.push(0);
  list[toe * 2 + turn] = value;
  while (list.length && !list[list.length - 1]) list.pop();
  const { [key]: _, ...rest } = p;
  return list.length ? { ...rest, [key]: list } : rest;
}

/** A bone's own turn in its parent's frame, about its joint, for a pose. */
function localTurn(b: number, p: CharacterPose, armOut: number): THREE.Matrix4 {
  const out = new THREE.Matrix4();
  for (const part of CHAR_PARTS) {
    if (PART_BONE[part] !== b) continue;
    for (const st of CHAR_STEPS[part]) {
      const a = st.sign * (st.fixed === undefined ? poseValue(p, st) : st.fixed === 'armOut' ? armOut : st.fixed);
      if (a !== 0) out.multiply(TURN[st.axis](a));
    }
    return out;
  }
  for (const h of [0, 1] as const) {
    // (The left hand, x < 0, closes toward +x: a positive turn about z; the right the other way.)
    const sg = h === 0 ? 1 : -1;
    if (b === toeBone(h)) return out.makeRotationX(-rad((h === 0 ? p.tL : p.tR) ?? 0));
    for (let t = 0; t < 5; t++) {
      // (A toe: to the side about the upright through its root, then up.)
      if (b === toeDigit(h, t)) return out.makeRotationY(rad(toeValue(p, h, t, 1))).multiply(new THREE.Matrix4().makeRotationX(-rad(toeValue(p, h, t, 0))));
    }
    for (let d = 0; d < 5; d++) {
      if (b === fingerTip(h, d)) {
        const middle = closed(h === 0 ? p.gL : p.gR, d) * FIST[d === 0 ? 0 : 1][1] + rad(digitValue(p, h, d, 2));
        return out.makeRotationZ(sg * TIP_FOLLOW[d === 0 ? 0 : 1] * Math.max(0, middle));
      }
      for (const j of [0, 1] as const) {
        if (b !== digitBone(h, d, j)) continue;
        const fist = closed(h === 0 ? p.gL : p.gR, d) * FIST[d === 0 ? 0 : 1][j];
        // (Its root spread to the side first, about the hand's own across, then closed.)
        if (j === 0) out.makeRotationX(rad(digitValue(p, h, d, 1)));
        return out.multiply(new THREE.Matrix4().makeRotationZ(sg * (fist + rad(digitValue(p, h, d, j === 0 ? 0 : 2)))));
      }
    }
  }
  return out;
}

/** A part's own turn in its parent's frame (all its turns together), for a pose. */
export function partTurn(T: Template, pose: CharacterPose, part: CharPart): THREE.Matrix4 {
  return localTurn(PART_BONE[part], pose, (T.armOut * 180) / Math.PI);
}
/** The bone a bone's own turns are from (-1: the root's are from nothing). An arm's are from the upper chest, though its joint is on its collar bone. */
export const parentBone = (b: number): number => (b === ROOT ? -1 : b === PELVIS || PARENT_OF[b] === -1 ? ROOT : PARENT_OF[b]);

/** A point that goes with a bone (given in the bind pose), posed. */
export function bonePoint(bones: Float32Array, b: number, p: readonly [number, number, number]): [number, number, number] {
  const o = b * 16;
  return [bones[o] * p[0] + bones[o + 4] * p[1] + bones[o + 8] * p[2] + bones[o + 12], bones[o + 1] * p[0] + bones[o + 5] * p[1] + bones[o + 9] * p[2] + bones[o + 13], bones[o + 2] * p[0] + bones[o + 6] * p[1] + bones[o + 10] * p[2] + bones[o + 14]];
}

export interface PosedBones {
  /** A matrix a bone (bind pose to posed, the figure's own frame, standing where the pose puts it): 16 numbers each. */
  readonly bones: Float32Array;
  /** Each bone's joint, posed. */
  readonly joints: readonly (readonly [number, number, number])[];
  /** How far the figure was moved up to stand on the floor or sit on its seat (0 when it's left where it is). */
  readonly down: number;
}

/**
 * Every bone's matrix for a pose, the figure set down on the floor (or on its seat). `sample`: every how many of the
 * figure's points are looked at to find its lowest (more than 1 while a drag is being solved: many poses a frame).
 * `free`: not set down at all (a figure held in the air: whoever draws it says how high).
 */
export function characterBones(T: Template, pose: CharacterPose, sample = 1, free = false): PosedBones {
  const armOut = (T.armOut * 180) / Math.PI;
  const M: THREE.Matrix4[] = [];
  const local = new THREE.Matrix4(), to = new THREE.Matrix4(), from = new THREE.Matrix4();
  /**
   * A collar bone's turn, from where its arm points (none of its twist): the shoulder lifted by how far the arm is
   * raised and brought forward or back with it (CLAVICLE). (It was a share of the shortest turn from hanging to
   * where the arm points: that let the shoulder down for an arm raised across the body, and jumped about near
   * straight up.)
   */
  const collar = (s: 0 | 1): THREE.Matrix4 => {
    const arm = s === 0 ? ARM_L : ARM_R, fore = s === 0 ? FORE_L : FORE_R;
    const a = T.pivot[arm], f = T.pivot[fore];
    const line = new THREE.Vector3(f[0] - a[0], f[1] - a[1], f[2] - a[2]).normalize();
    const hangs = line.clone().transformDirection(localTurn(arm, {}, armOut)), points = line.clone().transformDirection(localTurn(arm, pose, armOut));
    const side = Math.sign(a[0]) || 1;
    const forward = Math.asin(Math.max(-1, Math.min(1, points.z))) - Math.asin(Math.max(-1, Math.min(1, hangs.z)));
    return new THREE.Matrix4().makeRotationZ(side * CLAVICLE * hangs.angleTo(points)).multiply(new THREE.Matrix4().makeRotationY(-side * CLAVICLE_FORWARD * forward));
  };
  for (const b of ORDER) {
    const turn = b === clavicle(0) ? collar(0) : b === clavicle(1) ? collar(1) : localTurn(b, pose, armOut);
    if (b === ROOT) {
      M[b] = turn;
      continue;
    }
    const q = T.pivot[b] ?? [0, 0, 0];
    local.copy(to.makeTranslation(q[0], q[1], q[2])).multiply(turn).multiply(from.makeTranslation(-q[0], -q[1], -q[2]));
    const parent = b === PELVIS || PARENT_OF[b] === -1 ? ROOT : PARENT_OF[b];
    if (b === ARM_L || b === ARM_R) {
      // (An arm's turns are from the chest, as the pose has them: its collar bone moves the shoulder's joint and
      // doesn't turn the arm further.)
      const at = new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(M[parent]);
      M[b] = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(M[UPPER].clone().setPosition(0, 0, 0)).multiply(turn).multiply(from.makeTranslation(-q[0], -q[1], -q[2]));
      continue;
    }
    M[b] = new THREE.Matrix4().multiplyMatrices(M[parent], local);
  }
  // Each arm without its twist: its turn from the upper chest (which its own turns are from), less what of that is
  // about the arm's own length. (Not from its collar bone: that lifts the shoulder its own way, and the turn from it
  // to an arm raised in front is partly about the arm's length, which wrung the upper arm.)
  for (const s of [0, 1] as const) {
    const arm = s === 0 ? ARM_L : ARM_R, fore = s === 0 ? FORE_L : FORE_R;
    const a = T.pivot[arm], f = T.pivot[fore];
    const qc = new THREE.Quaternion().setFromRotationMatrix(M[UPPER]);
    const line = new THREE.Vector3(f[0] - a[0], f[1] - a[1], f[2] - a[2]).normalize().applyQuaternion(qc);
    const q = new THREE.Quaternion().setFromRotationMatrix(M[arm]).multiply(qc.clone().invert());
    const along = q.x * line.x + q.y * line.y + q.z * line.z;
    const twist = new THREE.Quaternion(line.x * along, line.y * along, line.z * along, q.w).normalize();
    const swing = q.multiply(twist.invert()).multiply(qc);
    const at = new THREE.Vector3(a[0], a[1], a[2]).applyMatrix4(M[arm]);
    M[armSwing(s)] = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(swing)).multiply(new THREE.Matrix4().makeTranslation(-a[0], -a[1], -a[2]));
  }
  // Each hip's and each shoulder's half-way bone: turned half as far as its thigh or arm, about the joint where that has it.
  // (A shoulder's from its collar bone to the arm without its twist.)
  for (const [helper, from, th, to] of [[hipHalf(0), PELVIS, THIGH_L, THIGH_L], [hipHalf(1), PELVIS, THIGH_R, THIGH_R], [shoulderHalf(0), clavicle(0), ARM_L, armSwing(0)], [shoulderHalf(1), clavicle(1), ARM_R, armSwing(1)]] as const) {
    const q = T.pivot[th];
    const half = new THREE.Quaternion().setFromRotationMatrix(M[from]).slerp(new THREE.Quaternion().setFromRotationMatrix(M[to]), 0.5);
    const at = new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(M[th]);
    M[helper] = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(half)).multiply(new THREE.Matrix4().makeTranslation(-q[0], -q[1], -q[2]));
  }
  // Set down: sitting, the hips on the seat; else the lowest of it on the floor.
  let dy: number;
  if (free) dy = 0;
  else if (pose.seat !== undefined) {
    const hip = new THREE.Vector3(0, T.pivot[THIGH_L][1], 0).applyMatrix4(M[PELVIS]);
    dy = pose.seat + 0.085 - hip.y;
  } else {
    let low = Infinity;
    const P = T.pos;
    for (let i = 0; i < T.b0.length; i += sample) {
      // (The face's emote quads are folded away when drawn: not part of the figure's outline.)
      if (T.shade[i] >= 2100) continue;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const e0 = M[T.b0[i]].elements, e1 = M[T.b1[i]].elements, w = T.w[i];
      const py = w * (e0[1] * x + e0[5] * y + e0[9] * z + e0[13]) + (1 - w) * (e1[1] * x + e1[5] * y + e1[9] * z + e1[13]);
      if (py < low) low = py;
    }
    dy = -low;
  }
  const bones = new Float32Array(POSE_BONES * 16);
  const joints: [number, number, number][] = [];
  const v = new THREE.Vector3();
  for (let b = 0; b < POSE_BONES; b++) {
    const m = M[b] ?? new THREE.Matrix4();
    m.elements[13] += dy;
    bones.set(m.elements, b * 16);
    const q = T.pivot[b] ?? [0, 0, 0];
    v.set(q[0], q[1], q[2]).applyMatrix4(m);
    joints.push([v.x, v.y, v.z]);
  }
  return { bones, joints, down: dy };
}
