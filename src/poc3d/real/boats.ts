import * as THREE from 'three';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { SEA_LEVEL } from './sea';

/**
 * Boats on the water (Manila: `CityConfig.boats`; reviewed in models.html). Every model is one merged mesh on the
 * city material, drawn as one InstancedMesh per model, so the whole fleet is about a dozen draw calls:
 * - the BANGKA, the Filipino outrigger: a slender double-ended wooden hull in bright paint, two bamboo booms
 *   carrying a long float each side, and a canopy and a long-tail engine, or a triangular sail; a lantern for night.
 *   Six paintings (palettes), each with its own gear.
 * - the ferry (a passenger launch), the lighterage barge (a loaded flat barge with a wheelhouse aft),
 * - cargo ships (stacked containers, cranes, a bridge house, funnel) and tankers (deck pipework), anchored out in the
 *   bay and swinging slowly, their navigation lights, deck floods and bridge windows lit at night.
 * Bangkas, the ferries and the lighters travel closed loops (the bay's ovals, stadium routes up and down the Pasig's
 * reaches between its bridges, whose decks are at street level: nothing tall goes under them), bobbing on the
 * water at SEA_LEVEL with a roll and pitch; moored ones lie along the docks. Only the craft near the camera are
 * placed every frame (the far ones every ~20th); a soft wake follows each moving one.
 * Models: bow along +z, the waterline at y 0, centred on the hull.
 */

type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------------------------
// Building blocks

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** A quad (or, with c = d, a triangle) facing `hint` (a direction): the winding is chosen to suit. */
function face(mb: MeshBuilder, a: V3, b: V3, c: V3, d: V3, hint: V3): void {
  const u = sub(b, a);
  const v = sub(d, a);
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) mb.poly4(a, d, c, b);
  else mb.poly4(a, b, c, d);
}

/** Both sides of a thin sheet (a sail, a tarpaulin). */
function sheet(mb: MeshBuilder, a: V3, b: V3, c: V3, d: V3): void {
  mb.poly4(a, b, c, d);
  mb.poly4(a, d, c, b);
}

function glow(mb: MeshBuilder, rgb: V3, cx: number, cz: number, y0: number, y1: number, w: number, d: number, ch: number = EMIT.lamp): void {
  mb.kind = KIND.emit;
  mb.style = [ch, 0, 0, 0];
  mb.color = rgb;
  mb.box(cx, cz, y0, y1, w, d, KIND.emit, true);
  mb.style = [0, 0, 0, 0];
  mb.kind = KIND.plain;
}

/** A plain painted box. */
function slab(mb: MeshBuilder, hex: number, cx: number, cz: number, y0: number, y1: number, w: number, d: number): void {
  mb.kind = KIND.plain;
  mb.color = lin(hex);
  mb.box(cx, cz, y0, y1, w, d, KIND.plain, y0 > 0.2);
}

interface HullSpec {
  L: number;
  /** Half-beam at the gunwale. */
  hw: number;
  /** Draught (below the waterline). */
  depth: number;
  /** Freeboard at midships. */
  free: number;
  /** How much the sheer line rises at the ends. */
  sheer: number;
  /** Plan taper exponents (bow, stern); higher is fuller. */
  pb: number;
  ps: number;
  /** Plan sharpness exponent (smaller is blunter ends). */
  wp?: number;
  /** Stern width fraction (a transom); 0 is pointed. */
  tr: number;
  /** How much of the keel's depth is lost at the bow and the stern. */
  kb?: number;
  ks?: number;
  /** A flat-bottomed section (ships, barges). */
  flat?: boolean;
  /** Painted topsides (above the waterline) and bottom. */
  up: number;
  lo: number;
  /** The deck. */
  deck: number;
  /** An open hull: the floor's height, with inner walls of `inner`; otherwise the deck closes it at the sheer. */
  floor?: number;
  inner?: number;
  ox?: number;
  oz?: number;
  n?: number;
}

const hullT = (s: HullSpec, z: number): number => (z - (s.oz ?? 0)) / (s.L / 2);

/** The plan width factor (0-1) at station t. */
function plan(s: HullSpec, t: number): number {
  const wp = s.wp ?? 0.55;
  const at = Math.abs(t);
  if (at >= 1) return t > 0 ? 0 : s.tr;
  if (t >= 0) return Math.pow(Math.max(0, 1 - Math.pow(at, s.pb)), wp);
  return s.tr + (1 - s.tr) * Math.pow(Math.max(0, 1 - Math.pow(at, s.ps)), wp);
}

/** The gunwale's height at z (the sheer line). */
export function sheerAt(s: HullSpec, z: number): number {
  return s.free + s.sheer * Math.pow(Math.min(1, Math.abs(hullT(s, z))), 2.2);
}

