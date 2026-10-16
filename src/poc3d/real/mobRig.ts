/**
 * The mob figures' rig (real/people.ts draws them): the skeleton's bones, a template in its bind pose, the loft
 * builder the templates are made with, each body's proportions and joints. Shared by the district's templates
 * (people.ts) and the shaped generation under review (real/mobShape.ts).
 */

import type { DetailedHair } from './mobHairKinds';
import type { MenHair } from './mobMenHairKinds';

export type V3 = [number, number, number];

/**
 * The other builds (2026-10-10, real/mobShape.ts): bodies of their own height, weight and shape, each with its own joints and
 * proportions, that behave as one of the four `BaseBody`s for everything else (`baseBody`: its outfits, hair, posing). The man's
 * (`Build`: stout, portly, bulky, lean, tall, short), the woman's (`WomanBuild`: with her bust and hips each their own size), and
 * the old (`OldBuild`: the elder man's three, and an elder woman's two; the base elder is a man).
 */
export type BaseBody = 'man' | 'woman' | 'child' | 'elder';
export type Build = 'stout' | 'portly' | 'lean' | 'tall' | 'short' | 'bulky';
export type WomanBuild = 'w_petite' | 'w_slim' | 'w_tall' | 'w_curvy' | 'w_busty' | 'w_pear' | 'w_plump' | 'w_heavy' | 'w_flat';
export type OldBuild = 'e_frail' | 'e_stout' | 'e_tall' | 'w_elder' | 'w_elder_plump';
export const BUILDS: readonly Build[] = ['stout', 'portly', 'lean', 'tall', 'short', 'bulky'];
export const WOMAN_BUILDS: readonly WomanBuild[] = ['w_petite', 'w_slim', 'w_tall', 'w_curvy', 'w_busty', 'w_pear', 'w_plump', 'w_heavy', 'w_flat'];
export const OLD_BUILDS: readonly OldBuild[] = ['e_frail', 'e_stout', 'e_tall', 'w_elder', 'w_elder_plump'];
export type Body = BaseBody | Build | WomanBuild | OldBuild;
/** Every body, in the order of the joints' rows: the old ones last, so `oldGlsl` is a range. */
export const ALL_BODIES: readonly Body[] = ['man', 'woman', 'child', 'elder', ...BUILDS, ...WOMAN_BUILDS, ...OLD_BUILDS];
export const isBuild = (b: Body): b is Build | WomanBuild | OldBuild => ALL_BODIES.indexOf(b) >= 4;
/** What a body behaves as (its outfits, hair, posing). */
export const baseBody = (b: Body): BaseBody => (b === 'man' || b === 'woman' || b === 'child' || b === 'elder' ? b : (BUILDS as readonly string[]).includes(b) ? 'man' : (WOMAN_BUILDS as readonly string[]).includes(b) || b === 'w_elder' || b === 'w_elder_plump' ? 'woman' : 'elder');
/** Whether a body is old: it stoops, and its hair is grey. */
export const isOld = (b: Body): boolean => b === 'elder' || (OLD_BUILDS as readonly string[]).includes(b);
/** GLSL: whether the body whose row is `v` (an int) is old. */
export const oldGlsl = (v: string): string => `(${v} == 3 || (${v} >= ${ALL_BODIES.indexOf(OLD_BUILDS[0])} && ${v} < ${ALL_BODIES.length}))`;
/** 'bob', 'ponytail' and 'twin' (twin tails) are the shaped generation's; the classic one draws them short or long. The detailed women's cuts (mobHairKinds.ts) are the shaped generation's too. */
export type Hair = 'short' | 'long' | 'bun' | 'hat' | 'cap' | 'none' | 'bob' | 'ponytail' | 'twin' | DetailedHair | MenHair;

// ---- Templates ----

