import { hash, rng, type Rng } from '../../core/hash';
import { frontPoint, frontSpan, frontWidth, type Building3, type Corner } from '../district/plan';
import { EMIT, KIND, lin, scale3, type MeshBuilder } from './meshBuilder';
import { filipino } from '../district/cityConfig';
import * as manila from './manilaBuilding';
import { HUES, hueOfColor, pickTrade, shopFlags, TRADE, TRADES } from './shops';

/**
 * Realistic building styles and geometry. Everything is a pure function of the building (its id seeds
 * the style), so a building looks the same every visit and the lightmap (props.ts) can predict which
 * shops are open.
 */

type C3 = [number, number, number];

/** Window types; must match city.ts. */
export const WIN = { punched: 0, ribbon: 1, curtain: 2, balcony: 3, small: 4, blank: 5 } as const;

/** Ground floor (storefront) height and storey height; must match city.ts. */
export const GF = 4.2;
export const FH = 3.0;
/** A home's ground floor (no shop): lower, so a two-storey house has both floors; must match city.ts. */
export const HOME_GF = 3.0;
/** The flag bit marking a home (city.ts reads it). */
export const HOME_FLAG = 256;
/**
 * The rooms behind the upper floors' glass (city.ts, windowScenes.ts; the literals there must match). VICE_SHIFT:
 * two bits, how much of the city's vice the building's zone has (its look's `vice`, 0 to 3). DEN_FLAG: a tenant
 * building whose upper floors are bars, clubs, parlours and back offices rather than flats or offices: more of them
 * the more vice the zone has, and over a bar or a parlour's sign.
 */
export const VICE_SHIFT = 131072;
export const DEN_FLAG = 524288;
/** Filipino looks (city.ts reads both): arched punched windows, and unplastered hollow-block walls (block joints). */
export const ARCH_FLAG = 1048576;
export const BLOCK_FLAG = 2097152;
/** An informal settlement's shack (zones' look `informal`): patchwork walls of mismatched panels, a low corrugated roof weighted with stones and tyres (city.ts reads the flag). */
export const INFORMAL_FLAG = 4194304;
const NIGHT_TRADES: readonly number[] = [TRADE.bar, TRADE.snack, TRADE.izakaya, TRADE.mahjong, TRADE.karaoke, TRADE.lounge, TRADE.pachinko, TRADE.arcade];

export interface RealStyle {
  readonly wall: C3;
  readonly trim: C3;
  readonly accent: C3;
  readonly type: number;
  readonly bay: number;
  readonly ratio: number;
  readonly winH: number;
  readonly shopOpen: boolean;
  /** The shops' mood: 0 warm, 1 cool white, 2 colourful, 3 dim bar. */
  readonly shopPal: number;
  /** What the shop is (shops.ts TRADE) and its own colour (an index into HUES; its sign's). */
  readonly trade: number;
  readonly hue: number;
  readonly flags: number;
  readonly parapet: number;
  readonly cornice: boolean;
  readonly awning: boolean;
  /** A home: a door and a window on the ground floor instead of a shop (HOME_GF high). */
  readonly home: boolean;
  /** A pitched roof's colour (low homes), or null for a flat roof with a parapet. */
  readonly roof: C3 | null;
  /** Manila: a hollow-block house (unplastered; a flat roof is left unfinished, with rebar), a church (a bell-tower on the front), grilles over its windows. */
  readonly block: boolean;
  readonly church: boolean;
  readonly grille: boolean;
  /** An informal-settlement shack (a home with patchwork walls and a low scrap roof). */
  readonly informal: boolean;
}

/** A shack's roof: old galvanised sheet, rusted through, a patch of blue tarp. */
const ROOFS_INFORMAL = [0x7a7c7c, 0x8a5a3c, 0x6a3a28, 0x9a9a94, 0x6a6a68, 0x2a4a7a, 0x8a5a3c];
const ROOFS = [0x3a4450, 0x2a2c30, 0x5a3a2a, 0x4a5a6a, 0x6a2a22];
/** Manila's roofs are corrugated iron: grey galvanised, rusted, painted red and green. */
const ROOFS_IRON = [0x8c8e8c, 0x7a7c7c, 0x8a5a3c, 0x6a3a28, 0x9a9a94, 0x7a2a22, 0x3e5a48];
/** Unplastered hollow block, a little different each house. */
const BLOCK_WALLS = [0xb4b4ac, 0xa6a6a0, 0xc0c0b8, 0xaeaea6, 0xb8b2a4];

