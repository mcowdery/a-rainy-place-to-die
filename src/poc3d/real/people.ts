import * as THREE from 'three';
import { overlaps, type Rect } from '../../core/coords';
import { hash, rng, u01, type Rng } from '../../core/hash';
import { CELL, junctionSpans, type CellPlan3, type Road3 } from '../district/plan';
import type { Signals } from '../district/traffic';
import { propDist, type CellDetail } from './props';
import { toGeometry, type RawGeometry } from './rawGeometry';
import { CITY_PEOPLE, DISTRICT_PEOPLE, OUTFITS, pickOutfit, smokeOf, SMOKES, type Outfit, type PeopleMix, type Smoke } from '../district/peopleMix';
import { HOURS, HOURS_GLSL, MANNERS, nightLife, seasonsOf, whenOf, type Hours, type Manner } from '../district/peopleHours';

import { ALL_BONES, blend, BONES, DIGIT_BONES, SPINE_BONES, TOE_BONES, digitParent, FOOT_L, FOOT_LEVEL, FOOT_R, ARM_L, ARM_R, FORE_L, FORE_R, HEAD, one, PARENT, PELVIS, pivotsOf, PROPORTIONS, ROOT, scaleRows, SHIN_L, SHIN_R, SPINE, TemplateBuilder, THIGH_L, THIGH_R, type Body, type Hair, type Row, type Template, type V3, type Weight } from './mobRig';
import { buildShaped, isTeen, shapedVariant, TEEN_SCALE } from './mobShape';
import { EMOTE_GLSL, EMOTE_REACH, emoteUniforms, FACE_MARK, FACE_MARK_GLSL, FACE_VERTEX_GLSL, flushGlsl } from './emoteGlsl';
import { modelTemplate, type MobModelDoc } from './mobModels';

export type { Outfit } from '../district/peopleMix';
export type { Body, Hair } from './mobRig';

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

/**
 * 'gait' is a figure moved by the game (real/liveFigure.ts: someone following you): standing, walking or running
 * by its `pace`, its stride at `phase`. 'ride' sits in a car's seat, the legs out ahead (tucked up by `pace`).
 */
export type Pose = 'stand' | 'walk' | 'talk' | 'phone' | 'pockets' | 'wave' | 'hold' | 'sit' | 'strap' | 'gait' | 'ride';

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
  /** With `fade` false: it stays whole as you come right up to it too (a passenger in the seat beside you). */
  readonly close?: boolean;
  /**
   * 'gait': how it's moving, 0 standing, 1 walking, 2 running (and between). 'ride': how far the knees are tucked
   * up, 0 legs out ahead to 1 (a cramped back seat).
   */
  readonly pace?: number;
  /**
   * A walker: walks (ex, ez) metres from where it stands at `speed` m/s, fades out at the end, stays away
   * `gap` seconds and comes back to the start. Without it a figure stands (a 'walk' pose then mid-stride).
   */
  readonly walk?: {
    readonly ex: number;
    readonly ez: number;
    readonly speed: number;
    readonly gap: number;
    /**
     * A crossing on a signal: its cycle (s), when the figure appears at the kerb (s into the cycle, on the
     * traffic's clock) and how long it waits there for the walk light. `gap` is then unused.
     */
    readonly signal?: { readonly cycle: number; readonly at: number; readonly wait: number };
  };
  /** The fade cycle's seed (people together share one, so they come and go together); else from where it stands. */
  readonly seed?: number;
  /** When this one is out (district/peopleHours.ts: its hours through the day, less in rain); unset, always there. */
  readonly hours?: Hours;
  /** Its threshold for being out, in [0, 1): out while the share of such people out is above it. */
  readonly out?: number;
  /** How it stands about and walks (the material's routine: a shady one squats and smokes, a drunk sways). */
  readonly manner?: Manner;
  /** Pose 'hold': how far out the holding arm is raised (rad). `holdHands` sets it so two people's hands meet. */
  readonly reach?: number;
  /** A modelled figure (real/mobModels.ts, registered with `registerMobModel`) drawn in place of the body's lofted one. */
  readonly model?: string;
  /**
   * Something lit in the free hand (district/peopleMix.ts smokeOf): the material carries it low and brings it to the
   * mouth for a drag every so often; real/smoke.ts draws the cigarette or cigar, its ember and the smoke for the
   * figures it's given (the street's crowd).
   */
  readonly smokes?: Smoke;
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

// ---- Templates (the skeleton and the loft builder are real/mobRig.ts) ----

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
/** The maid's dress below the waist: a rounded bell over a petticoat, ending mid-thigh. */
const MAID_SKIRT: readonly Row[] = [
  [0.665, 0.236, 0.212, 0.015],
  [0.68, 0.254, 0.23, 0.015],
  [0.76, 0.247, 0.222, 0.012],
  [0.86, 0.218, 0.188, 0.006],
  [0.95, 0.178, 0.143, 0],
  [1.02, 0.142, 0.102, 0],
  [1.065, 0.126, 0.091, 0],
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
/** A puffed short sleeve, round, gathered at the shoulder and into a cuff. */
const PUFF: readonly Row[] = [
  [1.25, 0.046, 0.051, -0.012],
  [1.27, 0.066, 0.071, -0.012],
  [1.32, 0.075, 0.08, -0.012],
  [1.38, 0.071, 0.076, -0.011],
  [1.42, 0.056, 0.06, -0.01],
  [1.445, 0.038, 0.043, -0.01],
];
const CUFF: readonly Row[] = [
  [1.236, 0.044, 0.049, -0.012],
  [1.252, 0.05, 0.055, -0.012],
  [1.262, 0.064, 0.069, -0.012],
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
const wears = (b: Body, o: Outfit): boolean => {
  switch (o) {
    case 'plain':
    case 'yukata':
    case 'puffer':
      return true;
    case 'maid':
    case 'dress':
    case 'mini':
    case 'gown':
      return b === 'woman';
    // (Nothing on: only ever in a room of an adult scene, real/windowScenes.ts; no mix has it and pickOutfit never
    // gives it, so nobody in the street does.)
    case 'nude':
      return b === 'woman' || b === 'man';
    // (The same in high heels: a woman's.)
    case 'nude_heels':
      return b === 'woman';
    case 'school':
    case 'pinoy_school':
    case 'otaku':
    case 'shorts':
    case 'hoodie':
    // (School sports clothes: a track suit, gym clothes.)
    case 'track':
    case 'gym':
      return b !== 'elder';
    case 'work':
    case 'police':
    case 'baller':
    case 'guard':
    case 'office':
    case 'nurse':
    case 'doctor':
    case 'bosozoku':
    case 'hood':
    case 'yankee':
      return b === 'man' || b === 'woman';
    case 'yakuza':
    case 'boss':
    case 'barong':
      return b === 'man' || b === 'elder';
    case 'chinpira':
    case 'irezumi':
    case 'drunk':
    case 'jeep_crew':
    case 'trike_driver':
      return b === 'man';
    default:
      return b !== 'child';
  }
};

/** The outfit a figure is drawn in: its own if its body wears it, else 'long' or everyday clothes. */
export function outfitOf(s: Pick<FigureSpec, 'body' | 'long' | 'outfit'>): Outfit {
  const o = s.outfit ?? (s.long ? 'long' : 'plain');
  return wears(s.body, o) ? o : s.long && s.body !== 'child' ? 'long' : 'plain';
}

/**
 * Which generation of bodies the templates are built as: 'classic', the district's, or 'shaped', the one under
 * review in the mob showroom (real/mobShape.ts: fuller bodies, women's figures, hair with a hairline). The skeleton is
 * the same, so one material poses both. Set it before the figures are built (templates are cached per generation).
 */
export type MobShape = 'classic' | 'shaped';
// (The sculpted figures are the city's now, on the main thread and in the chunk workers alike; 'classic' is kept for
// the mob showroom's comparison and its tests.)
let mobShape: MobShape = 'shaped';
export function setMobShape(shape: MobShape): void {
  mobShape = shape;
}
export const getMobShape = (): MobShape => mobShape;

/** The hair kinds only the shaped generation has, as the classic one draws them. */
const CLASSIC_HAIR: Partial<Record<Hair, Hair>> = { bob: 'short', ponytail: 'long', twin: 'long' };

/** The outfits only the shaped generation has, as the classic one draws them. */
const CLASSIC_OUTFIT: Partial<Record<Outfit, Outfit>> = { dress: 'long', mini: 'plain', gown: 'long', shorts: 'plain', hoodie: 'plain', office: 'suit', track: 'plain', nurse: 'plain', doctor: 'long', apron: 'plain', puffer: 'plain', gym: 'plain', yakuza: 'suit', boss: 'suit', drunk: 'suit', bosozoku: 'long', yankee: 'school', chinpira: 'plain', hood: 'plain', irezumi: 'plain', pinoy_school: 'school', baller: 'shorts', barong: 'suit', vendor: 'apron', jeep_crew: 'plain', trike_driver: 'plain', guard: 'police', nude: 'plain', nude_heels: 'plain' };

const templates = new Map<string, Template>();

/** The posable template for a body with its hair and outfit (built once per combination). */
function template(body: Body, hair: Hair, outfit: Outfit): Template {
  const o = wears(body, outfit) ? outfit : 'plain';
  const key = `${mobShape}${mobShape === 'shaped' ? shapedVariant() : ''}|${body}|${hair}|${o}`;
  let t = templates.get(key);
  if (!t) templates.set(key, (t = mobShape === 'shaped' ? buildShaped(body, hair, o) : buildTemplate(body, CLASSIC_HAIR[hair] ?? hair, CLASSIC_OUTFIT[o] ?? o)));
  return t;
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
  /**
   * A skirt's or coat's skinning: below the hip joints each side follows its thigh (more of it lower down), so it
   * lifts onto the lap when they sit and swings a little with the stride.
   */
  const hipY = 0.9 * ys;
  const drape = (r: Row, _i: number, x: number): Weight => {
    if (r[0] >= hipY) return hips(r);
    const k = Math.min(1, (hipY - r[0]) / (0.3 * ys));
    return [x < 0 ? THIGH_L : THIGH_R, PELVIS, 0.25 + 0.65 * k];
  };
  if (long) {
    const rows = scaleRows(body === 'woman' ? SKIRT : COAT, ys, body === 'woman' ? 0.95 : P.arm);
    tb.loft(rows, () => 0, drape, body === 'woman' ? 0.85 : 0.9, 14, 2.2);
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
      tb.loft(scaleRows(PENCIL, ys, 0.95), () => 0, drape, 0.95, 14, 2.4);
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
    tb.loft(skirt, () => 0, drape, 1, 18, 2);
    // The skirt at a height: its section, grown by `g` (the apron and lace sit just outside it).
    const skirtAt = (y: number, g: number): Row => {
      let i = 0;
      while (i < skirt.length - 2 && skirt[i + 1][0] < y) i++;
      const a = skirt[i], b = skirt[i + 1];
      const k = Math.min(1, Math.max(0, (y - a[0]) / (b[0] - a[0])));
      return [y, a[1] + (b[1] - a[1]) * k + g, a[2] + (b[2] - a[2]) * k + g, a[3] + (b[3] - a[3]) * k];
    };
    const F = Math.PI / 2;
    // Lace under the hem (the petticoat's edge).
    tb.loft([skirtAt(0.665 * ys, -0.01), [0.63 * ys, 0.25, 0.226, 0.015], [0.65 * ys, 0.262, 0.238, 0.015], skirtAt(0.67 * ys, 0.006)], () => 0, drape, WHITE, 18, 2);
    // The apron round the front of the skirt, a frill along its bottom, and the waistband all round.
    tb.loft([0.7, 0.76, 0.86, 0.95, 1.03].map((y) => skirtAt(y * ys, 0.012)), () => 0, drape, WHITE, 10, 2, 'y', [F - 1.0, F + 1.0]);
    const flare = skirtAt(0.7 * ys, 0.03);
    tb.loft([[0.672 * ys, flare[1], flare[2], flare[3]], skirtAt(0.7 * ys, 0.014)], () => 0, drape, WHITE * 0.9, 10, 2, 'y', [F - 1.05, F + 1.05]);
    const band = (y: number, g: number): Row => {
      const [w, d, z] = torsoAt(y);
      return [y, w + g, d + g, z];
    };
    tb.loft([band(1.04 * ys, 0.008), band(1.075 * ys, 0.008)], () => 0, hips, WHITE, 14, 2.4);
    // The bib up the chest, a frill along its top, and straps over the shoulders to the back.
    tb.loft([1.07, 1.15, 1.23, 1.3].map((y) => band(y * ys, 0.007)), () => 0, () => one(SPINE), WHITE, 8, 2.4, 'y', [F - 0.62, F + 0.62]);
    tb.loft([band(1.3 * ys, 0.007), band(1.325 * ys, 0.02)], () => 0, () => one(SPINE), WHITE * 0.9, 8, 2.4, 'y', [F - 0.66, F + 0.66]);
    for (const c of [F - 0.5, F + 0.5, -F + 0.5, -F - 0.5]) tb.loft([1.29, 1.36, 1.42, 1.455].map((y) => band(y * ys, 0.008)), () => 0, () => one(SPINE), WHITE, 2, 2.4, 'y', [c - 0.07, c + 0.07]);
    // The bow at the back of the waist, its two loops and tails.
    const [, bd, bz] = torsoAt(1.06 * ys);
    const back = bz - bd - 0.02;
    for (const sd of [-1, 1]) {
      const y = 1.07 * ys;
      tb.loft([[y - 0.045, 0.004, 0.004, back], [y - 0.03, 0.04, 0.02, back - 0.006], [y, 0.055, 0.026, back - 0.01], [y + 0.03, 0.04, 0.02, back - 0.006], [y + 0.045, 0.004, 0.004, back]], () => sd * 0.055, hips, WHITE, 8);
      tb.loft([[0.84 * ys, 0.022, 0.005, back - 0.01], [1.05 * ys, 0.016, 0.005, back]], () => sd * 0.03, hips, WHITE, 6, 6);
    }
    // A white collar at the neck.
    tb.loft([band(1.44 * ys, 0.006), band(1.475 * ys, 0.006)], () => 0, () => one(SPINE), WHITE, 10, 2.4, 'y', [F - 1.2, F + 1.2]);
    // Puffed sleeves with white cuffs.
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) {
      armRows(PUFF, sd, 1, arm, fore);
      armRows(CUFF, sd, WHITE, arm, fore);
    }
    // The katyusha: a band arching over the head from ear to ear, a frill of lace along its front.
    const hoop = (z: number, w: number, h: number): Row => [z * hk, w * hk, h * hk, neckY + 0.118 * hk];
    tb.loft([hoop(-0.012, 0.087, 0.12), hoop(0.012, 0.087, 0.12)], () => 0, () => one(HEAD), 0.5, 12, 2, 'z', [Math.PI + 0.5, 2 * Math.PI - 0.5]);
    tb.loft([hoop(0.012, 0.088, 0.121), hoop(0.026, 0.1, 0.136)], () => 0, () => one(HEAD), WHITE, 12, 2, 'z', [Math.PI + 0.62, 2 * Math.PI - 0.62]);
  } else if (outfit === 'school') {
    if (body === 'woman') {
      tb.loft(scaleRows(PLEATS, ys, 0.95), () => 0, drape, 1, 16, 3.5);
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
    tb.loft(scaleRows(ROBE, ys, woman ? 0.95 : P.arm), () => 0, drape, 1, 14, 2.4);
    tb.loft(scaleRows(OBI, ys, woman ? 0.95 : P.arm), () => 0, hips, woman ? 2.6 : 1.3, 14, 2.4);
    if (woman) {
      // The obi's bow on the back.
      const [, d, z] = torsoAt(1.08 * ys);
      tb.loft([1.0, 1.02, 1.16, 1.18].map((y, i): Row => [y * ys, i % 3 === 0 ? 0.11 : 0.13, i % 3 === 0 ? 0.025 : 0.035, z - d - 0.05]), () => 0, () => one(SPINE), 2.6, 8, 6);
    }
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) armRows(SLEEVE, sd, 1, arm, fore);
  } else if (outfit === 'yukata') {
    // Light summer cotton (lighter than a kimono) with a dark obi, and a bow behind for women and children.
    const k = body === 'woman' ? 0.95 : P.arm;
    tb.loft(scaleRows(ROBE, ys, k), () => 0, drape, 2.2, 14, 2.4);
    tb.loft(scaleRows(OBI, ys, k).map(([y, w, d, z]): Row => [y, w * 1.005, d * 1.01, z]), () => 0, hips, 0.5, 14, 2.4);
    if (body === 'woman' || body === 'child') {
      const [, d, z] = torsoAt(1.08 * ys);
      tb.loft([1.0, 1.02, 1.16, 1.18].map((y, i): Row => [y * ys, (i % 3 === 0 ? 0.1 : 0.12) * k, (i % 3 === 0 ? 0.022 : 0.032) * k, z - d - 0.045 * k]), () => 0, () => one(SPINE), 0.5, 8, 6);
    }
    const sleeve = SLEEVE.map(([y, a, b, z]): Row => [y + 0.06, a, b * 0.85, z]);
    for (const [sd, arm, fore] of [[-1, ARM_L, FORE_L], [1, ARM_R, FORE_R]] as const) armRows(sleeve, sd, 2.2, arm, fore);
  } else if (outfit === 'work') {
    // A hard hat with its brim, and a hi-vis vest with two reflective bands.
    tb.loft(headRows([[0.13, 0.12, 0.13, -0.005], [0.14, 0.12, 0.13, -0.005], [0.145, 0.088, 0.104, -0.008], [0.2, 0.084, 0.098, -0.01], [0.24, 0.05, 0.06, -0.012], [0.255, 0.003, 0.003, -0.012]]), () => 0, () => one(HEAD), WHITE * 1.1, 12, 2.1);
    const vest = (y: number, g: number): Row => {
      const [w, d, z] = torsoAt(y);
      return [y, w + g, d + g, z];
    };
    tb.loft([1.0, 1.1, 1.2, 1.3, 1.38].map((y) => vest(y * ys, 0.01)), () => 0, (r) => (r[0] > waist ? one(SPINE) : hips(r)), 2.2, 12, 2.4);
    for (const y of [1.1, 1.24]) tb.loft([vest(y * ys, 0.014), vest((y + 0.035) * ys, 0.014)], () => 0, () => one(SPINE), WHITE * 1.3, 12, 2.4);
  } else if (outfit === 'police') {
    // A peaked cap with a lighter band, and the duty belt.
    // (Low on the head, the crown flaring wider than the band to a flat top just above the hair.)
    tb.loft(headRows([[0.155, 0.083, 0.103, -0.006], [0.18, 0.091, 0.112, -0.01], [0.212, 0.104, 0.124, -0.014], [0.226, 0.1, 0.119, -0.015], [0.232, 0.003, 0.003, -0.015]]), () => 0, () => one(HEAD), 0.7, 12, 2.1);
    tb.loft(headRows([[0.155, 0.084, 0.104, -0.006], [0.172, 0.087, 0.108, -0.008]]), () => 0, () => one(HEAD), WHITE * 0.6, 12, 2.1);
    tb.loft(headRows(VISOR.map(([y, a, b, z]): Row => [y + 0.02, a * 1.05, b * 1.1, z + 0.004])), () => 0, () => one(HEAD), 0.4, 8);
    const [w, d, z] = torsoAt(0.98 * ys);
    tb.loft([[0.955 * ys, w + 0.012, d + 0.012, z], [1.0 * ys, w + 0.012, d + 0.012, z]], () => 0, hips, 0.4, 12, 2.4);
  } else if (outfit === 'otaku') {
    // A rucksack on the back.
    const ys0 = [1.04, 1.06, 1.36, 1.39].map((y) => y * ys);
    const back = Math.min(...ys0.map((y) => torsoAt(y)[2] - torsoAt(y)[1]));
    const k = body === 'child' ? 0.75 : 1;
    tb.loft(ys0.map((y, i): Row => [y, (i % 3 === 0 ? 0.12 : 0.135) * k, (i % 3 === 0 ? 0.06 : 0.075) * k, back - 0.07 * k]), () => 0, () => one(SPINE), 1.4, 10, 3);
  }
  return tb.build(pivot, armOut);
}

/**
 * The arm holding an umbrella up (the material poses the umbrella's arm so while it rains): the upper arm
 * near the body, the elbow bent so the fist is in front of the chest, turned a little in.
 */
/**
 * An otaku's hands on the rucksack's straps at the chest, standing or walking (the sculpted generation's, which has
 * the straps): the elbows a little back, the forearms folded up and turned in to the straps.
 */
const STRAP_HOLD = { swing: -0.35, raise: 0.1, bend: 2.5, twist: 0.8 } as const;
const holdsStraps = (s: Pick<FigureSpec, 'body' | 'long' | 'outfit'>): boolean => mobShape === 'shaped' && outfitOf(s) === 'otaku';

/** A colour from its sRGB hex, in the linear values the material works in. */
const hex = (h: string): V3 => {
  const n = parseInt(h.slice(1), 16);
  const lin = (v: number): number => (v / 255 <= 0.04045 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
  return [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)];
};

/**
 * The mob's colours (the sculpted generation's: real/mobShape.ts tags each vertex, its shade tag x 100 + shade). A
 * noir city in late Showa Japan: muted, deep and dusty (navy, charcoal, browns, olive, ochre, brick, off-white), no
 * bright or fluorescent colours. Tags from 2 are parts with a colour of their own, which they keep whatever the
 * figure's tint and through the one colour.
 */
const TAG_COLORS: readonly V3[] = [
  hex('#1c2740'), // 2 navy: police, a sailor uniform's skirt and collar, a man's kimono, a stethoscope, a maid's dress
  hex('#9a5c2a'), // 3 a hard hat's orange
  hex('#b9b6ab'), // 4 off-white: whites, shirts, lenses, aprons and lace, a yukata's cotton
  hex('#703028'), // 5 brick red: a shop apron, a tie, a sailor scarf, a randoseru
  hex('#a8201c'), // 6 a nurse's red cross
  hex('#26402c'), // 7 an otaku's dark green rucksack
  hex('#5c2830'), // 8 a school's maroon: track suit, bloomers, gym shorts
  hex('#561820'), // 9 an evening dress's dark red
  hex('#a8823a'), // 10 ochre: a yukata's sash, a schoolchild's cap
  hex('#4a3152'), // 11 a woman's kimono, plum
  hex('#968c40'), // 12 a safety vest's dull yellow
  hex('#8a7659'), // 13 tan: a trench coat, a long skirt, shorts; brown bags and hats (at a low shade)
  hex('#4f6478'), // 14 dusty blue: a dress
  hex('#8a5560'), // 15 a mini skirt's dusty rose
];
/**
 * Everyday clothes: tags 16 (tops), 17 (bottoms) and 18 (suits) take a colour from these by the figure (a hash of
 * its tint and fade seed, so it keeps them), so plain clothes differ from one person to the next.
 */
const CLOTH_TOPS: readonly V3[] = ['#b5b1a5', '#7a7a78', '#232c44', '#4a5a6e', '#9a8a6c', '#4d5234', '#562a2e', '#7d6a44', '#36484a', '#8c6064', '#3a3a3c', '#34443a', '#5a4030', '#c2b99e'].map(hex);
const CLOTH_BOTTOMS: readonly V3[] = ['#36465e', '#232c40', '#333336', '#857660', '#5e5e60', '#4a3828', '#454a30', '#222224'].map(hex);
const CLOTH_SUITS: readonly V3[] = ['#323236', '#20283c', '#5a5a5e', '#44362c'].map(hex);
/** The body: skin (tag 1, a little lighter or darker by the figure), hair (19; an elder's grey), shoes (20). These go to the one colour when it's on. */
const SKIN_TONE = hex('#b08e74');
const HAIR_COLORS: readonly V3[] = ['#17161a', '#1e1a18', '#17161a', '#2e221a'].map(hex);
const ELDER_HAIR: readonly V3[] = ['#7c7c7e', '#a6a6a4', '#5a5a5c'].map(hex);
const SHOE_COLORS: readonly V3[] = ['#1c1b1c', '#2e2420', '#151516', '#3a2c22'].map(hex);
const v3Glsl = (c: V3): string => `vec3(${c.map((v) => v.toFixed(4)).join(', ')})`;
/** GLSL: one of `colors` by h in [0, 1). */
const pickGlsl = (colors: readonly V3[], h: string): string => colors.map((c, i) => `${i < colors.length - 1 ? `${h} < ${((i + 1) / colors.length).toFixed(4)} ? ` : ''}${v3Glsl(c)}`).join(' : ');
const TAG_GLSL = TAG_COLORS.map((c, i) => `${i < TAG_COLORS.length - 1 ? `tag < ${i + 2}.5 ? ` : ''}${v3Glsl(c)}`).join(' : ');

/**
 * A smoker's round (s): the hand up to the mouth, the drag, the hand down, a moment's hold, the breath out; a round
 * every so many seconds (each their own, between the two) for a cigarette and for a cigar. (The material's mobPose
 * moves the arm and the head by it; real/smoke.ts lights the ember and lets the smoke out by it.)
 */
export const SMOKE_ROUND = { rise: 0.7, drag: 1.3, fall: 0.7, hold: 0.3, out: 1.6, every: [8, 15], cigar: [15, 24] } as const;
/** When in a round the breath starts out (s). */
export const SMOKE_OUT = SMOKE_ROUND.rise + SMOKE_ROUND.drag + SMOKE_ROUND.fall + SMOKE_ROUND.hold;
/** The mouth, from the head's joint in head heights (up, out of the face): where breath leaves and a cigarette goes. */
export const MOUTH = [0.14, 0.36] as const;
/** Where the fingers bring a cigarette's grip to, from the mouth (m, for a man: to the hand's side, up, out of the face). */
const SMOKE_AT_MOUTH = [0.012, -0.008, 0.03] as const;
/** A smoker's upper arm out from the body with the hand at the mouth (rad). */
const SMOKE_RAISE = 0.15;

const UMBRELLA_HOLD = { swing: -0.05, raise: 0.12, bend: 2.15, side: 0, twist: 0.45 } as const;
/** The spine's lean the umbrella is built for (the body's own, plus a little: walkers lean more, standers less). */
const umbrellaLean = (body: Body): number => (body === 'elder' ? 0.2 : 0.02) + 0.02;

/** The right forearm's matrix (bind pose to posed, figure frame) with the arm in UMBRELLA_HOLD, as poseBones builds it. */
function holdForearm(body: Body): THREE.Matrix4 {
  const { pivot, armOut } = pivotsOf(body);
  const L = UMBRELLA_HOLD;
  const about = (p: V3, r: THREE.Matrix4): THREE.Matrix4 => new THREE.Matrix4().makeTranslation(p[0], p[1], p[2]).multiply(r).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
  const spine = about(pivot[SPINE], new THREE.Matrix4().makeRotationX(umbrellaLean(body)));
  const arm = about(pivot[ARM_R], new THREE.Matrix4().makeRotationX(-L.swing).multiply(new THREE.Matrix4().makeRotationZ(L.raise - armOut)));
  const fore = about(pivot[FORE_R], new THREE.Matrix4().makeRotationY(-L.twist).multiply(new THREE.Matrix4().makeRotationZ(L.side)).multiply(new THREE.Matrix4().makeRotationX(-L.bend)));
  return spine.multiply(arm).multiply(fore);
}

/**
 * A clear vinyl umbrella (the konbini kind) for a body, held up in the right fist (mirrored for the left): a
 * shallow dome over the head, its shaft from just below the fist up to the canopy, leaning back so the dome
 * sits over the head. Laid out where the held arm (UMBRELLA_HOLD) puts the fist, then carried back into the
 * forearm's bind frame and skinned to the forearm, so it stays in the hand and rides the arm and the body.
 */
function buildUmbrella(body: Body): Template {
  const child = body === 'child';
  const k = child ? 0.62 : body === 'woman' ? 0.95 : 1;
  const P = PROPORTIONS[body];
  const tb = new TemplateBuilder();
  const fore = holdForearm(body);
  // The fist, held: the hand's middle in the bind pose, posed.
  const fist = new THREE.Vector3(P.wristX + 0.003, 0.77 * P.ys, 0.01).applyMatrix4(fore);
  const top = 1.95 * k + 0.25;
  const R = child ? 0.42 : 0.52;
  // The canopy's crown over the head (a little forward), the shaft from the fist up to it.
  const crown = new THREE.Vector3(0.05 * k, top, 0.1);
  const axis = crown.clone().sub(fist).normalize();
  const len = crown.distanceTo(fist);
  // Built upright in its own frame (the shaft up y from the handle at y 0), then stood on that axis.
  const handle = 0.09;
  const prof: [number, number][] = [[len + handle - 0.22, R], [len + handle - 0.14, R * 0.86], [len + handle - 0.05, R * 0.55], [len + handle, R * 0.15], [len + handle + 0.02, 0.005]];
  // Outside, then the underside a little below, wound the other way so it shows from beneath.
  tb.loft(prof.map(([y, r]): Row => [y, r, r, 0]), () => 0, () => one(FORE_R), 1.6, 12);
  const from = tb.idx.length;
  tb.loft(prof.map(([y, r]): Row => [y - 0.008, r, r, 0]), () => 0, () => one(FORE_R), 1.6, 12);
  for (let i = from; i < tb.idx.length; i += 3) [tb.idx[i + 1], tb.idx[i + 2]] = [tb.idx[i + 2], tb.idx[i + 1]];
  // The shaft: a thin square tube from the handle's end, through the fist, up to the canopy; a thicker grip.
  const tube = (y0: number, y1: number, r: number): void => {
    const base = tb.pos.length / 3;
    for (const y of [y0, y1]) {
      for (let j = 0; j < 4; j++) {
        const q = (j / 4) * Math.PI * 2;
        tb.pos.push(Math.cos(q) * r, y, Math.sin(q) * r);
        tb.b0.push(FORE_R);
        tb.b1.push(FORE_R);
        tb.w.push(1);
        tb.shade.push(1.6);
      }
    }
    for (let j = 0; j < 4; j++) {
      const j1 = (j + 1) % 4;
      tb.idx.push(base + j, base + 4 + j1, base + j1, base + j, base + 4 + j, base + 4 + j1);
    }
  };
  tube(0, len + handle, 0.008);
  tube(0, handle * 0.8, 0.016);
  // Stand it on the axis with the handle's end below the fist, then undo the held forearm.
  const place = new THREE.Matrix4()
    .makeTranslation(fist.x - axis.x * handle, fist.y - axis.y * handle, fist.z - axis.z * handle)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)));
  const toBind = fore.clone().invert().multiply(place);
  const v = new THREE.Vector3();
  for (let i = 0; i < tb.pos.length; i += 3) {
    v.set(tb.pos[i], tb.pos[i + 1], tb.pos[i + 2]).applyMatrix4(toBind);
    tb.pos[i] = v.x;
    tb.pos[i + 1] = v.y;
    tb.pos[i + 2] = v.z;
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
  /** The forearm's bend out to the side (a wave holds it upright), radians. */
  side?: number;
  /** The forearm turned in across the body (arms crossed, hands clasped), radians. */
  twist?: number;
}