/** Bones: indices into the skeleton. */
export const PELVIS = 0, SPINE = 1, HEAD = 2, THIGH_L = 3, SHIN_L = 4, THIGH_R = 5, SHIN_R = 6, ARM_L = 7, FORE_L = 8, ARM_R = 9, FORE_R = 10;
/** Bone 11, the root: only the walk's bob. */
export const ROOT = 11;
/** The feet (on the shins, held nearly level through the stride so the toes don't dig in). */
export const FOOT_L = 12, FOOT_R = 13;
export const BONES = 14;
/**
 * A named character's fingers and toes (real/mobCharacters.ts; the crowd has none): bones after the fourteen, posed
 * only by the characters' material (real/people.ts `characterMaterial`). A hand has five digits (0 the thumb, then
 * index to little), each two bones (0 at its root on the palm, 1 at its middle joint, a child of 0), children of
 * that side's forearm; a foot's toes are one bone at the ball of the foot, a child of that foot.
 */
export const DIGIT_BONES = 24;
export const digitBone = (hand: 0 | 1, digit: number, joint: 0 | 1): number => BONES + hand * 10 + digit * 2 + joint;
export const toeBone = (foot: 0 | 1): number => BONES + 20 + foot;
/** A hand's own bone, at the wrist (a child of that side's forearm; the fingers are its children): turned only where a character is posed freely (real/characterPose.ts). */
export const handBone = (hand: 0 | 1): number => BONES + 22 + hand;
/**
 * More joints up a named character's spine (after the digits'; a child each of the one before): 0 the lower chest, on
 * the waist's bone (SPINE) at the bottom of the ribs; 1 the upper chest, which the arms and the neck (HEAD, whose joint
 * is the neck's base) are on; 2 the head itself, on top of the neck. Turned only where a character is posed freely
 * (real/characterPose.ts); anywhere else each goes with the bone it is on (`digitParent`).
 */
export const SPINE_BONES = 3;
export const spineBone = (i: 0 | 1 | 2): number => BONES + DIGIT_BONES + i;
/**
 * A named character's toes each (after the spine's): a bone a toe (0 the big toe), at the toe's root, a child of that
 * foot's toes' bone (`toeBone`, which turns them all at the ball of the foot). Turned only where a character is posed
 * freely; anywhere else each goes with its foot's toes' bone.
 */
export const TOE_BONES = 10;
export const toeDigit = (foot: 0 | 1, toe: number): number => BONES + DIGIT_BONES + SPINE_BONES + foot * 5 + toe;
/**
 * A named character's hips each have a bone half-way between the pelvis and that thigh (after the toes'): turned half
 * as far as the thigh about the hip's joint. The skin across the hip goes pelvis, half-way, thigh, so a thigh turned
 * a right angle (sitting) is two bends of half that, and keeps its roundness; blended straight from the pelvis to
 * the thigh it fell in toward the joint. Worked out from the two it is between, wherever a character is drawn.
 */
export const HELPER_BONES = 18;
export const hipHalf = (side: 0 | 1): number => BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES + side;
/** The same at each shoulder: half-way between the chest and that arm, about the shoulder's joint. */
export const shoulderHalf = (side: 0 | 1): number => BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES + 2 + side;
/**
 * A collar bone each side (as the rigged reference has, refs/models: the skin just inside a shoulder goes with it, not
 * with the chest): from near the breastbone out to the shoulder, on the upper chest; the arm is on it. It isn't posed
 * by hand: it lifts by a share of how far its arm is raised from hanging (real/characterPose.ts CLAVICLE), so a raised
 * arm lifts its shoulder.
 */
export const clavicle = (side: 0 | 1): number => BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES + 4 + side;
/**
 * The upper arm without its twist (the reference's twist bones): where the arm points, but not turned about its own
 * length. The skin at the shoulder goes with it and the twist comes on down the upper arm, so an arm rolled about
 * itself doesn't wring the shoulder.
 */
export const armSwing = (side: 0 | 1): number => BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES + 6 + side;
/** Every bone a character has. */
/**
 * A finger's last joint (and the thumb's), on its middle joint's bone (the rigged reference has three bones a
 * finger): not posed by hand, it turns a share of what the middle joint is closed (real/characterPose.ts
 * TIP_FOLLOW), as a finger's last joint does, so a closed finger curls round instead of folding in two straight
 * pieces. Where a character isn't posed freely it goes with the middle joint's bone.
 */