// Kaburo palette: tiled mid-rises (beige, white, brown), bare concrete, dark bar buildings, and 80s pastels.
const PALETTES: readonly (readonly [number, readonly number[], boolean])[] = [
  [25, [0xb8a88c, 0xc2b49a, 0xa89878, 0xcfc4ae], true],
  [14, [0xd8d5cc, 0xcdc9bf, 0xe0ddd2], true],
  [12, [0x7c604c, 0x6c5242, 0x8a6a52], true],
  [20, [0x8e8d88, 0x7c7b77, 0x9d9b94, 0x6f6e6b], false],
  [15, [0x3a3a3e, 0x2c2e33, 0x46464a], false],
  [14, [0xa3b3ba, 0xc5aaa5, 0xbdbca4, 0xa9b8a6], false],
];
const GLASS_BODY = [0x2e3b45, 0x3a4550, 0x33383c];
const TRIMS = [0x5a5a5c, 0x8a8a86, 0x2a2a2c, 0xb0aca2];
const ACCENTS = [0x9a2a22, 0x2f5d3a, 0x283a5c, 0xb05a1e, 0x6a2a4a, 0x1f5a5a];

function weighted<T>(rnd: Rng, list: readonly (readonly [number, T])[]): T {
  let total = 0;
  for (const [w] of list) total += w;
  let r = rnd.float() * total;
  for (const [w, v] of list) if ((r -= w) < 0) return v;
  return list[0][1];
}

const cache = new Map<number, RealStyle>();

export function styleFor(b: Building3): RealStyle {
  let s = cache.get(b.id);
  if (s) return s;
  const rnd = rng(hash(b.id, 0x5719e));
  const stamp = b.hue !== undefined;
  const look = b.zone?.look;
  // A zone's window mix applies below tower height (towers keep curtain walls and ribbons).
  const type = stamp
    ? WIN.small
    : look?.windows && b.h < 45
      ? weighted(rnd, look.windows)
      : b.h >= 45
      ? weighted(rnd, [[45, WIN.curtain], [30, WIN.ribbon], [25, WIN.punched]])
      : b.h >= 15
        ? weighted(rnd, [[40, WIN.punched], [20, WIN.balcony], [25, WIN.ribbon], [5, WIN.curtain], [10, WIN.small]])
        : weighted(rnd, [[45, WIN.punched], [25, WIN.small], [15, WIN.ribbon], [15, WIN.balcony]]);
  let [, hexes, tiled] = weighted(rnd, PALETTES.map((p) => [p[0], p] as const));
  let wallHex = rnd.pick(hexes);
  if (look?.walls) {
    wallHex = rnd.pick(look.walls);
    tiled = look.tiled;
  }
  if (type === WIN.curtain) {
    wallHex = rnd.pick(GLASS_BODY);
    tiled = false;
  }
  if (stamp) {
    wallHex = 0x2a2a2e;
    tiled = false;
  }
  const bay = type === WIN.punched ? 2.6 + rnd.float() * 1.0
    : type === WIN.ribbon ? 1.8 + rnd.float() * 0.6
    : type === WIN.curtain ? 1.5 + rnd.float() * 0.5
    : type === WIN.balcony ? 3.2 + rnd.float() * 1.0
    : 3.0;
  const ratio = 0.4 + rnd.float() * 0.25;
  const winH = type === WIN.ribbon ? 1.1 + rnd.float() * 0.4 : 1.2 + rnd.float() * 0.5;
  // Homes (from their own hash, so the rest of the style stays as it was).
  const hr = rng(hash(b.id, 0x40e5));
  // An informal settlement's shack (its own hash): a home with patchwork walls.
  const informal = !stamp && rng(hash(b.id, 0x5ac4)).chance(look?.informal ?? 0);
  const home = !stamp && (hr.chance(look?.homes ?? 0) || informal);
  // Filipino looks (from their own hashes, so nothing else moves, and only where a zone asks for them).
  const fil = filipino() && !stamp;
  const fr = rng(hash(b.id, 0xb10c));
  const block = fil && b.h <= 16 && fr.chance(look?.block ?? 0) && !informal;
  const arch = fil && type === WIN.punched && fr.chance(look?.arch ?? 0);
  const church = fil && !block && b.w >= 9 && b.d >= 8 && b.h <= 22 && rng(hash(b.id, 0xc4c4)).chance(look?.church ?? 0);
  const grille = fil && fr.chance(0.6) && !informal;
  if (block) {
    wallHex = fr.pick(BLOCK_WALLS);
    tiled = false;
  }
  const roof = informal && b.h <= 9.5 ? lin(rng(hash(b.id, 0x5ac5)).pick(ROOFS_INFORMAL)) : home && b.h <= 9.5 && hr.chance(look?.roofs ?? 0) && (!block || fr.chance(0.4)) ? lin(hr.pick(fil ? ROOFS_IRON : ROOFS)) : null;
  const shopOpen = !home && (stamp || rnd.chance(look?.open ?? 0.8));
  const shopPal = stamp ? 3 : weighted(rnd, look?.shops ?? [[40, 0], [30, 1], [15, 2], [15, 3]]);
  const darkFrame = rnd.chance(0.4) || type === WIN.curtain;
  const litBias = rnd.int(0, 7);
  // The shop: what its sign says, else what its zone and mood suggest (from its own hash).
  const [s0, s1] = frontSpan(b);
  const { trade, hue } = stamp
    ? { trade: TRADE.bar, hue: hueOfColor(b.hue!) }
    : pickTrade({ id: b.id, sign: b.sign, words: b.zone?.style.signWords, colors: b.zone?.style.signColors, mood: shopPal, front: s1 - s0 - 0.7, tower: b.h >= 45 || type === WIN.curtain });
  // (From their own hash too.)
  const vice = stamp ? 0 : (look?.vice ?? 0);
  const den = !home && !stamp && b.h < 45 && rng(hash(b.id, 0xde17)).chance(vice * (NIGHT_TRADES.includes(trade) ? 0.95 : 0.5));
  const flags = (shopOpen ? 1 : 0) + shopPal * 2 + (darkFrame ? 8 : 0) + litBias * 16 + (tiled ? 128 : 0) + (home ? HOME_FLAG : 0) + (home ? 0 : shopFlags(trade, hue)) + (arch || church ? ARCH_FLAG : 0) + (block ? BLOCK_FLAG : 0) + (informal ? INFORMAL_FLAG : 0) + Math.min(3, Math.round(vice * 3)) * VICE_SHIFT + (den ? DEN_FLAG : 0);
  s = {
    wall: lin(wallHex),
    trim: lin(rnd.pick(TRIMS)),
    // (The pick stays so the rolls after it don't move; an awning takes the shop's own colour.)
    accent: stamp ? lin(b.hue!) : (rnd.pick(ACCENTS), scale3(HUES[hue], 0.8)),
    type,
    bay,
    ratio,
    winH,
    shopOpen,
    shopPal,
    trade,
    hue,
    flags,
    parapet: 0.6 + rnd.float() * 0.5,
    cornice: rnd.chance(0.3) && !roof,
    awning: shopOpen && rnd.chance(0.35) && TRADES[trade].awning,
    home,
    roof,
    block,
    church,
    grille,
    informal,
  };
  cache.set(b.id, s);
  return s;
}