/** A lofted hull: sections along z, a ring of points each (gunwale to keel), skinned in two paints, with its deck. */
function hull(mb: MeshBuilder, s: HullSpec): void {
  const n = s.n ?? 16;
  const ox = s.ox ?? 0;
  const oz = s.oz ?? 0;
  type Ring = { x: number; y: number }[];
  const rings: Ring[] = [];
  const zs: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const w = plan(s, t);
    const kf = t > 0 ? (s.kb ?? 1) : (s.ks ?? 1);
    const dep = s.depth * (1 - kf * Math.pow(Math.abs(t), 3));
    const ys = s.free + s.sheer * Math.pow(Math.abs(t), 2.2);
    const hw = s.hw * w;
    const r: Ring = s.flat
      ? [{ x: hw, y: ys }, { x: hw, y: -dep * 0.2 }, { x: hw * 0.93, y: -dep * 0.9 }, { x: hw * 0.55, y: -dep }, { x: 0, y: -dep }]
      : [{ x: hw, y: ys }, { x: hw * 0.95, y: -dep * 0.1 }, { x: hw * 0.62, y: -dep * 0.8 }, { x: 0, y: -dep }];
    rings.push(r);
    zs.push(oz + t * (s.L / 2));
  }
  const P = (i: number, j: number, side: number): V3 => [ox + side * rings[i][j].x, rings[i][j].y, zs[i]];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < rings[i].length - 1; j++) {
      const above = (rings[i][j].y + rings[i][j + 1].y) / 2 > -s.depth * 0.12;
      mb.color = lin(above ? s.up : s.lo);
      for (const side of [-1, 1]) {
        const a = P(i, j, side), b = P(i + 1, j, side), c = P(i + 1, j + 1, side), d = P(i, j + 1, side);
        const cx = (a[0] + b[0] + c[0] + d[0]) / 4 - ox;
        const cy = (a[1] + b[1] + c[1] + d[1]) / 4;
        face(mb, a, b, c, d, [cx, cy + s.depth * 0.3, 0]);
      }
    }
  }
  // The transom, closing the stern.
  if (s.tr > 0.01) {
    mb.color = lin(s.up);
    for (let j = 0; j < rings[0].length - 1; j++) face(mb, P(0, j, -1), P(0, j + 1, -1), P(0, j + 1, 1), P(0, j, 1), [0, 0, -1]);
  }
  // The deck, or the floor and the inner walls of an open hull.
  for (let i = 0; i < n; i++) {
    const x0 = rings[i][0].x, x1 = rings[i + 1][0].x;
    const y0 = rings[i][0].y, y1 = rings[i + 1][0].y;
    if (s.floor === undefined) {
      mb.color = lin(s.deck);
      face(mb, [ox - x0, y0, zs[i]], [ox + x0, y0, zs[i]], [ox + x1, y1, zs[i + 1]], [ox - x1, y1, zs[i + 1]], [0, 1, 0]);
    } else {
      const f = s.floor;
      mb.color = lin(s.deck);
      face(mb, [ox - x0 * 0.82, f, zs[i]], [ox + x0 * 0.82, f, zs[i]], [ox + x1 * 0.82, f, zs[i + 1]], [ox - x1 * 0.82, f, zs[i + 1]], [0, 1, 0]);
      mb.color = lin(s.inner ?? s.deck);
      for (const side of [-1, 1]) {
        face(mb, [ox + side * x0, y0, zs[i]], [ox + side * x1, y1, zs[i + 1]], [ox + side * x1 * 0.82, f, zs[i + 1]], [ox + side * x0 * 0.82, f, zs[i]], [-side, 0.5, 0]);
      }
      // The gunwale's top, a thin rim.
      mb.color = lin(s.up);
      for (const side of [-1, 1]) {
        const rim = 0.05;
        face(mb, [ox + side * x0, y0, zs[i]], [ox + side * x1, y1, zs[i + 1]], [ox + side * (x1 - rim), y1, zs[i + 1]], [ox + side * (x0 - rim), y0, zs[i]], [0, 1, 0]);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The bangka

interface Paint {
  up: number;
  lo: number;
  trim: number;
  /** The float and boom colour. */
  float: number;
  tarp: number;
  tarp2: number;
  canopy: boolean;
  sail: boolean;
  engine: boolean;
}

const BAMBOO = 0xc4a95e;
const WOOD = 0x9c7a4c;
const PAINTS: readonly Paint[] = [
  { up: 0xd8392b, lo: 0xf0ece0, trim: 0xf6c61e, float: BAMBOO, tarp: 0x2a64b8, tarp2: 0xf0ece0, canopy: true, sail: false, engine: true },
  { up: 0x1f78c8, lo: 0xf4d03f, trim: 0xffffff, float: 0xf0ece0, tarp: 0xe8892a, tarp2: 0x2a64b8, canopy: true, sail: false, engine: true },
  { up: 0x2faa5a, lo: 0xf5f2e8, trim: 0xd8392b, float: BAMBOO, tarp: 0xf0ece0, tarp2: 0xe8892a, canopy: false, sail: true, engine: false },
  { up: 0xf08a1c, lo: 0x1a5fb4, trim: 0xf5f2e8, float: BAMBOO, tarp: 0xc8312a, tarp2: 0xf0ece0, canopy: true, sail: false, engine: true },
  { up: 0xe8d32a, lo: 0xc62a2a, trim: 0x1a1a1a, float: 0x1a5fb4, tarp: 0x2faa5a, tarp2: 0xe8d32a, canopy: false, sail: false, engine: true },
  { up: 0xf5f2e8, lo: 0x19a7a8, trim: 0xd8392b, float: BAMBOO, tarp: 0xe8892a, tarp2: 0xf5f2e8, canopy: false, sail: true, engine: false },
];

const LAMP: V3 = [0.9, 0.6, 0.28];

const BANGKA_HULL = (p: Paint): HullSpec => ({ L: 8.6, hw: 0.5, depth: 0.34, free: 0.5, sheer: 0.55, pb: 2.0, ps: 2.0, wp: 0.8, tr: 0, up: p.up, lo: p.lo, deck: WOOD, floor: 0.12, inner: WOOD });

function bangka(i: number): MeshBuilder {
  const p = PAINTS[i % PAINTS.length];
  const mb = new MeshBuilder(8000);
  const h = BANGKA_HULL(p);
  hull(mb, h);
  // A trim stripe along the gunwale's outside.
  // (Painted into the strakes: the upper colour above, the lower below; the trim is on the stems and thwarts.)
  for (const z of [-2.1, -0.4, 1.3, 2.7]) slab(mb, WOOD, 0, z, 0.16, 0.26, 0.82 * plan(h, z / 4.3) + 0.2, 0.14);
  // The stems: tall posts at both ends, the bow's carrying the lantern.
  slab(mb, p.trim, 0, 4.1, 0.2, sheerAt(h, 4.1) + 0.22, 0.07, 0.1);
  slab(mb, p.trim, 0, -4.1, 0.2, sheerAt(h, -4.1) + 0.15, 0.07, 0.1);
  glow(mb, LAMP, 0, 4.12, sheerAt(h, 4.1) + 0.22, sheerAt(h, 4.1) + 0.4, 0.14, 0.14);
  // The outriggers: two bamboo booms across and a long float each side, held by struts.
  const floatSpec = (side: number): HullSpec => ({ L: 6.4, hw: 0.14, depth: 0.14, free: 0.1, sheer: 0.3, pb: 2.0, ps: 2.0, wp: 0.8, tr: 0, up: p.float, lo: p.float, deck: p.float, ox: side * 2.55, n: 10 });
  mb.color = lin(BAMBOO);
  for (const side of [-1, 1]) {
    hull(mb, floatSpec(side));
    for (const bz of [-1.7, 1.7]) {
      const yb = sheerAt(h, bz) + 0.12;
      mb.color = lin(BAMBOO);
      mb.beam([side * 0.3, yb, bz], [side * 2.55, 0.42, bz], 0.09);
      mb.beam([side * 2.55, 0.42, bz], [side * 2.55 + 0.02, 0.05, bz + 0.45], 0.06);
      mb.beam([side * 2.55, 0.42, bz], [side * 2.55 - 0.02, 0.05, bz - 0.45], 0.06);
    }
  }
  // A long-tail engine: the block on the stern, its shaft reaching astern and down into the water to the propeller.
  if (p.engine) {
    slab(mb, 0x232a2c, 0, -3.0, 0.14, 0.62, 0.46, 0.5);
    slab(mb, 0xb02a24, 0, -3.0, 0.62, 0.7, 0.4, 0.42);
    mb.color = lin(0x8a8f92);
    mb.beam([0, 0.55, -3.3], [0, -0.38, -6.7], 0.06);
    mb.beam([0, 0.55, -3.0], [0, 1.15, -3.5], 0.04);
    slab(mb, 0x54595c, 0, -6.7, -0.5, -0.26, 0.04, 0.34);
    slab(mb, 0x54595c, 0, -6.7, -0.42, -0.36, 0.34, 0.06);
  }
  // A canopy: four posts and a striped tarpaulin roof, a lantern hung at its front.
  if (p.canopy) {
    const zA = -1.9, zB = 1.1;
    for (const z of [zA, zB]) for (const side of [-1, 1]) {
      mb.color = lin(BAMBOO);
      mb.beam([side * 0.38, 0.12, z], [side * 0.38, 1.7, z], 0.05);
    }
    const bands = 6;
    for (let k = 0; k < bands; k++) {
      const z0 = zA - 0.2 + ((zB - zA + 0.4) * k) / bands;
      const z1 = zA - 0.2 + ((zB - zA + 0.4) * (k + 1)) / bands;
      mb.color = lin(k % 2 ? p.tarp2 : p.tarp);
      sheet(mb, [-0.72, 1.55, z0], [0, 2.0, z0], [0, 2.0, z1], [-0.72, 1.55, z1]);
      sheet(mb, [0, 2.0, z0], [0.72, 1.55, z0], [0.72, 1.55, z1], [0, 2.0, z1]);
    }
    glow(mb, LAMP, 0, zB + 0.25, 1.62, 1.82, 0.16, 0.16);
    mb.color = lin(0x1a1a1a);
    mb.beam([0, 1.82, zB + 0.25], [0, 2.0, zB + 0.2], 0.02);
  }
  // A sail: a mast near the bow and a triangular sail slung from a long yard, in broad bands.
  if (p.sail) {
    mb.color = lin(BAMBOO);
    mb.beam([0, 0.14, 0.9], [0, 4.4, 0.9], 0.07);
    const head: V3 = [0, 4.4, 0.95];
    const tack: V3 = [0, 0.95, -2.2];
    const clew: V3 = [0, 1.15, 3.0];
    mb.color = lin(BAMBOO);
    mb.beam(tack, clew, 0.05);
    mb.beam([0, 0.14, 0.9], [0, 0.95, -1.0], 0.025);
    const bands = 5;
    for (let k = 0; k < bands; k++) {
      const a: V3 = [0, tack[1] + ((clew[1] - tack[1]) * k) / bands, tack[2] + ((clew[2] - tack[2]) * k) / bands];
      const b: V3 = [0, tack[1] + ((clew[1] - tack[1]) * (k + 1)) / bands, tack[2] + ((clew[2] - tack[2]) * (k + 1)) / bands];
      mb.color = lin(k % 2 ? p.tarp2 : p.tarp);
      sheet(mb, a, b, head, head);
    }
    glow(mb, LAMP, 0, 0.9, 4.45, 4.62, 0.12, 0.12);
  }
  return mb;
}

// ---------------------------------------------------------------------------------------------------------------
// The ferry and the lighter

function ferry(): MeshBuilder {
  const mb = new MeshBuilder(8000);
  const h: HullSpec = { L: 17, hw: 2.0, depth: 0.9, free: 1.2, sheer: 0.55, pb: 2.0, ps: 6, tr: 0.7, wp: 0.6, kb: 0.9, ks: 0.3, up: 0xf2f0ea, lo: 0x1c4a86, deck: 0x8a8d90, n: 18 };
  hull(mb, h);
  // A blue sheer stripe and the rubbing strake.
  slab(mb, 0x1c4a86, 0, -2.2, 1.2, 3.0, 3.6, 7.6);
  // The cabin, white, its windows (lit at night) and the upper deck's canopy on posts.
  slab(mb, 0xf2f0ea, 0, -2.2, 1.2, 3.1, 3.4, 7.4);
  slab(mb, 0xc8312a, 0, -2.2, 3.1, 3.3, 3.7, 7.7);
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) glow(mb, [0.22, 0.18, 0.1], side * 1.72, -5.1 + k * 1.15, 1.85, 2.55, 0.1, 0.75);
  glow(mb, [0.22, 0.18, 0.1], 0, 1.52, 1.9, 2.6, 2.6, 0.1);
  // The upper deck with a canopy over the stern half, a bridge forward.
  slab(mb, 0xe4e1d8, 0, -3.2, 3.3, 5.4, 3.0, 3.0);
  for (let k = 0; k < 3; k++) glow(mb, [0.22, 0.18, 0.1], 0, -1.65, 3.85, 4.6, 0.1 + 0 * k, 0.1);
  glow(mb, [0.2, 0.16, 0.09], 0, -1.64, 3.9, 4.7, 2.7, 0.1);
  slab(mb, 0xc8312a, 0, -4.2, 5.4, 5.6, 4.0, 4.4);
  for (const x of [-1.6, 1.6]) for (const z of [-5.4, -1.0]) {
    mb.color = lin(0x8a8d90);
    mb.beam([x, 3.3, z], [x, 5.4, z], 0.07);
  }
  // Railings round the bow deck.
  mb.color = lin(0xd8d5cc);
  for (const side of [-1, 1]) mb.beam([side * 1.5, 1.2 + 0.9, 2.2], [side * 0.5, 2.1, 7.2], 0.04);
  // A mast with its masthead lamp.
  mb.color = lin(0x8a8d90);
  mb.beam([0, 5.6, -4.0], [0, 8.2, -4.0], 0.07);
  glow(mb, [0.9, 0.88, 0.8], 0, -4.0, 8.2, 8.4, 0.2, 0.2);
  // Side lights and a funnel.
  glow(mb, [1.0, 0.1, 0.06], 1.75, 1.2, 3.0, 3.2, 0.2, 0.2);
  glow(mb, [0.07, 0.9, 0.22], -1.75, 1.2, 3.0, 3.2, 0.2, 0.2);
  slab(mb, 0x3a3d40, 0, -6.0, 5.6, 6.9, 0.8, 1.0);
  // The lettering band along the hull sides in colour.
  slab(mb, 0xf0b81e, 0, -2.2, 1.2, 1.35, 3.64, 7.64);
  return mb;
}

function lighter(): MeshBuilder {
  const mb = new MeshBuilder(8000);
  const h: HullSpec = { L: 26, hw: 3.6, depth: 1.3, free: 0.55, sheer: 0.45, pb: 3.5, ps: 8, tr: 0.82, wp: 0.5, kb: 0.4, ks: 0.1, flat: true, up: 0x23262b, lo: 0x7a2a22, deck: 0x6a5a48, n: 14 };
  hull(mb, h);
  // The hold: coaming boxes round a load of sand and sacks heaped up.
  slab(mb, 0x1d2024, 0, 3.2, 0.5, 1.5, 6.6, 15);
  slab(mb, 0xc7b184, 0, 3.2, 1.2, 2.3, 6.0, 14.2);
  slab(mb, 0xb6a070, 0, 3.0, 2.2, 2.9, 4.2, 10.5);
  slab(mb, 0xa88f5e, 0, 3.0, 2.8, 3.2, 2.2, 6.0);
  // A wheelhouse aft, with lit windows, a funnel and a mast.
  slab(mb, 0xe6e2d6, 0, -9.5, 0.5, 3.4, 4.6, 4.4);
  slab(mb, 0x8a2a24, 0, -9.5, 3.4, 3.6, 5.0, 4.8);
  glow(mb, [0.2, 0.16, 0.09], 0, -7.28, 1.9, 2.8, 3.4, 0.1);
  for (const side of [-1, 1]) glow(mb, [0.2, 0.16, 0.09], side * 2.32, -9.5, 1.9, 2.8, 0.1, 3.2);
  slab(mb, 0x3a3d40, 1.3, -11.2, 3.6, 5.2, 0.7, 0.7);
  mb.color = lin(0x8a8d90);
  mb.beam([0, 3.6, -9.0], [0, 7.4, -9.0], 0.08);
  glow(mb, [0.9, 0.88, 0.8], 0, -9.0, 7.4, 7.6, 0.2, 0.2);
  // Bow bollards and a lantern each end.
  glow(mb, LAMP, 0, 11.6, 0.8, 1.1, 0.2, 0.2);
  glow(mb, [1.0, 0.1, 0.06], 3.4, -11, 0.7, 0.9, 0.2, 0.2);
  glow(mb, [0.07, 0.9, 0.22], -3.4, -11, 0.7, 0.9, 0.2, 0.2);
  return mb;
}

// ---------------------------------------------------------------------------------------------------------------
// Ships

const BOX_COLOURS = [0x9a2d27, 0x2c5f8a, 0xc9902a, 0x3b6e4a, 0x8a8d90, 0xb5502d, 0x253a5c, 0xd9d3c3, 0x6d3b7a];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deck floodlights on short poles along both rails, and the navigation lights. */
function shipLights(mb: MeshBuilder, h: HullSpec, z0: number, z1: number, step: number, mastZ: number, mastTop: number, bridgeY: number, bridgeZ: number, wing: number): void {
  const flood: V3 = [0.5, 0.45, 0.34];
  for (let z = z0; z <= z1; z += step) {
    for (const side of [-1, 1]) {
      const x = side * (h.hw * plan(h, hullT(h, z)) - 0.5);
      const y = sheerAt(h, z);
      mb.color = lin(0x44484c);
      mb.beam([x, y, z], [x, y + 3.2, z], 0.12);
      glow(mb, flood, x, z, y + 3.2, y + 3.5, 0.5, 0.5);
    }
  }
  // Masthead, stern and anchor lights, and the red (port, +x) and green (starboard, -x) side lights on the bridge wings.
  glow(mb, [1.0, 1.0, 0.9], 0, mastZ, mastTop, mastTop + 0.9, 0.9, 0.9);
  glow(mb, [1.0, 1.0, 0.9], 0, h.L / 2 - 4, sheerAt(h, h.L / 2 - 4) + 4.5, sheerAt(h, h.L / 2 - 4) + 5.2, 0.7, 0.7);
  glow(mb, [1.3, 0.1, 0.06], wing, bridgeZ, bridgeY, bridgeY + 0.8, 0.9, 0.9);
  glow(mb, [0.08, 1.1, 0.28], -wing, bridgeZ, bridgeY, bridgeY + 0.8, 0.9, 0.9);
}

function cargoShip(variant: number): MeshBuilder {
  const mb = new MeshBuilder(60000);
  const r = rng(0x5eed + variant * 97);
  const h: HullSpec = { L: 185, hw: 16.5, depth: 9.5, free: 12, sheer: 3.2, pb: 2.6, ps: 6, tr: 0.72, wp: 0.5, kb: 0.8, ks: 0.15, flat: true, up: variant ? 0x1c3a5a : 0x1f2226, lo: variant ? 0x8a2a24 : 0x7a1d1a, deck: 0x6a6258, n: 26 };
  hull(mb, h);
  // The superstructure aft: five decks, white, with rows of lit windows, the bridge wings and the funnel.
  const hz = -72;
  slab(mb, 0xe8e6de, 0, hz, 12, 29, 22, 15);
  slab(mb, 0xe8e6de, 0, hz + 1, 29, 32, 18, 11);
  slab(mb, 0xcfcdc4, 0, hz + 1, 32, 32.4, 19, 12);
  slab(mb, 0xe8e6de, 0, hz + 1, 29.3, 30.2, 31, 4.2);
  const win: V3 = [0.2, 0.16, 0.09];
  for (let d = 0; d < 5; d++) {
    const y0 = 14 + d * 3.1;
    glow(mb, win, 0, hz + 7.55, y0, y0 + 1.5, 18, 0.12);
    for (const side of [-1, 1]) glow(mb, win, side * 11.05, hz, y0, y0 + 1.5, 0.12, 12);
  }
  glow(mb, [0.26, 0.2, 0.12], 0, hz + 6.6, 30.0, 31.6, 16, 0.12);
  slab(mb, 0xb8302a, 0, hz - 6, 32, 38, 6.4, 6.4);
  slab(mb, 0x1a1a1a, 0, hz - 6, 36.4, 38.2, 6.5, 6.5);
  slab(mb, 0xf0f0f0, 0, hz - 6, 34.6, 36.2, 6.5, 6.5);
  // The containers: bays of 12.4 m, rows 2.6 m wide, stacked up to four high on hatch covers.
  for (let bay = 0; bay < 9; bay++) {
    const z = -52 + bay * 12.9;
    const width = h.hw * plan(h, hullT(h, z)) * 2 - 3;
    const rows = Math.max(1, Math.floor(width / 2.7));
    const stackH = 1 + Math.floor(r() * 3.99);
    slab(mb, 0x4a4640, 0, z, 12.9, 13.1, rows * 2.7 + 0.4, 12.6);
    for (let row = 0; row < rows; row++) {
      const x = (row - (rows - 1) / 2) * 2.7;
      const hgt = Math.max(1, stackH + (r() < 0.3 ? -1 : r() < 0.2 ? 1 : 0));
      for (let k = 0; k < hgt; k++) {
        const y = 13.1 + k * 2.65;
        slab(mb, BOX_COLOURS[Math.floor(r() * BOX_COLOURS.length)], x, z, y, y + 2.6, 2.5, 12.2);
      }
    }
  }
  // Cranes on the port side, and the forecastle's mast and winches.
  for (const cz of [-14, 28]) {
    slab(mb, 0xc9a02a, 13.8, cz, 12, 22, 1.6, 1.6);
    mb.color = lin(0xc9a02a);
    mb.beam([13.8, 21.5, cz], [4.5, 32, cz], 0.5);
    mb.beam([13.8, 21.5, cz], [13.8, 28, cz], 0.3);
    mb.beam([13.8, 28, cz], [4.5, 32, cz], 0.2);
  }
  slab(mb, 0x6a6258, 0, 74, 14.4, 16.4, 4.5, 3);
  mb.color = lin(0x8a8d90);
  mb.beam([0, 15, 70], [0, 27, 70], 0.4);
  shipLights(mb, h, -60, 70, 26, 70, 27, 33, hz + 1, 15.5);
  return mb;
}

function tanker(variant: number): MeshBuilder {
  const mb = new MeshBuilder(40000);
  const h: HullSpec = { L: 230, hw: 21.5, depth: 13.5, free: 7, sheer: 1.6, pb: 3.4, ps: 6, tr: 0.8, wp: 0.45, kb: 0.8, ks: 0.15, flat: true, up: variant ? 0x20262c : 0x2a2c30, lo: variant ? 0x2e5a3a : 0x6a1c18, deck: variant ? 0x3f6a4a : 0x7a3a2c, n: 28 };
  hull(mb, h);
  // The deck: a centre catwalk, long pipe runs with manifolds across, tank hatches and vents.
  slab(mb, 0x9a9a92, 0, 5, 7.3, 8.1, 2.4, 170);
  mb.color = lin(0xb8b6ac);
  for (const x of [-4.5, -3.3, 3.3, 4.5]) mb.beam([x, 8.3, -75], [x, 8.3, 85], 0.5);
  for (let z = -70; z <= 80; z += 25) {
    mb.beam([-9, 8.6, z], [9, 8.6, z], 0.55);
    slab(mb, 0x44484c, -7, z, 7.2, 8.4, 1.4, 1.4);
    slab(mb, 0x44484c, 7, z, 7.2, 8.4, 1.4, 1.4);
    for (const x of [-12, 12]) slab(mb, 0x54585c, x, z + 8, 7.2, 8.2, 3.2, 3.2);
  }
  // The bridge house aft, white, with the funnel and the lit windows; a forecastle mast.
  const hz = -96;
  slab(mb, 0xe8e6de, 0, hz, 7, 24, 26, 16);
  slab(mb, 0xe8e6de, 0, hz + 1, 24, 28, 21, 12);
  slab(mb, 0xcfcdc4, 0, hz + 1, 28, 28.4, 22, 13);
  slab(mb, 0xe8e6de, 0, hz + 1.5, 25.2, 26.2, 34, 4.4);
  const win: V3 = [0.2, 0.16, 0.09];
  for (let d = 0; d < 4; d++) {
    const y0 = 9.5 + d * 3.4;
    glow(mb, win, 0, hz + 8.05, y0, y0 + 1.6, 21, 0.12);
    for (const side of [-1, 1]) glow(mb, win, side * 13.05, hz, y0, y0 + 1.6, 0.12, 13);
  }
  glow(mb, [0.26, 0.2, 0.12], 0, hz + 7.1, 25.4, 27.0, 18, 0.12);
  slab(mb, variant ? 0x2e5a3a : 0xb8302a, 0, hz - 6, 28, 34, 7, 7);
  slab(mb, 0x1a1a1a, 0, hz - 6, 32.4, 34.2, 7.1, 7.1);
  slab(mb, 0x60666a, 0, 100, 7, 9, 5, 3.4);
  mb.color = lin(0x8a8d90);
  mb.beam([0, 9, 98], [0, 20, 98], 0.4);
  shipLights(mb, h, -70, 100, 30, 98, 20, 28, hz + 1.5, 17.5);
  return mb;
}

// ---------------------------------------------------------------------------------------------------------------
// The models, and what the showroom shows

export interface BoatModel {
  readonly id: string;
  readonly name: string;
  /** Its length (m) and the wake it draws. */
  readonly len: number;
  readonly build: () => MeshBuilder;
}

export const BOAT_MODELS: readonly BoatModel[] = [
  ...PAINTS.map((p, i) => ({ id: `bangka${i}`, name: `bangka · ${p.sail ? 'sail' : p.canopy ? 'canopy' : 'open'} ${i + 1}`, len: 8.6, build: () => bangka(i) })),
  { id: 'ferry', name: 'passenger launch', len: 17, build: ferry },
  { id: 'lighter', name: 'lighterage barge', len: 26, build: lighter },
  { id: 'cargo0', name: 'container ship', len: 185, build: () => cargoShip(0) },
  { id: 'cargo1', name: 'container ship (blue)', len: 185, build: () => cargoShip(1) },
  { id: 'tanker0', name: 'tanker', len: 230, build: () => tanker(0) },
  { id: 'tanker1', name: 'tanker (green)', len: 230, build: () => tanker(1) },
];

// ---------------------------------------------------------------------------------------------------------------
// Routes

export class Route {
  readonly cum: number[] = [0];
  constructor(readonly pts: readonly (readonly [number, number])[]) {
    for (let i = 1; i <= pts.length; i++) {
      const a = pts[i - 1], b = pts[i % pts.length];
      this.cum.push(this.cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
  }
  get length(): number {
    return this.cum[this.cum.length - 1];
  }
  /** Position and heading (yaw, bow +z) at arc length s round the loop. */
  at(s: number, out: { x: number; z: number; yaw: number }): void {
    const L = this.length;
    s = ((s % L) + L) % L;
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m;
    }
    const a = this.pts[lo], b = this.pts[(lo + 1) % this.pts.length];
    const seg = this.cum[lo + 1] - this.cum[lo] || 1;
    const f = (s - this.cum[lo]) / seg;
    out.x = a[0] + (b[0] - a[0]) * f;
    out.z = a[1] + (b[1] - a[1]) * f;
    out.yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  }
}

function oval(cx: number, cz: number, rx: number, rz: number, n = 48): Route {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cz + Math.sin(a) * rz]);
  }
  return new Route(pts);
}

