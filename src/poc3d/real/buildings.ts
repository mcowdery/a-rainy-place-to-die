import { hash, rng, type Rng } from '../../core/hash';
import { frontPoint, frontWidth, type Building3 } from '../district/plan';
import { EMIT, KIND, lin, scale3, type MeshBuilder } from './meshBuilder';

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

export interface RealStyle {
  readonly wall: C3;
  readonly trim: C3;
  readonly accent: C3;
  readonly type: number;
  readonly bay: number;
  readonly ratio: number;
  readonly winH: number;
  readonly shopOpen: boolean;
  /** 0 warm, 1 cool white, 2 colourful, 3 dim bar. */
  readonly shopPal: number;
  readonly flags: number;
  readonly parapet: number;
  readonly cornice: boolean;
  readonly awning: boolean;
}

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
  const type = stamp
    ? WIN.small
    : b.h >= 45
      ? weighted(rnd, [[45, WIN.curtain], [30, WIN.ribbon], [25, WIN.punched]])
      : b.h >= 15
        ? weighted(rnd, [[40, WIN.punched], [20, WIN.balcony], [25, WIN.ribbon], [5, WIN.curtain], [10, WIN.small]])
        : weighted(rnd, [[45, WIN.punched], [25, WIN.small], [15, WIN.ribbon], [15, WIN.balcony]]);
  let [, hexes, tiled] = weighted(rnd, PALETTES.map((p) => [p[0], p] as const));
  let wallHex = rnd.pick(hexes);
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
  const shopOpen = stamp || rnd.chance(0.8);
  const shopPal = stamp ? 3 : weighted(rnd, [[40, 0], [30, 1], [15, 2], [15, 3]]);
  const darkFrame = rnd.chance(0.4) || type === WIN.curtain;
  const litBias = rnd.int(0, 7);
  const flags = (shopOpen ? 1 : 0) + shopPal * 2 + (darkFrame ? 8 : 0) + litBias * 16 + (tiled ? 128 : 0);
  s = {
    wall: lin(wallHex),
    trim: lin(rnd.pick(TRIMS)),
    accent: stamp ? lin(b.hue!) : lin(rnd.pick(ACCENTS)),
    type,
    bay,
    ratio,
    winH,
    shopOpen,
    shopPal,
    flags,
    parapet: 0.6 + rnd.float() * 0.5,
    cornice: rnd.chance(0.3),
    awning: shopOpen && rnd.chance(0.35),
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

/** A building's tiers: [width, depth, bottom, top]; towers over 45 m step back once or twice. */
export function tiers(b: Building3): [number, number, number, number][] {
  if (b.h <= 45) return [[b.w, b.d, 0, b.h]];
  const rnd = rng(hash(b.id, 0x7135));
  const out: [number, number, number, number][] = [];
  const setbacks = rnd.int(1, 2);
  let y = 0;
  let k = 1;
  for (let t = 0; t <= setbacks; t++) {
    const top = t === setbacks ? b.h : y + (b.h - y) * (0.55 + rnd.float() * 0.25);
    out.push([b.w * k, b.d * k, y, top]);
    y = top;
    k *= 0.66 + rnd.float() * 0.16;
  }
  return out;
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
  for (const [w, d, y0, y1] of ts) {
    const floors = Math.max(0, Math.floor((y1 - GF - 0.5) / FH));
    mb.kind = KIND.wall;
    mb.color = s.wall;
    mb.style = [s.bay, s.ratio, s.winH, s.type + 8 * floors];
    mb.box(b.x, b.z, y0, y1, w, d);
  }
  mb.frontNormal = null;
  mb.style = [0, 0, 0, 0];
  if (!near) return;

  const [tw, td, , top] = ts[ts.length - 1];
  // Parapet (and sometimes a cornice band just below it).
  mb.kind = KIND.plain;
  mb.color = s.trim;
  const ph = s.parapet;
  const t = 0.2;
  mb.box(b.x, b.z - td / 2 + t / 2, top, top + ph, tw, t);
  mb.box(b.x, b.z + td / 2 - t / 2, top, top + ph, tw, t);
  mb.box(b.x - tw / 2 + t / 2, b.z, top, top + ph, t, td - 2 * t);
  mb.box(b.x + tw / 2 - t / 2, b.z, top, top + ph, t, td - 2 * t);
  if (s.cornice) mb.box(b.x, b.z, top - 0.45, top - 0.1, tw + 0.3, td + 0.3);
  // Setback terraces get a low parapet too.
  for (let i = 0; i < ts.length - 1; i++) {
    const [w, d, , y] = ts[i];
    mb.box(b.x, b.z - d / 2 + t / 2, y, y + 0.9, w, t);
    mb.box(b.x, b.z + d / 2 - t / 2, y, y + 0.9, w, t);
  }

  rooftop(mb, b, rnd, tw, td, top);

  const floors = Math.max(0, Math.floor((b.h - GF - 0.5) / FH));
  const mainTop = ts[0][3];
  const mainFloors = Math.max(0, Math.floor((mainTop - GF - 0.5) / FH));
  const { p, r, n, fw } = f;
  const at = (u: number, y: number, out: number): C3 => [p[0] + r[0] * u + n[0] * out, y, p[2] + r[2] * u + n[2] * out];

  if (s.type === WIN.balcony) {
    // Balconies on every upper floor of the front: slab, solid rail, unit dividers, an AC unit on some.
    const rail = rnd.chance(0.5) ? lin(0x9aa6ac) : scale3(s.trim, 0.8);
    const dividers = Math.max(1, Math.round(fw / (s.bay * 2)));
    for (let i = 0; i < Math.min(floors, mainFloors); i++) {
      const y = GF + i * FH;
      mb.kind = KIND.plain;
      mb.color = scale3(s.wall, 1.05);
      mb.frameBox(p, r, n, 0.15, fw - 0.15, y - 0.16, y, 0, 1.15);
      mb.color = rail;
      mb.frameBox(p, r, n, 0.15, fw - 0.15, y, y + 1.05, 1.08, 1.15);
      mb.color = scale3(s.wall, 0.9);
      for (let k = 1; k < dividers; k++) {
        const u = (fw * k) / dividers;
        mb.frameBox(p, r, n, u - 0.04, u + 0.04, y, y + 2.5, 0, 1.08);
      }
      if (rnd.chance(0.6)) {
        mb.color = lin(0xc8c4b8);
        const u = rnd.chance(0.5) ? 0.35 : fw - 1.15;
        mb.frameBox(p, r, n, u, u + 0.8, y, y + 0.6, 0.55, 0.85);
      }
    }
  } else if (s.type === WIN.curtain) {
    // Vertical fins on the front and back at the shader's mullion positions.
    mb.kind = KIND.plain;
    mb.color = lin(0x2a2d31);
    const span = fw - 1;
    const nb = Math.max(1, Math.floor(span / s.bay));
    const bw = span / nb;
    const back = frontFrame({ ...b, front: b.front === 'north' ? 'south' : b.front === 'south' ? 'north' : b.front === 'east' ? 'west' : 'east' });
    for (const fr of mainTop > GF + 3 ? [f, back] : []) {
      for (let k = 0; k <= nb; k += 1) {
        const u = 0.5 + k * bw;
        mb.frameBox(fr.p, fr.r, fr.n, u - 0.06, u + 0.06, GF, mainTop - 0.3, 0, 0.3);
      }
    }
  } else if (s.type === WIN.ribbon) {
    mb.kind = KIND.plain;
    mb.color = scale3(s.wall, 0.8);
    for (let i = 0; i < mainFloors; i++) {
      const y = GF + i * FH + 0.85;
      mb.frameBox(p, r, n, 0.2, fw - 0.2, y, y + 0.1, 0, 0.14);
    }
  }

  // Storefront awning: a sloped canvas with a valance.
  if (s.awning && fw > 3) {
    mb.kind = KIND.plain;
    mb.color = s.accent;
    const u0 = 0.45;
    const len = fw - 0.9;
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
    const units = rnd.int(1, Math.min(6, 1 + floors));
    for (let i = 0; i < units; i++) {
      const fl = rnd.int(0, Math.max(0, floors - 1));
      const y = GF + fl * FH + 0.3;
      const u = 0.6 + rnd.float() * Math.max(0.1, depth - 1.8);
      mb.color = lin(rnd.pick([0xc8c4b8, 0xb8b8b4, 0xd0ccc0]));
      mb.frameBox(origin, sr, sn, u, u + 0.8, y, y + 0.6, 0.05, 0.35);
    }
    mb.color = lin(0x6a6a6a);
    const pu = rnd.float() < 0.5 ? 0.3 : depth - 0.3;
    mb.frameBox(origin, sr, sn, pu - 0.05, pu + 0.05, 0.2, b.h, 0, 0.1);
  }
}

function rooftop(mb: MeshBuilder, b: Building3, rnd: Rng, w: number, d: number, top: number): void {
  const x0 = b.x - w / 2 + 0.8;
  const z0 = b.z - d / 2 + 0.8;
  const iw = w - 1.6;
  const id = d - 1.6;
  if (iw < 2 || id < 2) return;
  // Free spots on a coarse grid so items don't overlap.
  const used: [number, number, number, number][] = [];
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
