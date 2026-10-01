import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import { hash, rng, u01, type Rng } from '../../core/hash';
import type { CellPlan3, Road3 } from '../district/plan';
import { propDist, type CellDetail } from './props';
import { toGeometry, type RawGeometry } from './rawGeometry';
import { CITY_PEOPLE, DISTRICT_PEOPLE, OUTFITS, pickOutfit, type Outfit, type PeopleMix } from '../district/peopleMix';

export type { Outfit } from '../district/peopleMix';

/**
 * The mob: the city's passers-by as faint, dark, see-through figures (after COM3D2's "transparent man"),
 * there to show where life is, not to be looked at. Story characters are a separate, modelled cast.
 *
 * Each body type (man, woman, child, elder) with each hair and long coat or skirt is a template built once:
 * lofted cross-sections for the torso, legs, feet, arms, hands and head, bound to an eleven-bone skeleton,
 * in its bind pose. The figures are posed and animated on the GPU: the material's vertex shader rebuilds the
 * skeleton from a few numbers per figure (body, pose, facing, look, walk) and the time, so walkers walk their
 * stretch of pavement, everyone else breathes, shifts their weight and looks about, and talkers gesture.
 * The streets' crowds are drawn instanced, one draw per template for everyone in range (real/crowd.ts, from
 * `packFigures`); set pieces and story NPCs bake their few figures into a mesh with the same attributes
 * (`GhostBuilder`), so one material serves both.
 *
 * The material draws them in the opaque pass with alpha-to-coverage on the MSAA target, so only the
 * nearest surface of a figure shows (no inner seams where parts overlap, no sorting) and the alpha is
 * dithered while fading. Each figure fades in and out on its own slow cycle (a walker: in at the start of
 * its walk, out at the end), fades with distance and as you walk into it; story NPCs (`fade: false`) stay.
 * At night the street lightmap lights them, so they show under lamps and by the neon.
 */

type V3 = [number, number, number];

export type Body = 'man' | 'woman' | 'child' | 'elder';
export type Pose = 'stand' | 'walk' | 'talk' | 'phone' | 'pockets' | 'wave' | 'hold';
export type Hair = 'short' | 'long' | 'bun' | 'hat' | 'cap' | 'none';

export interface FigureSpec {
  readonly x: number;
  readonly z: number;
  /** Facing, radians: 0 faces +z (south); positive turns towards +x. */
  readonly yaw: number;
  readonly body: Body;
  readonly pose: Pose;
  /** Linear colour; bright colours are darkened to the mob's shades. */
  readonly color: V3;
  readonly hair: Hair;
  /** A skirt (women) or a long coat (men): the 'long' outfit when `outfit` isn't given. */
  readonly long: boolean;
  /** What they wear (district/peopleMix.ts); else everyday clothes, or 'long' with `long`. */
  readonly outfit?: Outfit;
  /** Walk cycle phase 0-1 (which leg is forward, how far). */
  readonly phase: number;
  /** Which side a talking/waving/holding arm is on: 1 right, -1 left. */
  readonly side: number;
  /** Head turn, radians. */
  readonly look: number;
  /** Height of the floor stood on above the pavement (default 0: on the pavement, 0.15 m above the road). */
  readonly y?: number;
  /** Fades in and out with the crowd (default true); false keeps it there (story NPCs). */
  readonly fade?: boolean;
  /**
   * A walker: walks (ex, ez) metres from where it stands at `speed` m/s, fades out at the end, stays away
   * `gap` seconds and comes back to the start. Without it a figure stands (a 'walk' pose then mid-stride).
   */
  readonly walk?: { readonly ex: number; readonly ez: number; readonly speed: number; readonly gap: number };
  /** The fade cycle's seed (people together share one, so they come and go together); else from where it stands. */
  readonly seed?: number;
}

/** The mob's shades: blacks, charcoal, and dark navy, wine, olive and brown. */
export const GHOST_COLORS: readonly V3[] = [
  [0.018, 0.018, 0.02],
  [0.03, 0.03, 0.034],
  [0.046, 0.046, 0.05],
  [0.016, 0.02, 0.04],
  [0.04, 0.016, 0.02],
  [0.026, 0.03, 0.02],
  [0.04, 0.03, 0.022],
  [0.06, 0.06, 0.064],
];

/** A colour as one of the mob's shades: dark ones kept, bright ones (old content) darkened and greyed. */
function mobShade(c: V3): V3 {
  const m = Math.max(c[0], c[1], c[2]);
  if (m <= 0.08) return c;
  const g = (c[0] + c[1] + c[2]) / 3 / m;
  return [0, 1, 2].map((i) => 0.05 * (0.55 * (c[i] / m) + 0.45 * g)) as V3;
}

// ---- Templates ----

/** Bones: indices into the skeleton. */
const PELVIS = 0, SPINE = 1, HEAD = 2, THIGH_L = 3, SHIN_L = 4, THIGH_R = 5, SHIN_R = 6, ARM_L = 7, FORE_L = 8, ARM_R = 9, FORE_R = 10;
/** Bone 11, the root: only the walk's bob (an umbrella in the hand rides on it). */
const ROOT = 11;
/** The feet (on the shins, held nearly level through the stride so the toes don't dig in). */
const FOOT_L = 12, FOOT_R = 13;
const BONES = 14;
const PARENT = [-1, PELVIS, SPINE, PELVIS, THIGH_L, PELVIS, THIGH_R, SPINE, ARM_L, SPINE, ARM_R, -1, SHIN_L, SHIN_R];
/** How much of the leg's pitch a foot takes back (1: level; a little less, a toe-off behind and a heel strike ahead). */
const FOOT_LEVEL = 0.85;

/** A body template in its bind pose (figure frame: x right, y up, z forward, feet at y 0). */
interface Template {
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
type Row = readonly [number, number, number, number];
type Weight = readonly [number, number, number];

class TemplateBuilder {
  pos: number[] = [];
  b0: number[] = [];
  b1: number[] = [];
  w: number[] = [];
  shade: number[] = [];
  idx: number[] = [];

