import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { addTree } from '../models/trees';
import { addCar } from './cars';
import type { C3 } from './interiorDraw';
import { Kit, text } from './kit';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld } from './localFrame';
import { EMIT, KIND, lin } from './meshBuilder';

/**
 * Kasumi-chō's open-air set pieces (registered through kasumi.ts with the kit landmarks), in the local frame
 * (u along the street face, t inward):
 * - cemetery: 霞町霊園 Kasumi Reien, the cemetery avenue (after Aoyama's): a walled cemetery on Kasumi-dōri, a
 *   stone gate, a paved avenue up its middle under cherry trees and stone lanterns, blocks of family graves either
 *   side in back-to-back rows (stepped granite pillars, flower vases, sotoba), cross paths; by the gate the flower
 *   and incense shop, the water station with its buckets, a row of jizō; at the far end a large family plot on
 *   the avenue's axis and, in the corner, the mound of stones nobody tends (無縁塚). Autumn opens here at higan.
 * - construction: the redevelopment site (霞町一丁目地区再開発): white hoardings with the project's board and
 *   notices, a half-open gate and its guard hut, prefab site offices, stacks of steel, an excavator and a crawler
 *   crane, and a shored pit 8 m deep you look down into from the rim (a hole cut in the ground: `siteHoles`); at
 *   its bottom a corner sealed under blue tarps behind a survey notice (what's under them is the story's).
 */

type R4 = readonly [number, number, number, number];

/** A small deterministic hash to [0, 1) for dressing the graves. */
function rnd(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ======================================================================================================
// 霞町霊園

/** The cemetery's plan: 84 m along Kasumi-dōri, 100 deep. */
export const REIEN = {
  w: 84,
  d: 100,
  wall: 0.4,
  gate: [37, 47] as const,
  avenue: [38.5, 45.5] as const,
  /** Cross paths (their centres along t), 3 m wide. */
  cross: [30, 56, 82] as const,
  left: [4, 36] as const,
  right: [48, 80] as const,
  /** A grave's width along its row, a row pair's depth (two graves back to back), the aisle between pairs. */
  plot: 2.3,
  pair: 4.6,
  aisle: 1.6,
} as const;

const SHOP: R4 = [26, 36.4, 3, 10];
const WATER: R4 = [49.5, 57, 3.4, 7.6];
const JIZO: R4 = [60, 72, 2, 3.4];
const FAMILY: R4 = [37, 47, 93.4, 99.2];
const MUEN: R4 = [70, 80, 86.5, 98.5];

/** The grave blocks' ranges along t (between the gate's yard and the cross paths), with how far along u each side runs. */
const RANGES: readonly (readonly [number, number, number])[] = [[13, 28.5, 80], [31.5, 54.5, 80], [57.5, 80.5, 80], [83.5, 93, 68]];

/** Every row pair of graves: its rect, for drawing and for collision. */
function gravePairs(): R4[] {
  const out: R4[] = [];
  for (const [a, b, rightEnd] of RANGES)
    for (let t = a + 0.5; t + REIEN.pair <= b - 0.3; t += REIEN.pair + REIEN.aisle) {
      out.push([REIEN.left[0], REIEN.left[1], t, t + REIEN.pair]);
      out.push([REIEN.right[0], rightEnd, t, t + REIEN.pair]);
    }
  return out;
}

/** The avenue's trees (both sides), clear of the cross paths. */
function avenueTrees(): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 15; t < 92; t += 8.5) {
    if (REIEN.cross.some((c) => Math.abs(t - c) < 2.6)) continue;
    out.push([37.2, t], [46.8, t]);
  }
  return out;
}

function reienRects(): R4[] {
  const { w, d, wall, gate } = REIEN;
  return [
    [0, gate[0], 0, wall],
    [gate[1], w, 0, wall],
    [0, wall, 0, d],
    [w - wall, w, 0, d],
    [0, w, d - wall, d],
    SHOP,
    WATER,
    JIZO,
    FAMILY,
    MUEN,
    ...gravePairs(),
    ...avenueTrees().map(([u, t]) => [u - 0.3, u + 0.3, t - 0.3, t + 0.3] as R4),
  ];
}

// ======================================================================================================
// The redevelopment site

/** The site's plan: 90 m along Kasumi-dōri, 80 deep; the pit and its depth. */
export const SITE = {
  w: 90,
  d: 80,
  gate: [42, 50] as const,
  pit: { u0: 30, u1: 80, t0: 26, t1: 70 },
  depth: 8,
  fence: 3,
} as const;

const OFFICE: R4 = [4, 22, 6, 12];
const HUT: R4 = [51, 53.4, 0.8, 3.2];
const TOILETS: R4 = [4, 8.5, 14, 15.6];
const STACKS: readonly R4[] = [[6, 18, 20, 23.5], [6, 16, 26, 28.5], [10, 15, 32, 36], [84, 88, 6, 20]];
const EXCAVATOR: R4 = [22.5, 28.5, 40, 47];
const CRANE: R4 = [12, 21, 54, 63];
const TRUCK: R4 = [58, 61, 8, 15.5];
const SITE_LAMPS: readonly (readonly [number, number])[] = [[27, 23], [83, 23], [27, 73], [83, 73]];

function siteRects(): R4[] {
  const { w, d, gate, pit } = SITE;
  return [
    [0, gate[0], 0, 0.3],
    [gate[1], w, 0, 0.3],
    [0, 0.3, 0, d],
    [w - 0.3, w, 0, d],
    [0, w, d - 0.3, d],
    // The accordion gate's closed half, and the rim's guard rail all round the pit.
    [38, gate[0], 0, 0.5],
    [pit.u0 - 0.6, pit.u1 + 0.6, pit.t0 - 0.6, pit.t1 + 0.6],
    OFFICE,
    HUT,
    TOILETS,
    ...STACKS,
    EXCAVATOR,
    CRANE,
    TRUCK,
    ...SITE_LAMPS.map(([u, t]) => [u - 0.3, u + 0.3, t - 0.3, t + 0.3] as R4),
  ];
}

/** The pit, cut out of the street's ground. */
export function siteHoles(b: Building3): Rect[] {
  const { pit } = SITE;
  return [localRect(localFrame(b), pit.u0, pit.u1, pit.t0, pit.t1)];
}

// ======================================================================================================

export type GroundsKind = 'cemetery' | 'construction';

export function groundsColliders(kind: GroundsKind, b: Building3): Rect[] {
  const f = localFrame(b);
  return (kind === 'cemetery' ? reienRects() : siteRects()).map((r) => localRect(f, r[0], r[1], r[2], r[3]));
}