const NORMALS = { south: [0, 0, 1], north: [0, 0, -1], east: [1, 0, 0], west: [-1, 0, 0] } as const;

/** The building's street face: origin (its left end at ground level), right vector, outward normal, width. */
export function frontFrame(b: Building3): { p: C3; r: C3; n: C3; fw: number } {
  const q = frontPoint(b, 0, 0);
  const n = NORMALS[b.front] as unknown as C3;
  return { p: [q.x, 0, q.z], r: [n[2], 0, -n[0]], n, fw: frontWidth(b) };
}

/** A tier of a building: width, depth, bottom, top, and its centre's offset from the footprint's. */
export type Tier = [w: number, d: number, y0: number, y1: number, ox: number, oz: number];

/**
 * A building's tiers. Towers over 45 m step back all round once or twice; some mid-rises step their top
 * floors back from the street (the road slant-plane limit), from 15 m up so blade signs stay clear.
 */
export function tiers(b: Building3): Tier[] {
  const whole: Tier[] = [[b.w, b.d, 0, b.h, 0, 0]];
  if (b.h <= 45) {
    const rnd = rng(hash(b.id, 0x7136));
    if (b.hue !== undefined || b.h < 18 || !rnd.chance(b.zone?.style.stepBack ?? 0.3)) return whole;
    const y = b.h - rnd.int(1, 3) * FH;
    const ns = b.front === 'north' || b.front === 'south';
    const step = Math.min(2.8 + rnd.float() * 2, (ns ? b.d : b.w) - 5);
    if (y < 15 || step < 2.8) return whole;
    const n = NORMALS[b.front];
    return [
      [b.w, b.d, 0, y, 0, 0],
      ns ? [b.w, b.d - step, y, b.h, 0, (-n[2] * step) / 2] : [b.w - step, b.d, y, b.h, (-n[0] * step) / 2, 0],
    ];
  }
  const rnd = rng(hash(b.id, 0x7135));
  const out: Tier[] = [];
  const setbacks = rnd.int(1, 2);
  let y = 0;
  let k = 1;
  for (let t = 0; t <= setbacks; t++) {
    const top = t === setbacks ? b.h : y + (b.h - y) * (0.55 + rnd.float() * 0.25);
    out.push([b.w * k, b.d * k, y, top, 0, 0]);
    y = top;
    k *= 0.66 + rnd.float() * 0.16;
  }
  return out;
}

/** How far a tier's street face stands back from the building's, and that face's width. */
export function tierFront(b: Building3, t: Tier): { inset: number; fw: number } {
  const n = NORMALS[b.front];
  const ns = b.front === 'north' || b.front === 'south';
  const full = ns ? b.d : b.w;
  const depth = ns ? t[1] : t[0];
  return { inset: full / 2 - depth / 2 - (t[4] * n[0] + t[5] * n[2]), fw: ns ? t[0] : t[1] };
}