export const fingerTip = (hand: 0 | 1, digit: number): number => BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES + 8 + hand * 5 + digit;
export const ALL_BONES = BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES + HELPER_BONES;
/** The fourteen-bone skeleton's bone a digit's (or a further spine joint's) goes with (where they aren't posed: the CPU's reference, the crowd's material). */
export const digitParent = (b: number): number => (b < BONES ? b : b >= BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES ? [THIGH_L, THIGH_R, ARM_L, ARM_R, SPINE, SPINE, ARM_L, ARM_R, FORE_L, FORE_L, FORE_L, FORE_L, FORE_L, FORE_R, FORE_R, FORE_R, FORE_R, FORE_R][b - (BONES + DIGIT_BONES + SPINE_BONES + TOE_BONES)] : b >= BONES + DIGIT_BONES + SPINE_BONES ? (b < BONES + DIGIT_BONES + SPINE_BONES + 5 ? FOOT_L : FOOT_R) : b >= BONES + DIGIT_BONES ? (b === BONES + DIGIT_BONES + 2 ? HEAD : SPINE) : b >= BONES + 22 ? (b === BONES + 22 ? FORE_L : FORE_R) : b >= BONES + 20 ? (b === BONES + 20 ? FOOT_L : FOOT_R) : b < BONES + 10 ? FORE_L : FORE_R);
export const PARENT = [-1, PELVIS, SPINE, PELVIS, THIGH_L, PELVIS, THIGH_R, SPINE, ARM_L, SPINE, ARM_R, -1, SHIN_L, SHIN_R];
/** How much of the leg's pitch a foot takes back (1: level; a little less, a toe-off behind and a heel strike ahead). */
export const FOOT_LEVEL = 0.85;

/** A body template in its bind pose (figure frame: x right, y up, z forward, feet at y 0). */
export interface Template {
  readonly pos: Float32Array;
  /** Bind-pose normals. */
  readonly nor: Float32Array;
  /** 1: mirrored to the figure's side (an umbrella held in the left or right hand). */
  readonly mirror: number;
  /** Two bones per vertex and the first one's weight. */
  readonly b0: Uint8Array;
  readonly b1: Uint8Array;
  readonly w: Float32Array;
  /** Shade multiplier per vertex (clothes below the waist and hair a little darker). */
  readonly shade: Float32Array;
  readonly idx: Uint32Array;
  /** Joint positions, one per bone. */
  readonly pivot: readonly V3[];
  /** The bind pose's arm angle away from the body. */
  readonly armOut: number;
}

/** [y, half width, half depth, z]: a horizontal cross-section. */
export type Row = readonly [number, number, number, number];
export type Weight = readonly [number, number, number];

export class TemplateBuilder {
  pos: number[] = [];
  b0: number[] = [];
  b1: number[] = [];
  w: number[] = [];
  shade: number[] = [];
  idx: number[] = [];

  /**
   * A loft through rings, each `seg` points round a superellipse (exponent n: 2 an ellipse, more boxy).
   * Axis 'y': horizontal rings, listed bottom to top, at (cx(y), y, z). Axis 'z': upright rings (feet),
   * listed back to front, with Row read as [z, half width, half height, y]. With `arc`, only that part of
   * each ring (angles from +x: pi/2 is the front (+z) for axis y, 3pi/2 the top for axis z), an open sheet.
   */
  loft(rows: readonly Row[], cx: (r: Row) => number, weight: (r: Row, i: number, x: number) => Weight, shade: number, seg: number, n = 2, axis: 'y' | 'z' = 'y', arc?: readonly [number, number]): void {
    const start = this.pos.length / 3;
    const e = 2 / n;
    const se = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
    // An arc's rings have seg + 1 points and don't close.
    const pts = arc ? seg + 1 : seg;
    rows.forEach((r, i) => {
      const x0 = cx(r);
      for (let j = 0; j < pts; j++) {
        const t = arc ? arc[0] + ((arc[1] - arc[0]) * j) / seg : (j / seg) * Math.PI * 2;
        const c = se(Math.cos(t));
        const s = se(Math.sin(t));
        const [b0, b1, w] = weight(r, i, x0 + r[1] * c);
        if (axis === 'y') this.pos.push(x0 + r[1] * c, r[0], r[3] + r[2] * s);
        else this.pos.push(x0 + r[1] * c, r[3] - r[2] * s, r[0]);
        this.b0.push(b0);
        this.b1.push(b1);
        this.w.push(w);
        this.shade.push(shade);
      }
    });
    // (a, c, b), (a, d, c) faces outward: round each ring x turns towards z (axis y) or towards -y
    // (axis z), the opposite sense to the stacking axis.
    for (let k = 0; k + 1 < rows.length; k++) {
      for (let j = 0; j < seg; j++) {
        const a = start + k * pts + j;
        const b = start + k * pts + ((j + 1) % pts);
        const c = start + (k + 1) * pts + ((j + 1) % pts);
        const d = start + (k + 1) * pts + j;
        this.idx.push(a, c, b, a, d, c);
      }
    }
  }