export function groundsShelters(kind: GroundsKind, b: Building3): { rect: Rect; y0: number; y1: number; enclosed: boolean }[] {
  const f = localFrame(b);
  const R = (r: R4, y1: number): { rect: Rect; y0: number; y1: number; enclosed: boolean } => ({ rect: localRect(f, r[0], r[1], r[2], r[3]), y0: 0, y1, enclosed: false });
  return kind === 'cemetery' ? [R(WATER, 2.6)] : [];
}

export function groundsLights(kind: GroundsKind, b: Building3): Light[] {
  const f = localFrame(b);
  const L = (u: number, t: number, r: number, color: C3, i: number): Light => {
    const [x, z] = toWorld(f, u, t);
    return { x, z, r, color, i };
  };
  if (kind === 'cemetery') {
    const warm: C3 = [1.0, 0.82, 0.6];
    return [L(42, 4, 8, warm, 0.6), L(36, 6.5, 5, warm, 0.6), ...[20, 43, 69, 90].map((t) => L(42, t, 9, warm, 0.45))];
  }
  const white: C3 = [0.95, 0.97, 1.0];
  return [...SITE_LAMPS.map(([u, t]) => L(u, t, 24, white, 0.85)), L(46, 3, 8, white, 0.7), L(46, 18, 14, white, 0.55), L(13, 5, 7, [1.0, 0.9, 0.7], 0.5)];
}

const SANS = "'Yu Gothic', 'Meiryo', sans-serif";
const MINCHO = "'Yu Mincho', 'MS Mincho', serif";

/** A world-space point for the mesh builder's beams. */
function P(k: Kit, u: number, t: number, y: number): [number, number, number] {
  const [x, z] = toWorld(k.f, u, t);
  return [x, y, z];
}

/** One grave at (u, t) facing along t by `dir`: the plot, the stepped base, the pillar; some with flowers and sotoba. */
function grave(k: Kit, u: number, t: number, dir: 1 | -1, seed: number): void {
  const r = (n: number): number => rnd(seed, n);
  const STONE = [0x9c9c98, 0x7a7c80, 0xb6b2aa, 0x6a6c70][Math.floor(r(1) * 4)];
  const big = r(2) > 0.82;
  const half = big ? 1.05 : 0.8;
  k.box(0xb0aca4, u - half, u + half, t - 1.0, t + 1.0, 0.03, 0.2);
  // The pillar stands toward the back of the plot (away from the aisle it faces).
  const tc = t - dir * 0.35;
  k.box(STONE, u - 0.5, u + 0.5, tc - 0.42, tc + 0.42, 0.2, 0.45);
  k.box(STONE, u - 0.36, u + 0.36, tc - 0.3, tc + 0.3, 0.45, 0.72);
  const top = 0.72 + (big ? 1.25 : 0.85 + r(3) * 0.3);
  if (r(4) > 0.72) k.kind(KIND.gloss, 0x24262a, u - 0.2, u + 0.2, tc - 0.2, tc + 0.2, 0.72, top);
  else k.box(STONE, u - 0.2, u + 0.2, tc - 0.2, tc + 0.2, 0.72, top);
  // Flowers in the two vases at the front, in most of them.
  const tf = tc + dir * 0.38;
  if (r(5) > 0.35)
    for (const s of [-1, 1]) {
      k.box(0x8a8c90, u + s * 0.3 - 0.05, u + s * 0.3 + 0.05, tf - 0.05, tf + 0.05, 0.45, 0.62);
      k.box([0xe8d040, 0xf0f0e8, 0xc83a6a, 0x8a4ac8][Math.floor(r(6 + s) * 4)], u + s * 0.3 - 0.09, u + s * 0.3 + 0.09, tf - 0.09, tf + 0.09, 0.62, 0.8);
      k.box(0x3a6a34, u + s * 0.3 - 0.03, u + s * 0.3 + 0.03, tf - 0.03, tf + 0.03, 0.56, 0.66);
    }
  // Sotoba: wooden tablets in a rack behind the pillar.
  if (r(8) > 0.6) {
    const tb = tc - dir * 0.34;
    const n = 1 + Math.floor(r(9) * 4);
    for (let i = 0; i < n; i++) k.box(0xc8b48a, u - 0.3 + i * 0.16, u - 0.22 + i * 0.16, tb - 0.012, tb + 0.012, 0.2, 1.9 + rnd(seed, 20 + i) * 0.5);
  }
  // A low stone lantern on the bigger plots.
  if (big) k.lathe(STONE, u + 0.8, t + dir * 0.6, [[0.2, 0.12], [0.6, 0.08], [0.62, 0.17], [0.82, 0.17], [0.86, 0.24], [0.98, 0.02]], 6);
}

/** A stone lantern (tōrō): a pedestal, the light box (a warm glow at night), a wide cap. */
function lantern(k: Kit, u: number, t: number): void {
  k.lathe(0x8c8c88, u, t, [[0, 0.3], [0.15, 0.3], [0.2, 0.14], [1.15, 0.12], [1.2, 0.28], [1.3, 0.28]], 8);
  k.glow([0.42, 0.28, 0.14], u - 0.16, u + 0.16, t - 0.16, t + 0.16, 1.3, 1.6, EMIT.lamp);
  k.lathe(0x7c7c78, u, t, [[1.6, 0.2], [1.64, 0.42], [1.74, 0.36], [1.95, 0.06], [2.05, 0.08], [2.12, 0.001]], 8);
}