interface Skeleton {
  lean: number;
  drop: number;
  armL: Limb;
  armR: Limb;
  legL: Limb;
  legR: Limb;
}

/** Pose 'hold': how far out the holding arm is raised (a child's hand up to a grown-up's), unless the figure says. */
const holdReach = (s: Pick<FigureSpec, 'body' | 'reach'>): number => s.reach ?? (s.body === 'child' ? 0.75 : 0.26);

/** `hip`: the hip joints' height (the template's). */
function skeleton(s: FigureSpec, umbrella = false, hip = PROPORTIONS[s.body].ys * 0.9): Skeleton {
  const still: Limb = { swing: 0, raise: 0.1, bend: 0.12 };
  const leg: Limb = { swing: 0, raise: 0.0, bend: 0 };
  const sk: Skeleton = { lean: s.body === 'elder' ? 0.2 : 0.02, drop: 0, armL: { ...still }, armR: { ...still }, legL: { ...leg }, legR: { ...leg } };
  const gest = (l: Limb, swing: number, raise: number, bend: number, side = 0, twist = 0): void => {
    l.swing = swing;
    l.raise = raise;
    l.bend = bend;
    l.side = side;
    l.twist = twist;
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
      sk.drop = hip * (1 - Math.cos(a));
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
      gest(armS, 0.15, 1.3, 0, 1.35);
      break;
    case 'hold':
      gest(armS, 0.1, holdReach(s), 0.1);
      break;
    case 'sit':
      // On a seat 0.46 m up: thighs forward, shins down, hands in the lap.
      gest(sk.legL, 1.45, 0.07, 1.45);
      gest(sk.legR, 1.45, 0.07, 1.45);
      gest(sk.armL, 0.3, 0.08, 0.75);
      gest(sk.armR, 0.3, 0.08, 0.75);
      sk.lean = -0.05;
      sk.drop = hip - 0.46;
      break;
    case 'strap':
      // Holding a strap overhead.
      gest(armS, 2.75, 0.12, 0.25);
      break;
    case 'gait': {
      // Standing, walking or running by its pace (as the material blends them; at rest, no idle routine).
      const wk = Math.min(1, Math.max(0, s.pace ?? 0));
      const rn = Math.min(1, Math.max(0, (s.pace ?? 0) - 1));
      const G = gaitLimbs(s.phase, rn);
      const mix = (l: Limb, to: Limb): void => gest(l, l.swing + (to.swing - l.swing) * wk, l.raise + (to.raise - l.raise) * wk, l.bend + (to.bend - l.bend) * wk);
      mix(sk.legL, G.legL);
      mix(sk.legR, G.legR);
      mix(sk.armL, G.armL);
      mix(sk.armR, G.armR);
      sk.lean += wk * G.lean;
      sk.drop = wk * hip * G.drop;
      break;
    }
    case 'ride': {
      // In a car's seat (the hips RIDE_HIP above the cushion): the legs out ahead, the hands in the lap, leaning back.
      const R = rideLegs(s.pace ?? 0);
      gest(sk.legL, R.swing, 0.06, R.bend);
      gest(sk.legR, R.swing, 0.06, R.bend);
      gest(sk.armL, RIDE_ARM[0], RIDE_ARM[1], RIDE_ARM[2]);
      gest(sk.armR, RIDE_ARM[0], RIDE_ARM[1], RIDE_ARM[2]);
      sk.lean = RIDE_LEAN;
      sk.drop = hip - RIDE_HIP;
      break;
    }
    case 'stand':
      gest(sk.legR, 0.03, 0.06, 0.02);
      break;
  }
  if (holdsStraps(s) && (s.pose === 'stand' || s.pose === 'walk' || s.pose === 'gait')) {
    const H = STRAP_HOLD;
    gest(sk.armL, H.swing, H.raise, H.bend, 0, H.twist);
    gest(sk.armR, H.swing, H.raise, H.bend, 0, H.twist);
  }
  if (umbrella) {
    // Held up in the gesturing hand, unless that one holds someone's hand (as the material does).
    const H = UMBRELLA_HOLD;
    gest((s.pose === 'hold' ? -s.side : s.side) > 0 ? sk.armR : sk.armL, H.swing, H.raise, H.bend, H.side, H.twist);
  }
  return sk;
}

/** A car seat: the hip joints' height above the cushion (m), and the spine's lean back against the seat (rad). */
export const RIDE_HIP = 0.1;
const RIDE_LEAN = -0.22;
/** A rider's arms (swing, raise, bend): the hands resting on the thighs. */
const RIDE_ARM = [0.2, 0.06, 0.6] as const;
/**
 * A seated rider's legs by how far the knees are tucked up (0-1): the thigh's swing and the knee's bend. Legs out,
 * the feet are 0.75 m ahead of the hips; tucked, 0.44 m; either way about 0.29 m below them.
 */
const rideLegs = (tuck: number): { swing: number; bend: number } => {
  const k = Math.min(1, Math.max(0, tuck));
  const swing = 1.7 + 0.3 * k;
  return { swing, bend: swing - (0.75 - 0.65 * k) };
};

/** How the walk's cycle is run: the stride's reach (rad), the knee's fold as the leg comes through, the arms. */
const GAIT = { reach: [0.36, 0.6], fold: 1.15, foldAt: 0.4, arm: [0.7, 1.2], elbow: [0.25, 1.5], lean: [0.04, 0.2] } as const;

