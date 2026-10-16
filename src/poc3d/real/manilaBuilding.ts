import { hash, rng, type Rng } from '../../core/hash';
import type { Building3 } from '../district/plan';
import { KIND, lin, scale3, type MeshBuilder } from './meshBuilder';

/**
 * Manila's buildings (buildings.ts calls these only when the city is Filipino, `CityConfig.filipino`): hollow-block
 * houses with the top floor left unfinished (rebar standing out of the roof columns), corrugated iron roofs weighted
 * with tyres and stones, water tanks and laundry on the roofs, grilles over windows and balconies, iron canopies over
 * the shops, and the Spanish-colonial church's bell-tower. Pure functions of the building: its id seeds each.
 */

type C3 = [number, number, number];
/** A building's street face: origin (its left end at ground level), right vector, outward normal, width. */
export interface Face { p: C3; r: C3; n: C3; fw: number }

const GRILLES = [0x2a2a2c, 0x5a2a22, 0xd8d8d0, 0x2f5a4a, 0x3a4a6a];
const LAUNDRY = [0xd8d4c8, 0xb8363a, 0x2f6ab0, 0xe0b830, 0x3a8a5a, 0xe8e8e0, 0xd86a9a, 0x2a2a30];
const TANKS = [0x2a5a9a, 0x2a2a2e, 0x3a6a4a, 0x9a9a94];
const IRON_RUST = 0x7a4a2a;

/** A flat quad drawn from both sides (cloth, sheet iron). */
function two(mb: MeshBuilder, c: C3, a: C3, b: C3): void {
  mb.quad(c, a, b);
  mb.quad(c, b, a);
}

/**
 * A flat bar on a facade (a grille's or a cage's), one front-facing quad (2 triangles) where a box was 10-12: they are
 * 1-5 cm across and seen from the street (the frame-rate pass of 2026-10-09; the sides are never in sight).
 */
function bar(mb: MeshBuilder, p: C3, r: C3, n: C3, u0: number, u1: number, y0: number, y1: number, out: number): void {
  mb.quad([p[0] + r[0] * u0 + n[0] * out, y0, p[2] + r[2] * u0 + n[2] * out], [r[0] * (u1 - u0), 0, r[2] * (u1 - u0)], [0, y1 - y0, 0]);
}

/** Laundry hung on a line from a to b (both at the same height): a few shirts and sheets, coloured. */
function laundry(mb: MeshBuilder, a: C3, b: C3, rnd: Rng, drop = 0.7): void {
  mb.kind = KIND.plain;
  mb.color = lin(0x4a4a48);
  mb.beam(a, b, 0.008);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const ux = (b[0] - a[0]) / (len || 1);
  const uz = (b[2] - a[2]) / (len || 1);
  for (let t = 0.2 + rnd.float() * 0.2; t < len - 0.3; t += 0.45 + rnd.float() * 0.35) {
    const w = 0.3 + rnd.float() * 0.3;
    if (t + w > len - 0.05) break;
    mb.color = lin(rnd.pick(LAUNDRY));
    const h = drop * (0.55 + rnd.float() * 0.5);
    two(mb, [a[0] + ux * t, a[1] - h, a[2] + uz * t], [ux * w, 0, uz * w], [0, h, 0]);
  }
}

/** A corrugated iron sheet's ribs: beams from e (along the slope) up to r, every `gap` m along the ridge direction. */
function ribs(mb: MeshBuilder, e0: C3, e1: C3, r0: C3, gap: number, t: number): void {
  const len = Math.hypot(e1[0] - e0[0], e1[2] - e0[2]);
  const k = Math.max(1, Math.min(12, Math.round(len / gap)));
  for (let i = 0; i <= k; i++) {
    const f = i / k;
    const lerp = (a: C3, b: C3): C3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    const a = lerp(e0, e1);
    const b: C3 = [r0[0] + (e1[0] - e0[0]) * f, r0[1], r0[2] + (e1[2] - e0[2]) * f];
    mb.beam([a[0], a[1] + 0.01, a[2]], [b[0], b[1] + 0.01, b[2]], t);
  }
}