type P2 = readonly [number, number];

/**
 * A tier's footprint as a polygon (x, z), anticlockwise seen from above: SW, SE, NE, NW, with the corner
 * cut (tier 0 of a corner building) replaced by its two ends. Also each edge's facade u at its start and
 * the full face width, so a cut face keeps the window grid of the uncut one.
 */
function footprint(b: Building3, t: Tier, first: boolean): { pts: P2[]; u0: number[]; fw: number[] } {
  const [w, d, , , ox, oz] = t;
  const x0 = b.x + ox - w / 2;
  const x1 = b.x + ox + w / 2;
  const z0 = b.z + oz - d / 2;
  const z1 = b.z + oz + d / 2;
  const corners: [Corner, P2][] = [['sw', [x0, z1]], ['se', [x1, z1]], ['ne', [x1, z0]], ['nw', [x0, z0]]];
  const cut = first ? b.cut : undefined;
  const pts: P2[] = [];
  const u0: number[] = [];
  const fw: number[] = [];
  corners.forEach(([name, c], i) => {
    const prev = corners[(i + 3) % 4][1];
    const next = corners[(i + 1) % 4][1];
    const len = Math.hypot(next[0] - c[0], next[1] - c[1]);
    if (cut?.corner === name) {
      const s = cut.size;
      const toward = (p: P2): P2 => {
        const l = Math.hypot(p[0] - c[0], p[1] - c[1]);
        return [c[0] + ((p[0] - c[0]) / l) * s, c[1] + ((p[1] - c[1]) / l) * s];
      };
      // The diagonal face, then this corner's outgoing edge starting s along.
      pts.push(toward(prev));
      u0.push(0);
      fw.push(Math.SQRT2 * s);
      pts.push(toward(next));
      u0.push(s);
      fw.push(len);
    } else {
      pts.push(c);
      u0.push(0);
      fw.push(len);
    }
  });
  return { pts, u0, fw };
}

/** Walls (facade coordinates per edge) and roof of a footprint polygon, from y0 to y1. */
function prism(mb: MeshBuilder, f: { pts: P2[]; u0: number[]; fw: number[] }, y0: number, y1: number): void {
  const { pts } = f;
  const h = y1 - y0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    mb.quad([p[0], y0, p[1]], [q[0] - p[0], 0, q[1] - p[1]], [0, h, 0], mb.kind, f.u0[i], f.fw[i]);
  }
  const kind = mb.kind;
  mb.kind = KIND.roof;
  const P = (i: number): C3 => [pts[i][0], y1, pts[i][1]];
  // A fan from the first point (the polygon is convex).
  for (let i = 1; i + 1 < pts.length; i += 2) {
    const last = Math.min(i + 2, pts.length - 1);
    mb.poly4(P(0), P(i), P(i + 1), P(last));
  }
  mb.kind = kind;
}

/** A thin wall of thickness t inside each edge of a polygon (parapets), from y0 to y1. */
function ring(mb: MeshBuilder, pts: readonly P2[], y0: number, y1: number, t: number): void {
  const h = y1 - y0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const a: C3 = [q[0] - p[0], 0, q[1] - p[1]];
    const l = Math.hypot(a[0], a[2]);
    if (l < 0.05) continue;
    // Outward normal (-dz, dx); the inner face runs back the other way.
    const n: C3 = [-a[2] / l, 0, a[0] / l];
    const ip: C3 = [p[0] - n[0] * t, y0, p[1] - n[2] * t];
    mb.quad([p[0], y0, p[1]], a, [0, h, 0]);
    mb.quad([ip[0] + a[0], y0, ip[2] + a[2]], [-a[0], 0, -a[2]], [0, h, 0]);
    mb.quad([p[0], y1, p[1]], a, [-n[0] * t, 0, -n[2] * t]);
  }
}

/**
 * Adds a building to the builder. near = false gives just the masses (distant LOD); near = true adds the
 * detail: parapets, cornice, rooftop gear, balconies, curtain-wall fins, ribbon-window lips, awnings,
 * wall-hung AC units and pipes.
 */