  build(pivot: readonly V3[], armOut: number, mirror = 0): Template {
    const pos = new Float32Array(this.pos);
    const nor = new Float32Array(pos.length);
    const I = this.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) {
        nor[o] += nx;
        nor[o + 1] += ny;
        nor[o + 2] += nz;
      }
    }
    for (let i = 0; i < nor.length; i += 3) {
      const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
      nor[i] /= l;
      nor[i + 1] /= l;
      nor[i + 2] /= l;
    }
    return {
      pos,
      nor,
      mirror,
      b0: new Uint8Array(this.b0),
      b1: new Uint8Array(this.b1),
      w: new Float32Array(this.w),
      shade: new Float32Array(this.shade),
      idx: new Uint32Array(this.idx),
      pivot,
      armOut,
    };
  }
}

export const one = (b: number): Weight => [b, b, 1];
export const blend = (a: number, b: number, w: number): Weight => [a, b, w];

/** Proportions of a body type. Rows are in metres for that body; ys scales the man's heights. */
export interface Proportions {
  /** Vertical scale against the man's 1.72 m (heights in the shared rows are the man's). */
  readonly ys: number;
  /** Torso rows (heights already this body's). */
  readonly torso: readonly Row[];
  /** Leg and arm girth against the man's. */
  readonly leg: number;
  readonly arm: number;
  /** Hip joint, shoulder, elbow and wrist x (this body's metres). */
  readonly hipX: number;
  readonly shoulderX: number;
  readonly elbowX: number;
  readonly wristX: number;
  /** Head size against the man's. */
  readonly head: number;
}

export const MAN_TORSO: readonly Row[] = [
  [0.8, 0.075, 0.07, 0],
  [0.84, 0.14, 0.1, -0.005],
  [0.9, 0.168, 0.112, -0.012],
  [0.98, 0.158, 0.105, -0.006],
  [1.06, 0.142, 0.095, 0.004],
  [1.16, 0.15, 0.102, 0.012],
  [1.26, 0.166, 0.112, 0.018],
  [1.35, 0.18, 0.108, 0.012],
  [1.42, 0.178, 0.09, 0],
  [1.465, 0.12, 0.072, -0.008],
  [1.5, 0.058, 0.055, -0.012],
];
export const WOMAN_TORSO: readonly Row[] = [
  [0.8, 0.07, 0.065, 0],
  [0.84, 0.14, 0.1, -0.008],
  [0.9, 0.165, 0.112, -0.016],
  [0.98, 0.15, 0.1, -0.008],
  [1.06, 0.118, 0.085, 0.002],
  [1.16, 0.125, 0.09, 0.008],
  [1.25, 0.14, 0.108, 0.026],
  [1.32, 0.148, 0.098, 0.016],
  [1.4, 0.152, 0.082, 0],
  [1.455, 0.1, 0.065, -0.008],
  [1.5, 0.05, 0.048, -0.012],
];
export const scaleRows = (rows: readonly Row[], ys: number, xs: number): Row[] => rows.map(([y, a, b, z]) => [y * ys, a * xs, b * xs, z * xs]);