/** Tyres and stones on a pitched roof's slope, so the wind doesn't take the sheets. */
export function ironRoofGear(mb: MeshBuilder, b: Building3, y0: number, y1: number, ns: boolean, half: number, len: number, near: boolean): void {
  if (!near) return;
  const rnd = rng(hash(b.id, 0x71e5));
  const P = (a: number, c: number, y: number): C3 => (ns ? [b.x + a, y, b.z + c] : [b.x + c, y, b.z + a]);
  const ye = y0 - 0.16;
  const yAt = (c: number): number => y1 - (y1 - ye) * (Math.abs(c) / half);
  const n = rnd.int(3, 7);
  for (let i = 0; i < n; i++) {
    const a = (rnd.float() * 2 - 1) * (len - 0.6);
    const c = (rnd.chance(0.5) ? 1 : -1) * (0.4 + rnd.float() * (half - 0.9));
    const p = P(a, c, yAt(c));
    if (rnd.chance(0.55)) {
      mb.color = lin(0x1a1a1c);
      mb.cylinder(p[0], p[2], p[1], p[1] + 0.16, 0.3, 8);
      mb.color = lin(0x2a2a2c);
      mb.cylinder(p[0], p[2], p[1] + 0.16, p[1] + 0.18, 0.14, 6);
    } else {
      mb.color = lin(rnd.pick([0x8a8a84, 0x6a6a66, 0x9a948a]));
      mb.lathe(p[0], p[2], [[p[1], 0.22], [p[1] + 0.12, 0.2], [p[1] + 0.2, 0.08]], 5);
    }
  }
  // A board along the ridge, and on some a pair of laundry lines or a little dish.
  if (rnd.chance(0.35)) {
    const q = P((rnd.float() * 2 - 1) * (len * 0.5), 0, y1);
    mb.color = lin(0xc8c4b8);
    mb.lathe(q[0], q[2], [[q[1], 0.05], [q[1] + 0.5, 0.05], [q[1] + 0.62, 0.4]], 8);
  }
}

/** Ribs on a pitched roof's two slopes (same geometry as buildings.ts pitchedRoof's). */
export function ironRoofRibs(mb: MeshBuilder, b: Building3, y0: number, y1: number, ns: boolean, half: number, len: number, near: boolean): void {
  if (!near) return;
  const over = 0.4;
  const P = (a: number, c: number, y: number): C3 => (ns ? [b.x + a, y, b.z + c] : [b.x + c, y, b.z + a]);
  mb.kind = KIND.plain;
  mb.color = lin(0x5a5a58);
  for (const side of [-1, 1]) {
    const e0 = P(-len, side * half, y0 - over * 0.4);
    const e1 = P(len, side * half, y0 - over * 0.4);
    const r0 = P(-len, 0, y1);
    ribs(mb, e0, e1, r0, 1.2, 0.012);
  }
  // The ridge cap.
  mb.color = lin(0x6a6a68);
  mb.beam(P(-len, 0, y1 + 0.02), P(len, 0, y1 + 0.02), 0.05);
}

/**
 * The unfinished top of a hollow-block house with a flat roof: concrete columns with rebar sticking up from them,
 * a half-built block wall, a corrugated lean-to weighed with tyres, a blue water drum, a clothes line.
 */