export function addBuilding(mb: MeshBuilder, b: Building3, near: boolean): void {
  const s = styleFor(b);
  const f = frontFrame(b);
  const rnd = rng(hash(b.id, 0xde7a11));
  mb.id = b.id;
  mb.flags = s.flags;
  mb.frontNormal = f.n;

  const ts = tiers(b);
  // A home's ground floor is lower: its upper windows start at HOME_GF.
  const gf = s.home ? HOME_GF : GF;
  const floorsTo = (y1: number): number => Math.max(0, Math.floor((y1 - gf - (s.home ? -0.4 : 0.5)) / FH));
  ts.forEach((tier, i) => {
    const [w, d, y0, y1, ox, oz] = tier;
    const floors = floorsTo(y1);
    mb.kind = KIND.wall;
    mb.color = s.wall;
    mb.style = [s.bay, s.ratio, s.winH, s.type + 8 * floors];
    if (i === 0 && b.cut) prism(mb, footprint(b, tier, true), y0, y1);
    else mb.box(b.x + ox, b.z + oz, y0, y1, w, d);
  });
  mb.frontNormal = null;
  mb.style = [0, 0, 0, 0];
  if (s.roof) pitchedRoof(mb, b, s, near);
  if (s.church) {
    const [c0, c1] = frontSpan(b);
    manila.churchMass(mb, b, f, c0, c1, ts[ts.length - 1][3], s.wall, near);
  }
  if (!near) return;

  const topTier = ts[ts.length - 1];
  const [tw, td, , top, tox, toz] = topTier;
  // Parapet (and sometimes a cornice band just below it).
  mb.kind = KIND.plain;
  mb.color = s.trim;
  const ph = s.parapet;
  const t = 0.2;
  if (!s.roof && !s.block) ring(mb, footprint(b, topTier, ts.length === 1).pts, top, top + ph, t);
  if (s.cornice && !(b.cut && ts.length === 1)) mb.box(b.x + tox, b.z + toz, top - 0.45, top - 0.1, tw + 0.3, td + 0.3);
  // Setback terraces get a low parapet too.
  for (let i = 0; i < ts.length - 1; i++) ring(mb, footprint(b, ts[i], i === 0).pts, ts[i][3], ts[i][3] + 0.9, t);

  if (s.block && !s.roof) manila.unfinishedTop(mb, b, top, tw, td, tox, toz, s.wall, true);
  else if (!s.roof) {
    rooftop(mb, b, rnd, tw, td, top, tox, toz, ts.length === 1 ? b.cut : undefined);
    if (filipino()) manila.roofGear(mb, b, top, tw, td, tox, toz, true);
  }

  const mainTop = ts[0][3];
  const mainFloors = floorsTo(mainTop);
  const { p, r, n } = f;
  // The part of the street face clear of a corner cut.
  const [s0, s1] = frontSpan(b);
  const sw = s1 - s0;
  const at = (u: number, y: number, out: number): C3 => [p[0] + r[0] * u + n[0] * out, y, p[2] + r[2] * u + n[2] * out];

  if (s.type === WIN.balcony) {
    // Balconies on every upper floor of the front: slab, solid rail, unit dividers, an AC unit on some.
    const rail = rnd.chance(0.5) ? lin(0x9aa6ac) : scale3(s.trim, 0.8);
    const dividers = Math.max(1, Math.round(sw / (s.bay * 2)));
    for (let i = 0; i < mainFloors; i++) {
      const y = gf + i * FH;
      mb.kind = KIND.plain;
      mb.color = scale3(s.wall, 1.05);
      mb.frameBox(p, r, n, s0 + 0.15, s1 - 0.15, y - 0.16, y, 0, 1.15);
      mb.color = rail;
      mb.frameBox(p, r, n, s0 + 0.15, s1 - 0.15, y, y + 1.05, 1.08, 1.15);
      mb.color = scale3(s.wall, 0.9);
      for (let k = 1; k < dividers; k++) {
        const u = s0 + (sw * k) / dividers;
        mb.frameBox(p, r, n, u - 0.04, u + 0.04, y, y + 2.5, 0, 1.08);
      }
      if (rnd.chance(0.6)) {
        mb.color = lin(0xc8c4b8);
        const u = rnd.chance(0.5) ? s0 + 0.35 : s1 - 1.15;
        mb.frameBox(p, r, n, u, u + 0.8, y, y + 0.6, 0.55, 0.85);
      }
    }
  } else if (s.type === WIN.curtain) {
    // Vertical fins on the front and back at the shader's mullion positions.
    mb.kind = KIND.plain;
    mb.color = lin(0x2a2d31);
    const span = f.fw - 1;
    const nb = Math.max(1, Math.floor(span / s.bay));
    const bw = span / nb;
    const back = frontFrame({ ...b, front: b.front === 'north' ? 'south' : b.front === 'south' ? 'north' : b.front === 'east' ? 'west' : 'east' });
    for (const fr of mainTop > GF + 3 ? [f, back] : []) {
      for (let k = 0; k <= nb; k += 1) {
        const u = 0.5 + k * bw;
        if (fr === f && (u < s0 + 0.2 || u > s1 - 0.2)) continue;
        mb.frameBox(fr.p, fr.r, fr.n, u - 0.06, u + 0.06, GF, mainTop - 0.3, 0, 0.3);
      }
    }
  } else if (s.type === WIN.ribbon) {
    mb.kind = KIND.plain;
    mb.color = scale3(s.wall, 0.8);
    for (let i = 0; i < mainFloors; i++) {
      const y = gf + i * FH + 0.85;
      mb.frameBox(p, r, n, s0 + 0.2, s1 - 0.2, y, y + 0.1, 0, 0.14);
    }
  }

  if (filipino()) manila.front(mb, b, f, s0, s1, mainFloors, gf, FH, s.type, s.bay, s.ratio, s.winH, s.grille, !s.home && s.shopOpen, s.accent);

  // Storefront awning: a sloped canvas with a valance.
  if (s.awning && sw > 3) {
    mb.kind = KIND.plain;
    mb.color = s.accent;
    const u0 = s0 + 0.45;
    const len = sw - 0.9;
    const c = at(u0, 3.0, 0);
    const a: C3 = [r[0] * len, 0, r[2] * len];
    const slope: C3 = [n[0] * 1.3, -0.45, n[2] * 1.3];
    mb.quad(c, slope, a);
    mb.quad(c, a, slope);
    const e = at(u0, 2.25, 1.3);
    mb.quad(e, a, [0, 0.3, 0]);
  }

  // Wall-hung AC units and a drainpipe on a side wall.
  if (s.type !== WIN.balcony && s.type !== WIN.curtain && b.h > 7 && rnd.chance(0.6)) {
    const side = rnd.chance(0.5) ? 1 : -1;
    // Side face frame: origin at its left end seen from outside, right vector, normal = side * r.
    const sn: C3 = [r[0] * side, 0, r[2] * side];
    const sr: C3 = [sn[2], 0, -sn[0]];
    const ns = b.front === 'north' || b.front === 'south';
    const depth = ns ? b.d : b.w;
    const half = ns ? b.w / 2 : b.d / 2;
    const origin: C3 = [b.x + sn[0] * half - (sr[0] * depth) / 2, 0, b.z + sn[2] * half - (sr[2] * depth) / 2];
    mb.kind = KIND.plain;
    // Keep clear of a corner cut at either end of the side wall, and below any step-back.
    const pad = b.cut ? b.cut.size : 0;
    const units = rnd.int(1, Math.min(6, 1 + mainFloors));
    for (let i = 0; i < units; i++) {
      const fl = rnd.int(0, Math.max(0, mainFloors - 1));
      const y = gf + fl * FH + 0.3;
      const u = 0.6 + pad + rnd.float() * Math.max(0.1, depth - 1.8 - 2 * pad);
      mb.color = lin(rnd.pick([0xc8c4b8, 0xb8b8b4, 0xd0ccc0]));
      mb.frameBox(origin, sr, sn, u, u + 0.8, y, y + 0.6, 0.05, 0.35);
    }
    mb.color = lin(0x6a6a6a);
    const pu = rnd.float() < 0.5 ? 0.3 + pad : depth - 0.3 - pad;
    mb.frameBox(origin, sr, sn, pu - 0.05, pu + 0.05, 0.2, mainTop, 0, 0.1);
  }
}