/** A 'gait' figure's limbs at full pace (walking, or by `rn` 0-1 running), at `phase` of the stride: as the material's. */
function gaitLimbs(phase: number, rn: number): { legL: Limb; legR: Limb; armL: Limb; armR: Limb; lean: number; drop: number } {
  const lerp = (a: readonly [number, number]): number => a[0] + (a[1] - a[0]) * rn;
  const ph = phase * Math.PI * 2;
  const amp = lerp(GAIT.reach);
  const a = Math.sin(ph) * amp;
  const c = Math.cos(ph + GAIT.foldAt);
  // Walking, the knee bends as the leg goes back; running, it folds up as the leg comes through.
  const knee = (back: number, through: number): number => 0.06 + (1 - rn) * 0.24 * Math.min(1, Math.max(0, back)) + rn * (0.15 + GAIT.fold * Math.max(0, through));
  const sw = lerp(GAIT.arm);
  const el = lerp(GAIT.elbow);
  return {
    legL: { swing: a, raise: 0, bend: knee(-a / amp, c) },
    legR: { swing: -a, raise: 0, bend: knee(a / amp, -c) },
    armL: { swing: -a * sw, raise: 0.1, bend: el },
    armR: { swing: a * sw, raise: 0.1, bend: el },
    lean: lerp(GAIT.lean),
    // (As a share of the hips' height: they drop as the legs part; a runner's less, between bounds.)
    drop: (1 - Math.cos(a)) * (1 - 0.5 * rn),
  };
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const boneMats = Array.from({ length: BONES }, () => new THREE.Matrix4());
const rot = Array.from({ length: BONES }, () => new THREE.Matrix4());

/** Each bone's matrix (bind pose to posed), in the figure frame. */
function poseBones(T: Template, s: FigureSpec, umbrella = false): THREE.Matrix4[] {
  const sk = skeleton(s, umbrella, T.pivot[THIGH_L][1]);
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
    // rotY(-sgn twist) rotZ(sgn side) rotX(-bend): bent forward, out to the side, turned in (as the shader).
    rot[fore].makeRotationY(-sgn * (l.twist ?? 0)).multiply(_r.makeRotationZ(sgn * (l.side ?? 0))).multiply(_t.makeRotationX(-l.bend));
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

export const BODY_LIST: readonly Body[] = ['man', 'woman', 'child', 'elder'];
const HAIR_LIST: readonly Hair[] = ['short', 'long', 'bun', 'hat', 'cap', 'none', 'bob', 'ponytail', 'twin'];
export const POSE_LIST: readonly Pose[] = ['stand', 'walk', 'talk', 'phone', 'pockets', 'wave', 'hold', 'sit', 'strap', 'gait', 'ride'];

/** Body templates are 0 to TEMPLATE_COUNT - 1 (body, outfit, hair); the umbrellas follow, one per body. */
export const TEMPLATE_COUNT = BODY_LIST.length * OUTFITS.length * HAIR_LIST.length;
export const templateIndex = (s: Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit' | 'model'>): number =>
  s.model !== undefined && modelSlot(s.model) >= 0
    ? TEMPLATE_COUNT + BODY_LIST.length + TEEN_ROWS + modelSlot(s.model)
    : (BODY_LIST.indexOf(s.body) * OUTFITS.length + OUTFITS.indexOf(outfitOf(s))) * HAIR_LIST.length + HAIR_LIST.indexOf(s.hair);
export const umbrellaIndex = (body: Body): number => TEMPLATE_COUNT + BODY_LIST.indexOf(body);
/** A figure's umbrella: its body's, or a teen's own (a row an umbrella, as the joints: TEMPLATE_COUNT + the body's row). */
const umbrellaOf = (s: Pick<FigureSpec, 'body' | 'long' | 'outfit'>): number => (teenRow(s) >= 0 ? TEMPLATE_COUNT + BODY_LIST.length + teenRow(s) : umbrellaIndex(s.body));

/**
 * Modelled figures (real/mobModels.ts): each a template of its own after the umbrellas', and a body of its own in
 * the material (its joints), after the four lofted ones. Register them before the material is made
 * (`ghostMaterial` takes their joints then), at most MAX_MOB_MODELS.
 */
export const MAX_MOB_MODELS = 252;
const mobModels: { name: string; doc: MobModelDoc | null; template: Template }[] = [];
const modelSlot = (name: string): number => mobModels.findIndex((m) => m.name === name);
export function registerMobModel(doc: MobModelDoc): void {
  if (modelSlot(doc.name) >= 0) return;
  if (mobModels.length >= MAX_MOB_MODELS) throw new Error(`too many mob models (${MAX_MOB_MODELS})`);
  mobModels.push({ name: doc.name, doc, template: modelTemplate(doc) });
  if (jointTexture) writeJoints(jointTexture);
}

/**
 * Every body's joints for the material, as a texture (a uniform array ran out with the models): a row a body (the
 * four lofted ones, then the models as registered), a texel a bone (xyz its joint), and the arms' bind angle in
 * the texel after the bones. One texture for every mob material, rewritten when a model is registered.
 */
const JOINT_COLS = 44;
/** (A named character's finger and toe joints, real/mobRig.ts: the texels after these.) */
const DIGIT_COL = 20;
/**
 * The texels after the bones' in a body's row: the arms' bind angle (x); a hand's grip, where the fingers hold a
 * cigarette (the right hand's, bind pose: x mirrored for the left); the mouth (bind pose) and the head's height (w);
 * a smoker's arm with the hand at the mouth (swing, bend, twist, and the raise in w).
 */
export const JOINT_EXTRA = { armOut: BONES, grip: BONES + 1, mouth: BONES + 2, reach: BONES + 3 } as const;
/** The shaped generation's teens (real/mobShape.ts `isTeen`): a row of joints each after the four bodies' (a girl's, a boy's), before the models'. */
const TEEN_ROWS = 2;
const teenRow = (s: Pick<FigureSpec, 'body' | 'long' | 'outfit'>): number => (mobShape === 'shaped' && isTeen(s.body, outfitOf(s)) ? (s.body === 'woman' ? 0 : 1) : -1);
const JOINT_ROWS = BODY_LIST.length + TEEN_ROWS + MAX_MOB_MODELS;
let jointTexture: THREE.DataTexture | null = null;
function writeJoints(tex: THREE.DataTexture): void {
  const data = tex.image.data as Float32Array;
  // (A smoker's numbers are the body's own; a teen's and a model's, who don't smoke, the grown body's scaled or as they are.)
  const row = (r: number, pivot: readonly V3[], armOut: number, sm: SmokerJoints, kx = 1, ky = 1): void => {
    pivot.forEach((p, b) => b < BONES + DIGIT_BONES && data.set([p[0], p[1], p[2], 0], (r * JOINT_COLS + (b < BONES ? b : DIGIT_COL + b - BONES)) * 4));
    data[(r * JOINT_COLS + JOINT_EXTRA.armOut) * 4] = armOut;
    data.set([sm.grip[0] * kx, sm.grip[1] * ky, sm.grip[2] * kx, 0], (r * JOINT_COLS + JOINT_EXTRA.grip) * 4);
    data.set([sm.mouth[0] * kx, sm.mouth[1] * ky, sm.mouth[2] * kx, sm.head * ky], (r * JOINT_COLS + JOINT_EXTRA.mouth) * 4);
    data.set([sm.reach.swing, sm.reach.bend, sm.reach.twist ?? 0, sm.reach.raise], (r * JOINT_COLS + JOINT_EXTRA.reach) * 4);
  };
  BODY_LIST.forEach((body, r) => {
    const p = pivotsOf(body);
    row(r, p.pivot, p.armOut, smokerJoints(body));
  });
  (['woman', 'man'] as const).forEach((body, t) => {
    const p = pivotsOf(body);
    const [kx, ky] = TEEN_SCALE[body];
    row(BODY_LIST.length + t, p.pivot.map((v): V3 => [v[0] * kx, v[1] * ky, v[2] * kx]), p.armOut, smokerJoints(body), kx, ky);
  });
  mobModels.forEach((m, i) => row(BODY_LIST.length + TEEN_ROWS + i, m.template.pivot, m.template.armOut, smokerJoints('man')));
  tex.needsUpdate = true;
}

/** What the material needs to know of a body to have it smoke (JOINT_EXTRA). */
export interface SmokerJoints {
  /** Where the fingers hold a cigarette: a point of the right hand in the bind pose (figure frame). */
  readonly grip: V3;
  /** The mouth in the bind pose, and the head's height (its joint to the top of the hair). */
  readonly mouth: V3;
  readonly head: number;
  /** The arm with the hand at the mouth. */
  readonly reach: Limb;
}
const smokers = new Map<Body, SmokerJoints>();
const _fk = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
const about = (m: THREE.Matrix4, at: V3): THREE.Matrix4 => _fk[1].makeTranslation(at[0], at[1], at[2]).multiply(m).multiply(_fk[2].makeTranslation(-at[0], -at[1], -at[2]));
/** A point of the right forearm (bind pose) with the arm posed, the body standing with its spine leant by `lean` (figure frame). */
function armPoint(pivot: readonly V3[], armOut: number, lean: number, l: Limb, p: V3, out: THREE.Vector3): THREE.Vector3 {
  const M = _fk[0].copy(about(_r.makeRotationX(lean), pivot[SPINE]));
  M.multiply(about(_r.makeRotationX(-l.swing).multiply(_t.makeRotationZ(l.raise - armOut)), pivot[ARM_R]));
  M.multiply(about(_r.makeRotationY(-(l.twist ?? 0)).multiply(_t.makeRotationZ(l.side ?? 0)).multiply(_fk[3].makeRotationX(-l.bend)), pivot[FORE_R]));
  return out.set(p[0], p[1], p[2]).applyMatrix4(M);
}
/** A point of the head (bind pose) with the body standing, its spine leant by `lean` (figure frame): as the material turns the head back upright. */
function headPoint(pivot: readonly V3[], lean: number, p: V3, out: THREE.Vector3): THREE.Vector3 {
  const M = _fk[0].copy(about(_r.makeRotationX(lean), pivot[SPINE]));
  M.multiply(about(_r.makeRotationX(-lean * 0.7), pivot[HEAD]));
  return out.set(p[0], p[1], p[2]).applyMatrix4(M);
}
/** A body's sculpted figure (the city's generation, whichever is set), plainly dressed. */
function plainFigure(body: Body): Template {
  const was = mobShape;
  mobShape = 'shaped';
  const T = template(body, 'short', 'plain');
  mobShape = was;
  return T;
}
/**
 * A body's hand, mouth and reach for smoking, measured on its sculpted figure and solved once: the arm's swing, bend
 * and twist that bring the fingers to the mouth.
 */
export function smokerJoints(body: Body): SmokerJoints {
  const had = smokers.get(body);
  if (had) return had;
  const T = plainFigure(body);
  const k = T.pivot[ARM_R][1] / 1.42;
  // The hand: the fingers are its lowest part.
  let lo = Infinity;
  let top = 0;
  for (let i = 0; i < T.b0.length; i++) {
    top = Math.max(top, T.pos[i * 3 + 1]);
    if (T.b0[i] === FORE_R && (T.b1[i] === FORE_R || T.w[i] > 0.99)) lo = Math.min(lo, T.pos[i * 3 + 1]);
  }
  const c = handBind(T, 1);
  const grip: V3 = [c.x, lo + 0.02 * k, c.z + 0.012 * k];
  const head = top - T.pivot[HEAD][1];
  const mouth: V3 = [0, T.pivot[HEAD][1] + head * MOUTH[0], T.pivot[HEAD][2] + head * MOUTH[1]];
  // Solved standing (an elder stoops): a coarse search, then closing in.
  const lean = body === 'elder' ? 0.2 : 0.02;
  const to = headPoint(T.pivot, lean, mouth, new THREE.Vector3()).add(new THREE.Vector3(SMOKE_AT_MOUTH[0] * k, SMOKE_AT_MOUTH[1] * k, SMOKE_AT_MOUTH[2] * k));
  const at = new THREE.Vector3();
  const miss = (swing: number, bend: number, twist: number): number => armPoint(T.pivot, T.armOut, lean, { swing, raise: SMOKE_RAISE, bend, twist }, grip, at).distanceTo(to);
  let best: [number, number, number] = [0.5, 2.3, 0.45];
  let err = miss(...best);
  for (let swing = 0; swing <= 1.4; swing += 0.1) {
    for (let bend = 1.5; bend <= 2.75; bend += 0.1) {
      for (let twist = 0; twist <= 1.2; twist += 0.1) {
        const e = miss(swing, bend, twist);
        if (e < err) [best, err] = [[swing, bend, twist], e];
      }
    }
  }
  for (let step = 0.05; step > 0.0005; step /= 2) {
    for (let again = 0; again < 4; again++) {
      for (let j = 0; j < 3; j++) {
        for (const d of [-step, step]) {
          const q: [number, number, number] = [...best];
          q[j] += d;
          // (An elbow only folds so far, and the forearm turns in, not out.)
          if (q[1] > 2.75 || q[2] < 0 || q[2] > 1.3) continue;
          const e = miss(...q);
          if (e < err) [best, err] = [q, e];
        }
      }
    }
  }
  const got: SmokerJoints = { grip, mouth, head, reach: { swing: best[0], raise: SMOKE_RAISE, bend: best[1], twist: best[2] } };
  smokers.set(body, got);
  return got;
}
/**
 * For tests: where a smoker's fingers are with the hand up at the mouth (`up` 1) or down (0), and where the mouth
 * is, standing (figure frame, the right hand's).
 */
export function smokerReach(body: Body, up = 1): { hand: [number, number, number]; mouth: [number, number, number] } {
  const J = smokerJoints(body);
  const T = plainFigure(body);
  const lean = body === 'elder' ? 0.2 : 0.02;
  const mix = (a: number, b: number): number => a + (b - a) * up;
  const l: Limb = { swing: mix(0.14, J.reach.swing), raise: mix(0.12, J.reach.raise), bend: mix(0.62, J.reach.bend), twist: mix(0.15, J.reach.twist ?? 0) };
  return { hand: armPoint(T.pivot, T.armOut, lean, l, J.grip, new THREE.Vector3()).toArray(), mouth: headPoint(T.pivot, lean, J.mouth, new THREE.Vector3()).toArray() };
}

function mobJoints(): THREE.DataTexture {
  if (!jointTexture) {
    jointTexture = new THREE.DataTexture(new Float32Array(JOINT_COLS * JOINT_ROWS * 4), JOINT_COLS, JOINT_ROWS, THREE.RGBAFormat, THREE.FloatType);
    jointTexture.minFilter = jointTexture.magFilter = THREE.NearestFilter;
    jointTexture.generateMipmaps = false;
    writeJoints(jointTexture);
  }
  return jointTexture;
}
/**
 * A figure built elsewhere (a named character: real/mobCharacters.ts), registered as the models are: a template of
 * its own and a body of its own in the material, so it can have its own height and joints. `FigureSpec.model` draws it.
 */
export function registerMobTemplate(name: string, template: Template): void {
  if (modelSlot(name) >= 0) return;
  if (mobModels.length >= MAX_MOB_MODELS) throw new Error(`too many mob models (${MAX_MOB_MODELS})`);
  mobModels.push({ name, doc: null, template });
  if (jointTexture) writeJoints(jointTexture);
}
export const mobModelNames = (): string[] => mobModels.map((m) => m.name);
/** The template a figure is drawn with: its model's, else its body's with its hair and outfit. */
function templateOf(s: Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit' | 'model'>): Template {
  const m = s.model === undefined ? -1 : modelSlot(s.model);
  return m >= 0 ? mobModels[m].template : template(s.body, s.hair, outfitOf(s));
}

function templateAt(i: number): Template {
  if (i >= TEMPLATE_COUNT + BODY_LIST.length + TEEN_ROWS) return mobModels[i - TEMPLATE_COUNT - BODY_LIST.length - TEEN_ROWS].template;
  if (i >= TEMPLATE_COUNT) {
    // An umbrella a body, then a teen girl's and a teen boy's (the adult's, scaled as the teen is).
    const row = i - TEMPLATE_COUNT;
    let t = templates.get(`umbrella|${row}`);
    if (!t) {
      if (row < BODY_LIST.length) t = buildUmbrella(BODY_LIST[row]);
      else {
        const body = row === BODY_LIST.length ? 'woman' : 'man';
        const [kx, ky] = TEEN_SCALE[body];
        const U = buildUmbrella(body);
        t = { ...U, pos: Float32Array.from(U.pos, (v, j) => v * (j % 3 === 1 ? ky : kx)), pivot: U.pivot.map((v): V3 => [v[0] * kx, v[1] * ky, v[2] * kx]) };
      }
      templates.set(`umbrella|${row}`, t);
    }
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

const geometries = new Map<string, THREE.BufferGeometry>();

/** A template as geometry (its bind pose and bones), shared by every figure drawn with it (real/crowd.ts). */
export function templateGeometry(i: number): THREE.BufferGeometry {
  const key = `${mobShape}|${i}`;
  let g = geometries.get(key);
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
  geometries.set(key, g);
  return g;
}

/**
 * A figure as numbers (packFigures), FIGURE_STRIDE floats: template, x, z, yaw, seed, body, pose, side, look,
 * walk ex, ez, speed, phase, floor at the start and end, gap, tint r, g, b, whether it carries an umbrella, and when
 * it's out: its hours (-1: always), its manner, its threshold, the seasons its outfit is worn in (bits).
 */
export const FIGURE_STRIDE = 24;
/** The pavements' and plazas' height (real/ground.ts): where a figure stands unless its floor says otherwise. */
export const PAVEMENT = 0.15;
/**
 * GLSL: where a figure is and whether it's there, from its numbers (a walker along its walk, a crosser on the
 * signal's clock, the fades; with uStay nobody comes and goes). The mob's vertex shader uses it, and so can anything
 * drawn with the figures (their emotes): it needs the attributes aFig, aWalk, aGround and aWhen and the uniforms
 * uStay, uHour, uRain and uSeason. Its fade is 0 for someone who isn't out at this hour, in this weather or season.
 */
export const MOB_PLACE_GLSL = /* glsl */ `${HOURS_GLSL}
      // Where a figure is and whether it's there (MOB_PLACE_GLSL: shared with anything drawn with the figures, like
      // their emotes). Needs aFig, aWalk, aGround and uStay declared.
      struct MobPlace { vec2 org; float ground; float phase; float fade; float turn; bool moving; bool crosser; };
      MobPlace mobPlace(float t, int body, float seed) {
        // Where it is: a walker along its walk, fading in at the start and out at the end, then away for its
        // gap; everyone else where they stand, on their own fade cycle. With uStay nobody fades: a walker stops at
        // the end of its walk for its gap, turns round and walks back; someone at a crossing crosses on one green
        // and back on the next.
        vec2 org = aFig.xy;
        float ground = aGround.x;
        float phase = aWalk.w;
        float fade = 1.0;
        // (Turned round, for the way back.)
        float turn = 0.0;
        bool stay = uStay > 0.5;
        bool moving = aWalk.z > 0.0;
        bool crosser = moving && aGround.z < 0.0;
        if (crosser) {
          // On a signal's clock (cycle C): appear at the kerb at aWalk.w, wait W s for the walk light, cross,
          // gone at the far side until the next cycle. Off the kerb (from 0.4 m in) a step down to the road.
          float C = floor(-aGround.z / 100.0);
          float W = mod(-aGround.z, 100.0);
          float L = max(length(aWalk.xy), 0.1);
          float tw = L / aWalk.z;
          float s = mod(t - aWalk.w, C);
          float k = clamp((s - W) / tw, 0.0, 1.0);
          moving = s > W && s < W + tw;
          fade = smoothstep(0.0, 1.5, s) * (1.0 - smoothstep(W + tw - 1.2, W + tw, s));
          if (stay) {
            // Every other cycle from the far side, turning round at the kerb as the cycle begins.
            bool odd = mod(floor((t - aWalk.w) / C), 2.0) > 0.5;
            if (odd) k = 1.0 - k;
            turn = (odd ? 0.0 : 3.14159265) + 3.14159265 * smoothstep(0.0, 0.9, s);
            fade = 1.0;
          }
          org += aWalk.xy * k;
          float d = k * L;
          ground = mix(aGround.x, aGround.y, k) - ${PAVEMENT.toFixed(2)} * smoothstep(0.3, 0.6, d) * (1.0 - smoothstep(L - 0.6, L - 0.3, d));
          phase = fract(k * L / ((body == 2 ? 0.95 : 1.35) * (1.0 + 0.7 * clamp(aWalk.z - 1.9, 0.0, 1.0))));
        } else if (moving) {
          float L = max(length(aWalk.xy), 0.1);
          float tw = L / aWalk.z;
          float k;
          if (stay) {
            // There (tw), a stop for the gap, back (tw), a stop.
            float leg = tw + max(aGround.z, 2.5);
            float u = mod(t + fract(abs(seed) * 7.31) * 2.0 * leg, 2.0 * leg);
            bool back = u >= leg;
            float v = back ? u - leg : u;
            float k1 = clamp(v / tw, 0.0, 1.0);
            k = back ? 1.0 - k1 : k1;
            moving = v < tw;
            turn = (back ? 3.14159265 : 0.0) + 3.14159265 * smoothstep(leg - 1.2, leg, v);
          } else {
            float cycle = tw + aGround.z;
            float u = mod(t + fract(abs(seed) * 7.31) * cycle, cycle);
            k = clamp(u / tw, 0.0, 1.0);
            if (seed >= 0.0) fade = smoothstep(0.0, 1.6, u) * (1.0 - smoothstep(tw - 1.6, tw, u));
          }
          org += aWalk.xy * k;
          ground = mix(aGround.x, aGround.y, k);
          phase = fract(aWalk.w + k * L / ((body == 2 ? 0.95 : 1.35) * (1.0 + 0.7 * clamp(aWalk.z - 1.9, 0.0, 1.0))));
        } else if (seed >= 0.0 && !stay) {
          float cycle = 50.0 + 70.0 * seed;
          float ph = fract(t / cycle + seed * 13.37);
          float e = 3.5 / cycle;
          fade = smoothstep(0.0, e, ph) * (1.0 - smoothstep(0.8, 0.8 + e, ph));
        }
        // Out at this hour, in this weather and season? (aWhen: its hours, manner, threshold, seasons; hours -1: always.)
        if (aWhen.x > -0.5) {
          float there = smoothstep(aWhen.z - 0.02, aWhen.z + 0.02, mobOut(aWhen.x, uHour, uRain));
          if (mod(floor(aWhen.w / exp2(floor(uSeason + 0.5))), 2.0) < 0.5) there = 0.0;
          fade *= there;
        }
        return MobPlace(org, ground, phase, fade, turn, moving, crosser);
      }
`;

/** The per-figure attributes the material reads, and where each comes from in a figure's numbers. */
export const FIGURE_ATTRS: readonly { readonly name: string; readonly at: readonly number[] }[] = [
  { name: 'aFig', at: [1, 2, 3, 4] },
  { name: 'aPose', at: [5, 6, 7, 8] },
  { name: 'aWalk', at: [9, 10, 11, 12] },
  { name: 'aGround', at: [13, 14, 15] },
  { name: 'aTint', at: [16, 17, 18] },
  { name: 'aWhen', at: [20, 21, 22, 23] },
];

/** A figure's fade seed in [0, 1): its own or from where it stands; -1 if it never fades (-2: nor up close). */
function figureSeed(s: FigureSpec): number {
  if (s.fade === false) return s.close ? -2 : -1;
  return s.seed ?? u01(hash(Math.round(s.x * 10), Math.round(s.z * 10), 0x6057));
}

/** Most people carry an umbrella in the rain: whether this one does is a pure function of where they stand. */
function carriesUmbrella(s: FigureSpec): boolean {
  const h = (Math.imul(Math.round(s.x * 10), 73856093) ^ Math.imul(Math.round(s.z * 10), 19349663)) >>> 0;
  return h % 100 < 72;
}

function writeFigure(o: Float32Array, k: number, s: FigureSpec, ground: ((x: number, z: number) => number) | null, umbrella: boolean): void {
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
  // (A model has a body of its own in the material: its joints. So has the shaped generation's teen.)
  const slot = s.model === undefined ? -1 : modelSlot(s.model);
  const teen = teenRow(s);
  o[k + 5] = slot >= 0 ? BODY_LIST.length + TEEN_ROWS + slot : teen >= 0 ? BODY_LIST.length + teen : BODY_LIST.indexOf(s.body);
  o[k + 6] = POSE_LIST.indexOf(s.pose);
  // (+1: a bag in the left hand, so the routine keeps that hand down; +2: an umbrella to hold up while it rains.)
  const o2 = outfitOf(s);
  // (A drunk's box of sushi, a sukeban's wooden sword.)
  const bag = ((o2 === 'suit' || o2 === 'office') && s.body !== 'woman') || (o2 === 'school' && s.body !== 'child') || o2 === 'drunk' || (o2 === 'yankee' && s.body === 'woman');
  const held = umbrella && carriesUmbrella(s);
  // (+4: both hands on a rucksack's straps. +8: a cigarette to smoke; +16: a cigar.)
  o[k + 7] = (s.side >= 0 ? 1 : -1) * (1 + (bag ? 1 : 0) + (held ? 2 : 0) + (holdsStraps(s) ? 4 : 0) + (s.smokes ? 8 * (1 + SMOKES.indexOf(s.smokes)) : 0));
  o[k + 8] = s.look;
  // (A figure moved by the game has no walk of its own: its pace goes in the walk's place.)
  // (And someone holding a hand: how far out that arm is raised.)
  o[k + 9] = w?.ex ?? (s.pose === 'gait' || s.pose === 'ride' ? (s.pace ?? 0) : s.pose === 'hold' ? holdReach(s) : 0);
  o[k + 10] = w?.ez ?? 0;
  o[k + 11] = w?.speed ?? 0;
  o[k + 12] = w?.signal ? w.signal.at : s.phase;
  o[k + 13] = y + g0;
  o[k + 14] = y + g1;
  // (A signal crossing packs its cycle and wait into the gap: -(cycle * 100 + wait), both whole seconds.)
  o[k + 15] = w?.signal ? -(Math.round(w.signal.cycle) * 100 + Math.min(99, Math.round(w.signal.wait))) : (w?.gap ?? 0);
  o[k + 16] = c[0];
  o[k + 17] = c[1];
  o[k + 18] = c[2];
  o[k + 19] = carriesUmbrella(s) ? 1 : 0;
  // When it's out. (Someone who never fades, a story npc or a passenger, is always there.)
  const always = s.hours === undefined || s.fade === false;
  o[k + 20] = always ? -1 : HOURS.indexOf(s.hours!);
  o[k + 21] = MANNERS.indexOf(s.manner ?? 'plain');
  o[k + 22] = s.out ?? 0;
  o[k + 23] = always ? 15 : seasonsOf(o2);
}

/**
 * Figures as numbers for the instanced crowd, standing on `ground` (the terrain) plus their own floor. With
 * `umbrellas`, those who carry one hold it up while the material's `uUmbrella` is on (the crowd draws the
 * umbrellas then); baked figures without an umbrella of their own leave it off.
 */
export function packFigures(specs: readonly FigureSpec[], ground: ((x: number, z: number) => number) | null = null, umbrellas = true): Float32Array {
  const out = new Float32Array(specs.length * FIGURE_STRIDE);
  specs.forEach((s, i) => writeFigure(out, i * FIGURE_STRIDE, s, ground, umbrellas));
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

  /**
   * People standing together come and go together: those who fade and stand within TOGETHER m of one another (up to
   * TOGETHER_MAX: a couple, a parent and child, a little group, a stretch of a queue) take the first one's fade seed.
   * (Someone's umbrella stands where they do, so it goes with them.) Walkers who go together are given one seed
   * where they're made (cellCrowd).
   */
  private seeds(): Float32Array {
    const P = this.parts;
    const seeds = Float32Array.from(P, (p) => p.f[4]);
    const taken = new Uint8Array(P.length);
    const standing = (f: Float32Array): boolean => f[4] >= 0 && f[11] === 0;
    for (let i = 0; i < P.length; i++) {
      if (taken[i] || !standing(P[i].f)) continue;
      const members = [i];
      taken[i] = 1;
      let people = 1;
      for (let m = 0; m < members.length; m++) {
        const a = P[members[m]].f;
        for (let j = i + 1; j < P.length; j++) {
          const b = P[j].f;
          if (taken[j] || !standing(b) || Math.abs(a[13] - b[13]) > 0.6) continue;
          const d = Math.hypot(a[1] - b[1], a[2] - b[2]);
          if (d > TOGETHER) continue;
          if (d > 0.01) {
            if (people >= TOGETHER_MAX) continue;
            people++;
          }
          taken[j] = 1;
          members.push(j);
          seeds[j] = seeds[i];
        }
      }
    }
    return seeds;
  }

  raw(ox: number, oz: number): RawGeometry | null {
    if (this.parts.length === 0) return null;
    const seeds = this.seeds();
    let pi = 0;
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
      f[4] = seeds[pi++];
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

/** How near two standing people are to be together (m), and how many at most come and go as one. */
const TOGETHER = 1.25;
const TOGETHER_MAX = 4;

/** The middle of a template's hand in its bind pose (sgn 1 the right, -1 the left): the lowest of what the forearm carries. */
function handBind(T: Template, sgn: number): THREE.Vector3 {
  // (Read off the right arm and mirrored: a bag hangs from the left.)
  let lo = Infinity;
  for (let i = 0; i < T.b0.length; i++) if (T.b0[i] === FORE_R && (T.b1[i] === FORE_R || T.w[i] > 0.99)) lo = Math.min(lo, T.pos[i * 3 + 1]);
  const top = lo + 0.045 * (T.pivot[ARM_R][1] / 1.42);
  const c = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < T.b0.length; i++) {
    if (T.b0[i] !== FORE_R || (T.b1[i] !== FORE_R && T.w[i] <= 0.99) || T.pos[i * 3 + 1] > top) continue;
    c.x += T.pos[i * 3];
    c.y += T.pos[i * 3 + 1];
    c.z += T.pos[i * 3 + 2];
    n++;
  }
  c.divideScalar(Math.max(1, n));
  c.x *= sgn;
  return c;
}

/** Where a 'hold' figure's holding hand is, in its own frame (x to its right, z ahead, y above its floor). */
function heldHand(s: FigureSpec): THREE.Vector3 {
  const T = templateOf(s);
  const sgn = s.side >= 0 ? 1 : -1;
  return handBind(T, sgn).applyMatrix4(poseBones(T, { ...s, pose: 'hold' })[sgn > 0 ? FORE_R : FORE_L]);
}

/** Where a figure's holding hand is in the world (pose 'hold'): for tests. */
export function handAt(s: FigureSpec): [number, number, number] {
  const h = heldHand(s);
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  return [s.x + fz * h.x + fx * h.z, PAVEMENT + (s.y ?? 0) + h.y, s.z - fx * h.x + fz * h.z];
}

/**
 * Two people holding hands, their hands really meeting: `a` where it stands, holding with its `side` hand; `b` set
 * beside it on that side, facing the same way, holding with the other hand. Whoever's hand hangs lower raises it to
 * the other's (a child's up to a parent's: `reach`), and b stands where the two hands then coincide. They come and go
 * together. Worked out on the templates as the generation now set builds them (teens and all).
 */
export function holdHands(a: FigureSpec, b: FigureSpec): [FigureSpec, FigureSpec] {
  const side = a.side >= 0 ? 1 : -1;
  let A: FigureSpec = { ...a, pose: 'hold', side, reach: 0.26 };
  let B: FigureSpec = { ...b, pose: 'hold', side: -side, yaw: a.yaw, y: a.y, reach: 0.26 };
  const ha = heldHand(A).y, hb = heldHand(B).y;
  // The lower hand comes up to the higher (the arm raised further out lifts the hand).
  const lift = (s: FigureSpec, to: number): FigureSpec => {
    let lo = 0.26, hi = 2.2;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (heldHand({ ...s, reach: mid }).y < to) lo = mid;
      else hi = mid;
    }
    return { ...s, reach: (lo + hi) / 2 };
  };
  if (ha < hb) A = lift(A, hb);
  else B = lift(B, ha);
  const pa = heldHand(A), pb = heldHand(B);
  const dx = pa.x - pb.x, dz = pa.z - pb.z;
  const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const seed = a.fade === false ? undefined : (a.seed ?? figureSeed(a));
  return [{ ...A, seed }, { ...B, x: a.x + fz * dx + fx * dz, z: a.z - fx * dx + fz * dz, fade: a.fade, close: a.close, seed }];
}

/** Adds one figure to gb (`umbrella`: it holds up its umbrella, if it carries one, while uUmbrella is on: bake that with addUmbrella). */
export function addFigure(gb: GhostBuilder, s: FigureSpec, umbrella = false): void {
  gb.add(templateIndex(s), packFigures([s], null, umbrella));
}

/**
 * Adds the figure's umbrella to gb if it carries one (it hangs off the arm held up while the material's uUmbrella is
 * on, so show it only then; add the figure with `addFigure(gb, s, true)`).
 */
export function addUmbrella(gb: GhostBuilder, s: FigureSpec): boolean {
  if (!carriesUmbrella(s)) return false;
  gb.add(umbrellaOf(s), packFigures([s]));
  return true;
}

/**
 * A figure posed as the material poses it at rest (no idle motion), in the world: for tests. With `umbrella`,
 * holding it up (the arm only), or with 'canopy' its umbrella instead of the figure.
 */
export function posedFigure(s: FigureSpec, umbrella: boolean | 'canopy' = false): Float32Array {
  const T = umbrella === 'canopy' ? templateAt(umbrellaOf(s)) : templateOf(s);
  const M = poseBones(T, s, umbrella !== false);
  const n = T.pos.length / 3;
  const out = new Float32Array(n * 3);
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  // (The umbrella mirrored to the hand it's in, on that side's forearm.)
  const left = umbrella === 'canopy' && (s.pose === 'hold' ? -s.side : s.side) < 0;
  for (let i = 0; i < n; i++) {
    const x = left ? -T.pos[i * 3] : T.pos[i * 3], y = T.pos[i * 3 + 1], z = T.pos[i * 3 + 2];
    const fore = (b: number): number => (left && (b === ARM_R || b === FORE_R) ? b - 2 : b);
    const e0 = M[fore(digitParent(T.b0[i]))].elements, e1 = M[fore(digitParent(T.b1[i]))].elements;
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

/** A figure's template as the generation now set builds it: its vertices and triangles. */
export function figureMesh(s: Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit' | 'model'>): { vertices: number; triangles: number } {
  const T = templateOf(s);
  return { vertices: T.pos.length / 3, triangles: T.idx.length / 3 };
}

/** A figure's standing height (hair and hat included) and its hip joints' height (m). */
export function figureSize(s: Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit' | 'model'>): { height: number; hip: number } {
  const T = templateOf(s);
  let height = 0;
  for (let i = 1; i < T.pos.length; i += 3) height = Math.max(height, T.pos[i]);
  return { height, hip: T.pivot[THIGH_L][1] };
}

// ---- The material ----

/**
 * How the mob looks (the debug menu's People tab, `?mob=`): `ghost` faint and see-through; `rim` a little more solid,
 * with a soft cool light along the silhouette so dark figures part from dark streets; `solid` near-opaque dark
 * mannequins; `lit` lighter mid-tone figures with the rim.
 */
// (`black`: everything the one black, clothes and all; `edge`: how much denser toward the silhouette; `scene`: lit by
// the scene's own light, the sky's and the sun's or moon's with the sun's shadows, instead of evenly: `setMobSun`.)
export const MOB_LOOKS = {
  ghost: { opacity: 0.72, lift: 1, rim: 0, black: 1, edge: 0 },
  rim: { opacity: 0.8, lift: 1, rim: 0.32, black: 1, edge: 0.2 },
  solid: { opacity: 0.94, lift: 1, rim: 0.12, black: 1, edge: 0.2 },
  lit: { opacity: 0.85, lift: 3.2, rim: 0.32, black: 1, edge: 0.2 },
  // The figures in their colours (skin, hair, clothes), near-opaque.
  color: { opacity: 0.94, lift: 1, rim: 0.04, black: 0, edge: 0, scene: 1 },
} as const;
export type MobLook = keyof typeof MOB_LOOKS;
export const MOB_LOOK_NAMES = Object.keys(MOB_LOOKS) as MobLook[];

/** Sets the mob material's look. */
/**
 * The mob's material for named characters (real/mobCharacters.ts): the same shader with the fingers' and toes'
 * bones posed as well (MOB_DIGITS; the crowd's material leaves them out and pays nothing for them). `uCurl` closes
 * the hands (0 relaxed, 1 a fist), `uToes` bends the toes up (radians). A character drawn with the crowd's material
 * would have its fingers left where they were bound.
 */
export function characterMaterial(light?: GhostLight, look: MobLook = 'solid'): THREE.ShaderMaterial {
  const material = ghostMaterial(light, look);
  material.defines = { ...material.defines, MOB_DIGITS: '' };
  material.uniforms.uCurl = { value: 0 };
  material.uniforms.uToes = { value: 0 };
  material.needsUpdate = true;
  return material;
}
/**
 * The characters' material for one posed freely (real/characterPose.ts): the pose's bones are worked out on the CPU
 * and handed in (`uBones`: a matrix a bone, the fourteen and the hands', fingers' and toes'), in place of the mob's
 * own posing. One material a figure: the bones are a uniform.
 */
export function posedMaterial(light?: GhostLight, look: MobLook = 'solid'): THREE.ShaderMaterial {
  const material = characterMaterial(light, look);
  material.defines = { ...material.defines, MOB_POSED: '' };
  const bones = new Float32Array(ALL_BONES * 16);
  for (let b = 0; b < ALL_BONES; b++) bones.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], b * 16);
  material.uniforms.uBones = { value: bones };
  material.needsUpdate = true;
  return material;
}
/** A figure's template as it's drawn (its bind pose, bones and joints): for whoever poses it themselves. */
export const figureTemplate = (s: Pick<FigureSpec, 'body' | 'hair' | 'long' | 'outfit' | 'model'>): Template => templateOf(s);
export function setMobLook(material: THREE.ShaderMaterial, look: MobLook): void {
  const L = MOB_LOOKS[look];
  material.uniforms.uOpacity.value = L.opacity;
  material.uniforms.uBlack.value = L.black;
  (material.uniforms.uFlat.value as THREE.Vector4).set(0.02, 0.02, 0.022, 0);
  material.uniforms.uEdge.value = L.edge;
  // (Compiled in only for the look that uses it, so the others pay nothing for it: a change of look to or from it
  // recompiles the mob's shader, once.)
  const lit = 'scene' in L;
  // (In their colours they aren't ghosts: nobody comes and goes.)
  material.uniforms.uStay.value = lit ? 1 : 0;
  if (('MOB_LIT' in material.defines) !== lit) {
    if (lit) material.defines.MOB_LIT = '';
    else delete material.defines.MOB_LIT;
    material.needsUpdate = true;
  }
  material.uniforms.uLift.value = L.lift;
  (material.uniforms.uRim.value as THREE.Color).setRGB(0.42 * L.rim, 0.5 * L.rim, 0.62 * L.rim);
}

/** A depth texture in compare mode, to stand in while the sun has no shadow map (a shadow sampler can't be given any other kind). */
const NO_SHADOW = new THREE.DepthTexture(1, 1);
NO_SHADOW.compareFunction = THREE.LessEqualCompare;
// (Marked for upload: a texture never uploaded binds as none, which a shadow sampler can't take either.)
NO_SHADOW.needsUpdate = true;

/**
 * The scene's light for the mob's coloured look (each frame): the hemisphere light, the sun or moon, and the sun's
 * shadow map, so people darken in a building's shadow and at night as the city round them does.
 */
export function setMobSun(material: THREE.ShaderMaterial, hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight): void {
  const u = material.uniforms;
  (u.uHemiSky.value as THREE.Color).copy(hemi.color).multiplyScalar(hemi.intensity);
  (u.uHemiGround.value as THREE.Color).copy(hemi.groundColor).multiplyScalar(hemi.intensity);
  (u.uSunCol.value as THREE.Color).copy(sun.color).multiplyScalar(sun.intensity);
  (u.uSunDir.value as THREE.Vector3).copy(sun.position).sub(sun.target.position).normalize();
  const map = sun.castShadow ? sun.shadow.map : null;
  u.tSunShadow.value = map?.depthTexture ?? NO_SHADOW;
  u.uSunShadow.value = map?.depthTexture ? sun.shadow.intensity : 0;
  (u.uSunShadowMatrix.value as THREE.Matrix4).copy(sun.shadow.matrix);
  (u.uSunShadowBias.value as THREE.Vector3).set(sun.shadow.bias, sun.shadow.normalBias, 1 / sun.shadow.mapSize.x);
}

/** Where the viewer is, for the mob's shadow caster (each frame). */
export function setMobEye(material: THREE.ShaderMaterial, eye: THREE.Vector3): void {
  (material.uniforms.uEye.value as THREE.Vector3).copy(eye);
}

/** The street lightmap's uniforms (real/city.ts), shared so the mob is lit where the streets are. */
export interface GhostLight {
  readonly tLight: { value: THREE.Texture | null };
  readonly uLightRect: { value: THREE.Vector4 };
  readonly uLightFade: { value: THREE.Vector2 };
  readonly uLightGain: { value: number };
}

/**
 * GLSL (vertex): how the mob's figures are posed. The limbs and the standing routine (`pickAct`, `act`), `mobPose`,
 * which sets a figure's skeleton for this moment (the globals armL, armR, legL, legR, lean, drop, spineRoll,
 * headYaw, headPitch, and a smoker's hand), and `bone`, a bone's transform from the bind pose. The mob's material
 * uses it, and so does anything that has to find a part of a figure as it is posed (real/smoke.ts: a smoker's hand
 * and mouth). It needs `pv` (a body's joints: tJoints, jointRow), uStill, uSmoking and the attributes aPose and
 * aWalk declared before it.
 */
export const MOB_POSE_GLSL = /* glsl */ `
      // swing forward, raise out, bend (elbow forward / knee back), the forearm's side bend and inward twist.
      struct Limb { float swing; float raise; float bend; float side; float twist; };
      Limb L3(float s, float r, float b) { return Limb(s, r, b, 0.0, 0.0); }
      Limb mixL(Limb a, Limb b, float w) { return Limb(mix(a.swing, b.swing, w), mix(a.raise, b.raise, w), mix(a.bend, b.bend, w), mix(a.side, b.side, w), mix(a.twist, b.twist, w)); }
      // A standing activity: the limbs, and how the head and hips go.
      // (lean: the spine forward; drop: the hips lowered, as a share of their height.)
      struct Act { Limb aL; Limb aR; Limb lL; Limb lR; float yaw; float pitch; float roll; float lean; float drop; };
      float hh1(float k, float r) { return fract(sin(k * 12.9898 + r * 78.233) * 43758.5453); }
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
          joint(M, T, rotX(-l.swing) * rotZ(sg * l.raise), pv(ti));
          if (b == ti) return;
          joint(M, T, rotX(l.bend), pv(ti + 1));
          if (b < 12) return;
          joint(M, T, rotX(${FOOT_LEVEL.toFixed(3)} * (l.swing - l.bend)), pv(b));
          return;
        }
        joint(M, T, rotX(lean) * rotZ(spineRoll), pv(1));
        if (b == 1) return;
        if (b == 2) {
          joint(M, T, rotX(-lean * 0.7 + headPitch) * rotZ(-spineRoll * 0.8) * rotY(headYaw), pv(2));
          return;
        }
        bool left = b <= 8;
        Limb l = armR;
        if (left) l = armL;
        float sg = left ? -1.0 : 1.0;
        int ai = left ? 7 : 9;
        joint(M, T, rotX(-l.swing) * rotZ(sg * (l.raise - armOut)), pv(ai));
        if (b == ai) return;
        joint(M, T, rotY(-sg * l.twist) * rotZ(sg * l.side) * rotX(-l.bend), pv(ai + 1));
      }

      /** Which activity (STANDING) a standing figure does in its k-th stretch, by its pose's temperament. */
      int pickAct(int P, float k, float r, bool bag, bool umb, int manner, bool smoker) {
        float h = hh1(k, r);
        int a = 0;
        if (uStill > 0.5) return 0;
        // Someone with a cigarette lit: the things that leave that hand to it (it has its own round: mobPose).
        if (smoker) {
          if (manner == 1) a = h < 0.28 ? 11 : h < 0.46 ? 14 : h < 0.8 ? 6 : 0;
          else if (manner == 2) a = 19;
          else a = h < 0.42 ? 0 : h < 0.72 ? 6 : h < 0.82 ? 16 : h < 0.9 ? 20 : 14;
          if (bag && (a == 11 || a == 14)) a = 6;
          return a;
        }
        // A shady one squats and watches; a drunk sways. (Nobody mimes a cigarette: those who smoke have one, above.)
        if (manner == 1) a = h < 0.24 ? 11 : h < 0.46 ? 6 : h < 0.6 ? 1 : h < 0.74 ? 6 : h < 0.86 ? 4 : h < 0.95 ? 14 : 0;
        else if (manner == 2) a = h < 0.72 ? 19 : h < 0.86 ? 16 : 13;
        else if (P == 3) a = h < 0.4 ? 2 : h < 0.6 ? 3 : h < 0.72 ? 6 : h < 0.85 ? 1 : 0;
        else if (P == 2) a = h < 0.38 ? 8 : h < 0.5 ? 15 : h < 0.6 ? 20 : h < 0.68 ? 4 : h < 0.74 ? 5 : h < 0.82 ? 1 : h < 0.87 ? 6 : (manner == 3 && h < 0.95) ? 12 : 0;
        else if (P == 5) a = h < 0.15 ? 9 : h < 0.45 ? 6 : h < 0.65 ? 1 : 0;
        else a = h < 0.2 ? 0 : h < 0.32 ? 1 : h < 0.41 ? 2 : h < 0.48 ? 4 : h < 0.54 ? 5 : h < 0.68 ? 6 : h < 0.73 ? 7 : h < 0.77 ? 3 : h < 0.82 ? 0 : h < 0.86 ? 16 : h < 0.89 ? 17 : h < 0.93 ? 18 : h < 0.96 ? 13 : 14;
        // Two-handed things aren't for someone holding a bag.
        if (bag && (a == 2 || a == 4 || a == 5)) a = a == 2 ? 3 : 0;
        if (bag && (a == 13 || a == 18 || a == 11)) a = 6;
        // Holding an umbrella up: nothing for that hand (the free one may still glance at the watch or go in a pocket).
        if (umb) {
          if (a == 2 || a == 3 || a == 8 || a == 9 || a == 13 || a == 15 || a == 17 || a == 18) a = 6;
          else if (a == 4 || a == 5 || (bag && a == 7)) a = 0;
        }
        return a;
      }

      /**
       * The activities: 0 standing easy, 1 hands in pockets, 2 texting, 3 a call, 4 arms crossed, 5 hands clasped,
       * 6 looking about, 7 a glance at the watch, 8 talking with a hand, 9 a wave, (10 was a mimed cigarette), 11 squatting on the
       * heels, 12 a bow, 13 a stretch, 14 leaning back with a knee up, 15 laughing, 16 looking up, 17 scratching the
       * head, 18 hands on hips, 19 a drunk's sway, 20 nodding along. u: seconds into it; k: which stretch (the resting
       * leg alternates).
       */
      Act act(int a, float u, float k, float t, float r, float side, int body) {
        Limb hang = L3(0.0, 0.1, 0.12);
        Limb rest = L3(0.05, 0.05, 0.1);
        Limb leg = L3(0.0, 0.0, 0.0);
        bool leftRests = mod(k, 2.0) < 1.0;
        // (No ?: on structs in ESSL 1.0.)
        Act A = Act(hang, hang, rest, leg, 0.0, 0.0, -0.035, 0.0, 0.0);
        if (!leftRests) {
          A.lL = leg;
          A.lR = rest;
          A.roll = 0.035;
        }
        Limb main = hang;
        Limb off = hang;
        if (a == 1) {
          main = L3(-0.1, 0.22, 0.45);
          off = main;
        } else if (a == 2) {
          main = Limb(0.45, 0.08, 1.45, 0.0, 0.35);
          off = Limb(0.4, 0.08, 1.4, 0.0, 0.3);
          A.pitch = 0.35;
        } else if (a == 3) {
          main = Limb(0.45, 0.12, 2.45, 0.0, 0.25);
          A.yaw = 0.25 * sin(u * 0.4 + r * 5.0);
        } else if (a == 4) {
          main = Limb(0.3, 0.02, 1.55, 0.0, 1.0);
          off = main;
        } else if (a == 5) {
          main = Limb(0.12, 0.0, 0.95, 0.0, 0.6);
          off = main;
        } else if (a == 6) {
          A.yaw = 0.75 * sin(u * 0.8 + k * 2.1) + 0.2 * sin(u * 2.3 + r * 6.0);
          A.pitch = 0.08 * sin(u * 0.5 + k);
        } else if (a == 7) {
          // Up to the face for two seconds or so, then down again.
          float w = smoothstep(0.2, 0.8, u) * (1.0 - smoothstep(2.4, 3.2, u));
          off = mixL(hang, Limb(0.35, 0.1, 1.9, 0.0, 0.6), w);
          A.pitch = 0.3 * w;
          A.yaw = -0.25 * side * w;
        } else if (a == 8) {
          main = L3(0.3 + 0.12 * sin(t * 2.1 + r * 7.0), 0.12, 1.25 + 0.3 * sin(t * 3.3 + r * 3.0));
          off = mixL(hang, L3(0.15, 0.1, 0.6), 0.5 + 0.5 * sin(t * 0.7 + r));
        } else if (a == 9) {
          // A short wave, then easy again.
          float w = smoothstep(0.2, 0.8, u) * (1.0 - smoothstep(2.6, 3.4, u));
          main = mixL(hang, Limb(0.15, 1.3, 0.0, 1.35 + 0.3 * sin(t * 7.0 + r * 2.0), 0.0), w);
        } else if (a == 11) {
          // Squatting on the heels, the arms resting on the knees, looking up from under.
          A.lL = L3(1.85, 0.28, 2.4);
          A.lR = A.lL;
          A.drop = 0.64;
          A.lean = 0.42;
          A.roll = 0.0;
          A.pitch = -0.22;
          A.yaw = 0.35 * sin(u * 0.5 + k * 1.7);
          main = L3(1.0, 0.25, 0.5);
          off = main;
        } else if (a == 12) {
          // A bow, held a moment.
          float w = smoothstep(0.3, 1.0, u) * (1.0 - smoothstep(1.8, 2.6, u));
          A.lean = 0.55 * w;
          A.pitch = 0.15 * w;
        } else if (a == 13) {
          // A stretch: both arms up and out, the head back.
          float w = smoothstep(0.3, 1.2, u) * (1.0 - smoothstep(2.6, 3.6, u));
          main = mixL(hang, L3(0.2, 2.7, 0.25), w);
          off = main;
          A.pitch = -0.3 * w;
          A.lean = -0.08 * w;
        } else if (a == 14) {
          // Leaning back, one knee up (a foot against the wall), hands in pockets.
          A.lean = -0.1;
          if (leftRests) A.lL = L3(0.55, 0.0, 1.05);
          else A.lR = L3(0.55, 0.0, 1.05);
          main = L3(-0.1, 0.22, 0.45);
          off = main;
        } else if (a == 15) {
          // Laughing: the head back, the shoulders shaking, a hand to the mouth.
          float shake = sin(t * 14.0 + r * 3.0);
          A.pitch = -0.16 + 0.05 * shake;
          A.lean = -0.04 + 0.02 * shake;
          main = Limb(0.45, 0.1, 2.2, 0.0, 0.5);
        } else if (a == 16) {
          // Looking up (at the signs, the screens, the sky).
          A.pitch = -0.5 * smoothstep(0.2, 1.0, u);
          A.yaw = 0.3 * sin(u * 0.4 + r * 4.0);
        } else if (a == 17) {
          // Scratching the head.
          float w = smoothstep(0.2, 0.8, u) * (1.0 - smoothstep(2.4, 3.2, u));
          main = mixL(hang, Limb(0.3, 0.5, 2.5 + 0.12 * sin(t * 9.0), 0.0, 0.3), w);
          A.pitch = 0.15 * w;
        } else if (a == 18) {
          // Hands on hips.
          main = Limb(-0.25, 0.6, 1.35, 0.0, 0.9);
          off = main;
        } else if (a == 19) {
          // A drunk on his feet: swaying, the head hanging.
          A.roll = 0.16 * sin(t * 0.9 + r * 6.0);
          A.lean = 0.1 + 0.12 * sin(t * 0.7 + r * 3.0);
          A.pitch = 0.3 + 0.12 * sin(t * 0.5 + r);
          main = L3(0.1 * sin(t * 0.9 + r), 0.15, 0.2);
          off = main;
        } else if (a == 20) {
          // Nodding along.
          A.pitch = 0.08 + 0.1 * sin(t * 3.0 + r * 5.0);
          A.yaw = 0.15 * sin(t * 0.6 + r * 2.0);
        }
        if (side > 0.0) {
          A.aR = main;
          A.aL = off;
        } else {
          A.aL = main;
          A.aR = off;
        }
        return A;
      }

      // (A texel of the body's joints whole: the ones after the bones', JOINT_EXTRA.)
      vec4 pw(int i) { return texture2D(tJoints, vec2((float(i) + 0.5) / ${JOINT_COLS}.0, (jointRow + 0.5) / ${JOINT_ROWS}.0)); }
      // Someone smoking (mobPose sets these): which hand has it (1 right, -1 left; 0: nothing lit now), how far that hand
      // is up at the mouth (0-1), the seconds into its round and the round's length, and that arm with the hand down
      // and with it at the mouth.
      float smokeHand, smokeUp, smokeAt, smokeEvery;
      Limb smokeLow, smokeHigh;
      // How far up the hand is, c seconds into a round: up to the mouth, a drag, down again.
      float smokeLift(float c) { return smoothstep(0.0, ${SMOKE_ROUND.rise.toFixed(2)}, c) * (1.0 - smoothstep(${(SMOKE_ROUND.rise + SMOKE_ROUND.drag).toFixed(2)}, ${(SMOKE_ROUND.rise + SMOKE_ROUND.drag + SMOKE_ROUND.fall).toFixed(2)}, c)); }
      // How hard the breath is going out, c seconds into a round (after the hand is down and a moment's hold).
      float smokeOut(float c) { return smoothstep(${SMOKE_OUT.toFixed(2)} - 0.1, ${SMOKE_OUT.toFixed(2)} + 0.2, c) * (1.0 - smoothstep(${(SMOKE_OUT + SMOKE_ROUND.out).toFixed(2)} - 0.4, ${(SMOKE_OUT + SMOKE_ROUND.out).toFixed(2)}, c)); }
      // The figure's skeleton now: the pose, and on top of it the motion. (sm: 0, or what it smokes: 1 a cigarette, 2 a cigar.)
      void mobPose(float t, int body, float r, int P, bool moving, float phase, float side, bool bag, bool umb, bool straps, int manner, float sm) {
        // Smoking now: someone who smokes (sm), a hand free for it (not up with an umbrella, on a strap or in someone's
        // hand), not running; and as many of them as the setting says (uSmoking).
        bool smoker = sm > 0.5 && !umb && !straps && P <= 5 && hh1(r, 9.1) < uSmoking && !(P == 1 && moving && aWalk.z > 1.9);
        // The umbrella's hand: the gesturing one, unless that hand holds someone else's (pose 'hold').
        float uside = P == 6 ? -side : side;
        Limb still = L3(0.0, 0.1, 0.12);
        Limb leg0 = L3(0.0, 0.0, 0.0);
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
          // (Someone in a hurry runs: a longer stride, the knee folding as the leg comes through, the elbows bent.)
          float rn = moving ? clamp(aWalk.z - 1.9, 0.0, 1.0) : 0.0;
          float amp = mix(0.36, 0.58, rn);
          float a = sin(phase * 6.2832) * amp;
          float thru = cos(phase * 6.2832 + 0.4);
          // The knee bends as the leg goes back (smoothly, so the foot doesn't snap as the legs pass).
          legL = L3(a, 0.0, 0.06 + (1.0 - rn) * 0.24 * clamp(-a / amp, 0.0, 1.0) + rn * (0.15 + 1.1 * max(0.0, thru)));
          legR = L3(-a, 0.0, 0.06 + (1.0 - rn) * 0.24 * clamp(a / amp, 0.0, 1.0) + rn * (0.15 + 1.1 * max(0.0, -thru)));
          armL = L3(-a * mix(0.7, 1.2, rn), 0.1, mix(0.25, 1.45, rn));
          armR = L3(a * mix(0.7, 1.2, rn), 0.1, mix(0.25, 1.45, rn));
          lean += mix(0.04, 0.18, rn);
          // The hips drop as far as the swinging legs rise, so the planted foot stays on the ground.
          drop = pv(3).y * (1.0 - cos(a));
          if (moving) {
            // The shoulders turning with the stride, a glance about.
            spineRoll = 0.03 * sin(phase * 6.2832);
            headYaw = aPose.w * 0.4 + 0.12 * sin(t * 0.4 + r * 9.0);
            if (manner == 2) {
              // A drunk: rolling, head down.
              spineRoll += 0.15 * sin(t * 1.3 + r * 6.0);
              lean += 0.1;
              headPitch = 0.25 + 0.1 * sin(t * 0.6 + r);
            }
          }
        } else {
          float breath = sin(t * 1.4 + r * 20.0);
          float sway = sin(t * 0.55 + r * 31.0);
          lean += 0.012 * breath;
          spineRoll = 0.025 * sway;
          headYaw = aPose.w + 0.12 * sin(t * 0.23 + r * 17.0) + 0.06 * sin(t * 0.61 + r * 5.0);
          headPitch = 0.04 * sin(t * 0.31 + r * 11.0);
          armL.swing += 0.015 * breath;
          armR.swing += 0.015 * breath;
          Limb g = still;
          bool gest = false;
          if (P == 6) {
            // Holding someone's hand: the arm out by aWalk.x (holdHands sets it so the two hands meet), the body still.
            g = L3(0.1, aWalk.x, 0.1);
            gest = true;
            spineRoll = 0.0;
          } else if (P == 7) {
            // Sitting (a seat 0.46 m up): the same as skeleton()'s 'sit', breathing.
            legL = L3(1.45, 0.07, 1.45);
            legR = legL;
            armL = L3(0.3, 0.08, 0.75);
            armR = armL;
            lean = -0.05 + 0.01 * breath;
            spineRoll *= 0.3;
            drop = pv(3).y - 0.46;
          } else if (P == 8) {
            // Holding a strap, swaying a little with the ride.
            g = L3(2.75 + 0.04 * sway, 0.12, 0.25);
            gest = true;
          } else if (P == 10) {
            // In a car's seat (skeleton()'s 'ride'): the legs out ahead, tucked up by aWalk.x; looking about.
            float tuck = clamp(aWalk.x, 0.0, 1.0);
            float sw = 1.7 + 0.3 * tuck;
            legL = L3(sw, 0.06, sw - (0.75 - 0.65 * tuck));
            legR = legL;
            armL = L3(${RIDE_ARM[0].toFixed(2)}, ${RIDE_ARM[1].toFixed(2)}, ${RIDE_ARM[2].toFixed(2)});
            armR = armL;
            lean = ${RIDE_LEAN.toFixed(3)} + 0.008 * breath;
            spineRoll *= 0.3;
            headYaw = aPose.w + 0.3 * sin(t * 0.19 + r * 17.0) + 0.1 * sin(t * 0.53 + r * 5.0);
            drop = pv(3).y - ${RIDE_HIP.toFixed(3)};
          } else {
            // Standing: a routine of everyday things a few seconds each (the pose sets the temperament: a talker
            // mostly talks), easing from one to the next.
            float dur = 5.0 + 6.0 * r;
            float tt = t / dur + r * 37.0;
            float k = floor(tt);
            float u = fract(tt) * dur;
            Act A = act(pickAct(P, k, r, bag, umb, manner, smoker), u, k, t, r, side, body);
            Act B = act(pickAct(P, k + 1.0, r, bag, umb, manner, smoker), u - dur, k + 1.0, t, r, side, body);
            float w = smoothstep(dur - 1.2, dur, u);
            armL = mixL(A.aL, B.aL, w);
            armR = mixL(A.aR, B.aR, w);
            legL = mixL(A.lL, B.lL, w);
            legR = mixL(A.lR, B.lR, w);
            headYaw += mix(A.yaw, B.yaw, w);
            headPitch += mix(A.pitch, B.pitch, w);
            spineRoll += mix(A.roll, B.roll, w);
            lean += mix(A.lean, B.lean, w);
            drop = pv(3).y * mix(A.drop, B.drop, w);
            armL.swing += 0.015 * breath;
            armR.swing += 0.015 * breath;
          }
          if (gest) {
            if (side > 0.0) armR = g;
            else armL = g;
          }
        }
        if (P == 9 && aWalk.x > 0.001) {
          // Moved by the game (gaitLimbs): the standing routine above eased into the walk by its pace (aWalk.x: 1
          // walking, 2 running), the stride at aWalk.w.
          float wk = clamp(aWalk.x, 0.0, 1.0);
          float rn = clamp(aWalk.x - 1.0, 0.0, 1.0);
          float ph = phase * 6.2832;
          float amp = mix(${GAIT.reach[0].toFixed(3)}, ${GAIT.reach[1].toFixed(3)}, rn);
          float a = sin(ph) * amp;
          float c = cos(ph + ${GAIT.foldAt.toFixed(3)});
          float kL = 0.06 + (1.0 - rn) * 0.24 * clamp(-a / amp, 0.0, 1.0) + rn * (0.15 + ${GAIT.fold.toFixed(3)} * max(0.0, c));
          float kR = 0.06 + (1.0 - rn) * 0.24 * clamp(a / amp, 0.0, 1.0) + rn * (0.15 + ${GAIT.fold.toFixed(3)} * max(0.0, -c));
          float sw = mix(${GAIT.arm[0].toFixed(3)}, ${GAIT.arm[1].toFixed(3)}, rn);
          float el = mix(${GAIT.elbow[0].toFixed(3)}, ${GAIT.elbow[1].toFixed(3)}, rn);
          legL = mixL(legL, L3(a, 0.0, kL), wk);
          legR = mixL(legR, L3(-a, 0.0, kR), wk);
          armL = mixL(armL, L3(-a * sw, 0.1, el), wk);
          armR = mixL(armR, L3(a * sw, 0.1, el), wk);
          lean += wk * mix(${GAIT.lean[0].toFixed(3)}, ${GAIT.lean[1].toFixed(3)}, rn);
          drop = wk * pv(3).y * (1.0 - cos(a)) * (1.0 - 0.5 * rn);
          spineRoll = mix(spineRoll, 0.03 * (1.0 + rn) * sin(ph), wk);
          headYaw = mix(headYaw, aPose.w, wk);
          headPitch = mix(headPitch, -0.1 * rn, wk);
        }
        if (straps && (P == 0 || P == 1 || P == 9)) {
          Limb h = Limb(${STRAP_HOLD.swing.toFixed(3)}, ${STRAP_HOLD.raise.toFixed(3)}, ${STRAP_HOLD.bend.toFixed(3)}, 0.0, ${STRAP_HOLD.twist.toFixed(3)});
          armL = h;
          armR = h;
        }
        smokeHand = 0.0;
        smokeUp = 0.0;
        smokeAt = 0.0;
        smokeEvery = 1.0;
        smokeLow = still;
        smokeHigh = still;
        if (smoker) {
          // A cigarette (or a cigar) in the free hand (a bag is in the left), held low; every so often up to the mouth
          // for a drag and down again, then the breath out, the head going back a little with it. Each at their own
          // pace: a cigar is slower.
          smokeHand = bag ? 1.0 : side;
          smokeEvery = (sm > 1.5 ? ${SMOKE_ROUND.cigar[0].toFixed(1)} : ${SMOKE_ROUND.every[0].toFixed(1)}) + (sm > 1.5 ? ${(SMOKE_ROUND.cigar[1] - SMOKE_ROUND.cigar[0]).toFixed(1)} : ${(SMOKE_ROUND.every[1] - SMOKE_ROUND.every[0]).toFixed(1)}) * hh1(r, 3.3);
          smokeAt = mod(t + r * 97.0, smokeEvery);
          smokeUp = smokeLift(smokeAt);
          // (The arm with the hand at the mouth is solved for each body: smokerJoints.)
          vec4 reach = pw(${JOINT_EXTRA.reach});
          smokeHigh = Limb(reach.x, reach.w, reach.y, 0.0, reach.z);
          // Walking, the arm still swings a little with the stride, the forearm carried.
          float stride = P == 1 ? sin(phase * 6.2832) * 0.1 * smokeHand : 0.0;
          // (No ?: on structs in ESSL 1.0.)
          smokeLow = Limb(0.14, 0.12, 0.62, 0.0, 0.15);
          if (P == 1) smokeLow = Limb(0.14 + stride, 0.1, 0.78, 0.0, 0.1);
          Limb now = mixL(smokeLow, smokeHigh, smokeUp);
          if (smokeHand > 0.0) armR = now;
          else armL = now;
          headPitch += 0.07 * smokeUp - 0.13 * smokeOut(smokeAt);
        }
        if (umb) {
          // The umbrella held up (people.ts UMBRELLA_HOLD, which the umbrella is built on), bobbing a little with
          // the stride or the breath.
          float bob = P == 1 ? 0.03 * sin(phase * 12.566) : 0.012 * sin(t * 1.4 + r * 20.0);
          Limb h = Limb(${UMBRELLA_HOLD.swing.toFixed(3)} + bob, ${UMBRELLA_HOLD.raise.toFixed(3)}, ${UMBRELLA_HOLD.bend.toFixed(3)} - bob, ${UMBRELLA_HOLD.side.toFixed(3)}, ${UMBRELLA_HOLD.twist.toFixed(3)});
          if (uside > 0.0) armR = h;
          else armL = h;
        }
      }
`;

/**
 * The mob's material: poses and animates each figure from its numbers (the skeleton rebuilt in the vertex
 * shader: the same joints and rotations as `poseBones`, plus breathing, a sway, looking about, gestures and
 * the walk), dark and softly top-lit, lit by the street lightmap at night, a little denser at the
 * silhouette, see-through by alpha to coverage (opaque pass, depth written: one surface per figure, no
 * sorting). `uTime` drives the motion and the fades (main.ts sets it).
 */
export function ghostMaterial(light?: GhostLight, look: MobLook = 'solid'): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uOpacity: { value: 0.72 }, uLift: { value: 1 }, uRim: { value: new THREE.Color(0, 0, 0) }, uUmbrella: { value: 0 }, uSkin: { value: 1 }, uStill: { value: 0 }, uFlat: { value: new THREE.Vector4(0, 0, 0, 0) }, uBlack: { value: 0 }, uStay: { value: 0 }, uHour: { value: 12 }, uRain: { value: 0 }, uSeason: { value: 0 }, uEdge: { value: 0.2 }, uSmoking: { value: 1 } }]),
      tJoints: { value: mobJoints() },
      // Emotes (real/emoteGlsl.ts): who shows what, when; off until the crowd's billboards (real/emotes.ts) turn them on.
      ...emoteUniforms(),
      // The scene's light (setMobSun), used by the look compiled with MOB_LIT. (As it starts, it's the even light of the other looks.)
      uHemiSky: { value: new THREE.Color(Math.PI, Math.PI, Math.PI) },
      uHemiGround: { value: new THREE.Color(0.6 * Math.PI, 0.6 * Math.PI, 0.6 * Math.PI) },
      uSunCol: { value: new THREE.Color(0, 0, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      tSunShadow: { value: NO_SHADOW },
      uSunShadow: { value: 0 },
      uSunShadowMatrix: { value: new THREE.Matrix4() },
      uSunShadowBias: { value: new THREE.Vector3(0, 0, 1 / 2048) },
      // For the shadow caster (mobDepthMaterial): where the viewer is, and how far from them people cast shadows (m).
      uEye: { value: new THREE.Vector3() },
      uShadowReach: { value: 60 },
      tLight: light?.tLight ?? { value: null },
      uLightRect: light?.uLightRect ?? { value: new THREE.Vector4(0, 0, 1, 1) },
      uLightFade: light?.uLightFade ?? { value: new THREE.Vector2(0, 0) },
      uLightGain: light?.uLightGain ?? { value: 0 },
    },
    alphaToCoverage: true,
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      // (The shadow caster is this shader with MOB_DEPTH: the camera there is the light's, so the viewer's place comes as uEye.)
      #ifdef MOB_DEPTH
      uniform vec3 uEye;
      uniform float uShadowReach;
      #define EYE uEye
      #else
      #define EYE cameraPosition
      #endif
      uniform float uTime;
      // 1 while it rains: those who carry an umbrella hold it up (real/crowd.ts sets it with its umbrellas).
      uniform float uUmbrella;
      // How much lighter skin is than the clothes (the shaped generation tags skin: aShade + 100; see vC below).
      uniform float uSkin;
      // 1: standing figures only stand easy, no routine (the mob showroom's turnarounds).
      uniform float uStill;
      // How many of those who smoke have one lit (0 to 1: the setting).
      uniform float uSmoking;
      // Every body's joints (mobJoints): a row a body, a texel a bone, the arms' bind angle after the bones.
      uniform sampler2D tJoints;
      // One colour for every figure and every part of it (rgb, and how much of it): the mob showroom's single-colour ghost.
      uniform vec4 uFlat;
      // 1: everything the one colour, clothes and all (the mob as it first was: all black).
      uniform float uBlack;
      // 1: nobody comes and goes (the coloured look: they aren't ghosts). Walkers turn round and walk back, people
      // at a crossing cross back on the next green, those standing stay.
      uniform float uStay;
      float jointRow;
      vec3 pv(int i) { return texture2D(tJoints, vec2((float(i) + 0.5) / ${JOINT_COLS}.0, (jointRow + 0.5) / ${JOINT_ROWS}.0)).xyz; }
      attribute float aShade;
      attribute vec3 aBone;
      attribute float aMirror;
      attribute vec4 aFig;
      attribute vec4 aPose;
      attribute vec4 aWalk;
      attribute vec3 aGround;
      attribute vec3 aTint;
      attribute vec4 aWhen;
      // The hour (0-24), the rain (0-1) and the season (0 spring to 3 winter): who is out (MOB_PLACE_GLSL).
      uniform float uHour;
      uniform float uRain;
      uniform float uSeason;
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vC;
      varying float vFade;
      // An emote's mark on the face (real/emoteGlsl.ts; its quads are the template's, real/mobShape.ts): uv across the
      // quad, which mark (0: none) and how much of it; its beat and its light.
      varying vec4 vMark;
      varying vec2 vMarkFx;
      uniform vec3 uHemiSky;
      ${EMOTE_GLSL}

      ${MOB_POSE_GLSL}
      ${MOB_PLACE_GLSL}
      #ifdef MOB_POSED
      uniform mat4 uBones[${ALL_BONES}];
      #endif
      #ifdef MOB_DIGITS
      // A named character's fingers and toes (real/mobRig.ts digitBone, toeBone): each finger's two bones curl it
      // toward the palm about its own joints (the bind pose is the hand hanging relaxed), on top of the forearm;
      // the toes bend up at the ball of the foot, on top of the foot. uCurl: 0 relaxed to 1 a fist; uToes: radians.
      uniform float uCurl;
      uniform float uToes;
      mat3 digitZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
      void digit(int b, out mat3 M, out vec3 T) {
        int k = b - 14;
        mat3 Mp;
        vec3 Tp;
        // (A hip's or a shoulder's half-way bone, real/mobRig.ts hipHalf, shoulderHalf: turned half as far as its
        // thigh or arm about that joint, from the pelvis or the chest.)
        if (k >= ${DIGIT_BONES + SPINE_BONES + TOE_BONES}) {
          int hh = k - ${DIGIT_BONES + SPINE_BONES + TOE_BONES};
          // (A finger's last joint, real/mobRig.ts fingerTip: its middle joint's bone, where the hands aren't posed.)
          if (hh >= 8) {
            int q = hh - 8;
            int hq = q / 5;
            k = hq * 10 + (q - hq * 5) * 2 + 1;
          } else {
          // (A collar bone goes with the spine, an arm's untwisted bone with the arm, where they aren't posed.)
          if (hh >= 4) {
            bone(hh < 6 ? 1 : hh == 6 ? 7 : 9, M, T);
            return;
          }
          int th = hh == 0 ? 3 : hh == 1 ? 5 : hh == 2 ? 7 : 9;
          mat3 Mt;
          vec3 Tt;
          bone(hh < 2 ? 0 : 1, Mp, Tp);
          bone(th, Mt, Tt);
          vec3 c0 = normalize(Mp[0] + Mt[0]);
          vec3 c1 = normalize(Mp[1] + Mt[1]);
          c1 = normalize(c1 - c0 * dot(c0, c1));
          M = mat3(c0, c1, cross(c0, c1));
          vec3 pj = pv(th);
          T = Mt * pj + Tt - M * pj;
          return;
          }
        }
        // (A toe's own bone, real/mobRig.ts toeDigit: its foot's toes' bone, where each toe isn't posed.)
        if (k >= ${DIGIT_BONES + SPINE_BONES}) k = 20 + (k - ${DIGIT_BONES + SPINE_BONES}) / 5;
        // (The spine's further joints, real/mobRig.ts spineBone: the chest's two go with the spine, the head's with the head.)
        if (k >= ${DIGIT_BONES}) {
          bone(k == ${DIGIT_BONES + 2} ? 2 : 1, M, T);
          return;
        }
        // (A hand's own bone: its forearm's, where the hands aren't posed.)
        if (k >= 22) {
          bone(k == 22 ? 8 : 10, M, T);
          return;
        }
        if (k >= 20) {
          bone(12 + (k - 20), Mp, Tp);
          vec3 p = pv(${DIGIT_COL} + k);
          float c = cos(-uToes), s = sin(-uToes);
          mat3 R = mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
          M = Mp * R;
          T = Mp * (p - R * p) + Tp;
          return;
        }
        int h = k / 10;
        int d = (k - h * 10) / 2;
        int j = k - h * 10 - d * 2;
        // (The left hand, x < 0, curls toward +x: a positive turn about z; the right the other way.)
        float sg = h == 0 ? 1.0 : -1.0;
        float curl = uCurl * (d == 0 ? 0.5 : 1.1) + 0.03 * sin(uTime * 0.9 + float(d) * 0.8 + float(h) * 1.7);
        vec3 p0 = pv(${DIGIT_COL} + h * 10 + d * 2);
        mat3 A = digitZ(sg * curl);
        vec3 a = p0 - A * p0;
        if (j == 1) {
          vec3 p1 = pv(${DIGIT_COL} + h * 10 + d * 2 + 1);
          mat3 R1 = digitZ(sg * curl * 1.2);
          a = A * (p1 - R1 * p1) + a;
          A = A * R1;
        }
        bone(h == 0 ? 8 : 10, Mp, Tp);
        M = Mp * A;
        T = Mp * a + Tp;
      }
      #endif
      void main() {
        float t = uTime;
        int body = int(aPose.x + 0.5);
        base = body * ${BONES};
        jointRow = float(body);
        armOut = pv(${BONES}).x;
        float side = sign(aPose.z);
        // |aPose.z| is 1, +1 with a bag in the left hand (that hand stays down), +2 carrying an umbrella.
        float carry = floor(abs(aPose.z) + 0.5);
        // (+8: a cigarette to smoke, +16: a cigar.)
        float sm = floor((carry - 1.0) / 8.0 + 0.01);
        carry -= sm * 8.0;
        // (+4: both hands on a rucksack's straps, standing or walking.)
        bool straps = carry > 4.5;
        if (straps) carry -= 4.0;
        bool umb = carry > 2.5 && uUmbrella > 0.5;
        bool bag = carry - (carry > 2.5 ? 2.0 : 0.0) > 1.5;
        float seed = aFig.w;
        // Each figure's own randomness for its idle motion (seeds can be shared by a group).
        float r = fract(sin(dot(aFig.xy, vec2(12.9898, 78.233))) * 43758.5453);

        MobPlace place = mobPlace(t, body, seed);
        vec2 org = place.org;
        float ground = place.ground;
        float phase = place.phase;
        float fade = place.fade;
        float turn = place.turn;
        bool moving = place.moving;
        bool crosser = place.crosser;
        int manner = int(aWhen.y + 0.5);
        #ifndef MOB_DEPTH
        // Not there (faded out, or not out at this hour): dropped here, before the work of posing it.
        if (fade <= 0.002) {
          vFade = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        #endif
        // A drunk weaves along.
        if (manner == 2 && moving) org += normalize(vec2(aWalk.y, -aWalk.x) + 1e-5) * 0.32 * sin(t * 0.8 + r * 9.0);

        #ifdef MOB_DEPTH
        {
          // Only people near the viewer cast shadows, and only while they're there (not faded out): the rest are
          // dropped here, before the work of posing them. (And a face mark's quad casts none.)
          vec3 at = (modelMatrix * vec4(org.x, ground, org.y, 1.0)).xyz;
          if (fade < 0.5 || aShade > ${FACE_MARK}.0 || distance(at.xz, uEye.xz) > uShadowReach) {
            vFade = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
        }
        #endif
        // The pose, and on top of it the motion.
        int P = int(aPose.y + 0.5);
        if (crosser && !moving) P = 0;
        // Mid-stride with nowhere to go (set pieces' figures): they stand and go about the routine instead. (Fixed
        // figures, seed < 0, keep their pose: the showroom, story NPCs.)
        if (P == 1 && !moving && seed >= 0.0) P = 0;
        // Emotes on the face: its marks' quads, and a flush of the head's skin.
        ${FACE_VERTEX_GLSL}
        // The umbrella's hand: the gesturing one, unless that hand holds someone else's (pose 'hold').
        float uside = P == 6 ? -side : side;
        #ifndef MOB_POSED
        mobPose(t, body, r, P, moving, phase, side, bag, umb, straps, manner, sm);
        #endif

        // Skinned by two bones (an umbrella mirrored to the hand it's in, on that side's arm).
        float m = mix(1.0, uside, aMirror);
        vec3 p = vec3(position.x * m, position.yz);
        vec3 n = vec3(normal.x * m, normal.yz);
        mat3 M0, M1;
        vec3 T0, T1;
        int b0 = int(aBone.x + 0.5);
        int b1 = int(aBone.y + 0.5);
        #ifdef MOB_POSED
        // A character posed freely (real/characterPose.ts): every bone's matrix worked out on the CPU and handed in.
        M0 = mat3(uBones[b0]);
        T0 = uBones[b0][3].xyz;
        M1 = mat3(uBones[b1]);
        T1 = uBones[b1][3].xyz;
        #else
        if (aMirror > 0.5 && uside < 0.0) {
          if (b0 == 9 || b0 == 10) b0 -= 2;
          if (b1 == 9 || b1 == 10) b1 -= 2;
        }
        #ifdef MOB_DIGITS
          if (b0 > 13) digit(b0, M0, T0); else bone(b0, M0, T0);
          if (b1 > 13) digit(b1, M1, T1); else bone(b1, M1, T1);
        #else
          bone(b0, M0, T0);
          bone(b1, M1, T1);
        #endif
        #endif
        float w = aBone.z;
        vec3 lp = w * (M0 * p + T0) + (1.0 - w) * (M1 * p + T1);
        vec3 ln = normalize(w * (M0 * n) + (1.0 - w) * (M1 * n));
        // The figure frame (x right, z forward) turned by its facing, at where it is.
        float fx = sin(aFig.z + turn), fz = cos(aFig.z + turn);
        vec3 local = vec3(org.x + fz * lp.x + fx * lp.z, ground + lp.y, org.y - fx * lp.x + fz * lp.z);
        vec3 nl = vec3(fz * ln.x + fx * ln.z, ln.y, -fx * ln.x + fz * ln.z);
        vec4 wp = modelMatrix * vec4(local, 1.0);
        vW = wp.xyz;
        vN = normalize(mat3(modelMatrix) * nl);
        // aShade: a tag in the hundreds, then the shade. No tag: the figure's tint. 1 skin, 19 hair, 20 shoes: the body,
        // coloured, or the one colour when that's on. 2-15: a part with a colour of its own (TAG_COLORS). 16-18: everyday
        // clothes, a colour by the figure (its top, its bottoms, its suit).
        float tag = floor(aShade / 100.0 + 0.001);
        float sh = aShade - tag * 100.0;
        float hq = fract(sin(dot(aTint, vec3(12.9898, 78.233, 37.719)) * 91.7 + aFig.w * 3.17) * 43758.5453);
        if (tag > 18.5) {
          float hh = fract(hq * 5.31 + 0.53);
          vec3 own = tag < 19.5 ? (body == 3 ? (${pickGlsl(ELDER_HAIR, 'hh')}) : (${pickGlsl(HAIR_COLORS, 'hh')})) : (${pickGlsl(SHOE_COLORS, 'hh')});
          vC = mix(own * sh, uFlat.rgb, uFlat.a);
        } else if (tag > 15.5) {
          float hb = fract(hq * 7.13 + 0.37);
          float hs = fract(hq * 3.71 + 0.11);
          vC = (tag < 16.5 ? (${pickGlsl(CLOTH_TOPS, 'hq')}) : tag < 17.5 ? (${pickGlsl(CLOTH_BOTTOMS, 'hb')}) : (${pickGlsl(CLOTH_SUITS, 'hs')})) * sh;
        } else if (tag > 1.5) vC = (${TAG_GLSL}) * sh;
        else if (tag > 0.5) vC = mix(${v3Glsl(SKIN_TONE)} * (0.84 + 0.3 * fract(hq * 2.17 + 0.71)) * sh * uSkin, uFlat.rgb, uFlat.a);
        else vC = mix(aTint * sh, uFlat.rgb, uFlat.a);
        // (A flushed face: the head's skin toward red, by how far to the front of the head it is, below the brow.)
        if (flushing > 0.0) vC = ${flushGlsl('vC', '(position - pv(2))', 'sh')};
        vC = mix(vC, uFlat.rgb, uBlack);
        // Fade with distance and as you walk into one, by where it stands so it fades whole.
        vec3 c = (modelMatrix * vec4(org.x, ground, org.y, 1.0)).xyz;
        float d = distance(c.xz, EYE.xz);
        // (seed -2: someone who stays whole right beside you, a passenger in your car.)
        vFade = fade * (seed < -1.5 ? 1.0 : smoothstep(0.45, 1.2, d)) * (1.0 - smoothstep(125.0, 175.0, d));
        #ifdef MOB_POSED
        // (A character being posed is looked at from as near as a fingertip: whole at any distance.)
        vFade = fade;
        #endif
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        // (A face mark's quad with nothing to show is folded away; one that shows, only near the viewer, as the emotes are.)
        if (folded) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vMark.w *= 1.0 - smoothstep(${(0.8 * EMOTE_REACH).toFixed(1)}, ${EMOTE_REACH.toFixed(1)}, d);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uOpacity;
      // How much denser a figure is toward its silhouette (and along every crease: 0 leaves a see-through figure even all over).
      uniform float uEdge;
      uniform float uLift;
      uniform vec3 uRim;
      uniform sampler2D tLight;
      uniform vec4 uLightRect;
      uniform vec2 uLightFade;
      uniform float uLightGain;
      varying vec3 vN;
      varying vec3 vW;
      varying vec3 vC;
      varying float vFade;
      varying vec4 vMark;
      varying vec2 vMarkFx;
      ${FACE_MARK_GLSL}
      float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
      float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
      #ifdef MOB_LIT
      uniform vec3 uHemiSky;
      uniform vec3 uHemiGround;
      uniform vec3 uSunCol;
      uniform vec3 uSunDir;
      uniform sampler2DShadow tSunShadow;
      uniform float uSunShadow;
      uniform mat4 uSunShadowMatrix;
      uniform vec3 uSunShadowBias;
      // How much of the sun reaches a point (the sun's shadow map, four taps of its filtered compare).
      float sunShade(vec3 n) {
        if (uSunShadow <= 0.0) return 1.0;
        // (Asked a little off the body, toward the sun: the map is too coarse for a figure to shade itself cleanly, so
        // it takes the shadows of what's round it, not its own.)
        vec4 sc = uSunShadowMatrix * vec4(vW + n * (uSunShadowBias.y + 0.06) + uSunDir * 0.3, 1.0);
        sc.xyz /= sc.w;
        sc.z += uSunShadowBias.x;
        if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
        float e = uSunShadowBias.z * 1.5;
        float s = texture(tSunShadow, vec3(sc.xy + vec2(e, e), sc.z)) + texture(tSunShadow, vec3(sc.xy + vec2(-e, e), sc.z)) + texture(tSunShadow, vec3(sc.xy + vec2(e, -e), sc.z)) + texture(tSunShadow, vec3(sc.xy + vec2(-e, -e), sc.z));
        return mix(1.0, s * 0.25, uSunShadow);
      }
      #endif
      void main() {
        if (vFade < 0.01) discard;
        if (vMark.z > 0.5) {
          // An emote's mark on the face: inked, not lit (a little dimmer at night), as the marks over a head are.
          vec4 mark = faceMark(vMark.xy, vMark.z, vMarkFx.x);
          float ma = mark.a * vMark.w * vFade;
          if (ma < 0.02) discard;
          gl_FragColor = vec4(mark.rgb * vMarkFx.y, ma);
          #include <fog_fragment>
          return;
        }
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        float rim = 1.0 - abs(dot(n, v));
        rim *= rim;
        float light = 0.6 + 0.4 * (n.y * 0.5 + 0.5);
        vec3 col = vC * uLift * light * (1.0 + 0.5 * rim);
        #ifdef MOB_LIT
        {
          // In the scene's light, as the city's surfaces are: the sky's from above and the ground's from below, and the
          // sun or the moon where it reaches. (A floor, so someone in the dark is a dark figure, not a hole.)
          vec3 sky = mix(uHemiGround, uHemiSky, 0.5 + 0.5 * n.y);
          vec3 lit = vC * 0.3183 * (sky + uSunCol * max(dot(n, uSunDir), 0.0) * sunShade(n));
          col = max(lit, vC * 0.05) * uLift * (1.0 + 0.3 * rim);
        }
        #endif
        // A soft light along the silhouette (MOB_LOOKS), so dark figures part from a dark street.
        col += uRim * rim * (0.4 + 0.6 * rim);
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
        float a = (uOpacity + uEdge * rim) * vFade + (bayer4(gl_FragCoord.xy) - 0.5) * 0.24 * (1.0 - smoothstep(0.92, 1.0, vFade));
        if (a < 0.02) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        #include <fog_fragment>
      }`,
  });
  setMobLook(material, look);
  // The shadow caster: the same posing, depth only (three draws a mesh into a shadow map with its customDepthMaterial).
  material.userData.depth = new THREE.ShaderMaterial({
    uniforms: material.uniforms,
    defines: { MOB_DEPTH: '' },
    vertexShader: material.vertexShader,
    fragmentShader: /* glsl */ `
      varying float vFade;
      void main() {
        if (vFade < 0.5) discard;
        gl_FragColor = vec4(1.0);
      }`,
  });
  return material;
}

/** The mob material's shadow caster (a mesh's `customDepthMaterial`): the figures posed as they're drawn, near the viewer only. */
export const mobDepthMaterial = (material: THREE.Material): THREE.Material | undefined => material.userData.depth as THREE.Material | undefined;

/** Where a point is, for people: on a pavement or open ground, a shared lane (walk along it), or the road. */
export type Footing = 'foot' | 'lane' | 'road';

/**
 * A cell's roads as people see them: the carriageways of roads with raised pavements and their junction boxes
 * (where the pavement stops for a crossing road) are 'road', shared lanes without pavements 'lane', and
 * everything else (pavements, alleys, plazas off the carriageways, open ground) 'foot'.
 */
export function footingOf(roads: readonly Road3[]): (x: number, z: number) => Footing {
  const live = roads.filter((r) => r.kind !== 'alley' && r.kind !== 'coast');
  return (x, z) => {
    let lane = false;
    for (const r of live) {
      const q = r.rect;
      if (x < q.x || x > q.x + q.w || z < q.y || z > q.y + q.h) continue;
      if (r.sidewalk <= 0) {
        lane = true;
        continue;
      }
      const across = r.vertical ? Math.min(x - q.x, q.x + q.w - x) : Math.min(z - q.y, q.y + q.h - z);
      if (across > r.sidewalk - 0.2) return 'road';
      // The pavement stops where a crossing road passes (the junction box is road).
      const cut = live.some((o) => o !== r && o.vertical !== r.vertical && o.sidewalk > 0 && (r.vertical ? z > o.rect.y && z < o.rect.y + o.rect.h : x > o.rect.x && x < o.rect.x + o.rect.w));
      if (cut) return 'road';
    }
    return lane ? 'lane' : 'foot';
  };
}

// ---- Crowds ----

/** Who hangs about in an alley. */
const ALLEY_PEOPLE: PeopleMix = { hood: 3, chinpira: 2, yakuza: 1.2, yankee: 1, drunk: 1, plain: 1, long: 0.5, irezumi: 0.3, bosozoku: 0.3 };

function randomPerson(rnd: Rng, x: number, z: number, yaw: number, pose: Pose, body: Body | undefined, mix: PeopleMix, night = 0.15): FigureSpec {
  const b: Body = body ?? (rnd.chance(0.45) ? 'man' : rnd.chance(0.85) ? 'woman' : 'elder');
  const woman = b === 'woman';
  // What they wear, by the place's mix.
  const outfit = pickOutfit(mix, rnd.int(0, 1 << 30), (o) => wears(b, o));
  let hair: Hair = woman ? rnd.pick(['long', 'long', 'bob', 'ponytail', 'bun', 'short', 'hat'] as const) : b === 'elder' ? rnd.pick(['none', 'hat', 'cap'] as const) : rnd.pick(['short', 'short', 'short', 'none', 'cap', 'hat'] as const);
  if (outfit === 'maid' || ((outfit === 'school' || outfit === 'pinoy_school' || outfit === 'track' || outfit === 'gym') && woman)) hair = rnd.pick(['long', 'ponytail', 'bob', 'twin', 'short', 'bun'] as const);
  if (outfit === 'gown' || outfit === 'office') hair = woman ? rnd.pick(['long', 'bun', 'bob'] as const) : hair;
  if (outfit === 'kimono' || outfit === 'yukata') hair = woman ? 'bun' : rnd.pick(['short', 'none'] as const);
  if (outfit === 'work' || outfit === 'police') hair = woman ? 'short' : rnd.pick(['short', 'none'] as const);
  if (outfit === 'suit' && !woman) hair = rnd.pick(['short', 'short', 'none'] as const);
  // The shady ones: their hair picks the look (real/mobShape.ts: a punch perm, a crop, slicked back; the old boss in
  // white under a hat; a politician's sash now and then on a fat cat).
  if (outfit === 'yakuza') hair = b === 'elder' ? rnd.pick(['hat', 'hat', 'short', 'none'] as const) : rnd.pick(['short', 'short', 'none', 'cap', 'cap'] as const);
  if (outfit === 'chinpira' || (outfit === 'bosozoku' && !woman)) hair = rnd.pick(['short', 'none', 'cap', 'hat'] as const);
  if (outfit === 'boss') hair = rnd.chance(0.06) ? 'cap' : rnd.pick(['short', 'none'] as const);
  if (outfit === 'hood' && !woman) hair = rnd.pick(['short', 'short', 'none', 'cap'] as const);
  if (outfit === 'yankee') hair = woman ? rnd.pick(['long', 'long', 'ponytail', 'bob'] as const) : rnd.pick(['short', 'none'] as const);
  if (outfit === 'drunk' || outfit === 'irezumi') hair = rnd.pick(['short', 'short', 'none'] as const);
  // The Filipino ones (under review): a vendor in a salakot or bareheaded, a tricycle driver in a cap, a guard bareheaded (his cap is his uniform's; none: a shotgun).
  if (outfit === 'vendor') hair = rnd.pick(woman ? ['hat', 'hat', 'bun', 'long', 'ponytail'] as const : ['hat', 'hat', 'short', 'none'] as const);
  if (outfit === 'trike_driver') hair = 'cap';
  if (outfit === 'guard') hair = woman ? rnd.pick(['short', 'bun', 'ponytail'] as const) : rnd.pick(['short', 'short', 'none'] as const);
  // A bag in the left hand: they gesture with the right.
  const carries = (outfit === 'suit' && !woman) || (outfit === 'school' && b !== 'child') || outfit === 'drunk' || (outfit === 'yankee' && woman);
  return {
    x,
    z,
    yaw,
    body: b,
    pose,
    // (Police in navy.)
    color: outfit === 'police' ? GHOST_COLORS[3] : rnd.pick(GHOST_COLORS),
    hair,
    long: outfit === 'long',
    outfit,
    phase: rnd.float(),
    side: carries || rnd.chance(0.5) ? 1 : -1,
    look: (rnd.float() - 0.5) * 0.6,
    // When they're out and how they carry themselves (district/peopleHours.ts), and their own threshold for being out.
    ...whenOf(outfit, b, night, rnd.float()),
    out: rnd.float(),
  };
}

/**
 * Deterministic people for a cell. A city's people are mostly going somewhere: most walk a stretch of pavement
 * (or a shared lane, a plaza, a park path), alone, in couples, with a child, two friends side by side, fading in
 * at one end and out at the other. People stand where it makes sense: at the kerb waiting for the walk light
 * (and then crossing on the zebra, on the signal's clock: `signals`), against a wall on the phone or waiting,
 * talking where a pavement is wide, a few in plazas and parks. Nobody stands in the road (`footingOf`). People
 * together share a fade seed and a walk.
 */
export function cellCrowd(plan: CellPlan3, detail: CellDetail, plazas: readonly (Rect & { readonly focus?: readonly [number, number] })[] = [], signals: Signals | null = null, around: readonly Road3[] = plan.roads, stamps: readonly Rect[] = [], fixtures: readonly Rect[] = []): FigureSpec[] {
  const out: FigureSpec[] = [];
  const mix = plan.style.people ?? DISTRICT_PEOPLE[plan.kind] ?? CITY_PEOPLE;
  const night = nightLife(plan.style, plan.kind);
  const person = (rnd: Rng, x: number, z: number, yaw: number, pose: Pose, body?: Body): FigureSpec => randomPerson(rnd, x, z, yaw, pose, body, mix, night);
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  const inRect = (q: Rect, x: number, z: number, m: number): boolean => x > q.x - m && x < q.x + q.w + m && z > q.y - m && z < q.y + q.h + m;
  const clear = (x: number, z: number): boolean =>
    !detail.props.some((p) => propDist(p, x, z) < p.radius + (p.kind === 'car' ? 1.6 : 0.8)) &&
    !detail.solids.some((q) => inRect(q, x, z, 0.8)) &&
    !plan.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8) &&
    // Set pieces (stamps, here and next door) are solid to the crowd too, a plaza's kōban or a corner's tower.
    !stamps.some((q) => inRect(q, x, z, 0.8)) &&
    // And so is what stands in and about them (their own collision: a store's racks out on the pavement, a
    // station's piers, a precinct's walls), with the room a walker needs (the controls' radius).
    !fixtures.some((q) => inRect(q, x, z, 0.4));
  // (The neighbours' roads too: a junction at the cell's corner is partly theirs.)
  const footing = footingOf(around);
  /** Somewhere a person can stand: off the road and the lanes, clear, in this cell. */
  const standable = (x: number, z: number): boolean => mine(x, z) && footing(x, z) === 'foot' && clear(x, z);
  /** How far a walker can go from (x, z) along (dx, dz) without reaching the road (lanes are fine), up to `max` m. */
  const reach = (x: number, z: number, dx: number, dz: number, max = 90): number => {
    let L = 0;
    for (let s = 1; s <= max; s++) {
      const px = x + dx * s;
      const pz = z + dz * s;
      if (!mine(px, pz) || !clear(px, pz) || footing(px, pz) === 'road') break;
      L = s;
    }
    return L;
  };
  /** A walk along (dx, dz) for L metres at a stroll (an elder's slower), and the time away between walks. */
  // (One in twenty-five is in a hurry: they run.)
  const walkOf = (rnd: Rng, L: number, dx: number, dz: number, slow = false): FigureSpec['walk'] => ({ ex: dx * L, ez: dz * L, speed: !slow && rnd.chance(0.04) ? 2.7 + rnd.float() * 0.5 : (slow ? 0.95 : 1.2) + rnd.float() * 0.35, gap: 3 + rnd.float() * 20 });
  /** People walking from (x, z) along (dx, dz): one, a couple, a parent and child, or two friends side by side. */
  const walkers = (rnd: Rng, x: number, z: number, dx: number, dz: number, L: number, roomy: boolean): void => {
    const yaw = Math.atan2(dx, dz);
    const rx = dz, rz = -dx;
    const seed = rnd.float();
    const roll = rnd.float();
    const at = (o: number): [number, number] => [x + rx * o, z + rz * o];
    if (roll < 0.6 || !roomy) {
      const who = person(rnd, x, z, yaw, 'walk');
      out.push({ ...who, seed, walk: walkOf(rnd, L, dx, dz, who.body === 'elder') });
    } else if (roll < 0.78) {
      const walk = walkOf(rnd, L, dx, dz);
      const [x1, z1] = at(-0.33);
      const [x2, z2] = at(0.33);
      out.push({ ...person(rnd, x1, z1, yaw, 'walk', 'man'), seed, walk });
      out.push({ ...person(rnd, x2, z2, yaw, 'walk', 'woman'), look: -0.4, seed, walk });
    } else if (roll < 0.9) {
      const walk = walkOf(rnd, L, dx, dz, true);
      const [x1, z1] = at(-0.28);
      const [x2, z2] = at(0.3);
      const parent = person(rnd, x1, z1, yaw, 'walk', rnd.chance(0.6) ? 'woman' : 'man');
      // (A parent out with a child: in their own clothes, not a uniform.)
      const own = parent.outfit === 'maid' || parent.outfit === 'school' ? 'plain' : parent.outfit;
      out.push({ ...parent, outfit: own, side: 1, seed, walk });
      out.push({ ...person(rnd, x2, z2, yaw, 'walk', 'child'), side: -1, hair: rnd.pick(['short', 'cap', 'bun', 'twin'] as const), look: -0.3, phase: parent.phase + 0.5, seed, walk });
    } else {
      const walk = walkOf(rnd, L, dx, dz);
      const [x1, z1] = at(-0.32);
      const [x2, z2] = at(0.32);
      out.push({ ...person(rnd, x1, z1, yaw, 'walk'), look: 0.35, seed, walk });
      out.push({ ...person(rnd, x2, z2, yaw, 'walk'), look: -0.35, seed, walk });
    }
  };
  const onRoad = (r: Road3, side: number, t: number, across: number): [number, number, number, number] => {
    const q = r.rect;
    // (x, z) across from the road's edge on `side` (its building side), plus the direction along the road.
    return r.vertical ? [side < 0 ? q.x + across : q.x + q.w - across, t, 0, 1] : [t, side < 0 ? q.y + across : q.y + q.h - across, 1, 0];
  };

  for (const r of plan.roads) {
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const shared = r.kind !== 'alley' && r.sidewalk <= 0;
    const pave = r.sidewalk > 0 ? r.sidewalk : r.kind === 'alley' ? Math.min(r.vertical ? q.w : q.h, 4) / 2 : 1.6;
    const rnd = rng(hash(Math.round(q.x * 3), Math.round(q.y * 3), 0x9e0, r.vertical ? 1 : 2));
    const [a, b] = r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w];
    for (const side of [-1, 1]) {
      for (let t = a + 2 + rnd.float() * 5; t < b - 2; t += 6 + rnd.float() * 9) {
        if (!rnd.chance(r.sidewalk > 0 ? 0.62 : shared ? 0.3 : 0.4)) continue;
        // Walking, on the pavement's middle (in a shared lane, near its edge).
        const across = shared ? 0.7 + rnd.float() * 0.6 : pave * (0.35 + rnd.float() * 0.3);
        const [x, z, dx0, dz0] = onRoad(r, side, t, across);
        const dir = rnd.chance(0.5) ? 1 : -1;
        const [dx, dz] = [dx0 * dir, dz0 * dir];
        const roll = rnd.float();
        if (shared || roll < 0.72) {
          if (!mine(x, z) || !clear(x, z) || footing(x, z) === 'road') continue;
          const L = reach(x, z, dx, dz);
          if (L >= 10) walkers(rnd, x, z, dx, dz, L, pave >= 2.2);
          continue;
        }
        // Standing: against the wall (on the phone, waiting, two talking), or where the pavement is wide, a few.
        const [wx, wz] = onRoad(r, side, t, 0.45);
        if (!standable(wx, wz)) continue;
        const face = Math.atan2(r.vertical ? -side : 0, r.vertical ? 0 : -side);
        const seed = rnd.float();
        if (roll < 0.86) {
          out.push({ ...person(rnd, wx, wz, face + (rnd.float() - 0.5) * 0.8, rnd.pick(['phone', 'phone', 'stand', 'pockets'] as const)), seed });
        } else if (roll < 0.95 || pave < 3.2) {
          const [ux, uz] = [dx0 * 0.45, dz0 * 0.45];
          if (!standable(wx + ux, wz + uz) || !standable(wx - ux, wz - uz)) continue;
          const yaw = Math.atan2(dx0, dz0);
          out.push({ ...person(rnd, wx - ux, wz - uz, yaw, rnd.chance(0.5) ? 'talk' : 'stand'), look: 0, seed });
          out.push({ ...person(rnd, wx + ux, wz + uz, yaw + Math.PI, rnd.chance(0.5) ? 'stand' : 'pockets'), look: 0, seed });
        } else {
          const [cx, cz] = onRoad(r, side, t, 1.3);
          const n = rnd.int(3, 4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd.float() * 0.4;
            const [xi, zi] = [cx + Math.sin(ang) * 0.6, cz + Math.cos(ang) * 0.6];
            if (standable(xi, zi)) out.push({ ...person(rnd, xi, zi, ang + Math.PI, rnd.pick(['stand', 'stand', 'pockets', 'talk', 'phone'] as const)), look: (rnd.float() - 0.5) * 0.8, seed });
          }
        }
      }
    }
  }

  // The alleys' own people: someone against the wall you'd rather not pass, two of them, a few squatting together.
  // More of them where the night is alive; they keep late hours, so an alley by day is mostly empty.
  for (const r of plan.roads) {
    if (r.kind !== 'alley') continue;
    const q = r.rect;
    const rnd = rng(hash(Math.round(q.x * 3), Math.round(q.y * 3), 0x5ad1, r.vertical ? 1 : 2));
    const [a, b] = r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w];
    const shady = (x: number, z: number, yaw: number, pose: Pose): FigureSpec => {
      const who = randomPerson(rnd, x, z, yaw, pose, rnd.chance(0.85) ? 'man' : 'woman', ALLEY_PEOPLE, night);
      return { ...who, hours: who.hours === 'always' || who.hours === 'commute' ? 'late' : who.hours, manner: who.manner === 'drunk' ? 'drunk' : 'shady' };
    };
    for (const side of [-1, 1]) {
      for (let t = a + 3 + rnd.float() * 8; t < b - 3; t += 9 + rnd.float() * 12) {
        if (!rnd.chance(0.14 + 0.36 * night)) continue;
        const [wx, wz, dx0, dz0] = onRoad(r, side, t, 0.4);
        if (!standable(wx, wz)) continue;
        const face = Math.atan2(r.vertical ? -side : 0, r.vertical ? 0 : -side);
        const seed = rnd.float();
        const roll = rnd.float();
        if (roll < 0.55) out.push({ ...shady(wx, wz, face + (rnd.float() - 0.5) * 0.6, rnd.pick(['stand', 'pockets', 'pockets', 'phone'] as const)), seed });
        else {
          const n = roll < 0.85 ? 2 : 3;
          for (let i = 0; i < n; i++) {
            const o = (i - (n - 1) / 2) * 0.8;
            const [xi, zi] = [wx + dx0 * o, wz + dz0 * o];
            if (standable(xi, zi)) out.push({ ...shady(xi, zi, face + (rnd.float() - 0.5) * 0.9, rnd.pick(['stand', 'pockets', 'talk'] as const)), look: (rnd.float() - 0.5) * 0.9, seed });
          }
        }
      }
    }
  }

  // Crossing at the zebras: a junction of two roads with pavements has a zebra over each road just outside the
  // junction box (real/ground.ts). People wait at the kerb and cross: at a signal (cell-edge roads on the grid
  // lines) when the walk light is on, on the traffic's clock; elsewhere whenever they come.
  const live = plan.roads.filter((r) => r.kind !== 'alley' && r.kind !== 'coast' && r.sidewalk > 0);
  const onGrid = (v: number): boolean => Math.abs(v - Math.round(v / CELL) * CELL) < 0.01;
  for (const r of live) {
    const q = r.rect;
    const width = r.vertical ? q.w : q.h;
    const centre = r.vertical ? q.x + q.w / 2 : q.y + q.h / 2;
    for (const o of live) {
      if (o === r || o.vertical === r.vertical || Math.min(o.rect.w, o.rect.h) < 3 || !overlaps(o.rect, q)) continue;
      const oc = o.vertical ? o.rect.x + o.rect.w / 2 : o.rect.y + o.rect.h / 2;
      const gx = Math.round((r.vertical ? centre : oc) / CELL);
      const gy = Math.round((r.vertical ? oc : centre) / CELL);
      const signal = signals && onGrid(centre) && onGrid(oc) && width >= 8 ? signals.walkPhase(gx, gy, o.vertical) : null;
      const rnd = rng(hash(Math.round(q.x * 3 + o.rect.x), Math.round(q.y * 3 + o.rect.y), 0x7e5));
      // The junction's box along r, which the zebras stand off: the wider of this street and the one carrying on
      // across r's line in the next cell (plan.ts junctionSpans).
      const [oa, ob] = r.vertical ? [o.rect.y, o.rect.y + o.rect.h] : [o.rect.x, o.rect.x + o.rect.w];
      const [ja, jb] = junctionSpans(r, plan.roads).find(([a, b]) => a <= oa + 0.01 && b >= ob - 0.01) ?? [oa, ob];
      for (const [edge, dir] of [[ja, -1], [jb, 1]] as const) {
        const t = edge + dir * 2.1;
        for (const side of [-1, 1]) {
          // From the kerb on `side` straight across to the other.
          const [x, z] = onRoad(r, side, t, r.sidewalk - 0.45);
          if (!mine(x, z) || !clear(x, z)) continue;
          const L = width - 2 * (r.sidewalk - 0.45);
          const [dx, dz] = r.vertical ? [-side, 0] : [0, -side];
          const yaw = Math.atan2(dx, dz);
          // A few at each kerb: more on the avenues, at the signals.
          const n = rnd.chance(signal ? 0.75 : 0.35) ? rnd.int(1, r.kind === 'boulevard' && signal ? 3 : 1) : 0;
          for (let i = 0; i < n; i++) {
            // Bunched at the kerb, a little apart along it.
            const off = (rnd.float() - 0.5) * 2.6;
            const back = rnd.float() * 0.5;
            const px = x + (r.vertical ? -dx * back : off);
            const pz = z + (r.vertical ? off : -dz * back);
            if (!mine(px, pz)) continue;
            const who = person(rnd, px, pz, yaw, 'walk');
            if (signal) {
              // Off the kerb within the first few seconds of the walk light, across in time.
              const delay = rnd.float() * 3;
              const speed = Math.max(1.25 + rnd.float() * 0.3, L / Math.max(4, signal.length - delay - 1));
              const wait = 3 + rnd.float() * Math.min(18, signal.cycle - L / speed - delay - 6);
              const at = (((signal.start + delay - wait) % signal.cycle) + signal.cycle) % signal.cycle;
              out.push({ ...who, look: 0, walk: { ex: dx * L, ez: dz * L, speed, gap: 0, signal: { cycle: signal.cycle, at, wait } } });
            } else out.push({ ...who, seed: rnd.float(), walk: walkOf(rnd, L, dx, dz, who.body === 'elder') });
          }
        }
      }
    }
  }
  // A scramble: people also cross the junction diagonally, corner to corner, in the scramble phase.
  if (signals) {
    for (const v of live.filter((r) => r.vertical && onGrid(r.rect.x + r.rect.w / 2))) {
      for (const h of live.filter((r) => !r.vertical && onGrid(r.rect.y + r.rect.h / 2) && overlaps(r.rect, v.rect))) {
        const X = v.rect.x + v.rect.w / 2;
        const Z = h.rect.y + h.rect.h / 2;
        const gx = Math.round(X / CELL), gy = Math.round(Z / CELL);
        if (!signals.isScramble(gx, gy)) continue;
        const ph = signals.walkPhase(gx, gy, true);
        const rnd = rng(hash(gx, gy, 0x5c4));
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
          // From the corner of the pavements to the opposite corner.
          const x0 = X + sx * (v.rect.w / 2 - v.sidewalk / 2);
          const z0 = Z + sz * (h.rect.h / 2 + 0.6);
          if (!mine(x0, z0)) continue;
          const ex = -2 * (x0 - X), ez = -2 * (z0 - Z);
          const L = Math.hypot(ex, ez);
          const yaw = Math.atan2(ex, ez);
          for (let i = rnd.int(1, 3); i > 0; i--) {
            const px = x0 + (rnd.float() - 0.5) * 1.6, pz = z0 + sz * rnd.float() * 0.8;
            const delay = rnd.float() * 2.5;
            const speed = Math.max(1.3, L / (ph.length - delay - 1));
            const wait = 3 + rnd.float() * 15;
            const at = (((ph.start + delay - wait) % ph.cycle) + ph.cycle) % ph.cycle;
            out.push({ ...person(rnd, px, pz, yaw, 'walk'), look: 0, walk: { ex, ez, speed, gap: 0, signal: { cycle: ph.cycle, at, wait } } });
          }
        }
      }
    }
  }

  // Plazas (a busy square of people crossing it, a few waiting to meet someone or standing together), and more
  // thinly the open ground: tower plazas, park paths, playgrounds.
  const areas: { rect: Rect; density: number; focus?: readonly [number, number] }[] = [...plazas.map((rect) => ({ rect, density: 0.5, focus: rect.focus })), ...detail.open.flatMap((o) => o.crowd)];
  // Open ground stands lower than the pavements (car parks, grass, gravel paths): figures there stand on its top.
  const pieces = detail.open.flatMap((o) => o.ground);
  const floorAt = (x: number, z: number): number => {
    let top = -1;
    for (const g of pieces) if (inRect(g.rect, x, z, 0)) top = Math.max(top, g.top);
    return top < 0 ? 0 : top - 0.15;
  };
  /** Something solid within `d` m of (x, z) along (dx, dz): a wall, a fence, a planter. */
  const wallAt = (x: number, z: number, dx: number, dz: number, d: number): boolean => {
    for (let s = 0.5; s <= d; s += 0.5) if (!clear(x + dx * s, z + dz * s)) return true;
    return false;
  };
  for (const { rect: q, density, focus } of areas) {
    const rnd = rng(hash(Math.round(q.x), Math.round(q.y), 0x9e1));
    for (let x = q.x + 2.5; x < q.x + q.w - 2; x += 4.2) {
      for (let z = q.y + 2.5; z < q.y + q.h - 2; z += 4.2) {
        if (!rnd.chance(density)) continue;
        const px = x + (rnd.float() - 0.5) * 2.4;
        const pz = z + (rnd.float() - 0.5) * 2.4;
        if (!standable(px, pz)) continue;
        const yaw = rnd.float() * Math.PI * 2;
        const [dx, dz] = [Math.sin(yaw), Math.cos(yaw)];
        const roll = rnd.float();
        const y = floorAt(px, pz);
        const from = out.length;
        // Walks stay inside the area (crossing the square, not wandering off into the streets).
        let inside = 0;
        while (inside < 60 && inRect(q, px + dx * (inside + 1), pz + dz * (inside + 1), 0)) inside++;
        const L = Math.min(reach(px, pz, dx, dz), inside);
        // Someone alone waits where people wait: with their back to something (a wall, a planter), looking out,
        // or near a landmark watching it (the big screens); never alone in the open facing nothing.
        let wait: number | null = null;
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          if (wallAt(px, pz, Math.sin(a), Math.cos(a), 2.5)) {
            wait = a + Math.PI + (rnd.float() - 0.5) * 0.7;
            break;
          }
        }
        const fd = focus ? Math.hypot(focus[0] - px, focus[1] - pz) : Infinity;
        if (wait === null && fd < 45) wait = Math.atan2(focus![0] - px, focus![1] - pz) + (rnd.float() - 0.5) * 0.5;
        if (L >= 8 && (roll < 0.62 || (roll < 0.86 && wait === null))) walkers(rnd, px, pz, dx, dz, L, true);
        else if (roll < 0.86) {
          if (wait !== null) out.push({ ...person(rnd, px, pz, wait, rnd.pick(['phone', 'phone', 'stand', 'pockets'] as const)), look: 0, seed: rnd.float() });
        } else {
          const seed = rnd.float();
          const n = rnd.int(2, 4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd.float() * 0.4;
            const [xi, zi] = [px + Math.sin(ang) * 0.6, pz + Math.cos(ang) * 0.6];
            if (standable(xi, zi)) out.push({ ...person(rnd, xi, zi, ang + Math.PI, rnd.pick(['stand', 'stand', 'pockets', 'talk', 'phone'] as const)), look: (rnd.float() - 0.5) * 0.8, seed });
          }
        }
        if (y !== 0) for (let i = from; i < out.length; i++) out[i] = { ...out[i], y };
      }
    }
  }
  // Nobody stands facing a wall: anyone standing with something solid right in front turns round.
  for (let i = 0; i < out.length; i++) {
    const f = out[i];
    if (f.walk) continue;
    if (wallAt(f.x, f.z, Math.sin(f.yaw), Math.cos(f.yaw), 1.0)) out[i] = { ...f, yaw: f.yaw + Math.PI };
  }
  // People together are out together: one threshold for the group, and a child's hours if there's a child among them.
  const groups = new Map<number, number[]>();
  out.forEach((f, i) => {
    if (f.seed === undefined) return;
    const g = groups.get(f.seed);
    if (g) g.push(i);
    else groups.set(f.seed, [i]);
  });
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const lead = out[g[0]];
    const hours = g.some((i) => out[i].body === 'child') ? 'day' : lead.hours;
    for (const i of g) out[i] = { ...out[i], hours, out: lead.out };
  }
  // Who has something lit (district/peopleMix.ts): by who they are and what they're doing, each from where they
  // stand (no draw from the cell's random numbers, so everything else stays as it was). Not someone holding a hand.
  return out.map((s): FigureSpec => {
    if (s.pose === 'hold') return s;
    const what = smokeOf({ body: s.body, outfit: outfitOf(s), hair: s.hair }, !s.walk ? 'stand' : s.walk.speed > 1.9 ? 'run' : 'walk', u01(hash(Math.round(s.x * 10), Math.round(s.z * 10), 0x5a0c)));
    return what ? { ...s, smokes: what } : s;
  });
}

// ---- Passengers ----

/** A place in a vehicle's own frame: where a passenger stands or sits (the seat's middle), on what floor, facing. */
export interface PassengerSpot {
  readonly x: number;
  readonly z: number;
  /** The floor under the feet (a seated passenger's feet too; the seat is 0.46 m above it). */
  readonly y: number;
  readonly yaw: number;
}

let passengerMaterial: THREE.Material | null = null;
/** The material passengers are drawn with (the mob's; set by the page before trains and buses are built). */
export function setPassengerMaterial(m: THREE.Material | null): void {
  passengerMaterial = m;
}

/**
 * Passengers for a vehicle (or people waiting on a platform: no seats, `poses` without the strap): some of its seats taken (sitting, a few on their phones) and people standing in the
 * aisles holding straps or poles, as one baked mesh in the vehicle's frame (add it to the car or bus, so it rides
 * along). Who's aboard is a pure function of `seed`; they never fade. Null when there's no material (the
 * showroom) or nobody aboard.
 */
export function passengerMesh(seats: readonly PassengerSpot[], standing: readonly PassengerSpot[], seed: number, fill: { readonly seat: number; readonly stand: number }, mix: PeopleMix = CITY_PEOPLE, poses: readonly Pose[] = ['strap', 'strap', 'stand', 'phone']): THREE.Mesh | null {
  if (!passengerMaterial) return null;
  const rnd = rng(hash(seed, 0x9a55));
  const gb = new GhostBuilder();
  const add = (p: PassengerSpot, pose: Pose): void => {
    const who = randomPerson(rnd, 0, 0, p.yaw, pose, rnd.chance(0.04) ? 'child' : undefined, mix);
    // A seated passenger's feet are 0.15 m in front of the seat's middle (the hips over the cushion).
    const back = pose === 'sit' ? -0.12 : 0;
    addFigure(gb, { ...who, x: p.x + Math.sin(p.yaw) * back, z: p.z + Math.cos(p.yaw) * back, y: p.y - 0.15, fade: false, look: (rnd.float() - 0.5) * 0.5 });
  };
  // (No one sits right next to someone: the figures are wider than a 0.46 m seat. Seats come in bench order.)
  let last: PassengerSpot | null = null;
  for (const p of seats) {
    const near = last !== null && Math.hypot(p.x - last.x, p.z - last.z) < 0.7;
    if (!near && rnd.chance(fill.seat * 1.6)) {
      add(p, 'sit');
      last = p;
    }
  }
  for (const p of standing) if (rnd.chance(fill.stand)) add(p, rnd.pick(poses));
  const geo = gb.build(0, 0);
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, passengerMaterial);
  mesh.renderOrder = 2;
  mesh.name = 'passengers';
  return mesh;
}