export function unfinishedTop(mb: MeshBuilder, b: Building3, top: number, w: number, d: number, ox: number, oz: number, wall: C3, near: boolean): void {
  const rnd = rng(hash(b.id, 0xfa11));
  const x0 = b.x + ox - w / 2;
  const z0 = b.z + oz - d / 2;
  const x1 = x0 + w;
  const z1 = z0 + d;
  mb.kind = KIND.plain;
  // A low stub wall round the edge: block, part of it, as high as the mason got.
  mb.color = scale3(wall, 0.95);
  const stub = 0.25 + rnd.float() * 0.2;
  const sideRun = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const upTo = len * (0.45 + rnd.float() * 0.55);
    const cx = ax + ((bx - ax) / len) * upTo / 2;
    const cz = az + ((bz - az) / len) * upTo / 2;
    const horiz = Math.abs(bx - ax) > Math.abs(bz - az);
    mb.box(cx, cz, top, top + stub + (rnd.chance(0.4) ? 0.9 : 0), horiz ? upTo : 0.15, horiz ? 0.15 : upTo);
  };
  sideRun(x0 + 0.1, z0 + 0.1, x1 - 0.1, z0 + 0.1);
  sideRun(x0 + 0.1, z1 - 0.1, x1 - 0.1, z1 - 0.1);
  sideRun(x0 + 0.1, z0 + 0.1, x0 + 0.1, z1 - 0.1);
  sideRun(x1 - 0.1, z0 + 0.1, x1 - 0.1, z1 - 0.1);
  // Columns at the corners and along the long sides: a concrete stub, then rebar bent a little, rusty.
  const cols: [number, number][] = [[x0 + 0.2, z0 + 0.2], [x1 - 0.2, z0 + 0.2], [x0 + 0.2, z1 - 0.2], [x1 - 0.2, z1 - 0.2]];
  const longX = w >= d;
  const extra = Math.floor((longX ? w : d) / 3.5);
  for (let i = 1; i <= extra; i++) {
    const f = i / (extra + 1);
    if (longX) cols.push([x0 + w * f, z0 + 0.2], [x0 + w * f, z1 - 0.2]);
    else cols.push([x0 + 0.2, z0 + d * f], [x1 - 0.2, z0 + d * f]);
  }
  for (const [cx, cz] of cols) {
    mb.color = lin(0x8a8a84);
    mb.box(cx, cz, top, top + 0.55, 0.22, 0.22);
    if (!near) continue;
    mb.color = lin(rnd.chance(0.5) ? IRON_RUST : 0x5a3a2a);
    const lean = (rnd.float() - 0.5) * 0.25;
    // (Two bars of the four are drawn, thicker; every random draw is still made so the roof's other gear is as it was.)
    [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]].forEach(([dx, dz], bi) => {
      const hh = 0.9 + rnd.float() * 0.7;
      const ex = cx + dx + lean * (rnd.float() - 0.3);
      const ez = cz + dz + lean * (rnd.float() - 0.3);
      if (bi === 0 || bi === 3) mb.beam([cx + dx, top + 0.5, cz + dz], [ex, top + 0.5 + hh, ez], 0.017);
    });
  }
  if (!near) return;
  const room = (w - 1.2) * (d - 1.2);
  // A corrugated lean-to over part of the roof, on posts, weighed with tyres.
  if (room > 12 && rnd.chance(0.55)) {
    const sw = Math.min(w - 1.4, 2.5 + rnd.float() * 2.5);
    const sd = Math.min(d - 1.4, 2.2 + rnd.float() * 1.5);
    const cx = x0 + 0.7 + sw / 2 + rnd.float() * Math.max(0, w - 1.4 - sw);
    const cz = z0 + 0.7 + sd / 2 + rnd.float() * Math.max(0, d - 1.4 - sd);
    mb.color = lin(0x5a5a58);
    for (const [dx, dz, h] of [[-1, -1, 2.3], [1, -1, 2.3], [-1, 1, 1.9], [1, 1, 1.9]]) mb.beam([cx + dx * sw / 2, top, cz + dz * sd / 2], [cx + dx * sw / 2, top + h, cz + dz * sd / 2], 0.03);
    mb.color = lin(rnd.pick([0x8c8e8c, 0x8a5a3c, 0x7a7c7c, 0x6a3a28]));
    two(mb, [cx - sw / 2 - 0.1, top + 2.3, cz - sd / 2 - 0.1], [sw + 0.2, 0, 0], [0, -0.4, sd + 0.2]);
    mb.color = lin(0x5a5a58);
    ribs(mb, [cx - sw / 2 - 0.1, top + 2.31, cz - sd / 2 - 0.1], [cx + sw / 2 + 0.1, top + 2.31, cz - sd / 2 - 0.1], [cx - sw / 2 - 0.1, top + 1.91, cz + sd / 2 + 0.1], 0.8, 0.012);
    mb.color = lin(0x1a1a1c);
    for (let i = 0; i < 3; i++) mb.cylinder(cx - sw / 2 + (sw * (i + 0.5)) / 3, cz - sd / 2 + sd * 0.35, top + 2.2, top + 2.36, 0.28, 8);
  }
  // A water drum or tank on a stand.
  if (rnd.chance(0.55)) {
    const cx = x0 + 0.7 + rnd.float() * (w - 1.4);
    const cz = z0 + 0.7 + rnd.float() * (d - 1.4);
    mb.color = lin(0x5a5a58);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mb.beam([cx + dx * 0.4, top, cz + dz * 0.4], [cx + dx * 0.4, top + 1.1, cz + dz * 0.4], 0.03);
    mb.color = lin(rnd.pick(TANKS));
    mb.cylinder(cx, cz, top + 1.1, top + 2.1, 0.5, 10);
    mb.color = lin(0x1a1a1a);
    mb.cylinder(cx, cz, top + 2.1, top + 2.2, 0.18, 6);
  }
  // A clothes line from column to column.
  if (rnd.chance(0.6)) {
    const y = top + 1.7;
    if (longX) laundry(mb, [x0 + 0.5, y, z0 + d * 0.5], [x1 - 0.5, y, z0 + d * 0.5], rnd);
    else laundry(mb, [x0 + w * 0.5, y, z0 + 0.5], [x0 + w * 0.5, y, z1 - 0.5], rnd);
  }
}