const SHRUBS = [0x2e4a26, 0x3e5a2e, 0x4a6a34, 0x36522a];

/**
 * A pitched roof on a low home: the ridge runs along the street face, eaves overhanging 0.4 m, gable
 * ends in the wall's colour. Both windings of each slope are drawn (the eaves are seen from below).
 */
function pitchedRoof(mb: MeshBuilder, b: Building3, s: RealStyle, near: boolean): void {
  const ns = b.front === 'north' || b.front === 'south';
  const over = 0.4;
  const half = (ns ? b.d : b.w) / 2 + over;
  const len = (ns ? b.w : b.d) / 2 + over;
  // A shack's roof is nearly flat: a scrap sheet at a slight pitch, not a gable.
  // (A Filipino house's corrugated roof is low-pitched, about 12 degrees, not a Japanese gable.)
  const rise = s.informal ? Math.min(0.7, half * 0.26) : filipino() ? Math.min(1.0, half * 0.21) : Math.min(2.4, half * 0.55);
  const y0 = b.h;
  const y1 = b.h + rise;
  // P(a, c, y): a along the ridge, c across it (from the ridge), in world.
  const P = (a: number, c: number, y: number): C3 => (ns ? [b.x + a, y, b.z + c] : [b.x + c, y, b.z + a]);
  // Manila's roofs are not all gables: about a third are mono-pitch (a shed roof, one slope, high at the back or the
  // front) and a fifth hipped (four slopes, a short ridge): corrugated iron on each.
  if (filipino() && !s.informal) {
    const roll = rng(hash(b.id, 0x600f)).float();
    if (roll >= 0.45) {
      filipinoRoof(mb, b, s, ns, half, len, over, y0, Math.min(1.1, half * 0.24), roll >= 0.8 && len > half * 0.9, rng(hash(b.id, 0x600e)).chance(0.5), P);
      return;
    }
  }
  const slope = (side: number): void => {
    const e0 = P(-len, side * half, y0 - over * 0.4);
    const e1 = P(len, side * half, y0 - over * 0.4);
    const r0 = P(-len, 0, y1);
    const r1 = P(len, 0, y1);
    mb.kind = KIND.roof;
    mb.color = s.roof!;
    mb.poly4(e0, e1, r1, r0);
    mb.poly4(e1, e0, r0, r1);
  };
  slope(-1);
  slope(1);
  // Gables: the wall's colour, both windings.
  mb.kind = KIND.plain;
  mb.color = s.wall;
  const g = (ns ? b.w : b.d) / 2;
  for (const e of [-g, g]) {
    const a = P(e, -half + over, y0);
    const c = P(e, half - over, y0);
    const r = P(e, 0, y1 - 0.05);
    mb.poly4(a, c, r, r);
    mb.poly4(c, a, r, r);
  }
  if (filipino()) {
    manila.ironRoofRibs(mb, b, y0, y1, ns, half, len, near);
    manila.ironRoofGear(mb, b, y0, y1, ns, half, len, near);
  }
}