function buildCemetery(k: Kit): void {
  const { w, d, wall, gate, avenue, cross, left, right, plot } = REIEN;
  const STONE = 0x9a9892;
  // ---- The ground: gravel between the graves, paving on the avenue and the paths, grass under the trees ----
  k.kind(KIND.gravel, 0xa89e8a, wall, w - wall, wall, d - wall, 0, 0.03);
  k.kind(KIND.sidewalk, 0xa6a094, avenue[0], avenue[1], 0, FAMILY[2], 0.03, 0.08);
  for (const c of cross) k.kind(KIND.sidewalk, 0xa6a094, left[0], right[1], c - 1.5, c + 1.5, 0.03, 0.07);
  for (const [a, b2] of [[36, avenue[0]], [avenue[1], 48]] as const) k.kind(KIND.grass, 0x4f6e38, a, b2, 13, 93, 0.03, 0.06);
  // ---- The wall on the street and round the sides: dressed stone under a clipped hedge; the gate's posts ----
  const run = (u0: number, u1: number, t0: number, t1: number): void => {
    k.box(STONE, u0, u1, t0, t1, 0, 1.25);
    k.box(0x2f4a2a, Math.min(u0, u1) + 0.04, Math.max(u0, u1) - 0.04, t0 + 0.04, t1 - 0.04, 1.25, 1.75);
  };
  run(0, gate[0], 0, wall);
  run(gate[1], w, 0, wall);
  run(0, wall, wall, d);
  run(w - wall, w, wall, d);
  run(wall, w - wall, d - wall, d);
  for (const u of [gate[0], gate[1]]) {
    k.box(0x8a8882, u - 0.45, u + 0.45, -0.1, 0.8, 0, 2.7);
    k.box(0x6e6c68, u - 0.6, u + 0.6, -0.25, 0.95, 2.7, 2.95);
    k.glow([1.2, 0.85, 0.5], u - 0.2, u + 0.2, 0.15, 0.55, 2.95, 3.3, EMIT.lamp);
  }
  k.plane(k.canvas(128, 512, (g) => {
    g.fillStyle = '#8a8882';
    g.fillRect(0, 0, 128, 512);
    ['霞', '町', '霊', '園'].forEach((c, i) => text(g, c, 64, 80 + i * 118, `bold 96px ${MINCHO}`, '#1c1c1a'));
  }), 0.5, 2.0, gate[0], -0.11, 1.5, 'out', 1.0);
  // The iron gates, swung in against the posts.
  for (const u of [gate[0] + 0.5, gate[1] - 0.6]) {
    for (let t = 0.9; t < 4.4; t += 0.22) k.box(0x1e2022, u, u + 0.05, t, t + 0.04, 0.15, 1.9);
    k.box(0x1e2022, u, u + 0.05, 0.9, 4.4, 1.86, 1.92);
    k.box(0x1e2022, u, u + 0.05, 0.9, 4.4, 0.15, 0.21);
  }
  // ---- The flower and incense shop (the cemetery's office) by the gate, its counter open to the avenue ----
  k.box(0xe6dfcc, SHOP[0], SHOP[1], SHOP[2], SHOP[3], 0, 0.9);
  k.box(0xe6dfcc, SHOP[0], SHOP[1], SHOP[2], SHOP[3], 2.3, 2.9);
  k.box(0xe6dfcc, SHOP[0], SHOP[0] + 0.2, SHOP[2], SHOP[3], 0.9, 2.3);
  k.box(0xe6dfcc, SHOP[0], SHOP[1], SHOP[3] - 0.2, SHOP[3], 0.9, 2.3);
  k.box(0xe6dfcc, SHOP[0], SHOP[1] - 3.4, SHOP[2], SHOP[2] + 0.2, 0.9, 2.3);
  k.lit(0xf4ead0, SHOP[0] + 0.2, SHOP[1] - 0.05, SHOP[2] + 0.2, SHOP[3] - 0.2, 0.9, 0.92, true);
  k.lit(0xe8dcc0, SHOP[0] + 0.2, SHOP[0] + 0.25, SHOP[2] + 0.2, SHOP[3] - 0.2, 0.92, 2.3, true);
  k.glow([1.5, 1.3, 1.0], SHOP[1] - 3, SHOP[1] - 1, SHOP[2] + 2.5, SHOP[2] + 2.7, 2.24, 2.3, EMIT.lamp);
  k.box(0x3a3d42, SHOP[0] - 0.5, SHOP[1] + 0.6, SHOP[2] - 0.5, SHOP[3] + 0.5, 2.9, 3.1);
  k.box(0x44474c, SHOP[0] - 0.1, SHOP[1] + 0.2, SHOP[2] + 2, SHOP[3] - 2, 3.1, 3.6);
  k.plane(k.canvas(640, 110, (g) => {
    g.fillStyle = '#2a3a2c';
    g.fillRect(0, 0, 640, 110);
    text(g, '花 ・ 線香 ・ 霊園管理事務所', 320, 58, `bold 46px ${MINCHO}`, '#f4ecd8');
  }), 5.6, 0.95, SHOP[1] + 0.03, (SHOP[2] + SHOP[3]) / 2, 2.6, '+u', 1.1);
  // Buckets of flowers out front, bundles of incense on the counter.
  for (let t = SHOP[2] + 0.5, i = 0; t < SHOP[3] - 0.4; t += 0.8, i++) {
    k.lathe(0x4a6a8a, SHOP[1] + 0.5, t, [[0.03, 0.16], [0.4, 0.2], [0.4, 0.001]], 8);
    const BLOOMS = [0xe8d040, 0xf0f0e8, 0xc83a6a, 0x8a4ac8];
    for (const [j, du, dt] of [[0, 0, 0], [1, 0.1, 0.08], [2, -0.09, 0.06], [3, 0.02, -0.1]] as const)
      k.box(BLOOMS[(i + j) % 4], SHOP[1] + 0.5 + du - 0.07, SHOP[1] + 0.5 + du + 0.07, t + dt - 0.07, t + dt + 0.07, 0.55, 0.75);
    k.box(0x3a6a34, SHOP[1] + 0.44, SHOP[1] + 0.56, t - 0.06, t + 0.06, 0.4, 0.58);
  }
  for (let t = SHOP[2] + 1; t < SHOP[3] - 1; t += 0.5) k.box(0x6a4a8a, SHOP[1] - 0.4, SHOP[1] - 0.2, t, t + 0.3, 0.92, 1.0);
  // ---- The water station: a roof on four posts over the stone trough, the rack of buckets and ladles ----
  for (const u of [WATER[0] + 0.2, WATER[1] - 0.2]) for (const t of [WATER[2] + 0.2, WATER[3] - 0.2]) k.post(0x5a4a3a, u, t, 0, 2.4, 0.07, 6);
  k.box(0x3a3d42, WATER[0] - 0.3, WATER[1] + 0.3, WATER[2] - 0.3, WATER[3] + 0.3, 2.4, 2.58);
  k.box(0x8c8c88, WATER[0] + 0.6, WATER[0] + 3.4, WATER[3] - 1.3, WATER[3] - 0.5, 0, 0.75);
  k.kind(KIND.water, 0x3a6a78, WATER[0] + 0.75, WATER[0] + 3.25, WATER[3] - 1.18, WATER[3] - 0.62, 0.6, 0.7);
  for (const u of [WATER[0] + 1.2, WATER[0] + 2.8]) k.post(0xb8bcc0, u, WATER[3] - 0.55, 0.75, 1.15, 0.025, 6);
  for (let y = 0.5; y < 1.9; y += 0.55) {
    k.box(0x6a5a44, WATER[1] - 3.2, WATER[1] - 0.4, WATER[2] + 0.5, WATER[2] + 1.0, y - 0.04, y);
    for (let u = WATER[1] - 3.05; u < WATER[1] - 0.5; u += 0.42) k.lathe(0x9a7a4c, u, WATER[2] + 0.75, [[y, 0.13], [y + 0.26, 0.16], [y + 0.26, 0.001]], 8);
  }
  k.plane(k.canvas(256, 96, (g) => {
    g.fillStyle = '#f4ecd8';
    g.fillRect(0, 0, 256, 96);
    text(g, '水汲み場', 128, 50, `bold 52px ${MINCHO}`, '#2a2a28');
  }), 1.3, 0.48, (WATER[0] + WATER[1]) / 2, WATER[2] - 0.31, 2.2, 'out', 1.0);
  // ---- Six jizō in red bibs on a plinth, under a little roof ----
  k.box(0x8c8c88, JIZO[0], JIZO[1], JIZO[2], JIZO[3], 0, 0.4);
  for (let i = 0; i < 6; i++) {
    const u = JIZO[0] + 1 + i * 2;
    k.lathe(0x9a9a96, u, 2.7, [[0.4, 0.2], [0.75, 0.17], [1.0, 0.13], [1.02, 0.09], [1.1, 0.13], [1.24, 0.14], [1.36, 0.001]], 8);
    k.box(0xc8242a, u - 0.14, u + 0.14, 2.52, 2.58, 0.84, 1.04);
  }
  for (const u of [JIZO[0] + 0.15, JIZO[1] - 0.15]) k.post(0x5a4a3a, u, 2.1, 0.4, 2.0, 0.05, 6);
  k.box(0x3a3d42, JIZO[0] - 0.2, JIZO[1] + 0.2, JIZO[2] - 0.3, JIZO[3] + 0.2, 2.0, 2.14);
  // ---- The avenue: cherry trees and stone lanterns down both sides, lamps on posts ----
  for (const [u, t] of avenueTrees()) {
    const [x, z] = toWorld(k.f, u, t);
    addTree(k.mb, { x, z, species: 'sakura', size: 0.95, seed: Math.round(u * 7 + t) });
  }
  for (let t = 19.2; t < 92; t += 8.5) {
    if (cross.some((c) => Math.abs(t - c) < 1.4)) continue;
    lantern(k, 37.9, t);
    lantern(k, 46.1, t);
  }
  for (const t of [20, 43, 69, 90]) {
    k.post(0x2a2c2e, 38.0, t + 2.2, 0, 3.6, 0.05, 6);
    k.glow([1.6, 1.25, 0.8], 37.82, 38.18, t + 2.02, t + 2.38, 3.6, 3.9, EMIT.lamp);
  }
  // ---- The graves, in back-to-back rows ----
  gravePairs().forEach((r, pi) => {
    k.box(0x8e8c86, r[0], r[1], r[2] + 2.2, r[2] + 2.4, 0.03, 0.5);
    for (let u = r[0] + plot / 2, i = 0; u + plot / 2 <= r[1] + 0.01; u += plot, i++) {
      grave(k, u, r[2] + 1.1, -1, pi * 64 + i * 2);
      grave(k, u, r[2] + 3.5, 1, pi * 64 + i * 2 + 1);
    }
  });
  // ---- The avenue's end: the big family plot (a stone fence, a tall pillar, two lanterns, fresh flowers) ----
  k.box(0xb0aca4, FAMILY[0], FAMILY[1], FAMILY[2], FAMILY[3], 0.03, 0.3);
  for (const [a, b2, c, e] of [[FAMILY[0], FAMILY[0] + 0.2, FAMILY[2], FAMILY[3]], [FAMILY[1] - 0.2, FAMILY[1], FAMILY[2], FAMILY[3]], [FAMILY[0], FAMILY[1], FAMILY[3] - 0.2, FAMILY[3]], [FAMILY[0], 40.4, FAMILY[2], FAMILY[2] + 0.2], [43.6, FAMILY[1], FAMILY[2], FAMILY[2] + 0.2]] as const)
    k.box(STONE, a, b2, c, e, 0.3, 0.95);
  k.box(0x8a8c90, 40.6, 43.4, 96.0, 98.4, 0.3, 0.7);
  k.box(0x8a8c90, 41.0, 43.0, 96.4, 98.0, 0.7, 1.1);
  k.kind(KIND.gloss, 0x26282c, 41.55, 42.45, 96.75, 97.65, 1.1, 3.3);
  lantern(k, 38.6, 96.6);
  lantern(k, 45.4, 96.6);
  for (const u of [41.2, 42.8]) {
    k.box(0x8a8c90, u - 0.07, u + 0.07, 95.75, 95.89, 0.7, 0.95);
    k.box(0xf0f0e8, u - 0.13, u + 0.13, 95.69, 95.95, 0.95, 1.2);
  }
  // ---- 無縁塚: the stones nobody tends, gathered into a mound round a tablet ----
  k.box(0x8c8a84, MUEN[0], MUEN[1], MUEN[2], MUEN[3], 0.03, 0.35);
  for (let tier = 0; tier < 5; tier++) {
    const inset = 0.5 + tier * 0.85;
    const y = 0.35 + tier * 0.42;
    for (let u = MUEN[0] + inset; u < MUEN[1] - inset; u += 0.62)
      for (let t = MUEN[2] + inset; t < MUEN[3] - inset; t += 0.62) {
        const edge = u < MUEN[0] + inset + 0.6 || u > MUEN[1] - inset - 1.2 || t < MUEN[2] + inset + 0.6 || t > MUEN[3] - inset - 1.2;
        if (!edge) continue;
        const s = rnd(Math.round(u * 10), Math.round(t * 10), tier);
        k.box([0x7a7a76, 0x8a8880, 0x6c6e6a][Math.floor(s * 3)], u, u + 0.34 + s * 0.14, t, t + 0.3, y, y + 0.5 + s * 0.3);
      }
  }
  k.box(0x6a6c70, 74.4, 75.6, 91.9, 93.1, 2.4, 4.1);
  k.plane(k.canvas(128, 256, (g) => {
    g.fillStyle = '#6a6c70';
    g.fillRect(0, 0, 128, 256);
    ['無', '縁', '塚'].forEach((c, i) => text(g, c, 64, 50 + i * 78, `bold 64px ${MINCHO}`, '#e8e4d8'));
  }), 0.9, 1.55, 75, 91.88, 3.25, 'out', 1.0);
  // ---- People: a family at a grave, an old man with a bucket, a woman in black on the avenue ----
  k.person(17.6, 34.6, 0, 1, { body: 'man', pose: 'stand', outfit: 'suit', hair: 'short', color: [0.1, 0.1, 0.12], y: -0.12 });
  k.person(18.5, 34.5, 0, 1, { body: 'woman', pose: 'hold', outfit: 'long', hair: 'bun', long: true, color: [0.1, 0.1, 0.12], y: -0.12 });
  k.person(19.2, 34.9, -0.3, 1, { body: 'child', pose: 'stand', outfit: 'plain', hair: 'short', color: [0.2, 0.2, 0.26], y: -0.12 });
  k.person(60.5, 62.3, 0, 1, { body: 'elder', pose: 'hold', outfit: 'plain', hair: 'none', color: [0.26, 0.26, 0.24], y: -0.12 });
  k.person(43.6, 47, -0.2, 1, { body: 'woman', pose: 'stand', outfit: 'kimono', hair: 'bun', long: true, color: [0.1, 0.1, 0.12], y: -0.08 });
}