/** Gear on the roofs of the other low flat-roofed buildings: a blue tank, a line of washing. */
export function roofGear(mb: MeshBuilder, b: Building3, top: number, w: number, d: number, ox: number, oz: number, near: boolean): void {
  if (!near || b.h > 30 || w < 5 || d < 5) return;
  const rnd = rng(hash(b.id, 0xfa12));
  const x0 = b.x + ox - w / 2;
  const z0 = b.z + oz - d / 2;
  if (rnd.chance(0.5)) laundry(mb, [x0 + 0.6, top + 1.8, z0 + 0.8 + rnd.float() * (d - 1.6)], [x0 + w - 0.6, top + 1.8, z0 + 0.8 + rnd.float() * (d - 1.6)].map((v, i) => (i === 2 ? z0 + d * 0.5 : v)) as C3, rnd);
  if (rnd.chance(0.35)) {
    const cx = x0 + 1 + rnd.float() * (w - 2);
    const cz = z0 + 1 + rnd.float() * (d - 2);
    mb.kind = KIND.plain;
    mb.color = lin(rnd.pick(TANKS));
    mb.cylinder(cx, cz, top, top + 1.1, 0.45, 9);
  }
}

/**
 * The front's ironwork (near only): window grilles over the punched windows, caged balconies with their washing,
 * and a corrugated canopy over a shop. `floors` are the main tier's; gf its ground floor; bay, ratio, winH the
 * shader's window layout (city.ts: margin 0.5, nb = floor((fw - 1) / bay), the window centred in its bay).
 */