/**
 * A mono-pitch (a shed roof: one slope, its low edge at the front or the back, the end walls trapezoids) or a hipped
 * roof (four slopes up to a short ridge) of corrugated iron, for Manila's low homes. Both windings are drawn.
 */
function filipinoRoof(mb: MeshBuilder, b: Building3, s: RealStyle, ns: boolean, half: number, len: number, over: number, y0: number, rise: number, hip: boolean, lowFront: boolean, P: (a: number, c: number, y: number) => C3): void {
  const ye = y0 - over * 0.4;
  const quad = (a: C3, c: C3, d: C3, e: C3): void => {
    mb.kind = KIND.roof;
    mb.color = s.roof!;
    mb.poly4(a, c, d, e);
    mb.poly4(e, d, c, a);
  };
  if (hip) {
    const yr = y0 + rise;
    const ridge = Math.max(0.2, len - half);
    const a0 = -ridge;
    const a1 = ridge;
    quad(P(-len, -half, ye), P(len, -half, ye), P(a1, 0, yr), P(a0, 0, yr));
    quad(P(len, half, ye), P(-len, half, ye), P(a0, 0, yr), P(a1, 0, yr));
    quad(P(-len, half, ye), P(-len, -half, ye), P(a0, 0, yr), P(a0, 0, yr));
    quad(P(len, -half, ye), P(len, half, ye), P(a1, 0, yr), P(a1, 0, yr));
    return;
  }
  // The front side: the street's (c negative is north or west).
  const front = b.front === 'north' || b.front === 'west' ? -1 : 1;
  const low = lowFront ? front : -front;
  const yHi = y0 + rise * 1.5;
  quad(P(-len, low * half, ye), P(len, low * half, ye), P(len, -low * half, yHi), P(-len, -low * half, yHi));
  // The end walls, in the wall's colour: a trapezoid from the wall's low side up to the roof's height there.
  mb.kind = KIND.plain;
  mb.color = s.wall;
  const g = (ns ? b.w : b.d) / 2;
  const wl = half - over;
  const yAt = (c: number): number => ye + ((yHi - ye) * (c * -low + half)) / (2 * half);
  for (const e of [-g, g]) {
    const a = P(e, low * wl, y0);
    const c = P(e, -low * wl, y0);
    const d = P(e, -low * wl, yAt(-low * wl));
    const f = P(e, low * wl, yAt(low * wl));
    mb.poly4(a, c, d, f);
    mb.poly4(f, d, c, a);
  }
}