/** A parked work vehicle, nose along local (du, dt). */
function vehicle(k: Kit, u: number, t: number, du: number, dt: number, type: 'boxtruck' | 'van' | 'keitruck', paint: number, variant: number): void {
  const [x, z] = toWorld(k.f, u, t);
  addCar(k.mb, { x, z, fx: k.f.r[0] * du - k.f.n[0] * dt, fz: k.f.r[2] * du - k.f.n[2] * dt, variant, type, paint });
}

function buildSite(k: Kit): void {
  const { w, d, gate, pit, depth, fence } = SITE;
  const mb = k.mb;
  const beam = (a: [number, number, number], b2: [number, number, number], r: number, hex: number): void => {
    mb.kind = KIND.plain;
    mb.color = lin(hex);
    mb.beam(a, b2, r);
  };
  // ---- The ground: trodden gravel round the pit, steel road plates from the gate ----
  const DIRT = 0x8a7a62;
  k.kind(KIND.gravel, DIRT, 0.3, w - 0.3, 0.3, pit.t0, 0, 0.03);
  k.kind(KIND.gravel, DIRT, 0.3, w - 0.3, pit.t1, d - 0.3, 0, 0.03);
  k.kind(KIND.gravel, DIRT, 0.3, pit.u0, pit.t0, pit.t1, 0, 0.03);
  k.kind(KIND.gravel, DIRT, pit.u1, w - 0.3, pit.t0, pit.t1, 0, 0.03);
  for (let t = 0.4; t < pit.t0 - 2.2; t += 3.05) for (const u of [42.2, 45.3]) k.box(0x4c4c50, u, u + 3, t, t + 3, 0.03, 0.06);
  // ---- The hoarding: white steel panels on a dark plinth, a red lamp on each corner ----
  const panel = (u0: number, u1: number, t0: number, t1: number): void => {
    k.box(0xf0f0ec, u0, u1, t0, t1, 0.25, fence);
    k.box(0x3a3d42, u0, u1, t0, t1, 0, 0.25);
    k.box(0x9aa0a6, u0, u1, t0, t1, fence, fence + 0.06);
  };
  panel(0, 38, 0, 0.3);
  panel(gate[1], w, 0, 0.3);
  panel(0, 0.3, 0.3, d);
  panel(w - 0.3, w, 0.3, d);
  panel(0.3, w - 0.3, d - 0.3, d);
  for (const [u, t] of [[0.15, 0.15], [w - 0.15, 0.15], [0.15, d - 0.15], [w - 0.15, d - 0.15]] as const) k.glow([1.6, 0.12, 0.08], u - 0.1, u + 0.1, t - 0.1, t + 0.1, fence + 0.06, fence + 0.3, EMIT.lamp);
  // The accordion gate's closed half (a lattice), the open half's post.
  for (let u = 38; u < gate[0]; u += 0.5) {
    beam(P(k, u, 0.15, 0.1), P(k, u + 0.5, 0.15, 1.9), 0.02, 0x8a8e94);
    beam(P(k, u + 0.5, 0.15, 0.1), P(k, u, 0.15, 1.9), 0.02, 0x8a8e94);
  }
  k.box(0x6a6e72, 38, gate[0], 0.1, 0.2, 1.88, 1.96);
  for (const u of [38, gate[0], gate[1]]) k.box(0x6a6e72, u - 0.08, u + 0.08, 0.05, 0.25, 0, 2.1);
  // On the hoarding, facing the street: the project, its notices, the day's numbers.
  k.plane(k.canvas(1280, 300, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 300);
    sky.addColorStop(0, '#2a3a6a');
    sky.addColorStop(1, '#e8a878');
    g.fillStyle = sky;
    g.fillRect(0, 0, 1280, 300);
    // The tower as drawn: a glass slab over the old roofs.
    g.fillStyle = '#1c2230';
    for (let x = 0; x < 520; x += 46) g.fillRect(x, 230 - ((x * 7) % 50), 42, 80);
    const tw = g.createLinearGradient(190, 0, 300, 0);
    tw.addColorStop(0, '#9ac8e8');
    tw.addColorStop(1, '#5a86b8');
    g.fillStyle = tw;
    g.fillRect(200, 20, 100, 280);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 30; y < 290; y += 12) g.fillRect(200, y, 100, 2);
    text(g, '霞町一丁目地区 第一種市街地再開発事業', 860, 70, `bold 40px ${SANS}`, '#ffffff');
    text(g, 'KASUMI GATE TOWER', 860, 150, '900 72px Arial, sans-serif', '#ffffff');
    text(g, '地上42階 ・ 地下4階   竣工予定 2028年春', 860, 230, `bold 34px ${SANS}`, '#ffe8c8');
  }), 15, 3.5 * 0.78, 19, -0.02, 1.6, 'out', 1.0);
  k.plane(k.canvas(512, 360, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 360);
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 500, 348);
    text(g, '建築計画のお知らせ', 256, 44, `bold 38px ${SANS}`, '#1a1a1a');
    const rows = ['建築物の名称   (仮称) 霞町一丁目計画', '用途   事務所・店舗・共同住宅', '階数   地上42階 地下4階', '着工   昨年10月', '完了予定   2028年3月', '建築主 ・ 設計 ・ 施工   別紙のとおり'];
    rows.forEach((r, i) => text(g, r, 30, 100 + i * 42, `24px ${SANS}`, '#1a1a1a', 'left'));
  }), 2.3, 1.62, 32.5, -0.02, 1.6, 'out', 1.0);
  k.plane(k.canvas(512, 256, (g) => {
    g.fillStyle = '#0a0a0c';
    g.fillRect(0, 0, 512, 256);
    text(g, '騒音', 90, 76, `bold 44px ${SANS}`, '#e8e8e8');
    text(g, '62 dB', 330, 78, '900 76px Consolas, monospace', '#ff6a2a');
    text(g, '振動', 90, 186, `bold 44px ${SANS}`, '#e8e8e8');
    text(g, '38 dB', 330, 188, '900 76px Consolas, monospace', '#5aff7a');
  }), 1.8, 0.9, 54.5, -0.02, 2.1, 'out', 1.3);
  k.plane(k.canvas(640, 200, (g) => {
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 640, 200);
    g.fillStyle = '#1a8a4a';
    g.fillRect(40, 70, 120, 60);
    g.fillRect(70, 40, 60, 120);
    text(g, '安全第一', 400, 100, `900 100px ${SANS}`, '#1a8a4a');
  }), 4.2, 1.3, 64, -0.02, 1.7, 'out', 1.0);
  k.plane(k.canvas(512, 200, (g) => {
    g.fillStyle = '#ffe45f';
    g.fillRect(0, 0, 512, 200);
    text(g, '関係者以外 立入禁止', 256, 70, `900 48px ${SANS}`, '#1a1a1a');
    text(g, 'ご迷惑をおかけします', 256, 144, `bold 36px ${SANS}`, '#1a1a1a');
  }), 2.4, 0.94, 52.2, -0.02, 2.2, 'out', 1.0);
  // ---- The guard hut by the gate; the site office (two prefab storeys, an outside stair); toilets ----
  k.box(0xe8e8e0, HUT[0], HUT[1], HUT[2], HUT[3], 0, 2.3);
  k.lit(0xf4ecd0, HUT[0] - 0.02, HUT[0], HUT[2] + 0.3, HUT[3] - 0.3, 1.0, 1.9);
  k.box(0x5a5e64, HUT[0] - 0.1, HUT[1] + 0.1, HUT[2] - 0.1, HUT[3] + 0.1, 2.3, 2.42);
  for (const y of [0, 2.7]) {
    k.box(0xe2ddd0, OFFICE[0], OFFICE[1], OFFICE[2], OFFICE[3], y, y + 2.6);
    k.box(0x7a7e84, OFFICE[0] - 0.05, OFFICE[1] + 0.05, OFFICE[2] - 0.05, OFFICE[3] + 0.05, y + 2.6, y + 2.7);
    for (let u = OFFICE[0] + 1.2; u < OFFICE[1] - 1.5; u += 3) k.lit(0xf0e8c8, u, u + 1.8, OFFICE[2] - 0.03, OFFICE[2], y + 1.0, y + 2.0);
  }
  for (let i = 0; i < 12; i++) k.box(0x8a8e94, OFFICE[1] + 0.1, OFFICE[1] + 1.1, OFFICE[2] + i * 0.42, OFFICE[2] + (i + 1) * 0.42, i * 0.225, i * 0.225 + 0.06);
  k.box(0x8a8e94, OFFICE[1] + 0.1, OFFICE[1] + 1.1, OFFICE[2] + 5.0, OFFICE[3], 2.64, 2.7);
  k.plane(k.canvas(384, 96, (g) => {
    g.fillStyle = '#1a3a6a';
    g.fillRect(0, 0, 384, 96);
    text(g, '現場事務所', 192, 50, `bold 52px ${SANS}`, '#ffffff');
  }), 2.4, 0.6, 13, OFFICE[2] - 0.04, 2.3, 'out', 1.0);
  for (let u = TOILETS[0]; u < TOILETS[1] - 0.5; u += 1.5) k.box(0x3a7ac8, u, u + 1.3, TOILETS[2], TOILETS[3], 0, 2.3);
  // ---- Materials: rebar in bundles, H-beams, formwork, drums and cones ----
  for (let i = 0; i < 6; i++) k.box(0x7a4a34, STACKS[0][0], STACKS[0][1], STACKS[0][2] + i * 0.58, STACKS[0][2] + i * 0.58 + 0.45, 0.1, 0.5 + (i % 2) * 0.35);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) k.box(0x8a3a2a, STACKS[1][0], STACKS[1][1], STACKS[1][2] + i * 0.62, STACKS[1][2] + i * 0.62 + 0.4, 0.1 + j * 0.5, 0.5 + j * 0.5);
  for (let i = 0; i < 5; i++) k.box(0xd8b83a, STACKS[2][0], STACKS[2][1], STACKS[2][2] + i * 0.7, STACKS[2][2] + i * 0.7 + 0.12, 0.05, 1.85);
  for (let t = STACKS[3][2] + 0.5; t < STACKS[3][3] - 0.5; t += 1.1) for (const u of [85, 86.2, 87.3]) k.lathe([0x2a5ac8, 0xc83a2a, 0x3a3a3e][Math.round(t + u) % 3], u, t, [[0.03, 0.29], [0.9, 0.29], [0.9, 0.001]], 10);
  for (const [u, t] of [[41.6, 22], [48.4, 22], [41.6, 12], [48.4, 12], [37, 24.4], [53, 24.4]] as const) k.lathe(0xe05a1a, u, t, [[0.03, 0.17], [0.7, 0.03], [0.72, 0.001]], 6);
  vehicle(k, 59.5, 11.8, 0, -1, 'boxtruck', 0xe8e8e4, 31);
  // ---- Floodlight towers at the pit's corners ----
  for (const [u, t] of SITE_LAMPS) {
    k.post(0x8a8e94, u, t, 0, 9, 0.09, 8);
    k.box(0x3a3d42, u - 0.7, u + 0.7, t - 0.15, t + 0.15, 9, 9.5);
    k.glow([2.4, 2.4, 2.3], u - 0.6, u + 0.6, t - 0.17, t + 0.17, 9.05, 9.45, EMIT.lamp);
  }
  // ---- The excavator on the pit's west rim: tracks, the house, the cab, the boom out over the hole ----
  const ex = { u: 25.5, t: 43.5 };
  for (const dt of [-1.3, 1.3]) k.box(0x1e1e20, ex.u - 2.4, ex.u + 2.4, ex.t + dt - 0.4, ex.t + dt + 0.4, 0, 0.85);
  k.box(0xe8a81a, ex.u - 2.2, ex.u + 1.8, ex.t - 1.4, ex.t + 1.4, 0.85, 2.2);
  k.box(0x2a2a2e, ex.u - 2.3, ex.u - 1.2, ex.t - 1.3, ex.t + 1.3, 1.0, 2.5);
  k.box(0xe8a81a, ex.u + 0.3, ex.u + 1.7, ex.t - 1.35, ex.t - 0.2, 2.2, 3.4);
  k.kind(KIND.glass, 0x9ab8c8, ex.u + 0.4, ex.u + 1.72, ex.t - 1.3, ex.t - 0.25, 2.45, 3.3);
  beam(P(k, ex.u + 1.6, ex.t + 0.5, 2.0), P(k, ex.u + 5.4, ex.t + 0.5, 5.4), 0.28, 0xe8a81a);
  beam(P(k, ex.u + 5.4, ex.t + 0.5, 5.4), P(k, ex.u + 8.2, ex.t + 0.5, 1.6), 0.2, 0xe8a81a);
  k.box(0x3a3a3e, ex.u + 7.6, ex.u + 8.8, ex.t - 0.1, ex.t + 1.1, 0.7, 1.7);
  // ---- The crawler crane: tracks, the red house, a lattice boom leaning over the pit, the hook on its line ----
  const cr = { u: 16.5, t: 58.5 };
  for (const dt of [-2.2, 2.2]) k.box(0x1e1e20, cr.u - 3.6, cr.u + 3.6, cr.t + dt - 0.6, cr.t + dt + 0.6, 0, 1.1);
  k.box(0xc8281e, cr.u - 3.4, cr.u + 2.6, cr.t - 2.0, cr.t + 2.0, 1.1, 3.4);
  k.box(0x3a3a3e, cr.u - 4.6, cr.u - 3.4, cr.t - 1.9, cr.t + 1.9, 1.2, 2.6);
  k.kind(KIND.glass, 0x9ab8c8, cr.u + 1.5, cr.u + 2.62, cr.t - 1.9, cr.t - 0.7, 2.0, 3.3);
  const foot: [number, number, number] = [cr.u + 2.4, cr.t, 3.2];
  const tip: [number, number, number] = [cr.u + 22, cr.t - 6, 44];
  const along = (s: number, du: number, dy: number): [number, number, number] => P(k, foot[0] + (tip[0] - foot[0]) * s + du * 0.6, foot[1] + (tip[1] - foot[1]) * s + du * 0.8, foot[2] + (tip[2] - foot[2]) * s + dy);
  const chords: [number, number][] = [[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]];
  for (const [du, dy] of chords) beam(along(0, du * 0.3, dy * 0.3), along(1, du * 0.3, dy * 0.3), 0.07, 0xd8d4c8);
  for (let i = 0; i < 20; i++) {
    const a = i / 20;
    const b2 = (i + 1) / 20;
    const hex = i % 4 < 2 ? 0xc8281e : 0xe8e4d8;
    beam(along(a, -0.18, -0.15), along(b2, 0.18, -0.15), 0.035, hex);
    beam(along(a, 0.18, 0.15), along(b2, -0.18, 0.15), 0.035, hex);
    beam(along(a, -0.18, 0.15), along(b2, -0.18, -0.15), 0.035, hex);
    beam(along(a, 0.18, -0.15), along(b2, 0.18, 0.15), 0.035, hex);
  }
  beam(P(k, cr.u - 3, cr.t, 3.4), P(k, cr.u - 2, cr.t, 12), 0.1, 0xc8281e);
  beam(P(k, cr.u - 2, cr.t, 12), P(k, tip[0], tip[1], tip[2]), 0.03, 0x2a2a2e);
  beam(P(k, tip[0], tip[1], tip[2]), P(k, tip[0], tip[1], 9), 0.025, 0x2a2a2e);
  k.box(0xe8c020, tip[0] - 0.4, tip[0] + 0.4, tip[1] - 0.3, tip[1] + 0.3, 7.8, 9);
  k.glow([1.8, 0.1, 0.08], tip[0] - 0.2, tip[0] + 0.2, tip[1] - 0.2, tip[1] + 0.2, tip[2], tip[2] + 0.4, EMIT.lamp);

  // ---- The pit: sheet piles down all four sides, two rings of walers, struts across, the floor ----
  const y0 = -depth;
  const RUST = 0x6a4636;
  for (let u = pit.u0; u < pit.u1; u += 1) {
    const inset = Math.round(u) % 2 ? 0.12 : 0;
    k.box(RUST, u, u + 1, pit.t0 - 0.3 + inset, pit.t0 + inset, y0 - 0.3, 0.3);
    k.box(RUST, u, u + 1, pit.t1 - inset, pit.t1 + 0.3 - inset, y0 - 0.3, 0.3);
  }
  for (let t = pit.t0; t < pit.t1; t += 1) {
    const inset = Math.round(t) % 2 ? 0.12 : 0;
    k.box(RUST, pit.u0 - 0.3 + inset, pit.u0 + inset, t, t + 1, y0 - 0.3, 0.3);
    k.box(RUST, pit.u1 - inset, pit.u1 + 0.3 - inset, t, t + 1, y0 - 0.3, 0.3);
  }
  for (const y of [-2.2, -5.2]) {
    k.box(0x8a2a1c, pit.u0 + 0.12, pit.u1 - 0.12, pit.t0 + 0.12, pit.t0 + 0.5, y, y + 0.4);
    k.box(0x8a2a1c, pit.u0 + 0.12, pit.u1 - 0.12, pit.t1 - 0.5, pit.t1 - 0.12, y, y + 0.4);
    k.box(0x8a2a1c, pit.u0 + 0.12, pit.u0 + 0.5, pit.t0 + 0.12, pit.t1 - 0.12, y, y + 0.4);
    k.box(0x8a2a1c, pit.u1 - 0.5, pit.u1 - 0.12, pit.t0 + 0.12, pit.t1 - 0.12, y, y + 0.4);
    for (let u = pit.u0 + 8; u < pit.u1 - 4; u += 8) k.box(0x9a3a26, u - 0.2, u + 0.2, pit.t0 + 0.5, pit.t1 - 0.5, y + 0.02, y + 0.38);
  }
  for (let u = pit.u0 + 8; u < pit.u1 - 4; u += 8) for (const t of [pit.t0 + 14.6, pit.t0 + 29.3]) k.box(0x7a2a1c, u - 0.2, u + 0.2, t - 0.2, t + 0.2, y0, -1.8);
  k.kind(KIND.gravel, 0x5a4e40, pit.u0, pit.u1, pit.t0, pit.t1, y0 - 0.3, y0);
  k.kind(KIND.water, 0x3a3e38, pit.u0 + 4, pit.u0 + 15, pit.t0 + 5, pit.t0 + 11, y0, y0 + 0.02);
  // A scaffold stair down the south wall.
  for (let i = 0; i < 4; i++) {
    const ya = -i * 2;
    const dir = i % 2 ? -1 : 1;
    const ua = 52 + (dir > 0 ? 0 : 4);
    beam(P(k, ua, pit.t0 + 1.2, ya), P(k, ua + dir * 4, pit.t0 + 1.2, ya - 2), 0.12, 0x9a9ea2);
    k.box(0x9a9ea2, 51.6, 56.4, pit.t0 + 0.4, pit.t0 + 2.0, ya - 2.06, ya - 2);
  }
  for (const u of [51.7, 56.3]) for (const t of [pit.t0 + 0.5, pit.t0 + 1.9]) k.box(0x7a7e84, u - 0.04, u + 0.04, t - 0.04, t + 0.04, y0, 1.1);
  // The rim's guard rail: orange posts, two white rails.
  const rail = (u0: number, u1: number, t0: number, t1: number): void => {
    for (const y of [0.55, 1.05]) k.box(0xf0f0ec, u0, u1, t0, t1, y, y + 0.06);
    const n = Math.round(Math.max(u1 - u0, t1 - t0) / 2);
    for (let i = 0; i <= n; i++) {
      const u = u1 - u0 > 1 ? u0 + ((u1 - u0) * i) / n : (u0 + u1) / 2;
      const t = t1 - t0 > 1 ? t0 + ((t1 - t0) * i) / n : (t0 + t1) / 2;
      k.box(0xe8782a, u - 0.04, u + 0.04, t - 0.04, t + 0.04, 0, 1.15);
    }
  };
  rail(pit.u0 - 0.55, pit.u1 + 0.55, pit.t0 - 0.6, pit.t0 - 0.52);
  rail(pit.u0 - 0.55, pit.u1 + 0.55, pit.t1 + 0.52, pit.t1 + 0.6);
  rail(pit.u0 - 0.6, pit.u0 - 0.52, pit.t0 - 0.55, pit.t1 + 0.55);
  rail(pit.u1 + 0.52, pit.u1 + 0.6, pit.t0 - 0.55, pit.t1 + 0.55);
  // ---- The sealed corner at the bottom: blue tarps over long shapes, a white tent, a fence, the survey's notice,
  // lamps left on over it ----
  const S = { u0: 58, u1: 78.5, t0: 50, t1: 68.5 };
  for (const [a, b2, c, e, h] of [[60, 76, 53, 55.4, 1.1], [61.5, 75, 56.6, 58.4, 0.8], [60.5, 77, 59.8, 62.2, 1.3], [63, 72, 63.4, 65, 0.7]] as const) {
    k.box(0x2a56c0, a, b2, c, e, y0, y0 + h);
    k.box(0x3a66d0, a + 0.6, b2 - 0.6, c + 0.3, e - 0.3, y0 + h, y0 + h + 0.25);
  }
  k.box(0xf2f2ee, 72.5, 77.5, 64.6, 68, y0, y0 + 2.2);
  k.box(0xe2e2de, 72.2, 77.8, 64.3, 68.3, y0 + 2.2, y0 + 2.5);
  for (let u = S.u0; u <= S.u1; u += 1.5) k.box(0xe8782a, u - 0.03, u + 0.03, S.t0 - 0.03, S.t0 + 0.03, y0, y0 + 1.2);
  for (let t = S.t0; t <= S.t1; t += 1.5) k.box(0xe8782a, S.u0 - 0.03, S.u0 + 0.03, t - 0.03, t + 0.03, y0, y0 + 1.2);
  for (const y of [0.5, 1.1]) {
    k.box(0xe8782a, S.u0, S.u1, S.t0 - 0.02, S.t0 + 0.02, y0 + y, y0 + y + 0.05);
    k.box(0xe8782a, S.u0 - 0.02, S.u0 + 0.02, S.t0, S.t1, y0 + y, y0 + y + 0.05);
  }
  k.plane(k.canvas(640, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 640, 256);
    g.strokeStyle = '#c81818';
    g.lineWidth = 14;
    g.strokeRect(7, 7, 626, 242);
    text(g, '埋蔵文化財 調査中', 320, 70, `900 56px ${SANS}`, '#1a1a1a');
    text(g, '立入禁止', 320, 150, `900 70px ${SANS}`, '#c81818');
    text(g, '東都都教育委員会', 320, 218, `bold 34px ${SANS}`, '#1a1a1a');
  }), 3.2, 1.28, 66, S.t0 - 0.06, y0 + 1.6, 'out', 1.2);
  for (const [u, t] of [[59, 51], [77.5, 51], [59, 67.5]] as const) {
    k.post(0x8a8e94, u, t, y0, y0 + 3, 0.05, 6);
    k.glow([2.0, 2.0, 1.9], u - 0.25, u + 0.25, t - 0.12, t + 0.12, y0 + 3, y0 + 3.3, EMIT.always);
  }
  // ---- People: a foreman at the rim with his papers, two men by the steel, one at the office's stair ----
  k.person(44.8, 24.2, 0.2, 1, { body: 'man', pose: 'hold', outfit: 'work', hair: 'none', color: [0.3, 0.3, 0.32], y: -0.12 });
  k.person(19.5, 22, -1, 0.2, { body: 'man', pose: 'talk', outfit: 'work', hair: 'none', color: [0.28, 0.3, 0.34], y: -0.12 });
  k.person(19.9, 23.1, -1, -0.4, { body: 'man', pose: 'stand', outfit: 'work', hair: 'none', color: [0.32, 0.3, 0.28], y: -0.12 });
  k.person(24, 9.4, 1, 0.3, { body: 'man', pose: 'phone', outfit: 'suit', hair: 'short', color: [0.12, 0.12, 0.14], y: -0.12 });
}

export const GROUNDS_BUILDERS: Record<GroundsKind, (k: Kit) => void> = { cemetery: buildCemetery, construction: buildSite };