export function front(mb: MeshBuilder, b: Building3, f: Face, s0: number, s1: number, floors: number, gf: number, FH: number, type: number, bay: number, ratio: number, winH: number, grille: boolean, shop: boolean, awningColour: C3): void {
  const rnd = rng(hash(b.id, 0xfa13));
  const { p, r, n } = f;
  const at = (u: number, y: number, out: number): C3 => [p[0] + r[0] * u + n[0] * out, y, p[2] + r[2] * u + n[2] * out];
  const metal = lin(rnd.pick(GRILLES));
  const sw = s1 - s0;
  mb.kind = KIND.plain;
  if (type === 0 && grille && floors > 0) {
    const span = f.fw - 1;
    const nb = Math.max(1, Math.floor(span / bay));
    const bw = span / nb;
    const ww = bw * ratio;
    for (let fl = 0; fl < floors; fl++) {
      const y0 = gf + fl * FH + 0.9;
      const y1 = gf + fl * FH + Math.min(0.9 + winH, FH - 0.35);
      for (let k = 0; k < nb; k++) {
        const uc = 0.5 + (k + 0.5) * bw;
        if (uc - ww / 2 < s0 + 0.1 || uc + ww / 2 > s1 - 0.1) continue;
        mb.color = metal;
        const u0 = uc - ww / 2 - 0.04;
        const u1 = uc + ww / 2 + 0.04;
        bar(mb, p, r, n, u0, u1, y0 - 0.04, y0 + 0.02, 0.16);
        bar(mb, p, r, n, u0, u1, y1 - 0.02, y1 + 0.04, 0.16);
        bar(mb, p, r, n, u0, u0 + 0.05, y0, y1, 0.16);
        bar(mb, p, r, n, u1 - 0.05, u1, y0, y1, 0.16);
        bar(mb, p, r, n, uc - 0.02, uc + 0.02, y0, y1, 0.16);
        bar(mb, p, r, n, u0, u1, (y0 + y1) / 2 - 0.02, (y0 + y1) / 2 + 0.02, 0.16);
        // Washing hung from the grille or an AC unit beside it.
        if (rnd.chance(0.12)) {
          mb.color = lin(rnd.pick(LAUNDRY));
          const x = at(uc - ww / 2, y1 - 0.1, 0.3);
          two(mb, x, [r[0] * 0.5, 0, r[2] * 0.5], [0, -0.8, 0]);
        }
      }
    }
  }
  if (type === 3 && floors > 0) {
    // Caged balconies: a grille from the rail to the slab above, and washing on a line in some.
    for (let fl = 0; fl < floors; fl++) {
      const y = gf + fl * FH;
      mb.color = metal;
      if (rnd.chance(0.65)) {
        bar(mb, p, r, n, s0 + 0.15, s1 - 0.15, y + 2.15, y + 2.22, 1.15);
        const k = Math.max(2, Math.round(sw / 0.5));
        for (let i = 0; i <= k; i++) {
          const u = s0 + 0.15 + ((sw - 0.3) * i) / k;
          bar(mb, p, r, n, u - 0.012, u + 0.012, y + 1.05, y + 2.2, 1.13);
        }
      }
      if (rnd.chance(0.5)) laundry(mb, at(s0 + 0.5, y + 1.95, 0.9), at(s1 - 0.5, y + 1.95, 0.9), rnd, 0.9);
    }
  }
  // A corrugated iron canopy over the shop front, on two chains or arms.
  if (shop && sw > 3 && rnd.chance(0.5)) {
    mb.color = lin(rnd.pick([0x8c8e8c, 0x7a4a2a, 0x6a6e72, awningColour[0] > 0.2 ? 0x9a3a2a : 0x3e5a48]));
    const c = at(s0 + 0.2, 3.1, 0);
    const a: C3 = [r[0] * (sw - 0.4), 0, r[2] * (sw - 0.4)];
    const slope: C3 = [n[0] * 1.5, -0.35, n[2] * 1.5];
    two(mb, c, slope, a);
    mb.color = lin(0x5a5a58);
    ribs(mb, c, [c[0] + a[0], c[1], c[2] + a[2]], [c[0] + slope[0], c[1] + slope[1], c[2] + slope[2]], 0.8, 0.012);
    for (const u of [s0 + 0.3, s1 - 0.3]) mb.beam(at(u, 3.1, 0.05), at(u, 2.75, 1.45), 0.015);
  }
}

/**
 * A Spanish-colonial church's mass: a bell-tower at the front's left end with a belfry of pointed arches under a
 * hipped roof and a cross, and (near) a pediment over the front with pilasters, buttresses down the side and a great
 * door. The building itself is the nave.
 */