/** Down one lane and up the other: straight runs between z0 and z1 with half-circle turns at both ends. */
function stadium(xc: number, z0: number, z1: number, hw: number, arc = 10): Route {
  const pts: [number, number][] = [];
  pts.push([xc + hw, z0]);
  for (let i = 1; i < arc; i++) {
    const a = (i / arc) * Math.PI;
    pts.push([xc + Math.cos(a) * hw, z1 + Math.sin(a) * hw]);
  }
  pts.push([xc - hw, z1]);
  pts.push([xc - hw, z0]);
  for (let i = 1; i < arc; i++) {
    const a = (i / arc) * Math.PI;
    pts.push([xc - Math.cos(a) * hw, z0 - Math.sin(a) * hw]);
  }
  return new Route(pts);
}

export interface Craft {
  model: string;
  route?: Route;
  /** Arc position now (m); moving craft add speed * t. */
  s0: number;
  speed: number;
  /** Fixed berth/anchorage (x, z) and heading. */
  x: number;
  z: number;
  yaw: number;
  /** A swing about the anchor (rad) with its period (s). */
  swing: number;
  period: number;
  phase: number;
  /** Bobbing amplitude (m). */
  bob: number;
  wake: number;
}

export function planFleet(): Craft[] {
  const out: Craft[] = [];
  const r = rng(0xb0a7);
  const base = { x: 0, z: 0, yaw: 0, swing: 0, period: 1, s0: 0, speed: 0, wake: 0 };
  const bob = (len: number): number => Math.min(0.12, 0.03 + len * 0.004);
  const moving = (model: string, route: Route, phase: number, speed: number, len: number): void => {
    out.push({ ...base, model, route, s0: phase * route.length, speed, phase: r() * 6.28, bob: bob(len), wake: len });
  };
  // The Pasig: reaches between the bridges (decks at street level: nothing tall goes under), lane up and lane down.
  const reaches: [number, number, number, number[]][] = [
    [2270, 2900, 16, [0, 4, 1, 3]],
    [1710, 2130, 14, [2, 5]],
    [1180, 1610, 14, [4, 0]],
  ];
  reaches.forEach(([z0, z1, hw, ps], k) => {
    const route = stadium(2624, z0, z1, hw);
    ps.forEach((p, i) => moving(`bangka${p}`, route, i / ps.length + k * 0.13, 2.6 + k * 0.3, 8.6));
  });
  // The ferry between the quays and the bay, a barge going the other way.
  moving('ferry', stadium(2624, 2310, 3780, 34, 14), 0.1, 5.5, 17);
  moving('ferry', stadium(2624, 2310, 3780, 34, 14), 0.6, 5.5, 17);
  moving('lighter', stadium(2624, 2290, 3300, 24, 12), 0.35, 1.7, 26);
  // The bay.
  const bays: [number, number, number, number, number[]][] = [
    [1500, 3260, 400, 150, [0, 2, 4]],
    [3750, 3300, 430, 170, [1, 3, 5]],
    [2150, 3220, 210, 90, [5, 0]],
    [3000, 3600, 520, 120, [3, 2]],
  ];
  bays.forEach(([cx, cz, rx, rz, ps], k) => {
    const route = oval(cx, cz, rx, rz);
    ps.forEach((p, i) => moving(`bangka${p}`, route, i / ps.length + k * 0.21, 3.0 + k * 0.4, 8.6));
  });
  moving('ferry', oval(1800, 3700, 800, 260), 0.2, 6.5, 17);
  moving('lighter', oval(3300, 3480, 360, 110), 0.5, 1.6, 26);
  moving('lighter', oval(900, 3560, 240, 70), 0.1, 1.5, 26);
  // Moored: bangkas along the river walks and the bay quay, bows every which way, a lighter or two at the quay.
  const moor = (model: string, x: number, z: number, yaw: number, len: number): void => {
    out.push({ ...base, model, x, z, yaw, swing: 0.05, period: 7 + r() * 5, phase: r() * 6.28, bob: bob(len) * 0.8, wake: 0 });
  };
  for (const [xs, side] of [[2565, 0.06], [2683, 0.06]] as const) {
    for (let z = 2290; z < 2890; z += 16 + r() * 26) moor(`bangka${Math.floor(r() * 6)}`, xs + (r() - 0.5) * 3, z, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * side * 4, 8.6);
    for (let z = 1720; z < 2120; z += 22 + r() * 40) moor(`bangka${Math.floor(r() * 6)}`, xs + (r() - 0.5) * 3, z, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * side * 4, 8.6);
  }
  for (const [x0, x1] of [[1500, 2520], [2730, 3700]] as const) {
    for (let x = x0; x < x1; x += 14 + r() * 24) moor(`bangka${Math.floor(r() * 6)}`, x, 2958 + r() * 8, Math.PI / 2 * (r() < 0.5 ? 1 : -1) + (r() - 0.5) * 0.2, 8.6);
  }
  moor('lighter', 2570, 2760, 0.02, 26);
  moor('lighter', 2680, 2480, Math.PI - 0.03, 26);
  // At anchor in the bay, swinging slowly on the tide.
  const anchored: [string, number, number, number][] = [
    ['cargo0', 1350, 3520, 1.15],
    ['tanker0', 3250, 3700, 2.0],
    ['cargo1', 4300, 3460, 1.9],
    ['tanker1', 600, 3900, 1.3],
    ['cargo0', 2500, 4300, 2.3],
    ['cargo1', 4900, 4100, 1.0],
  ];
  for (const [model, x, z, yaw] of anchored) {
    out.push({ ...base, model, x, z, yaw, swing: 0.28, period: 140 + r() * 70, phase: r() * 6.28, bob: 0.035, wake: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The fleet

export interface Boats {
  readonly group: THREE.Group;
  /** Places the craft near the camera (the rest now and then); dt in seconds of game time (0 stops them). */
  update(camera: THREE.Vector3, dt: number): void;
}

/** The wake: a pale V and the foam at the stern, fading astern, drawn flat on the water. */
function wakeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3, alphas: [number, number, number, number]): void => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = [a, b, c, d][k];
      pos.push(...p);
      col.push(1, 1, 1, alphas[k]);
    }
  };
  // (Unit boat: length 1 along -z from the stern, half-width of the V opening to 0.9.)
  for (const side of [-1, 1]) {
    quad([side * 0.04, 0, 0], [side * 0.14, 0, 0], [side * 0.95, 0, -2.4], [side * 0.7, 0, -2.4], [0.5, 0.35, 0, 0]);
  }
  quad([-0.08, 0, 0.1], [0.08, 0, 0.1], [0.05, 0, -1.2], [-0.05, 0, -1.2], [0.45, 0.45, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  return g;
}

const NEAR = 700;
const FAR_EVERY = 20;

export function buildBoats(city: THREE.Material): Boats {
  const group = new THREE.Group();
  group.name = 'boats';
  const crafts = planFleet();
  const counts = new Map<string, number>();
  for (const c of crafts) counts.set(c.model, (counts.get(c.model) ?? 0) + 1);
  const meshes = new Map<string, THREE.InstancedMesh>();
  const slot: number[] = [];
  const next = new Map<string, number>();
  for (const m of BOAT_MODELS) {
    const n = counts.get(m.id) ?? 0;
    if (!n) continue;
    const im = new THREE.InstancedMesh(m.build().build()!, city, n);
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.name = `boat:${m.id}`;
    meshes.set(m.id, im);
    group.add(im);
  }
  for (const c of crafts) {
    const i = next.get(c.model) ?? 0;
    next.set(c.model, i + 1);
    slot.push(i);
  }
  const movers = crafts.filter((c) => c.wake > 0);
  const wakeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0.8 });
  const wakes = new THREE.InstancedMesh(wakeGeometry(), wakeMat, Math.max(1, movers.length));
  wakes.frustumCulled = false;
  wakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wakes.renderOrder = 1;
  group.add(wakes);

  const pose = { x: 0, z: 0, yaw: 0 };
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const ws = new THREE.Vector3();
  let t = 0;
  let frame = 0;

  const place = (c: Craft, ci: number, k: number): void => {
    if (c.route) c.route.at(c.s0 + c.speed * t, pose);
    else {
      pose.x = c.x;
      pose.z = c.z;
      pose.yaw = c.yaw + Math.sin((t / c.period) * Math.PI * 2 + c.phase) * c.swing;
    }
    const w = t * 1.3 + c.phase;
    const heave = Math.sin(w) * c.bob + Math.sin(w * 1.7 + 1) * c.bob * 0.4;
    const pitch = Math.sin(w * 0.9 + 0.5) * c.bob * 0.35;
    const roll = Math.sin(w * 1.15 + 2) * c.bob * 0.5;
    e.set(pitch, pose.yaw, roll);
    q.setFromEuler(e);
    p.set(pose.x, SEA_LEVEL + 0.02 + heave, pose.z);
    m4.compose(p, q, one);
    meshes.get(c.model)!.setMatrixAt(slot[ci], m4);
    if (c.wake > 0 && k >= 0) {
      const len = c.wake;
      const stern = len / 2;
      e.set(0, pose.yaw, 0);
      q.setFromEuler(e);
      p.set(pose.x - Math.sin(pose.yaw) * stern * 0.9, SEA_LEVEL + 0.06, pose.z - Math.cos(pose.yaw) * stern * 0.9);
      const sp = Math.min(1, c.speed / 4);
      ws.set(len * (0.5 + 0.4 * sp), 1, len * (0.6 + 0.8 * sp));
      m4.compose(p, q, ws);
      wakes.setMatrixAt(k, m4);
    }
  };

  // Where each craft was last placed: the far ones are placed only now and then.
  const lastX = new Float64Array(crafts.length);
  const lastZ = new Float64Array(crafts.length);
  const wakeOf: number[] = [];
  let nw = 0;
  for (const c of crafts) wakeOf.push(c.wake > 0 ? nw++ : -1);
  const placeCraft = (ci: number): void => {
    place(crafts[ci], ci, wakeOf[ci]);
    lastX[ci] = pose.x;
    lastZ[ci] = pose.z;
  };
  for (let ci = 0; ci < crafts.length; ci++) placeCraft(ci);
  for (const im of meshes.values()) im.instanceMatrix.needsUpdate = true;
  wakes.count = movers.length;
  wakes.instanceMatrix.needsUpdate = true;

  // The region the fleet lives in: nothing to do while the camera is far from all of it.
  const BOX = { x0: 300, x1: 5300, z0: 1100, z1: 4600 };

  return {
    group,
    update(camera, dt) {
      t += dt;
      frame++;
      const dx = Math.max(BOX.x0 - camera.x, 0, camera.x - BOX.x1);
      const dz = Math.max(BOX.z0 - camera.z, 0, camera.z - BOX.z1);
      group.visible = Math.hypot(dx, dz) < 1500;
      if (!group.visible) return;
      for (let ci = 0; ci < crafts.length; ci++) {
        const near = Math.hypot(lastX[ci] - camera.x, lastZ[ci] - camera.z) < NEAR;
        if (near || (frame + ci) % FAR_EVERY === 0) placeCraft(ci);
      }
      for (const im of meshes.values()) im.instanceMatrix.needsUpdate = true;
      wakes.instanceMatrix.needsUpdate = true;
    },
  };
}