function rooftop(mb: MeshBuilder, b: Building3, rnd: Rng, w: number, d: number, top: number, ox = 0, oz = 0, cut?: Building3['cut']): void {
  const x0 = b.x + ox - w / 2 + 0.8;
  const z0 = b.z + oz - d / 2 + 0.8;
  const iw = w - 1.6;
  const id = d - 1.6;
  if (iw < 2 || id < 2) return;
  // Free spots on a coarse grid so items don't overlap (a cut corner counts as used).
  const used: [number, number, number, number][] = [];
  if (cut) {
    const cx = cut.corner[1] === 'w' ? x0 - 0.8 : x0 + iw + 0.8;
    const cz = cut.corner[0] === 'n' ? z0 - 0.8 : z0 + id + 0.8;
    used.push([cx, cz, cut.size * 2 + 1.6, cut.size * 2 + 1.6]);
  }
  // A roof garden on some (planted beds and low shrubs), from its own hash so the gear stays put.
  const green = rng(hash(b.id, 0x9ee7));
  if (b.hue === undefined && b.h >= 12 && iw >= 5 && id >= 5 && green.chance(0.14)) {
    const gw = iw * (0.4 + green.float() * 0.25);
    const gd = id * (0.4 + green.float() * 0.25);
    const gx = x0 + gw / 2 + green.float() * (iw - gw);
    const gz = z0 + gd / 2 + green.float() * (id - gd);
    if (!used.some(([ux, uz, uw, ud]) => Math.abs(ux - gx) < (uw + gw) / 2 && Math.abs(uz - gz) < (ud + gd) / 2)) {
      used.push([gx, gz, gw, gd]);
      mb.kind = KIND.plain;
      mb.color = lin(0x5a5650);
      mb.box(gx, gz, top, top + 0.35, gw, gd, KIND.plain);
      mb.kind = KIND.grass;
      mb.color = lin(0x3a5a2a);
      mb.box(gx, gz, top + 0.35, top + 0.4, gw - 0.3, gd - 0.3, KIND.grass);
      mb.kind = KIND.plain;
      const shrubs = Math.floor((gw * gd) / 6);
      for (let i = 0; i < shrubs; i++) {
        const sx = gx + (green.float() - 0.5) * (gw - 1);
        const sz = gz + (green.float() - 0.5) * (gd - 1);
        const r = 0.35 + green.float() * 0.35;
        mb.color = lin(SHRUBS[i % SHRUBS.length]);
        mb.lathe(sx, sz, [[top + 0.4, r * 0.6], [top + 0.4 + r * 0.8, r], [top + 0.4 + r * 1.6, 0.05]], 6);
      }
    }
  }
  const place = (sw: number, sd: number): [number, number] | null => {
    for (let tries = 0; tries < 6; tries++) {
      const cx = x0 + sw / 2 + rnd.float() * Math.max(0, iw - sw);
      const cz = z0 + sd / 2 + rnd.float() * Math.max(0, id - sd);
      if (used.some(([ux, uz, uw, ud]) => Math.abs(ux - cx) < (uw + sw) / 2 + 0.3 && Math.abs(uz - cz) < (ud + sd) / 2 + 0.3)) continue;
      if (sw > iw || sd > id) return null;
      used.push([cx, cz, sw, sd]);
      return [cx, cz];
    }
    return null;
  };
  mb.kind = KIND.plain;
  // Stair / lift housing.
  if (b.h >= 12 && rnd.chance(0.6)) {
    const q = place(2.6, 2.8);
    if (q) {
      mb.color = styleFor(b).wall;
      mb.box(q[0], q[1], top, top + 2.8, 2.6, 2.8);
      mb.color = lin(0x3a3a3c);
      mb.box(q[0], q[1], top + 2.8, top + 3.0, 2.8, 3.0);
    }
  }
  // Water tank on a steel stand.
  if (b.h >= 9 && rnd.chance(0.45)) {
    const rr = 0.9 + rnd.float() * 0.5;
    const q = place(rr * 2 + 0.4, rr * 2 + 0.4);
    if (q) {
      mb.color = lin(0x505458);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.box(q[0] + dx * rr * 0.7, q[1] + dz * rr * 0.7, top, top + 1.2, 0.1, 0.1);
      mb.box(q[0], q[1], top + 1.1, top + 1.25, rr * 2, rr * 2);
      mb.color = lin(rnd.pick([0xa8c4d4, 0xdcdcd4, 0xd4c8a8]));
      if (rnd.chance(0.5)) mb.cylinder(q[0], q[1], top + 1.25, top + 1.25 + 1.6 + rnd.float() * 0.8, rr, 10);
      else mb.box(q[0], q[1], top + 1.25, top + 2.9, rr * 1.8, rr * 1.8);
    }
  }
  // AC condensers.
  const acs = rnd.int(0, Math.min(5, Math.floor((iw * id) / 12)));
  for (let i = 0; i < acs; i++) {
    const q = place(1.0, 0.8);
    if (!q) break;
    mb.color = lin(rnd.pick([0xc8c4b8, 0xb4b4b0, 0x9a9c9e]));
    mb.box(q[0], q[1], top, top + 0.75, 0.9, 0.4);
  }
  // Antenna mast.
  if (rnd.chance(b.h > 40 ? 0.6 : 0.2)) {
    const q = place(0.6, 0.6);
    if (q) {
      mb.color = lin(0x6a6a6e);
      const hh = b.h > 40 ? 6 + rnd.float() * 14 : 2 + rnd.float() * 3;
      mb.box(q[0], q[1], top, top + hh, 0.12, 0.12);
      for (let k = 1; k <= 3; k++) mb.box(q[0], q[1], top + hh * (0.5 + k * 0.14), top + hh * (0.5 + k * 0.14) + 0.05, 1.2 - k * 0.25, 0.05);
      if (b.h > 40) {
        // Aircraft warning light.
        mb.kind = KIND.emit;
        mb.color = lin(0xff2a1a);
        mb.style = [EMIT.always, 0, 0, 0];
        mb.box(q[0], q[1], top + hh, top + hh + 0.25, 0.25, 0.25);
        mb.style = [0, 0, 0, 0];
        mb.kind = KIND.plain;
      }
    }
  }
}