export function churchMass(mb: MeshBuilder, b: Building3, f: Face, s0: number, s1: number, top: number, stone: C3, near: boolean): void {
  const { p, r, n } = f;
  const at = (u: number, y: number, out: number): C3 => [p[0] + r[0] * u + n[0] * out, y, p[2] + r[2] * u + n[2] * out];
  const tw = Math.min(4.6, (s1 - s0) * 0.4);
  const u0 = s0 + 0.5;
  const u1 = u0 + tw;
  const h = top + 13;
  mb.kind = KIND.plain;
  mb.color = scale3(stone, 1.05);
  mb.frameBox(p, r, n, u0, u1, 0, h, -tw, 0.3);
  // Bands marking the stages, a darker stone base.
  mb.color = scale3(stone, 0.8);
  mb.frameBox(p, r, n, u0 - 0.08, u1 + 0.08, 0, 1.0, -tw - 0.08, 0.38);
  mb.color = scale3(stone, 1.25);
  for (const y of [top + 0.2, top + 5.5, h - 0.4]) mb.frameBox(p, r, n, u0 - 0.15, u1 + 0.15, y, y + 0.35, -tw - 0.15, 0.45);
  if (near) {
    // Pointed arched openings in the belfry on the front and the street side faces, with a dark inside.
    mb.color = lin(0x1a1816);
    const bell = top + 7.4;
    const arch = (u: number, out: number, al: C3): void => {
      const w = 0.9;
      const c = [p[0] + r[0] * u + n[0] * out, bell, p[2] + r[2] * u + n[2] * out] as C3;
      const a: C3 = [al[0] * w, 0, al[2] * w];
      const l: C3 = [c[0] - a[0] / 2, c[1], c[2] - a[2] / 2];
      mb.poly4(l, [l[0] + a[0], l[1], l[2] + a[2]], [l[0] + a[0], l[1] + 2.0, l[2] + a[2]], [l[0], l[1] + 2.0, l[2]]);
      mb.poly4([l[0] + a[0], l[1], l[2] + a[2]], l, [l[0], l[1] + 2.0, l[2]], [l[0] + a[0], l[1] + 2.0, l[2] + a[2]]);
      const apex: C3 = [c[0], c[1] + 3.0, c[2]];
      mb.poly4([l[0], l[1] + 2.0, l[2]], [l[0] + a[0], l[1] + 2.0, l[2] + a[2]], apex, apex);
      mb.poly4([l[0] + a[0], l[1] + 2.0, l[2] + a[2]], [l[0], l[1] + 2.0, l[2]], apex, apex);
    };
    arch((u0 + u1) / 2, 0.32, r);
    arch(u0 - 0.1, -tw / 2, [-n[0], 0, -n[2]]);
    arch(u1 + 0.1, -tw / 2, [n[0], 0, n[2]]);
  }
  // The hipped roof and the cross.
  mb.color = lin(0x5a4a40);
  const c0 = at(u0 - 0.2, h, 0.5);
  const c1 = at(u1 + 0.2, h, 0.5);
  const c2 = at(u1 + 0.2, h, -tw - 0.2);
  const c3 = at(u0 - 0.2, h, -tw - 0.2);
  const apex = at((u0 + u1) / 2, h + 4.2, -tw / 2);
  mb.poly4(c0, c1, apex, apex);
  mb.poly4(c1, c0, apex, apex);
  mb.poly4(c1, c2, apex, apex);
  mb.poly4(c2, c1, apex, apex);
  mb.poly4(c2, c3, apex, apex);
  mb.poly4(c3, c2, apex, apex);
  mb.poly4(c3, c0, apex, apex);
  mb.poly4(c0, c3, apex, apex);
  mb.color = lin(0x2a2a2c);
  mb.beam(apex, [apex[0], apex[1] + 1.6, apex[2]], 0.05);
  mb.beam([apex[0] - r[0] * 0.4, apex[1] + 1.2, apex[2] - r[2] * 0.4], [apex[0] + r[0] * 0.4, apex[1] + 1.2, apex[2] + r[2] * 0.4], 0.05);
  if (!near) return;
  // The pediment over the rest of the front, pilasters, and the great arched door.
  const pu0 = u1 + 0.4;
  const pu1 = s1 - 0.3;
  if (pu1 - pu0 > 4) {
    mb.color = scale3(stone, 1.1);
    const ped = [at(pu0, top, 0.2), at(pu1, top, 0.2), at((pu0 + pu1) / 2, top + 3.4, 0.2)];
    mb.poly4(ped[0], ped[1], ped[2], ped[2]);
    mb.poly4(ped[1], ped[0], ped[2], ped[2]);
    mb.color = scale3(stone, 1.3);
    const k = Math.max(2, Math.round((pu1 - pu0) / 3.2));
    for (let i = 0; i <= k; i++) {
      const u = pu0 + ((pu1 - pu0) * i) / k;
      mb.frameBox(p, r, n, u - 0.22, u + 0.22, 0, top + 0.3, 0, 0.3);
    }
    mb.color = lin(0x3a2a20);
    const dm = (pu0 + pu1) / 2;
    mb.frameBox(p, r, n, dm - 1.0, dm + 1.0, 0, 3.0, 0, 0.12);
    const apx = at(dm, 4.2, 0.13);
    mb.poly4(at(dm - 1.0, 3.0, 0.13), at(dm + 1.0, 3.0, 0.13), apx, apx);
    mb.poly4(at(dm + 1.0, 3.0, 0.13), at(dm - 1.0, 3.0, 0.13), apx, apx);
  }
  // Buttresses on the side walls.
  mb.color = scale3(stone, 0.9);
  const depth = Math.abs(n[0]) > 0.5 ? b.w : b.d;
  for (let t = 3; t < depth - 2; t += 4.5) {
    for (const u of [s0 - 0.0, s1 + 0.0]) {
      const side = u === s0 ? -1 : 1;
      mb.frameBox(p, r, n, u + side * 0.0 - (side < 0 ? 0.5 : 0), u + (side > 0 ? 0.5 : 0), 0, top - 0.6, -t - 0.3, -t + 0.3);
    }
  }
}