export const PROPORTIONS: Record<Body, Proportions> = {
  man: { ys: 1, torso: MAN_TORSO, leg: 1, arm: 1, hipX: 0.092, shoulderX: 0.19, elbowX: 0.215, wristX: 0.235, head: 1 },
  woman: { ys: 0.93, torso: scaleRows(WOMAN_TORSO, 0.93, 1), leg: 0.95, arm: 0.84, hipX: 0.088, shoulderX: 0.165, elbowX: 0.19, wristX: 0.205, head: 0.94 },
  child: { ys: 0.6, torso: scaleRows(MAN_TORSO, 0.6, 0.64), leg: 0.66, arm: 0.64, hipX: 0.058, shoulderX: 0.12, elbowX: 0.135, wristX: 0.145, head: 0.8 },
  elder: { ys: 0.95, torso: scaleRows(MAN_TORSO, 0.95, 0.95), leg: 0.92, arm: 0.92, hipX: 0.088, shoulderX: 0.18, elbowX: 0.205, wristX: 0.222, head: 0.96 },
  // The man's builds. A fat man's legs stand wider apart and his arms hang further out, round a belly; a lean one's closer.
  // ys: 1.72 m times it (stout 1.65, portly 1.67, lean 1.77, tall 1.87, short 1.55, bulky 1.80).
  stout: { ys: 0.96, torso: scaleRows(MAN_TORSO, 0.96, 1.25), leg: 1.4, arm: 1.45, hipX: 0.14, shoulderX: 0.222, elbowX: 0.31, wristX: 0.335, head: 1.04 },
  portly: { ys: 0.97, torso: scaleRows(MAN_TORSO, 0.97, 1.1), leg: 1.1, arm: 1.12, hipX: 0.1, shoulderX: 0.2, elbowX: 0.235, wristX: 0.258, head: 1.02 },
  lean: { ys: 1.03, torso: scaleRows(MAN_TORSO, 1.03, 0.88), leg: 0.86, arm: 0.84, hipX: 0.082, shoulderX: 0.172, elbowX: 0.192, wristX: 0.208, head: 0.98 },
  tall: { ys: 1.09, torso: scaleRows(MAN_TORSO, 1.09, 0.96), leg: 0.96, arm: 0.95, hipX: 0.09, shoulderX: 0.188, elbowX: 0.21, wristX: 0.228, head: 0.97 },
  short: { ys: 0.9, torso: scaleRows(MAN_TORSO, 0.9, 1.02), leg: 1.02, arm: 1.0, hipX: 0.092, shoulderX: 0.19, elbowX: 0.215, wristX: 0.235, head: 1.06 },
  bulky: { ys: 1.05, torso: scaleRows(MAN_TORSO, 1.05, 1.22), leg: 1.25, arm: 1.2, hipX: 0.108, shoulderX: 0.258, elbowX: 0.3, wristX: 0.318, head: 1.0 },
  // The woman's builds (the bust and the hips are each their own size: mobShape.ts BUILD_FIGURE).
  w_petite: { ys: 0.86, torso: scaleRows(WOMAN_TORSO, 0.86, 1), leg: 0.9, arm: 0.8, hipX: 0.082, shoulderX: 0.155, elbowX: 0.178, wristX: 0.192, head: 0.96 },
  w_slim: { ys: 0.95, torso: scaleRows(WOMAN_TORSO, 0.95, 1), leg: 0.88, arm: 0.76, hipX: 0.084, shoulderX: 0.158, elbowX: 0.181, wristX: 0.196, head: 0.94 },
  w_tall: { ys: 1.0, torso: scaleRows(WOMAN_TORSO, 1.0, 1), leg: 0.95, arm: 0.84, hipX: 0.09, shoulderX: 0.17, elbowX: 0.195, wristX: 0.21, head: 0.92 },
  w_curvy: { ys: 0.94, torso: scaleRows(WOMAN_TORSO, 0.94, 1), leg: 1.0, arm: 0.86, hipX: 0.095, shoulderX: 0.168, elbowX: 0.194, wristX: 0.21, head: 0.94 },
  w_busty: { ys: 0.94, torso: scaleRows(WOMAN_TORSO, 0.94, 1), leg: 0.95, arm: 0.86, hipX: 0.09, shoulderX: 0.168, elbowX: 0.194, wristX: 0.21, head: 0.94 },
  w_pear: { ys: 0.93, torso: scaleRows(WOMAN_TORSO, 0.93, 1), leg: 1.02, arm: 0.8, hipX: 0.1, shoulderX: 0.16, elbowX: 0.185, wristX: 0.2, head: 0.94 },
  w_plump: { ys: 0.92, torso: scaleRows(WOMAN_TORSO, 0.92, 1.2), leg: 1.12, arm: 1.0, hipX: 0.105, shoulderX: 0.18, elbowX: 0.215, wristX: 0.235, head: 0.96 },
  w_flat: { ys: 0.93, torso: scaleRows(WOMAN_TORSO, 0.93, 1), leg: 0.92, arm: 0.8, hipX: 0.086, shoulderX: 0.162, elbowX: 0.186, wristX: 0.2, head: 0.94 },
  w_heavy: { ys: 0.92, torso: scaleRows(WOMAN_TORSO, 0.92, 1.45), leg: 1.3, arm: 1.18, hipX: 0.12, shoulderX: 0.195, elbowX: 0.275, wristX: 0.3, head: 1.0 },
  // The old: an elder man's three (frail, stout, tall) and an elder woman's two (slight, plump).
  e_frail: { ys: 0.92, torso: scaleRows(MAN_TORSO, 0.92, 0.88), leg: 0.8, arm: 0.78, hipX: 0.082, shoulderX: 0.165, elbowX: 0.188, wristX: 0.204, head: 0.98 },
  e_stout: { ys: 0.94, torso: scaleRows(MAN_TORSO, 0.94, 1.2), leg: 1.2, arm: 1.2, hipX: 0.115, shoulderX: 0.2, elbowX: 0.27, wristX: 0.295, head: 1.02 },
  e_tall: { ys: 1.02, torso: scaleRows(MAN_TORSO, 1.02, 0.92), leg: 0.9, arm: 0.86, hipX: 0.088, shoulderX: 0.176, elbowX: 0.2, wristX: 0.216, head: 0.97 },
  w_elder: { ys: 0.88, torso: scaleRows(WOMAN_TORSO, 0.88, 0.95), leg: 0.9, arm: 0.78, hipX: 0.085, shoulderX: 0.155, elbowX: 0.178, wristX: 0.192, head: 0.95 },
  w_elder_plump: { ys: 0.89, torso: scaleRows(WOMAN_TORSO, 0.89, 1.2), leg: 1.1, arm: 0.98, hipX: 0.1, shoulderX: 0.172, elbowX: 0.205, wristX: 0.225, head: 0.97 },
};

/** A body's joints (one per bone, the root at the feet) and its bind pose's arm angle away from the body. */
export function pivotsOf(body: Body): { pivot: V3[]; armOut: number } {
  const P = PROPORTIONS[body];
  const ys = P.ys;
  const pivot: V3[] = [
    [0, 0.95 * ys, 0],
    [0, 1.06 * ys, 0],
    [0, 1.5 * ys, -0.01],
    [-P.hipX, 0.9 * ys, 0],
    [-P.hipX * 0.93, 0.47 * ys, 0],
    [P.hipX, 0.9 * ys, 0],
    [P.hipX * 0.93, 0.47 * ys, 0],
    [-P.shoulderX, 1.42 * ys, -0.01],
    [-P.elbowX, 1.13 * ys, -0.02],
    [P.shoulderX, 1.42 * ys, -0.01],
    [P.elbowX, 1.13 * ys, -0.02],
    [0, 0, 0],
    [-P.hipX * 0.88, 0.08 * ys, 0],
    [P.hipX * 0.88, 0.08 * ys, 0],
  ];
  return { pivot, armOut: Math.atan2(P.wristX - P.shoulderX, (1.42 - 0.865) * ys) };
}