  /**
   * A loft through rings, each `seg` points round a superellipse (exponent n: 2 an ellipse, more boxy).
   * Axis 'y': horizontal rings, listed bottom to top, at (cx(y), y, z). Axis 'z': upright rings (feet),
   * listed back to front, with Row read as [z, half width, half height, y].
   */
  loft(rows: readonly Row[], cx: (r: Row) => number, weight: (r: Row, i: number) => Weight, shade: number, seg: number, n = 2, axis: 'y' | 'z' = 'y'): void {
    const start = this.pos.length / 3;
    const e = 2 / n;
    const se = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
    rows.forEach((r, i) => {
      const [b0, b1, w] = weight(r, i);
      const x0 = cx(r);
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        const c = se(Math.cos(t));
        const s = se(Math.sin(t));
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
        const a = start + k * seg + j;
        const b = start + k * seg + ((j + 1) % seg);
        const c = start + (k + 1) * seg + ((j + 1) % seg);
        const d = start + (k + 1) * seg + j;
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

const one = (b: number): Weight => [b, b, 1];
const blend = (a: number, b: number, w: number): Weight => [a, b, w];

/** Proportions of a body type. Rows are in metres for that body; ys scales the man's heights. */
interface Proportions {
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

const MAN_TORSO: readonly Row[] = [
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
const WOMAN_TORSO: readonly Row[] = [
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
const scaleRows = (rows: readonly Row[], ys: number, xs: number): Row[] => rows.map(([y, a, b, z]) => [y * ys, a * xs, b * xs, z * xs]);

const PROPORTIONS: Record<Body, Proportions> = {
  man: { ys: 1, torso: MAN_TORSO, leg: 1, arm: 1, hipX: 0.092, shoulderX: 0.19, elbowX: 0.215, wristX: 0.235, head: 1 },
  woman: { ys: 0.93, torso: scaleRows(WOMAN_TORSO, 0.93, 1), leg: 0.95, arm: 0.84, hipX: 0.088, shoulderX: 0.165, elbowX: 0.19, wristX: 0.205, head: 0.94 },
  child: { ys: 0.6, torso: scaleRows(MAN_TORSO, 0.6, 0.64), leg: 0.66, arm: 0.64, hipX: 0.058, shoulderX: 0.12, elbowX: 0.135, wristX: 0.145, head: 0.8 },
  elder: { ys: 0.95, torso: scaleRows(MAN_TORSO, 0.95, 0.95), leg: 0.92, arm: 0.92, hipX: 0.088, shoulderX: 0.18, elbowX: 0.205, wristX: 0.222, head: 0.96 },
};

// The man's limbs and head; the others are scaled from these.
const LEG: readonly Row[] = [
  [0.06, 0.004, 0.004, -0.005],
  [0.08, 0.03, 0.034, -0.005],
  [0.16, 0.036, 0.04, -0.01],
  [0.28, 0.048, 0.056, -0.016],
  [0.37, 0.052, 0.06, -0.014],
  [0.47, 0.05, 0.054, 0],
  [0.55, 0.058, 0.062, 0.004],
  [0.68, 0.07, 0.075, 0.006],
  [0.8, 0.082, 0.085, 0.002],
  [0.92, 0.088, 0.09, -0.004],
];
/** Rows along z: [z, half width, half height, centre y]. */
const FOOT: readonly Row[] = [
  [-0.06, 0.012, 0.015, 0.05],
  [-0.045, 0.034, 0.038, 0.05],
  [0, 0.04, 0.045, 0.055],
  [0.07, 0.044, 0.035, 0.045],
  [0.14, 0.042, 0.025, 0.032],
  [0.185, 0.03, 0.018, 0.024],
  [0.2, 0.004, 0.004, 0.022],
];
const ARM: readonly Row[] = [
  [0.865, 0.024, 0.03, 0],
  [0.94, 0.031, 0.036, -0.004],
  [1.03, 0.038, 0.042, -0.012],
  [1.13, 0.036, 0.04, -0.02],
  [1.22, 0.042, 0.046, -0.016],
  [1.32, 0.047, 0.052, -0.012],
  [1.39, 0.054, 0.058, -0.01],
  [1.43, 0.045, 0.05, -0.01],
  [1.45, 0.005, 0.005, -0.01],
];
/** A mitten hand, flat across the palm (palm towards the thigh). */
const HAND: readonly Row[] = [
  [0.68, 0.004, 0.004, 0.012],
  [0.7, 0.01, 0.02, 0.012],
  [0.74, 0.015, 0.036, 0.01],
  [0.79, 0.017, 0.042, 0.006],
  [0.83, 0.016, 0.036, 0.004],
  [0.865, 0.02, 0.028, 0],
];
const NECK: readonly Row[] = [
  [1.47, 0.054, 0.052, -0.012],
  [1.53, 0.05, 0.048, -0.008],
  [1.58, 0.046, 0.046, -0.002],
];
/** Head rows from the neck joint (y 1.5): an egg with a jaw and the back of the skull. */
const HEAD_ROWS: readonly Row[] = [
  [-0.025, 0.01, 0.01, 0.055],
  [-0.012, 0.038, 0.035, 0.045],
  [0.02, 0.06, 0.07, 0.022],
  [0.06, 0.07, 0.09, 0.008],
  [0.1, 0.075, 0.098, 0],
  [0.145, 0.078, 0.1, -0.008],
  [0.185, 0.07, 0.09, -0.014],
  [0.21, 0.05, 0.066, -0.016],
  [0.222, 0.02, 0.028, -0.016],
  [0.226, 0.002, 0.002, -0.016],
];
const HAIR_SHORT: readonly Row[] = [
  [0.085, 0.074, 0.088, -0.03],
  [0.12, 0.081, 0.104, -0.012],
  [0.16, 0.084, 0.106, -0.008],
  [0.195, 0.076, 0.096, -0.012],
  [0.218, 0.054, 0.07, -0.016],
  [0.232, 0.022, 0.03, -0.016],
  [0.236, 0.002, 0.002, -0.016],
];
/** Long hair down the back, from between the shoulder blades up into the short cap. */
const HAIR_LONG: readonly Row[] = [
  [-0.14, 0.004, 0.004, -0.075],
  [-0.13, 0.07, 0.03, -0.072],
  [-0.05, 0.085, 0.04, -0.07],
  [0.03, 0.088, 0.05, -0.06],
  [0.1, 0.084, 0.07, -0.04],
];
const BUN: readonly Row[] = [
  [0.16, 0.003, 0.003, -0.09],
  [0.17, 0.035, 0.03, -0.095],
  [0.2, 0.048, 0.042, -0.1],
  [0.23, 0.035, 0.03, -0.095],
  [0.24, 0.003, 0.003, -0.09],
];
const FEDORA: readonly Row[] = [
  [0.158, 0.09, 0.1, -0.008],
  [0.16, 0.15, 0.165, -0.008],
  [0.17, 0.15, 0.165, -0.008],
  [0.172, 0.088, 0.1, -0.008],
  [0.25, 0.08, 0.095, -0.012],
  [0.262, 0.002, 0.002, -0.012],
];
const CAP: readonly Row[] = [
  [0.13, 0.083, 0.105, -0.014],
  [0.17, 0.087, 0.108, -0.01],
  [0.205, 0.078, 0.098, -0.012],
  [0.23, 0.05, 0.064, -0.016],
  [0.242, 0.002, 0.002, -0.016],
];
const VISOR: readonly Row[] = [
  [0.135, 0.002, 0.002, 0.1],
  [0.136, 0.072, 0.06, 0.1],
  [0.146, 0.072, 0.06, 0.1],
  [0.147, 0.002, 0.002, 0.1],
];
/** A skirt and a long coat, in the man's heights. */
const SKIRT: readonly Row[] = [
  [0.5, 0.2, 0.18, 0.01],
  [0.7, 0.175, 0.15, 0],
  [0.9, 0.16, 0.12, -0.01],
  [1.02, 0.13, 0.092, 0],
  [1.04, 0.12, 0.088, 0],
];
const COAT: readonly Row[] = [
  [0.42, 0.21, 0.16, 0],
  [0.7, 0.19, 0.14, 0],
  [0.9, 0.185, 0.13, -0.01],
  [1.06, 0.165, 0.115, 0],
  [1.26, 0.18, 0.125, 0.015],
  [1.4, 0.19, 0.105, 0],
  [1.46, 0.12, 0.08, -0.008],
  [1.49, 0.07, 0.065, -0.012],
];

/** The outfits' garments, in the man's heights (rows scaled to each body like the skirt and coat). */
const MAID_SKIRT: readonly Row[] = [
  [0.6, 0.235, 0.215, 0.02],
  [0.64, 0.24, 0.22, 0.02],
  [0.8, 0.205, 0.175, 0.01],
  [0.95, 0.16, 0.12, 0],
  [1.04, 0.125, 0.09, 0],
  [1.06, 0.12, 0.088, 0],
];
const PLEATS: readonly Row[] = [
  [0.6, 0.2, 0.17, 0.01],
  [0.64, 0.198, 0.168, 0.01],
  [0.85, 0.17, 0.13, 0],
  [1.0, 0.13, 0.095, 0],
  [1.04, 0.12, 0.088, 0],
];
const PENCIL: readonly Row[] = [
  [0.48, 0.13, 0.1, 0],
  [0.5, 0.135, 0.105, 0],
  [0.85, 0.165, 0.115, -0.01],
  [1.0, 0.13, 0.092, 0],
  [1.04, 0.12, 0.088, 0],
];
const ROBE: readonly Row[] = [
  [0.07, 0.13, 0.11, 0.01],
  [0.1, 0.14, 0.115, 0.01],
  [0.35, 0.155, 0.12, 0.01],
  [0.65, 0.168, 0.125, 0],
  [0.9, 0.172, 0.12, -0.005],
  [1.0, 0.16, 0.11, 0],
];
const OBI: readonly Row[] = [
  [0.97, 0.168, 0.118, 0],
  [0.99, 0.172, 0.122, 0],
  [1.16, 0.168, 0.12, 0.01],
  [1.18, 0.16, 0.112, 0.01],
];
/** Hanging kimono sleeves on the arm: deep front to back, down past the wrist. */
const SLEEVE: readonly Row[] = [
  [0.82, 0.03, 0.07, -0.03],
  [0.85, 0.05, 0.12, -0.03],
  [1.12, 0.052, 0.13, -0.02],
  [1.2, 0.046, 0.08, -0.015],
  [1.25, 0.035, 0.045, -0.01],
];
const PUFF: readonly Row[] = [
  [1.27, 0.03, 0.035, -0.01],
  [1.3, 0.066, 0.07, -0.01],
  [1.38, 0.072, 0.076, -0.01],
  [1.44, 0.05, 0.055, -0.01],
];
/** A case hanging from the left hand (briefcase or school bag): [y, half thickness, half length, z]. */
const CASE: readonly Row[] = [
  [0.4, 0.028, 0.17, 0.02],
  [0.42, 0.034, 0.19, 0.02],
  [0.64, 0.034, 0.19, 0.02],
  [0.66, 0.028, 0.17, 0.02],
];
/** White garments (apron, collar, shirt, obi) are lighter shades of the figure's dark: still dark, readable. */
const WHITE = 3.6;

/** Which outfits a body wears (others fall back to everyday clothes). */
const wears = (b: Body, o: Outfit): boolean => o === 'plain' || (o === 'maid' ? b === 'woman' : o === 'school' ? b !== 'elder' : b !== 'child');

/** The outfit a figure is drawn in: its own if its body wears it, else 'long' or everyday clothes. */
export function outfitOf(s: Pick<FigureSpec, 'body' | 'long' | 'outfit'>): Outfit {
  const o = s.outfit ?? (s.long ? 'long' : 'plain');
  return wears(s.body, o) ? o : s.long && s.body !== 'child' ? 'long' : 'plain';
}

const templates = new Map<string, Template>();

/** The posable template for a body with its hair and outfit (built once per combination). */
function template(body: Body, hair: Hair, outfit: Outfit): Template {
  const o = wears(body, outfit) ? outfit : 'plain';
  const key = `${body}|${hair}|${o}`;
  let t = templates.get(key);
  if (!t) templates.set(key, (t = buildTemplate(body, hair, o)));
  return t;
}

/** A body's joints (one per bone, the root at the feet) and its bind pose's arm angle away from the body. */
function pivotsOf(body: Body): { pivot: V3[]; armOut: number } {
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

function buildTemplate(body: Body, hair: Hair, outfit: Outfit): Template {
  const P = PROPORTIONS[body];
  const ys = P.ys;
  const tb = new TemplateBuilder();
  const neckY = 1.5 * ys;
  const hk = P.head;
  const { pivot, armOut } = pivotsOf(body);
  const long = outfit === 'long';
  // Legs: bare-ish under a skirt, dark stockings under a maid's dress, trousers otherwise.
  const legs = outfit === 'maid' ? 0.6 : body === 'woman' && outfit !== 'plain' ? 0.9 : 0.82;
  const top = 1;
  // Torso: hips on the pelvis, the chest on the spine, blended at the waist.
  const waist = 1.06 * ys;
  tb.loft(P.torso, () => 0, (r) => (r[0] < waist - 0.01 ? one(PELVIS) : r[0] > waist + 0.01 ? one(SPINE) : blend(SPINE, PELVIS, 0.5)), top, 12, 2.4);
  tb.loft(scaleRows(NECK, ys, P.arm), () => 0, (_, i) => (i === 0 ? one(SPINE) : i === 1 ? blend(HEAD, SPINE, 0.5) : one(HEAD)), top, 8);
  // Head, hair and hats on the head bone, from the neck joint.
  const headRows = (rows: readonly Row[]): Row[] => rows.map(([y, a, b, z]) => [neckY + y * hk, a * hk, b * hk, z * hk]);
  tb.loft(headRows(HEAD_ROWS), () => 0, () => one(HEAD), top, 10, 2.1);
  const hairShade = 0.6;
  if (hair === 'short' || hair === 'long' || hair === 'bun') tb.loft(headRows(HAIR_SHORT), () => 0, () => one(HEAD), hairShade, 10, 2.1);
  if (hair === 'long') tb.loft(headRows(HAIR_LONG), () => 0, (r) => (r[0] < neckY ? one(SPINE) : one(HEAD)), hairShade, 8, 2.6);
  if (hair === 'bun') tb.loft(headRows(BUN), () => 0, () => one(HEAD), hairShade, 8);
  if (hair === 'hat') tb.loft(headRows(FEDORA), () => 0, () => one(HEAD), hairShade, 12);
  if (hair === 'cap') {
    tb.loft(headRows(CAP), () => 0, () => one(HEAD), hairShade, 10, 2.1);
    tb.loft(headRows(VISOR), () => 0, () => one(HEAD), hairShade, 8);
  }
  // Legs and feet.
  const knee = 0.47 * ys;
  for (const [s, thigh, shin, foot] of [[-1, THIGH_L, SHIN_L, FOOT_L], [1, THIGH_R, SHIN_R, FOOT_R]] as const) {
    const rows = LEG.map(([y, a, b, z]): Row => [y * ys, a * P.leg, b * P.leg, z * P.leg]);
    const x = (r: Row): number => s * P.hipX * (0.86 + 0.14 * (r[0] / (0.92 * ys)));
    tb.loft(rows, x, (r, i) => (i === rows.length - 1 ? blend(thigh, PELVIS, 0.6) : r[0] > knee + 0.04 * ys ? one(thigh) : r[0] < knee - 0.06 * ys ? one(shin) : blend(thigh, shin, 0.5)), legs, 8);
    const feet = FOOT.map(([z, a, h, y]): Row => [z * P.leg, a * P.leg, h * P.leg, y * P.leg]);
    tb.loft(feet, () => s * P.hipX * 0.88, () => one(foot), legs * 0.8, 8, 2.4, 'z');
  }
  // Arms and hands, hanging a little out from the body.
  const ax = (y: number): number =>
    y >= 1.42 ? P.shoulderX * 0.97 : y >= 1.13 ? P.elbowX + ((y - 1.13) / 0.29) * (P.shoulderX - P.elbowX) : P.wristX + ((y - 0.865) / 0.265) * (P.elbowX - P.wristX);
  for (const [s, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) {
    const rows = ARM.map(([y, a, b, z]): Row => [y * ys, a * P.arm, b * P.arm, z * P.arm]);
    tb.loft(rows, (r) => s * ax(r[0] / ys), (r, i) => (i >= rows.length - 2 ? blend(arm, SPINE, 0.6) : r[0] > 1.18 * ys ? one(arm) : r[0] < 1.08 * ys ? one(fore) : blend(arm, fore, 0.5)), top, 8);
    const hand = HAND.map(([y, a, b, z]): Row => [y * ys, a * P.arm, b * P.arm, z]);
    tb.loft(hand, () => s * (P.wristX + 0.003), () => one(fore), top, 8);
  }
  const hips = (r: Row): Weight => (r[0] < waist - 0.02 ? one(PELVIS) : r[0] > waist + 0.08 ? one(SPINE) : blend(SPINE, PELVIS, 0.5));
  if (long) {
    const rows = scaleRows(body === 'woman' ? SKIRT : COAT, ys, body === 'woman' ? 0.95 : P.arm);
    tb.loft(rows, () => 0, hips, body === 'woman' ? 0.85 : 0.9, 14, 2.2);
  }
  // The torso's section at a height (this body's rows): half width, half depth, centre z.
  const torsoAt = (y: number): [number, number, number] => {
    const T = P.torso;
    let i = 0;
    while (i < T.length - 2 && T[i + 1][0] < y) i++;
    const a = T[i], b = T[i + 1];
    const k = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
  };
  /** A thin panel over the torso's front (side 1) or back (-1), between two heights (man's), narrowing by `w`. */
  const panel = (y0: number, y1: number, w: (y: number) => number, side: number, shade: number, off = 0.004): void => {
    const rows: Row[] = [];
    for (let i = 0; i <= 4; i++) {
      const y = (y0 + ((y1 - y0) * i) / 4) * ys;
      const [, d, z] = torsoAt(y);
      rows.push([y, w(y / ys) * (body === 'child' ? 0.64 : 1), 0.007, z + side * (d + off + 0.007)]);
    }
    tb.loft(rows, () => 0, (r) => (r[0] > waist ? one(SPINE) : one(PELVIS)), shade, 8, 6);
  };
  /** A case in the left hand (a briefcase, a school bag), `k` its size. */
  const caseInHand = (k: number): void => tb.loft(CASE.map(([y, a, b, z]): Row => [y * ys, a, b * k, z]), () => -(P.wristX + 0.012), () => one(FORE_L), 1.3, 8, 6);
  const armRows = (rows: readonly Row[], s: number, shade: number, arm: number, fore: number): void =>
    tb.loft(rows.map(([y, a, b, z]): Row => [y * ys, a * P.arm, b * P.arm, z * P.arm]), (r) => s * ax(r[0] / ys), (r) => (r[0] > 1.18 * ys ? one(arm) : one(fore)), shade, 8);
  if (outfit === 'suit') {
    if (body === 'woman') {
      tb.loft(scaleRows(PENCIL, ys, 0.95), () => 0, hips, 0.95, 14, 2.4);
      // A shoulder bag at the left hip.
      tb.loft([[0.84 * ys, 0.03, 0.11, 0], [0.86 * ys, 0.034, 0.12, 0], [1.0 * ys, 0.034, 0.12, 0], [1.02 * ys, 0.03, 0.11, 0]], () => -(P.hipX + 0.115), () => one(PELVIS), 1.3, 8, 6);
    } else {
      // The jacket's skirt over the hips, a little proud of the body.
      const rows: Row[] = [0.82, 0.86, 0.92, 0.99, 1.06].map((y) => {
        const [w, d, z] = torsoAt(y * ys);
        return [y * ys, w * 1.05 + 0.012, d * 1.05 + 0.012, z];
      });
      tb.loft(rows, () => 0, hips, 1, 12, 2.4);
      caseInHand(1);
    }
    // The shirt's V at the collar and a dark tie down it.
    panel(1.24, 1.46, (y) => 0.012 + (y - 1.24) * 0.22, 1, WHITE);
    if (body !== 'woman') panel(1.06, 1.42, () => 0.014, 1, 0.45, 0.012);
  } else if (outfit === 'maid') {
    const skirt = scaleRows(MAID_SKIRT, ys, 0.95);
    tb.loft(skirt, () => 0, hips, 1, 14, 2.2);
    // The apron over the skirt's front, and its bib up the chest; the frilled headband; puffed sleeves.
    const apron = skirt.filter((r) => r[0] > 0.62 * ys && r[0] < 1.02 * ys).map(([y, w, d, z]): Row => [y, w * 0.62, 0.008, z + d + 0.01]);
    tb.loft(apron, () => 0, hips, WHITE, 8, 6);
    panel(1.06, 1.32, () => 0.07, 1, WHITE);
    tb.loft(headRows([[0.158, 0.09, 0.112, -0.008], [0.182, 0.088, 0.108, -0.01]]), () => 0, () => one(HEAD), WHITE, 12, 2.1);
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) armRows(PUFF, sd, 1, arm, fore);
  } else if (outfit === 'school') {
    if (body === 'woman') {
      tb.loft(scaleRows(PLEATS, ys, 0.95), () => 0, hips, 1, 16, 3.5);
      // The sailor collar's flap down the back, and the scarf at the front.
      panel(1.33, 1.47, () => 0.13, -1, WHITE);
      panel(1.27, 1.34, () => 0.035, 1, WHITE);
    }
    if (body === 'child') {
      // The randoseru on the back.
      const yb = [0.6, 0.62, 0.84, 0.86].map((y) => y * ys / 0.6);
      const back = Math.min(...yb.map((y) => torsoAt(y)[2] - torsoAt(y)[1]));
      tb.loft(yb.map((y, i): Row => [y, i % 3 === 0 ? 0.095 : 0.105, i % 3 === 0 ? 0.05 : 0.06, back - 0.06]), () => 0, () => one(SPINE), 1.2, 8, 6);
    } else caseInHand(0.8);
  } else if (outfit === 'kimono') {
    const woman = body === 'woman';
    tb.loft(scaleRows(ROBE, ys, woman ? 0.95 : P.arm), () => 0, () => one(PELVIS), 1, 14, 2.4);
    tb.loft(scaleRows(OBI, ys, woman ? 0.95 : P.arm), () => 0, hips, woman ? 2.6 : 1.3, 14, 2.4);
    if (woman) {
      // The obi's bow on the back.
      const [, d, z] = torsoAt(1.08 * ys);
      tb.loft([1.0, 1.02, 1.16, 1.18].map((y, i): Row => [y * ys, i % 3 === 0 ? 0.11 : 0.13, i % 3 === 0 ? 0.025 : 0.035, z - d - 0.05]), () => 0, () => one(SPINE), 2.6, 8, 6);
    }
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) armRows(SLEEVE, sd, 1, arm, fore);
  }
  return tb.build(pivot, armOut);
}

/**
 * A clear vinyl umbrella (the konbini kind) for a body, held in the right hand (mirrored for the left): a
 * shallow dome over the head, a little forward and toward the hand, and its shaft down to the hand. On the
 * root bone, so it rides the walk's bob.
 */
function buildUmbrella(body: Body): Template {
  const child = body === 'child';
  const k = child ? 0.62 : body === 'woman' ? 0.95 : 1;
  const tb = new TemplateBuilder();
  const cx = 0.1 * k;
  const top = 1.95 * k + 0.25;
  const R = child ? 0.42 : 0.52;
  const prof: [number, number][] = [[top - 0.22, R], [top - 0.14, R * 0.86], [top - 0.05, R * 0.55], [top, R * 0.15], [top + 0.02, 0.005]];
  // Outside, then the underside a little below, wound the other way so it shows from beneath.
  tb.loft(prof.map(([y, r]): Row => [y, r, r, 0.1]), () => cx, () => one(ROOT), 1.6, 12);
  const from = tb.idx.length;
  tb.loft(prof.map(([y, r]): Row => [y - 0.008, r, r, 0.1]), () => cx, () => one(ROOT), 1.6, 12);
  for (let i = from; i < tb.idx.length; i += 3) [tb.idx[i + 1], tb.idx[i + 2]] = [tb.idx[i + 2], tb.idx[i + 1]];
  // The shaft: a thin square tube from the hand up to the canopy.
  const hand: V3 = [0.2 * k, 1.0 * k, 0.15];
  const head: V3 = [cx, top, 0.1];
  const base = tb.pos.length / 3;
  for (const c of [hand, head]) {
    for (let j = 0; j < 4; j++) {
      const q = (j / 4) * Math.PI * 2;
      tb.pos.push(c[0] + Math.cos(q) * 0.008, c[1], c[2] + Math.sin(q) * 0.008);
      tb.b0.push(ROOT);
      tb.b1.push(ROOT);
      tb.w.push(1);
      tb.shade.push(1.6);
    }
  }
  for (let j = 0; j < 4; j++) {
    const j1 = (j + 1) % 4;
    tb.idx.push(base + j, base + 4 + j1, base + j1, base + j, base + 4 + j, base + 4 + j1);
  }
  const { pivot, armOut } = pivotsOf(body);
  return tb.build(pivot, armOut, 1);
}

// ---- Posing ----

interface Limb {
  /** Forward swing, radians (positive = forward). */
  swing: number;
  /** Outward raise, radians. */
  raise: number;
  /** Elbow / knee bend, radians (elbow folds forward, knee folds back). */
  bend: number;
  /** The forearm folds up beside the body instead of forward (a wave). */
  up?: boolean;
}

interface Skeleton {
  lean: number;
  drop: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
}

function skeleton(s: FigureSpec): Skeleton {
  const still: Limb = { swing: 0, raise: 0.1, bend: 0.12 };
  const leg: Limb = { swing: 0, raise: 0.0, bend: 0 };
  const sk: Skeleton = { lean: s.body === 'elder' ? 0.2 : 0.02, drop: 0, armL: { ...still }, armR: { ...still }, legL: { ...leg }, legR: { ...leg } };
  const gest = (l: Limb, swing: number, raise: number, bend: number, up = false): void => {
    l.swing = swing;
    l.raise = raise;
    l.bend = bend;
    l.up = up;
  };
  const armS = s.side > 0 ? sk.armR : sk.armL;
  switch (s.pose) {
    case 'walk': {
      const a = Math.sin(s.phase * Math.PI * 2) * 0.36;
      gest(sk.legL, a, 0, 0.06 + 0.24 * Math.min(1, Math.max(0, -a / 0.36)));
      gest(sk.legR, -a, 0, 0.06 + 0.24 * Math.min(1, Math.max(0, a / 0.36)));
      gest(sk.armL, -a * 0.7, 0.1, 0.25);
      gest(sk.armR, a * 0.7, 0.1, 0.25);
      sk.lean += 0.04;
      sk.drop = PROPORTIONS[s.body].ys * 0.9 * (1 - Math.cos(a));
      break;
    }
    case 'talk':
      gest(armS, 0.3, 0.12, 1.25);
      gest(sk.legL, 0.04, 0.04, 0.04);
      gest(sk.legR, -0.04, 0.06, 0.04);
      break;
    case 'phone':
      gest(armS, 0.2, 0.32, 2.5);
      break;
    case 'pockets':
      gest(sk.armL, -0.1, 0.22, 0.45);
      gest(sk.armR, -0.1, 0.22, 0.45);
      break;
    case 'wave':
      gest(armS, 0.15, 1.3, 1.35, true);
      break;
    case 'hold':
      gest(armS, 0.1, s.body === 'child' ? 0.75 : 0.26, 0.1);
      break;
    case 'stand':
      gest(sk.legR, 0.03, 0.06, 0.02);
      break;
  }
  return sk;
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const boneMats = Array.from({ length: BONES }, () => new THREE.Matrix4());
const rot = Array.from({ length: BONES }, () => new THREE.Matrix4());

/** Each bone's matrix (bind pose to posed), in the figure frame. */
function poseBones(T: Template, s: FigureSpec): THREE.Matrix4[] {
  const sk = skeleton(s);
  for (const m of rot) m.identity();
  rot[SPINE].makeRotationX(sk.lean);
  rot[HEAD].makeRotationY(s.look).premultiply(_r.makeRotationX(-sk.lean * 0.7));
  for (const [sgn, l, thigh, shin, foot] of [[-1, sk.legL, THIGH_L, SHIN_L, FOOT_L], [1, sk.legR, THIGH_R, SHIN_R, FOOT_R]] as const) {
    rot[thigh].makeRotationX(-l.swing).multiply(_r.makeRotationZ(sgn * l.raise));
    rot[shin].makeRotationX(l.bend);
    rot[foot].makeRotationX(FOOT_LEVEL * (l.swing - l.bend));
  }
  for (const [sgn, l, arm, fore] of [[-1, sk.armL, ARM_L, FORE_L], [1, sk.armR, ARM_R, FORE_R]] as const) {
    rot[arm].makeRotationX(-l.swing).multiply(_r.makeRotationZ(sgn * (l.raise - T.armOut)));
    if (l.up) rot[fore].makeRotationZ(sgn * l.bend);
    else rot[fore].makeRotationX(-l.bend);
  }
  for (let i = 0; i < BONES; i++) {
    const p = T.pivot[i];
    // local = T(p) R T(-p); world = parent * local.
    _m.makeTranslation(p[0], p[1], p[2]).multiply(rot[i]).multiply(_t.makeTranslation(-p[0], -p[1], -p[2]));
    if (i === PELVIS || i === ROOT) boneMats[i].makeTranslation(0, -sk.drop, 0).multiply(_m);
    else boneMats[i].multiplyMatrices(boneMats[PARENT[i]], _m);
  }
  return boneMats;
}

// ---- Templates by index, and figures as data ----

const BODY_LIST: readonly Body[] = ['man', 'woman', 'child', 'elder'];
const HAIR_LIST: readonly Hair[] = ['short', 'long', 'bun', 'hat', 'cap', 'none'];
const POSE_LIST: readonly Pose[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold'];

/** Body templates are 0 to TEMPLATE_COUNT - 1 (body, outfit, hair); the umbrellas follow, one per body. */
export const TEMPLATE_COUNT = BODY_LIST.length * OUTFITS.length * HAIR_LIST.length;
export const templateIndex = (s: Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit'>): number =>
  (BODY_LIST.indexOf(s.body) * OUTFITS.length + OUTFITS.indexOf(outfitOf(s))) * HAIR_LIST.length + HAIR_LIST.indexOf(s.hair);
export const umbrellaIndex = (body: Body): number => TEMPLATE_COUNT + BODY_LIST.indexOf(body);

function templateAt(i: number): Template {
  if (i >= TEMPLATE_COUNT) {
    const body = BODY_LIST[i - TEMPLATE_COUNT];
    let t = templates.get(`umbrella|${body}`);
    if (!t) templates.set(`umbrella|${body}`, (t = buildUmbrella(body)));
    return t;
  }
  const hair = HAIR_LIST[i % HAIR_LIST.length];
  const outfit = OUTFITS[Math.floor(i / HAIR_LIST.length) % OUTFITS.length];
  return template(BODY_LIST[Math.floor(i / HAIR_LIST.length / OUTFITS.length)], hair, outfit);
}

/** A template's per-vertex attributes (bind pose, bones), as arrays. */
function templateArrays(T: Template): { position: Float32Array; normal: Float32Array; aShade: Float32Array; aBone: Float32Array; aMirror: Float32Array } {
  const n = T.pos.length / 3;
  const aBone = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    aBone[i * 3] = T.b0[i];
    aBone[i * 3 + 1] = T.b1[i];
    aBone[i * 3 + 2] = T.w[i];
  }
  return { position: T.pos, normal: T.nor, aShade: T.shade, aBone, aMirror: new Float32Array(n).fill(T.mirror) };
}

const geometries = new Map<number, THREE.BufferGeometry>();

/** A template as geometry (its bind pose and bones), shared by every figure drawn with it (real/crowd.ts). */
export function templateGeometry(i: number): THREE.BufferGeometry {
  let g = geometries.get(i);
  if (g) return g;
  const T = templateAt(i);
  const a = templateArrays(T);
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.setAttribute('aShade', new THREE.BufferAttribute(a.aShade, 1));
  g.setAttribute('aBone', new THREE.BufferAttribute(a.aBone, 3));
  g.setAttribute('aMirror', new THREE.BufferAttribute(a.aMirror, 1));
  g.setIndex(new THREE.BufferAttribute(T.idx, 1));
  geometries.set(i, g);
  return g;
}

/**
 * A figure as numbers (packFigures), FIGURE_STRIDE floats: template, x, z, yaw, seed, body, pose, side, look,
 * walk ex, ez, speed, phase, floor at the start and end, gap, tint r, g, b, and whether it carries an umbrella.
 */
export const FIGURE_STRIDE = 20;
/** The pavements' and plazas' height (real/ground.ts): where a figure stands unless its floor says otherwise. */
const PAVEMENT = 0.15;
/** The per-figure attributes the material reads, and where each comes from in a figure's numbers. */
export const FIGURE_ATTRS: readonly { readonly name: string; readonly at: readonly number[] }[] = [
  { name: 'aFig', at: [1, 2, 3, 4] },
  { name: 'aPose', at: [5, 6, 7, 8] },
  { name: 'aWalk', at: [9, 10, 11, 12] },
  { name: 'aGround', at: [13, 14, 15] },
  { name: 'aTint', at: [16, 17, 18] },
];

/** A figure's fade seed in [0, 1): its own or from where it stands; -1 if it never fades. */
function figureSeed(s: FigureSpec): number {
  if (s.fade === false) return -1;
  return s.seed ?? u01(hash(Math.round(s.x * 10), Math.round(s.z * 10), 0x6057));
}

/** Most people carry an umbrella in the rain: whether this one does is a pure function of where they stand. */
function carriesUmbrella(s: FigureSpec): boolean {
  const h = (Math.imul(Math.round(s.x * 10), 73856093) ^ Math.imul(Math.round(s.z * 10), 19349663)) >>> 0;
  return h % 100 < 72;
}

function writeFigure(o: Float32Array, k: number, s: FigureSpec, ground: ((x: number, z: number) => number) | null): void {
  const c = mobShade(s.color);
  const w = s.walk;
  // A figure stands on the raised pavement (0.15 m) plus its own floor (s.y: a step, a storey, or less on open ground).
  const y = PAVEMENT + (s.y ?? 0);
  const g0 = ground ? ground(s.x, s.z) : 0;
  const g1 = w && ground ? ground(s.x + w.ex, s.z + w.ez) : g0;
  o[k] = templateIndex(s);
  o[k + 1] = s.x;
  o[k + 2] = s.z;
  o[k + 3] = s.yaw;
  o[k + 4] = figureSeed(s);
  o[k + 5] = BODY_LIST.indexOf(s.body);
  o[k + 6] = POSE_LIST.indexOf(s.pose);
  o[k + 7] = s.side >= 0 ? 1 : -1;
  o[k + 8] = s.look;
  o[k + 9] = w?.ex ?? 0;
  o[k + 10] = w?.ez ?? 0;
  o[k + 11] = w?.speed ?? 0;
  o[k + 12] = s.phase;
  o[k + 13] = y + g0;
  o[k + 14] = y + g1;
  o[k + 15] = w?.gap ?? 0;
  o[k + 16] = c[0];
  o[k + 17] = c[1];
  o[k + 18] = c[2];
  o[k + 19] = carriesUmbrella(s) ? 1 : 0;
}

/** Figures as numbers for the instanced crowd, standing on `ground` (the terrain) plus their own floor. */
export function packFigures(specs: readonly FigureSpec[], ground: ((x: number, z: number) => number) | null = null): Float32Array {
  const out = new Float32Array(specs.length * FIGURE_STRIDE);
  specs.forEach((s, i) => writeFigure(out, i * FIGURE_STRIDE, s, ground));
  return out;
}

// ---- Baked figures (set pieces, story NPCs, the showroom) ----

/**
 * Bakes a few figures into one mesh with the crowd's attributes (each template's vertices with its figure's
 * numbers on every vertex), for the material to pose and animate like the instanced crowd.
 */
export class GhostBuilder {
  private parts: { t: number; f: Float32Array }[] = [];

  /** Vertices so far. */
  get count(): number {
    return this.parts.reduce((n, p) => n + templateAt(p.t).pos.length / 3, 0);
  }

  reset(): this {
    this.parts = [];
    return this;
  }

  /** Adds a template with a figure's numbers (FIGURE_STRIDE of them). */
  add(t: number, figure: Float32Array): void {
    this.parts.push({ t, f: figure });
  }

  build(ox: number, oz: number): THREE.BufferGeometry | null {
    const r = this.raw(ox, oz);
    return r ? toGeometry(r) : null;
  }

  raw(ox: number, oz: number): RawGeometry | null {
    if (this.parts.length === 0) return null;
    let nv = 0;
    let ni = 0;
    for (const p of this.parts) {
      const T = templateAt(p.t);
      nv += T.pos.length / 3;
      ni += T.idx.length;
    }
    const sizes: Record<string, number> = { position: 3, normal: 3, aShade: 1, aBone: 3, aMirror: 1 };
    for (const a of FIGURE_ATTRS) sizes[a.name] = a.at.length;
    const out: Record<string, Float32Array> = {};
    for (const [k, n] of Object.entries(sizes)) out[k] = new Float32Array(nv * n);
    const index = new Uint32Array(ni);
    let v0 = 0;
    let i0 = 0;
    let cx = 0, cy = 0, cz = 0;
    for (const p of this.parts) {
      const T = templateAt(p.t);
      const a = templateArrays(T);
      const n = T.pos.length / 3;
      out.position.set(a.position, v0 * 3);
      out.normal.set(a.normal, v0 * 3);
      out.aShade.set(a.aShade, v0);
      out.aBone.set(a.aBone, v0 * 3);
      out.aMirror.set(a.aMirror, v0);
      const f = p.f.slice();
      f[1] -= ox;
      f[2] -= oz;
      for (const attr of FIGURE_ATTRS) {
        const arr = out[attr.name];
        const m = attr.at.length;
        for (let i = 0; i < n; i++) for (let c = 0; c < m; c++) arr[(v0 + i) * m + c] = f[attr.at[c]];
      }
      for (let i = 0; i < T.idx.length; i++) index[i0 + i] = v0 + T.idx[i];
      cx += f[1];
      cy += f[13];
      cz += f[2];
      v0 += n;
      i0 += T.idx.length;
    }
    // Bounds from where the figures stand (the positions are each one's bind pose, not where it is).
    const k = this.parts.length;
    cx /= k;
    cy /= k;
    cz /= k;
    let r = 0;
    for (const p of this.parts) {
      const x = p.f[1] - ox, z = p.f[2] - oz;
      r = Math.max(r, Math.hypot(x - cx, p.f[13] - cy, z - cz) + Math.hypot(p.f[9], p.f[10]));
    }
    const attrs: RawGeometry['attrs'] = {};
    for (const [name, size] of Object.entries(sizes)) attrs[name] = { array: out[name], size };
    return { attrs, index, sphere: [cx, cy + 1, cz, r + 3] };
  }
}

/** Adds one figure to gb. */
export function addFigure(gb: GhostBuilder, s: FigureSpec): void {
  gb.add(templateIndex(s), packFigures([s]));
}

/** Adds the figure's umbrella to gb if it carries one (the district shows umbrellas only while it rains). */
export function addUmbrella(gb: GhostBuilder, s: FigureSpec): boolean {
  if (!carriesUmbrella(s)) return false;
  gb.add(umbrellaIndex(s.body), packFigures([s]));
  return true;
}

/** A figure posed as the material poses it at rest (no idle motion), in the world: for tests. */
export function posedFigure(s: FigureSpec): Float32Array {
  const T = template(s.body, s.hair, outfitOf(s));
  const M = poseBones(T, s);
  const n = T.pos.length / 3;
  const out = new Float32Array(n * 3);
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  for (let i = 0; i < n; i++) {
    const x = T.pos[i * 3], y = T.pos[i * 3 + 1], z = T.pos[i * 3 + 2];
    const e0 = M[T.b0[i]].elements, e1 = M[T.b1[i]].elements;
    const w = T.w[i], u = 1 - w;
    const px = w * (e0[0] * x + e0[4] * y + e0[8] * z + e0[12]) + u * (e1[0] * x + e1[4] * y + e1[8] * z + e1[12]);
    const py = w * (e0[1] * x + e0[5] * y + e0[9] * z + e0[13]) + u * (e1[1] * x + e1[5] * y + e1[9] * z + e1[13]);
    const pz = w * (e0[2] * x + e0[6] * y + e0[10] * z + e0[14]) + u * (e1[2] * x + e1[6] * y + e1[10] * z + e1[14]);
    out[i * 3] = s.x + fz * px + fx * pz;
    out[i * 3 + 1] = PAVEMENT + (s.y ?? 0) + py;
    out[i * 3 + 2] = s.z - fx * px + fz * pz;
  }
  return out;
}

// ---- The material ----

/** The street lightmap's uniforms (real/city.ts), shared so the mob is lit where the streets are. */
export interface GhostLight {
  readonly tLight: { value: THREE.Texture | null };
  readonly uLightRect: { value: THREE.Vector4 };
  readonly uLightFade: { value: THREE.Vector2 };
  readonly uLightGain: { value: number };
}

/**
 * The mob's material: poses and animates each figure from its numbers (the skeleton rebuilt in the vertex
 * shader: the same joints and rotations as `poseBones`, plus breathing, a sway, looking about, gestures and
 * the walk), dark and softly top-lit, lit by the street lightmap at night, a little denser at the
 * silhouette, see-through by alpha to coverage (opaque pass, depth written: one surface per figure, no
 * sorting). `uTime` drives the motion and the fades (main.ts sets it).
 */
export function ghostMaterial(light?: GhostLight): THREE.ShaderMaterial {
  const pivots: THREE.Vector3[] = [];
  const armOut: number[] = [];
  for (const body of BODY_LIST) {
    const p = pivotsOf(body);
    for (const v of p.pivot) pivots.push(new THREE.Vector3(...v));
    armOut.push(p.armOut);
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uOpacity: { value: 0.72 }, uPivot: { value: pivots }, uArmOut: { value: armOut } }]),
      tLight: light?.tLight ?? { value: null },
      uLightRect: light?.uLightRect ?? { value: new THREE.Vector4(0, 0, 1, 1) },
      uLightFade: light?.uLightFade ?? { value: new THREE.Vector2(0, 0) },
      uLightGain: light?.uLightGain ?? { value: 0 },
    },
    alphaToCoverage: true,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float uTime;
      uniform vec3 uPivot[${BODY_LIST.length * BONES}];
      uniform float uArmOut[${BODY_LIST.length}];
      attribute float aShade;
      attribute vec3 aBone;
      attribute float aMirror;
      attribute vec4 aFig;
      attribute vec4 aPose;
      attribute vec4 aWalk;
      attribute vec3 aGround;
      attribute vec3 aTint;
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vC;
      varying float vFade;

      struct Limb { float swing; float raise; float bend; float up; };
      Limb armL, armR, legL, legR;
      float lean, drop, spineRoll, headYaw, headPitch, armOut;
      int base;

      mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
      mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
      mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
      // Appends a joint: (M, T) then R about the pivot p.
      void joint(inout mat3 M, inout vec3 T, mat3 R, vec3 p) { T = M * (p - R * p) + T; M = M * R; }

      // A bone's transform from the bind pose (figure frame): the chain from the pelvis, as poseBones builds it.
      void bone(int b, out mat3 M, out vec3 T) {
        M = mat3(1.0);
        T = vec3(0.0, -drop, 0.0);
        if (b == 0 || b == 11) return;
        if ((b >= 3 && b <= 6) || b >= 12) {
          bool left = b == 3 || b == 4 || b == 12;
          Limb l = legR;
          if (left) l = legL;
          float sg = left ? -1.0 : 1.0;
          int ti = left ? 3 : 5;
          joint(M, T, rotX(-l.swing) * rotZ(sg * l.raise), uPivot[base + ti]);
          if (b == ti) return;
          joint(M, T, rotX(l.bend), uPivot[base + ti + 1]);
          if (b < 12) return;
          joint(M, T, rotX(${FOOT_LEVEL.toFixed(3)} * (l.swing - l.bend)), uPivot[base + b]);
          return;
        }
        joint(M, T, rotX(lean) * rotZ(spineRoll), uPivot[base + 1]);
        if (b == 1) return;
        if (b == 2) {
          joint(M, T, rotX(-lean * 0.7 + headPitch) * rotZ(-spineRoll * 0.8) * rotY(headYaw), uPivot[base + 2]);
          return;
        }
        bool left = b <= 8;
        Limb l = armR;
        if (left) l = armL;
        float sg = left ? -1.0 : 1.0;
        int ai = left ? 7 : 9;
        joint(M, T, rotX(-l.swing) * rotZ(sg * (l.raise - armOut)), uPivot[base + ai]);
        if (b == ai) return;
        joint(M, T, l.up > 0.5 ? rotZ(sg * l.bend) : rotX(-l.bend), uPivot[base + ai + 1]);
      }

      void main() {
        float t = uTime;
        int body = int(aPose.x + 0.5);
        base = body * ${BONES};
        armOut = uArmOut[body];
        float side = aPose.z;
        float seed = aFig.w;
        // Each figure's own randomness for its idle motion (seeds can be shared by a group).
        float r = fract(sin(dot(aFig.xy, vec2(12.9898, 78.233))) * 43758.5453);

        // Where it is: a walker along its walk, fading in at the start and out at the end, then away for its
        // gap; everyone else where they stand, on their own fade cycle.
        vec2 org = aFig.xy;
        float ground = aGround.x;
        float phase = aWalk.w;
        float fade = 1.0;
        bool moving = aWalk.z > 0.0;
        if (moving) {
          float L = max(length(aWalk.xy), 0.1);
          float tw = L / aWalk.z;
          float cycle = tw + aGround.z;
          float u = mod(t + fract(abs(seed) * 7.31) * cycle, cycle);
          float k = clamp(u / tw, 0.0, 1.0);
          org += aWalk.xy * k;
          ground = mix(aGround.x, aGround.y, k);
          phase = fract(aWalk.w + k * L / (body == 2 ? 0.95 : 1.35));
          if (seed >= 0.0) fade = smoothstep(0.0, 1.6, u) * (1.0 - smoothstep(tw - 1.6, tw, u));
        } else if (seed >= 0.0) {
          float cycle = 50.0 + 70.0 * seed;
          float ph = fract(t / cycle + seed * 13.37);
          float e = 3.5 / cycle;
          fade = smoothstep(0.0, e, ph) * (1.0 - smoothstep(0.8, 0.8 + e, ph));
        }

        // The pose, and on top of it the motion.
        int P = int(aPose.y + 0.5);
        Limb still = Limb(0.0, 0.1, 0.12, 0.0);
        Limb leg0 = Limb(0.0, 0.0, 0.0, 0.0);
        armL = still;
        armR = still;
        legL = leg0;
        legR = leg0;
        lean = body == 3 ? 0.2 : 0.02;
        drop = 0.0;
        spineRoll = 0.0;
        headYaw = aPose.w;
        headPitch = 0.0;
        if (P == 1) {
          float a = sin(phase * 6.2832) * 0.36;
          // The knee bends as the leg goes back (smoothly, so the foot doesn't snap as the legs pass).
          legL = Limb(a, 0.0, 0.06 + 0.24 * clamp(-a / 0.36, 0.0, 1.0), 0.0);
          legR = Limb(-a, 0.0, 0.06 + 0.24 * clamp(a / 0.36, 0.0, 1.0), 0.0);
          armL = Limb(-a * 0.7, 0.1, 0.25, 0.0);
          armR = Limb(a * 0.7, 0.1, 0.25, 0.0);
          lean += 0.04;
          // The hips drop as far as the swinging legs rise, so the planted foot stays on the ground.
          drop = uPivot[base + 3].y * (1.0 - cos(a));
          if (moving) {
            // The shoulders turning with the stride, a glance about.
            spineRoll = 0.03 * sin(phase * 6.2832);
            headYaw = aPose.w * 0.4 + 0.12 * sin(t * 0.4 + r * 9.0);
          }
        } else {
          float breath = sin(t * 1.4 + r * 20.0);
          float sway = sin(t * 0.55 + r * 31.0);
          lean += 0.012 * breath;
          spineRoll = 0.025 * sway;
          headYaw = aPose.w + 0.22 * sin(t * 0.23 + r * 17.0) + 0.08 * sin(t * 0.61 + r * 5.0);
          headPitch = 0.04 * sin(t * 0.31 + r * 11.0);
          armL.swing += 0.015 * breath;
          armR.swing += 0.015 * breath;
          Limb g = still;
          bool gest = false;
          if (P == 0) {
            legR = Limb(0.03, 0.06, 0.02, 0.0);
          } else if (P == 2) {
            g = Limb(0.3 + 0.12 * sin(t * 2.1 + r * 7.0), 0.12, 1.25 + 0.3 * sin(t * 3.3 + r * 3.0), 0.0);
            gest = true;
            legL = Limb(0.04, 0.04, 0.04, 0.0);
            legR = Limb(-0.04, 0.06, 0.04, 0.0);
          } else if (P == 3) {
            g = Limb(0.2, 0.32, 2.5, 0.0);
            gest = true;
            headPitch += 0.25;
            headYaw = aPose.w + 0.05 * sin(t * 0.3 + r * 4.0);
          } else if (P == 4) {
            armL = Limb(-0.1, 0.22, 0.45, 0.0);
            armR = armL;
          } else if (P == 5) {
            // The elbow up near shoulder height, the forearm upright and swinging.
            g = Limb(0.15, 1.3, 1.35 + 0.3 * sin(t * 7.0 + r * 2.0), 1.0);
            gest = true;
          } else if (P == 6) {
            g = Limb(0.1, body == 2 ? 0.75 : 0.26, 0.1, 0.0);
            gest = true;
          }
          if (gest) {
            if (side > 0.0) armR = g;
            else armL = g;
          }
        }

        // Skinned by two bones (an umbrella mirrored to the hand it's in).
        float m = mix(1.0, side, aMirror);
        vec3 p = vec3(position.x * m, position.yz);
        vec3 n = vec3(normal.x * m, normal.yz);
        mat3 M0, M1;
        vec3 T0, T1;
        bone(int(aBone.x + 0.5), M0, T0);
        bone(int(aBone.y + 0.5), M1, T1);
        float w = aBone.z;
        vec3 lp = w * (M0 * p + T0) + (1.0 - w) * (M1 * p + T1);
        vec3 ln = normalize(w * (M0 * n) + (1.0 - w) * (M1 * n));
        // The figure frame (x right, z forward) turned by its facing, at where it is.
        float fx = sin(aFig.z), fz = cos(aFig.z);
        vec3 local = vec3(org.x + fz * lp.x + fx * lp.z, ground + lp.y, org.y - fx * lp.x + fz * lp.z);
        vec3 nl = vec3(fz * ln.x + fx * ln.z, ln.y, -fx * ln.x + fz * ln.z);
        vec4 wp = modelMatrix * vec4(local, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * nl);
        vC = aTint * aShade;
        // Fade with distance and as you walk into one, by where it stands so it fades whole.
        vec3 c = (modelMatrix * vec4(org.x, ground, org.y, 1.0)).xyz;
        float d = distance(c.xz, cameraPosition.xz);
        vFade = fade * smoothstep(0.45, 1.2, d) * (1.0 - smoothstep(125.0, 175.0, d));
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uOpacity;
      uniform sampler2D tLight;
      uniform vec4 uLightRect;
      uniform vec2 uLightFade;
      uniform float uLightGain;
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vC;
      varying float vFade;
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      void main() {
        if (vFade < 0.01) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        float rim = 1.0 - abs(dot(n, v));
        rim *= rim;
        float light = 0.6 + 0.4 * (n.y * 0.5 + 0.5);
        vec3 col = vC * light * (1.0 + 0.5 * rim);
        // Street light (the lightmap): the dark clothes catch the lamps and the neon.
        if (uLightGain > 0.0) {
          vec3 L = texture2D(tLight, (vW.xz - uLightRect.xy) * uLightRect.zw).rgb * uLightGain;
          if (uLightFade.y > 0.0) {
            vec2 dc = abs(vW.xz - cameraPosition.xz);
            L *= 1.0 - smoothstep(uLightFade.x, uLightFade.y, max(dc.x, dc.y));
          }
          // (Capped: under the brightest pools they stay dark figures, not pale statues.)
          col += (vC * 1.6 + 0.006) * min(L, vec3(2.2)) * (0.5 + 0.5 * max(n.y, 0.0) + 0.4 * rim);
        }
        // Alpha to coverage has a few steps per pixel (4x MSAA); while a figure fades, a 4x4 ordered dither
        // hides them (steady, the steps only draw a denser edge at the silhouette).
        float a = (uOpacity + 0.2 * rim) * vFade + (bayer4(gl_FragCoord.xy) - 0.5) * 0.24 * (1.0 - smoothstep(0.92, 1.0, vFade));
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <fog_fragment>
      }`,
  });
}

// ---- Crowds ----

function randomPerson(rnd: Rng, x: number, z: number, yaw: number, pose: Pose, body: Body | undefined, mix: PeopleMix): FigureSpec {
  const b: Body = body ?? (rnd.chance(0.45) ? 'man' : rnd.chance(0.85) ? 'woman' : 'elder');
  const woman = b === 'woman';
  // What they wear, by the place's mix (a long coat or skirt as often as before where the mix has 'long').
  const outfit = pickOutfit(mix, rnd.int(0, 1 << 30), (o) => wears(b, o));
  let hair: Hair = woman ? rnd.pick(['long', 'long', 'bun', 'short', 'hat'] as const) : b === 'elder' ? rnd.pick(['none', 'hat', 'cap'] as const) : rnd.pick(['short', 'short', 'short', 'none', 'cap', 'hat'] as const);
  if (outfit === 'maid' || (outfit === 'school' && woman)) hair = rnd.pick(['long', 'long', 'short', 'bun'] as const);
  if (outfit === 'kimono') hair = woman ? 'bun' : rnd.pick(['short', 'none'] as const);
  if (outfit === 'suit' && !woman) hair = rnd.pick(['short', 'short', 'none'] as const);
  // A bag in the left hand: they gesture with the right.
  const carries = (outfit === 'suit' && !woman) || (outfit === 'school' && b !== 'child');
  return {
    x,
    z,
    yaw,
    body: b,
    pose,
    color: rnd.pick(GHOST_COLORS),
    hair,
    long: outfit === 'long',
    outfit,
    phase: rnd.float(),
    side: carries || rnd.chance(0.5) ? 1 : -1,
    look: (rnd.float() - 0.5) * 0.6,
  };
}

/**
 * Deterministic groups of people along a cell's pavements: people walking a stretch of pavement (and fading
 * at its ends), people standing, and now and then a couple walking together, two talking, a parent with a
 * child, a few friends, someone on the phone. People together share a fade seed (they come and go together).
 */
export function cellCrowd(plan: CellPlan3, detail: CellDetail, plazas: readonly Rect[] = []): FigureSpec[] {
  const out: FigureSpec[] = [];
  // Dressed for where they are (the zone's mix, else the district's).
  const mix = plan.style.people ?? DISTRICT_PEOPLE[plan.kind] ?? CITY_PEOPLE;
  const person = (rnd: Rng, x: number, z: number, yaw: number, pose: Pose, body?: Body): FigureSpec => randomPerson(rnd, x, z, yaw, pose, body, mix);
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  const inRect = (q: Rect, x: number, z: number, m: number): boolean => x > q.x - m && x < q.x + q.w + m && z > q.y - m && z < q.y + q.h + m;
  const clear = (x: number, z: number): boolean =>
    !detail.props.some((p) => propDist(p, x, z) < p.radius + (p.kind === 'car' ? 1.6 : 0.8)) &&
    !detail.solids.some((q) => inRect(q, x, z, 0.8)) &&
    !plan.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8);
  // A plaza can reach across a road: nobody stands where the cars drive (the carriageways, kerb to kerb).
  const lanes = plan.roads.filter((r) => r.kind !== 'alley' && r.kind !== 'coast' && r.sidewalk > 0);
  const inTraffic = (x: number, z: number): boolean =>
    lanes.some(({ rect: q, sidewalk: sw, vertical }) =>
      vertical ? x > q.x + sw - 0.4 && x < q.x + q.w - sw + 0.4 && z > q.y && z < q.y + q.h : z > q.y + sw - 0.4 && z < q.y + q.h - sw + 0.4 && x > q.x && x < q.x + q.w,
    );
  /** How far a walker can go on from (x, z) along (dx, dz) while the way is clear: whole metres, up to 36. */
  const reach = (x: number, z: number, dx: number, dz: number): number => {
    let L = 0;
    for (let s = 1; s <= 36; s++) {
      const px = x + dx * s;
      const pz = z + dz * s;
      if (!mine(px, pz) || !clear(px, pz) || inTraffic(px, pz)) break;
      L = s;
    }
    return L;
  };
  /** A walk along (dx, dz) for L metres at a stroll (an elder's slower), and the time away between walks. */
  const walkOf = (rnd: Rng, L: number, dx: number, dz: number, slow = false): FigureSpec['walk'] => ({ ex: dx * L, ez: dz * L, speed: (slow ? 0.95 : 1.2) + rnd.float() * 0.35, gap: 4 + rnd.float() * 30 });
  const onRoad = (r: Road3, side: number, t: number, across: number): [number, number, number, number] => {
    const q = r.rect;
    // (x, z) on the pavement, plus the direction along the road.
    return r.vertical ? [side < 0 ? q.x + across : q.x + q.w - across, t, 0, 1] : [t, side < 0 ? q.y + across : q.y + q.h - across, 1, 0];
  };
  for (const r of plan.roads) {
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const pave = r.sidewalk > 0 ? r.sidewalk : 1.4;
    const rnd = rng(hash(Math.round(q.x * 3), Math.round(q.y * 3), 0x9e0, r.vertical ? 1 : 2));
    const [a, b] = r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w];
    for (const side of [-1, 1]) {
      for (let t = a + 3 + rnd.float() * 6; t < b - 3; t += 9 + rnd.float() * 10) {
        if (!rnd.chance(r.sidewalk > 0 ? 0.55 : 0.3)) continue;
        const across = pave * (0.35 + rnd.float() * 0.3);
        const [x, z, dx, dz] = onRoad(r, side, t, across);
        if (!mine(x, z) || !clear(x, z)) continue;
        const dirYaw = Math.atan2(dx, dz) + (rnd.chance(0.5) ? Math.PI : 0);
        const f: V3 = [Math.sin(dirYaw), 0, Math.cos(dirYaw)];
        const rt: V3 = [f[2], 0, -f[0]];
        const roll = rnd.float();
        const seed = rnd.float();
        const p = (ox: number, oz: number): [number, number] => [x + rt[0] * ox + f[0] * oz, z + rt[2] * ox + f[2] * oz];
        const L = reach(x, z, f[0], f[2]);
        if (roll < 0.3) {
          // Someone walking down the pavement (standing, if there's no room to walk).
          const who = person(rnd, x, z, dirYaw, L >= 8 ? 'walk' : 'stand');
          out.push(L >= 8 ? { ...who, seed, walk: walkOf(rnd, L, f[0], f[2], who.body === 'elder') } : { ...who, seed });
        } else if (roll < 0.45) {
          out.push({ ...person(rnd, x, z, dirYaw + (rnd.float() - 0.5) * 1.2, rnd.chance(0.7) ? 'stand' : 'pockets'), seed });
        } else if (roll < 0.57) {
          // A couple walking side by side (or waiting together).
          const [x1, z1] = p(-0.35, 0);
          const [x2, z2] = p(0.35, 0.1);
          const walk = L >= 8 ? walkOf(rnd, L - 1, f[0], f[2]) : undefined;
          const pose: Pose = walk ? 'walk' : 'stand';
          out.push({ ...person(rnd, x1, z1, dirYaw, pose, 'man'), seed, walk });
          out.push({ ...person(rnd, x2, z2, dirYaw, pose, 'woman'), look: -0.4, seed, walk });
        } else if (roll < 0.7) {
          // Two people talking, face to face.
          const [x1, z1] = p(0, -0.45);
          const [x2, z2] = p(0, 0.45);
          out.push({ ...person(rnd, x1, z1, dirYaw, rnd.chance(0.4) ? 'talk' : 'stand'), look: 0, seed });
          out.push({ ...person(rnd, x2, z2, dirYaw + Math.PI, rnd.chance(0.5) ? 'stand' : 'pockets'), look: 0, seed });
        } else if (roll < 0.8) {
          // Parent and child holding hands, walking or waiting.
          const walk = rnd.chance(0.6) && L >= 8 ? walkOf(rnd, L - 1, f[0], f[2], true) : undefined;
          const [x1, z1] = p(-0.28, 0);
          const [x2, z2] = p(0.3, 0);
          const parent = person(rnd, x1, z1, dirYaw, walk ? 'walk' : 'hold', rnd.chance(0.6) ? 'woman' : 'man');
          // (A parent out with a child: in their own clothes, not a uniform.)
          const own = parent.outfit === 'maid' || parent.outfit === 'school' ? 'plain' : parent.outfit;
          out.push({ ...parent, outfit: own, side: 1, pose: walk ? 'walk' : 'hold', seed, walk });
          out.push({ ...person(rnd, x2, z2, dirYaw, walk ? 'walk' : 'hold', 'child'), side: -1, hair: rnd.pick(['short', 'cap', 'bun'] as const), long: false, look: -0.3, phase: parent.phase + 0.5, seed, walk });
        } else if (roll < 0.9) {
          // Friends in a loose circle.
          const n = rnd.int(3, 4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd.float() * 0.4;
            const [xi, zi] = [x + Math.sin(ang) * 0.6, z + Math.cos(ang) * 0.6];
            out.push({ ...person(rnd, xi, zi, ang + Math.PI, rnd.pick(['stand', 'stand', 'pockets', 'talk', 'phone'] as const)), look: (rnd.float() - 0.5) * 0.8, seed });
          }
        } else if (roll < 0.97) {
          // On the phone, facing the street from the building side.
          const [x1, z1] = onRoad(r, side, t, pave - 0.4);
          out.push({ ...person(rnd, x1, z1, Math.atan2(r.vertical ? -side : 0, r.vertical ? 0 : -side), 'phone'), seed });
        } else {
          out.push({ ...person(rnd, x, z, dirYaw + Math.PI / 2, 'wave'), seed });
        }
      }
    }
  }
  // Plazas (a busy square of people crossing, waiting to meet someone, and standing in groups), and more
  // thinly the open ground: tower plazas, park paths, playgrounds.
  const areas = [...plazas.map((rect) => ({ rect, density: 0.5 })), ...detail.open.flatMap((o) => o.crowd)];
  // Open ground stands lower than the pavements (car parks, grass, gravel paths): figures there stand on its top.
  const pieces = detail.open.flatMap((o) => o.ground);
  const floorAt = (x: number, z: number): number => {
    let top = -1;
    for (const g of pieces) if (inRect(g.rect, x, z, 0)) top = Math.max(top, g.top);
    return top < 0 ? 0 : top - 0.15;
  };
  for (const { rect: q, density } of areas) {
    const rnd = rng(hash(Math.round(q.x), Math.round(q.y), 0x9e1));
    for (let x = q.x + 2.5; x < q.x + q.w - 2; x += 4.2) {
      for (let z = q.y + 2.5; z < q.y + q.h - 2; z += 4.2) {
        if (!rnd.chance(density)) continue;
        const px = x + (rnd.float() - 0.5) * 2.4;
        const pz = z + (rnd.float() - 0.5) * 2.4;
        if (!mine(px, pz) || !clear(px, pz) || inTraffic(px, pz)) continue;
        const yaw = rnd.float() * Math.PI * 2;
        const [dx, dz] = [Math.sin(yaw), Math.cos(yaw)];
        // Plaza walks stay inside the area (crossing the square, not wandering off into the streets).
        let inside = 0;
        while (inside < 36 && inRect(q, px + dx * (inside + 1), pz + dz * (inside + 1), 0)) inside++;
        const L = Math.min(reach(px, pz, dx, dz), inside);
        const roll = rnd.float();
        const seed = rnd.float();
        const y = floorAt(px, pz);
        const from = out.length;
        if (roll < 0.35) {
          const who = person(rnd, px, pz, yaw, L >= 8 ? 'walk' : 'stand');
          out.push(L >= 8 ? { ...who, seed, walk: walkOf(rnd, L, dx, dz, who.body === 'elder') } : { ...who, seed });
        } else if (roll < 0.47) {
          const [sx, sz] = [Math.cos(yaw) * 0.35, -Math.sin(yaw) * 0.35];
          const walk = L >= 8 ? walkOf(rnd, L - 1, dx, dz) : undefined;
          out.push({ ...person(rnd, px - sx, pz - sz, yaw, walk ? 'walk' : 'stand', 'man'), seed, walk });
          out.push({ ...person(rnd, px + sx, pz + sz, yaw, walk ? 'walk' : 'stand', 'woman'), look: -0.4, seed, walk });
        } else if (roll < 0.82) {
          out.push({ ...person(rnd, px, pz, yaw, rnd.pick(['stand', 'stand', 'pockets', 'phone'] as const)), seed });
        } else {
          const n = rnd.int(2, 4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd.float() * 0.4;
            out.push({ ...person(rnd, px + Math.sin(ang) * 0.6, pz + Math.cos(ang) * 0.6, ang + Math.PI, rnd.pick(['stand', 'stand', 'pockets', 'talk', 'phone'] as const)), look: (rnd.float() - 0.5) * 0.8, seed });
          }
        }
        if (y !== 0) for (let i = from; i < out.length; i++) out[i] = { ...out[i], y };
      }
    }
  }
  return out;
}
