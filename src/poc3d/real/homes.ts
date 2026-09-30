import * as THREE from 'three';
import type { Rect } from '../../core/coords';
import type { Building3 } from '../district/plan';
import { Draw, type C3 } from './interiorDraw';
import type { Interior } from './interiors';
import { Kit, text } from './kit';
import { localFrame, localRect, toLocal, type LocalFrame } from './localFrame';
import { EMIT } from './meshBuilder';

/**
 * Homes: flats you can walk into, set inside their buildings at their true positions (the interiors' hybrid
 * approach, real/interiors.ts), so their windows and balconies look out on the real street. A flat is a box in the
 * building's local frame (u along the street face, t inward) on one storey: its outer walls (with windows and a
 * balcony door), partitions, the furniture that blocks, and a balcony outside one wall. The building's exterior
 * stays (its faces are one-sided, so from inside a block you see only the flat's own walls).
 *
 * `homeLayout` is the pure half (collision, floor, what counts as inside), for tests too; `homeInterior` builds the
 * shell and hands a `Home` (furniture helpers over interiorDraw's Draw) to the flat's own furnishing.
 */

type R4 = readonly [number, number, number, number];
export type Side = 't0' | 't1' | 'u0' | 'u1';

export interface HomePlan {
  /** The flat inside its outer walls: [u0, u1, t0, t1]. */
  readonly box: R4;
  /** Floor height and ceiling height above it. */
  readonly y: number;
  readonly h: number;
  /** Partitions (full height; doorways are gaps), and the furniture that blocks. */
  readonly walls: readonly R4[];
  readonly solids: readonly R4[];
  /** Openings in the outer walls (a, b along the wall; y0, y1 above the floor), glazed. */
  readonly windows: readonly { readonly side: Side; readonly a: number; readonly b: number; readonly y0: number; readonly y1: number }[];
  /** A balcony outside one of the t walls: its span, depth, and the glass door onto it (the open half walkable). */
  readonly balcony?: { readonly side: 't0' | 't1'; readonly a: number; readonly b: number; readonly depth: number; readonly glass: readonly [number, number]; readonly open: readonly [number, number] };
  /** The flat's front door in its outer wall (drawn shut; you leave by its node). */
  readonly door: { readonly side: Side; readonly a: number; readonly b: number };
}

const WALL = 0.12;

/** The outer walls' rects, with the balcony's open doorway left out. */
function outerRects(p: HomePlan): R4[] {
  const [u0, u1, t0, t1] = p.box;
  const gap = (side: Side): readonly [number, number] | null => (p.balcony?.side === side ? p.balcony.open : null);
  const along = (side: Side, a0: number, a1: number, rect: (a: number, b: number) => R4): R4[] => {
    const g = gap(side);
    return g ? [rect(a0, g[0]), rect(g[1], a1)] : [rect(a0, a1)];
  };
  return [
    ...along('t0', u0 - WALL, u1 + WALL, (a, b) => [a, b, t0 - WALL, t0]),
    ...along('t1', u0 - WALL, u1 + WALL, (a, b) => [a, b, t1, t1 + WALL]),
    [u0 - WALL, u0, t0, t1],
    [u1, u1 + WALL, t0, t1],
  ];
}

function balconyRects(p: HomePlan): { floor: R4 | null; rails: R4[] } {
  const bal = p.balcony;
  if (!bal) return { floor: null, rails: [] };
  const [, , t0, t1] = p.box;
  const [n0, n1] = bal.side === 't0' ? [t0 - WALL - bal.depth, t0 - WALL] : [t1 + WALL, t1 + WALL + bal.depth];
  const far = bal.side === 't0' ? n0 : n1;
  return {
    floor: [bal.a, bal.b, n0, n1],
    rails: [
      [bal.a, bal.b, Math.min(far, far + (bal.side === 't0' ? -0.1 : 0.1)), Math.max(far, far + (bal.side === 't0' ? -0.1 : 0.1))],
      [bal.a - 0.1, bal.a, n0, n1],
      [bal.b, bal.b + 0.1, n0, n1],
    ],
  };
}

/** A flat's layout: collision on its storey (the street's own below), its floor, and what counts as inside. */
function flatLayout(b: Building3, p: HomePlan, ground: readonly Rect[]): Omit<Interior, 'group'> {
  const f = localFrame(b);
  const R = (r: R4): Rect => localRect(f, r[0], r[1], r[2], r[3]);
  const bal = balconyRects(p);
  const up = [...outerRects(p), ...p.walls, ...p.solids, ...bal.rails].map(R);
  const [u0, u1, t0, t1] = p.box;
  const within = (x: number, z: number): boolean => {
    const [u, t] = toLocal(f, x, z);
    if (u > u0 && u < u1 && t > t0 && t < t1) return true;
    const q = bal.floor;
    return !!q && u > q[0] && u < q[1] && t > q[2] - 0.2 && t < q[3] + 0.2;
  };
  return {
    colliders: (floor) => (Math.abs(floor - p.y) < 1.2 ? up : Math.abs(floor) <= 1 ? ground : []),
    floorAt: (x, z, current) => (current > p.y - 2 && within(x, z) ? p.y : null),
    contains: (x, z, y) => y > p.y && y < p.y + p.h + 0.4 && within(x, z),
  };
}

/** The layout of a building's flats together: each one's collision on its own storey, the street's below. */
export function homeLayout(b: Building3, plans: readonly HomePlan[], ground: readonly Rect[]): Omit<Interior, 'group'> {
  const flats = plans.map((p) => ({ p, l: flatLayout(b, p, []) }));
  return {
    colliders(floor) {
      const on = flats.filter(({ p }) => Math.abs(floor - p.y) < 1.2);
      return on.length ? on.flatMap(({ l }) => l.colliders(floor)) : Math.abs(floor) <= 1 ? ground : [];
    },
    floorAt(x, z, current) {
      for (const { l } of flats) {
        const y = l.floorAt(x, z, current);
        if (y !== null) return y;
      }
      return null;
    },
    contains: (x, z, y) => flats.some(({ l }) => l.contains(x, z, y)),
  };
}

export interface Flat {
  readonly plan: HomePlan;
  readonly look: { readonly wall: number; readonly ceiling: number; readonly floor?: number };
  readonly furnish: (h: Home) => void;
}

/** Furniture over a Kit, in the flat's frame (u, t local; y above the flat's floor). */
export class Home {
  readonly d: Draw;
  readonly k: Kit;
  readonly f: LocalFrame;
  constructor(k: Kit, readonly p: HomePlan) {
    this.k = k;
    this.d = new Draw(k);
    this.d.level = p.y;
    this.f = k.f;
  }
  /** A self-lit box, y above the floor. */
  box(hex: number, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void {
    this.d.W(hex, u0, u1, t0, t1, this.p.y + y0, this.p.y + y1, y0 > 0.2);
  }
  glow(rgb: C3, u0: number, u1: number, t0: number, t1: number, y0: number, y1: number): void {
    this.d.glow(rgb, u0, u1, t0, t1, this.p.y + y0, this.p.y + y1, EMIT.always);
  }
  /** Tatami: mats in alternating runs with their dark cloth edges. */
  tatami(u0: number, u1: number, t0: number, t1: number): void {
    this.box(0x6a6a3a, u0, u1, t0, t1, 0, 0.04);
    let row = 0;
    for (let t = t0; t < t1 - 0.2; t += 0.9, row++) {
      for (let u = u0 + (row % 2 ? 0.9 : 0); u < u1 - 0.2; u += 1.8) {
        this.box(0xb8b070, u + 0.03, Math.min(u + 1.77, u1 - 0.03), t + 0.03, Math.min(t + 0.87, t1 - 0.03), 0.04, 0.06);
      }
      if (row % 2) this.box(0xb8b070, u0 + 0.03, u0 + 0.87, t + 0.03, Math.min(t + 0.87, t1 - 0.03), 0.04, 0.06);
    }
  }
  boards(hex: number, u0: number, u1: number, t0: number, t1: number): void {
    this.box(hex, u0, u1, t0, t1, 0, 0.05);
    for (let t = t0 + 0.18; t < t1; t += 0.18) this.box(0x000000, u0, u1, t - 0.004, t + 0.004, 0.05, 0.052);
  }
  /** A futon: mattress, quilt (rumpled if unmade), pillow at the t0 end. */
  futon(u0: number, u1: number, t0: number, t1: number, quilt = 0x8a9ac8, unmade = false): void {
    this.box(0xe8e4dc, u0, u1, t0, t1, 0.04, 0.14);
    if (unmade) {
      this.box(quilt, u0 + 0.05, u1 - 0.2, t0 + 0.7, t1 - 0.3, 0.14, 0.26);
      this.box(quilt, u0 + 0.25, u1 + 0.1, t0 + 1.2, t0 + 1.8, 0.2, 0.34);
    } else this.box(quilt, u0 + 0.02, u1 - 0.02, t0 + 0.55, t1 - 0.05, 0.14, 0.22);
    this.box(0xf0ece4, u0 + 0.2, u1 - 0.2, t0 + 0.08, t0 + 0.45, 0.14, 0.24);
  }
  /** A kotatsu: the low table over its quilt. */
  kotatsu(u: number, t: number, w = 0.9, quilt = 0xa84a3a): void {
    this.box(quilt, u - w / 2 - 0.25, u + w / 2 + 0.25, t - w / 2 - 0.25, t + w / 2 + 0.25, 0.04, 0.34);
    this.box(0x8a6a4a, u - w / 2, u + w / 2, t - w / 2, t + w / 2, 0.36, 0.4);
  }
  /** A low round table (chabudai). */
  chabudai(u: number, t: number, r = 0.45): void {
    this.d.lathe(0x7a5a3a, u, t, [[this.p.y + 0.04, 0.08], [this.p.y + 0.28, 0.08], [this.p.y + 0.28, r], [this.p.y + 0.32, r], [this.p.y + 0.32, 0.001]], 16);
  }
  table(u0: number, u1: number, t0: number, t1: number, hex = 0x8a6a4a, h = 0.72): void {
    this.box(hex, u0, u1, t0, t1, h - 0.04, h);
    for (const [u, t] of [[u0 + 0.05, t0 + 0.05], [u1 - 0.09, t0 + 0.05], [u0 + 0.05, t1 - 0.09], [u1 - 0.09, t1 - 0.09]] as const) this.box(hex, u, u + 0.04, t, t + 0.04, 0, h - 0.04);
  }
  chair(u: number, t: number, hex = 0x6a5a48, back: Side = 't1'): void {
    this.box(hex, u - 0.21, u + 0.21, t - 0.21, t + 0.21, 0.42, 0.46);
    for (const [du, dt] of [[-0.19, -0.19], [0.17, -0.19], [-0.19, 0.17], [0.17, 0.17]] as const) this.box(hex, u + du, u + du + 0.03, t + dt, t + dt + 0.03, 0, 0.42);
    const [a0, a1, b0, b1] = back === 't1' ? [u - 0.21, u + 0.21, t + 0.18, t + 0.21] : back === 't0' ? [u - 0.21, u + 0.21, t - 0.21, t - 0.18] : back === 'u1' ? [u + 0.18, u + 0.21, t - 0.21, t + 0.21] : [u - 0.21, u - 0.18, t - 0.21, t + 0.21];
    this.box(hex, a0, a1, b0, b1, 0.46, 0.9);
  }
  /** Shelving with books or files along it. */
  shelf(u0: number, u1: number, t0: number, t1: number, h: number, hex = 0x6a6a6e, fill: readonly number[] = [0x8a3a2a, 0x2a4a6a, 0xd8c8a0, 0x3a5a3a, 0x1a1a1a]): void {
    this.box(hex, u0, u1, t0, t1, 0, 0.03);
    this.box(hex, u0, u1, t0, t1, h - 0.03, h);
    const alongU = u1 - u0 > t1 - t0;
    for (let y = 0.05; y < h - 0.35; y += 0.38) {
      this.box(hex, u0, u1, t0, t1, y - 0.02, y);
      const n = Math.floor((alongU ? u1 - u0 : t1 - t0) / 0.06);
      for (let i = 0; i < n; i++) {
        if ((i * 7 + Math.round(y * 10)) % 11 === 0) continue;
        const a = (alongU ? u0 : t0) + i * 0.06 + 0.01;
        const top = y + 0.2 + ((i * 13) % 7) * 0.015;
        const c = fill[(i * 5 + Math.round(y * 3)) % fill.length];
        if (alongU) this.box(c, a, a + 0.05, t0 + 0.03, t1 - 0.03, y, top);
        else this.box(c, u0 + 0.03, u1 - 0.03, a, a + 0.05, y, top);
      }
    }
  }
  /** A television: a boxy CRT or a flat panel, on a low stand; its screen glows. */
  tv(u: number, t: number, facing: Side, crt = true, screen: C3 = [0.35, 0.45, 0.6]): void {
    const w = crt ? 0.55 : 1.1;
    const alongU = facing === 't0' || facing === 't1';
    const [hu, ht] = alongU ? [w / 2 + 0.1, 0.22] : [0.22, w / 2 + 0.1];
    this.box(0x2a2624, u - hu, u + hu, t - ht, t + ht, 0, 0.42);
    const d = crt ? 0.45 : 0.06;
    const [bu, bt] = alongU ? [w / 2, d / 2] : [d / 2, w / 2];
    const h0 = 0.44;
    const h1 = crt ? 0.9 : 1.08;
    this.box(crt ? 0x3a3836 : 0x141416, u - bu, u + bu, t - bt, t + bt, h0, h1);
    const s = facing === 't0' ? [u - bu + 0.06, u + bu - 0.06, t - bt - 0.01, t - bt] : facing === 't1' ? [u - bu + 0.06, u + bu - 0.06, t + bt, t + bt + 0.01] : facing === 'u0' ? [u - bu - 0.01, u - bu, t - bt + 0.06, t + bt - 0.06] : [u + bu, u + bu + 0.01, t - bt + 0.06, t + bt - 0.06];
    this.glow(screen, s[0], s[1], s[2], s[3], h0 + 0.06, h1 - 0.06);
  }
  fridge(u0: number, u1: number, t0: number, t1: number, h = 1.5, hex = 0xe8e4dc): void {
    this.box(hex, u0, u1, t0, t1, 0, h);
    this.box(0x9a968e, u0, u1, t0, t1, h * 0.62, h * 0.63);
  }
  /** A kitchen run along a wall: cupboards, the worktop, a sink and a two-ring hob, wall cupboards over it. */
  kitchen(u0: number, u1: number, t0: number, t1: number, wall: Side, hex = 0xd8d0c0): void {
    this.box(hex, u0, u1, t0, t1, 0, 0.82);
    this.box(0xb8b4ac, u0, u1, t0, t1, 0.82, 0.86);
    const alongU = u1 - u0 > t1 - t0;
    const L = alongU ? u1 - u0 : t1 - t0;
    const at = (a: number, b: number, c0: number, c1: number, y0: number, y1: number, color: number): void =>
      alongU ? this.box(color, u0 + a, u0 + b, t0 + c0 * (t1 - t0), t0 + c1 * (t1 - t0), y0, y1) : this.box(color, u0 + c0 * (u1 - u0), u0 + c1 * (u1 - u0), t0 + a, t0 + b, y0, y1);
    at(0.2, 0.8, 0.2, 0.8, 0.84, 0.865, 0x6a6e72);
    at(L - 0.75, L - 0.15, 0.2, 0.8, 0.86, 0.9, 0x2a2a2e);
    at(L - 0.6, L - 0.45, 0.35, 0.5, 0.9, 0.92, 0x3a3a3a);
    at(L - 0.4, L - 0.25, 0.5, 0.65, 0.9, 0.92, 0x3a3a3a);
    // Wall cupboards (on the wall's side of the run).
    const [c0, c1] = wall === 't0' || wall === 'u0' ? [0, 0.6] : [0.4, 1];
    at(0, L, c0, c1, 1.5, 2.1, hex);
    at(L - 0.7, L - 0.2, c0, c1, 1.45, 1.5, 0x9a9a9a);
    // The kettle on the hob.
    at(L - 0.55, L - 0.35, 0.35, 0.6, 0.92, 1.1, 0xc8c8c0);
  }
  /** A closed box of a room (a unit bath, a closet), its door on one side. */
  closet(u0: number, u1: number, t0: number, t1: number, doorSide: Side, hex = 0xe0dcd4): void {
    this.box(hex, u0, u1, t0, t1, 0, this.p.h);
    const m = 0.01;
    const [a, b] = doorSide === 't0' || doorSide === 't1' ? [(u0 + u1) / 2 - 0.35, (u0 + u1) / 2 + 0.35] : [(t0 + t1) / 2 - 0.35, (t0 + t1) / 2 + 0.35];
    if (doorSide === 't0') this.box(0xc8c0b0, a, b, t0 - m, t0, 0, 1.9);
    if (doorSide === 't1') this.box(0xc8c0b0, a, b, t1, t1 + m, 0, 1.9);
    if (doorSide === 'u0') this.box(0xc8c0b0, u0 - m, u0, a, b, 0, 1.9);
    if (doorSide === 'u1') this.box(0xc8c0b0, u1, u1 + m, a, b, 0, 1.9);
  }
  /** A flat picture on a wall: side is the wall it hangs on, a along it, y its centre. */
  picture(side: Side, a: number, y: number, w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void): void {
    const [u0, u1, t0, t1] = this.p.box;
    const W = Math.round(w * 160);
    const H = Math.round(h * 160);
    const tex = this.k.canvas(W, H, (g) => draw(g, W, H));
    const e = 0.02;
    if (side === 't0') this.k.plane(tex, w, h, a, t0 + e, this.p.y + y, 'in', 1.0);
    if (side === 't1') this.k.plane(tex, w, h, a, t1 - e, this.p.y + y, 'out', 1.0);
    if (side === 'u0') this.k.plane(tex, w, h, u0 + e, a, this.p.y + y, '+u', 1.0);
    if (side === 'u1') this.k.plane(tex, w, h, u1 - e, a, this.p.y + y, '-u', 1.0);
  }
  /** Venetian blinds over a window in an outer wall, the slats half open (the street light in stripes). */
  blinds(side: Side, a: number, b: number, y0: number, y1: number): void {
    const [u0, u1, t0, t1] = this.p.box;
    for (let y = y0; y < y1; y += 0.09) {
      if (side === 't1') this.box(0xd8d4c8, a, b, t1 - 0.06, t1 - 0.04, y, y + 0.045);
      if (side === 't0') this.box(0xd8d4c8, a, b, t0 + 0.04, t0 + 0.06, y, y + 0.045);
      if (side === 'u0') this.box(0xd8d4c8, u0 + 0.04, u0 + 0.06, a, b, y, y + 0.045);
      if (side === 'u1') this.box(0xd8d4c8, u1 - 0.06, u1 - 0.04, a, b, y, y + 0.045);
    }
  }
  /** Curtains either side of a window. */
  curtains(side: Side, a: number, b: number, y0: number, y1: number, hex = 0xb8a88c): void {
    const [u0, u1, t0, t1] = this.p.box;
    for (const [c0, c1] of [[a - 0.1, a + 0.35], [b - 0.35, b + 0.1]] as const) {
      if (side === 't1') this.box(hex, c0, c1, t1 - 0.12, t1 - 0.05, y0 - 0.1, y1 + 0.1);
      if (side === 't0') this.box(hex, c0, c1, t0 + 0.05, t0 + 0.12, y0 - 0.1, y1 + 0.1);
      if (side === 'u0') this.box(hex, u0 + 0.05, u0 + 0.12, c0, c1, y0 - 0.1, y1 + 0.1);
      if (side === 'u1') this.box(hex, u1 - 0.12, u1 - 0.05, c0, c1, y0 - 0.1, y1 + 0.1);
    }
  }
  /** A ceiling light: a fluorescent ring (the classic flat's), a bare bulb, or a paper pendant. */
  ceilingLight(u: number, t: number, kind: 'ring' | 'bulb' | 'pendant' = 'ring', rgb: C3 = [1.3, 1.3, 1.25]): void {
    const top = this.p.y + this.p.h;
    if (kind === 'ring') {
      this.d.lathe(0xe8e8e4, u, t, [[top - 0.14, 0.001], [top - 0.14, 0.3], [top - 0.02, 0.26], [top, 0.001]], 16);
      this.d.lathe(0, u, t, [[top - 0.145, 0.25], [top - 0.145, 0.001]], 16, EMIT.always, rgb);
    } else if (kind === 'bulb') {
      this.box(0x2a2a2a, u - 0.01, u + 0.01, t - 0.01, t + 0.01, this.p.h - 0.45, this.p.h);
      this.d.lathe(0, u, t, [[top - 0.56, 0.001], [top - 0.52, 0.05], [top - 0.46, 0.001]], 8, EMIT.always, rgb);
    } else {
      this.box(0x2a2a2a, u - 0.01, u + 0.01, t - 0.01, t + 0.01, this.p.h - 0.6, this.p.h);
      this.d.lathe(0, u, t, [[top - 0.95, 0.001], [top - 0.9, 0.2], [top - 0.7, 0.24], [top - 0.6, 0.12], [top - 0.6, 0.001]], 12, EMIT.always, rgb);
    }
  }
  /** Shoes in the genkan. */
  shoes(u: number, t: number, pairs: readonly number[]): void {
    pairs.forEach((c, i) => {
      const uu = u + i * 0.32;
      this.box(c, uu, uu + 0.1, t, t + 0.27, 0, 0.09);
      this.box(c, uu + 0.12, uu + 0.22, t, t + 0.27, 0, 0.09);
    });
  }
  /** Clothes hanging on a rail along u (suits, coats, dresses). */
  hanging(u0: number, u1: number, t: number, y: number, colors: readonly number[]): void {
    this.box(0x8a8a8a, u0, u1, t - 0.01, t + 0.01, y, y + 0.02);
    let i = 0;
    for (let u = u0 + 0.1; u < u1 - 0.1; u += 0.16) this.box(colors[i++ % colors.length], u, u + 0.12, t - 0.24, t + 0.24, y - 1.0, y - 0.05);
  }
  plant(u: number, t: number, size = 1): void {
    this.d.lathe(0xb86a3a, u, t, [[this.p.y, 0.14 * size], [this.p.y + 0.3 * size, 0.18 * size], [this.p.y + 0.3 * size, 0.001]], 10);
    this.d.ball(0x3a6a2a, u, t, this.p.y + 0.3 * size, 0.3 * size, 8);
  }
}

/** Builds a building's flats (each: its shell, then its furniture) as one interior. */
export function homeInterior(b: Building3, flats: readonly Flat[], city: THREE.Material, ghost: THREE.Material, ground: readonly Rect[]): Interior {
  const k = new Kit(b);
  for (const fl of flats) buildFlat(k, fl.plan, fl.look, fl.furnish);
  const group = k.finish(city, ghost);
  group.visible = false;
  return { group, ...homeLayout(b, flats.map((fl) => fl.plan), ground) };
}

/** A flat's shell (floor, ceiling, outer walls with windows, door and balcony), then its furniture. */
function buildFlat(k: Kit, p: HomePlan, look: Flat['look'], furnish: (h: Home) => void): void {
  const h = new Home(k, p);
  const [u0, u1, t0, t1] = p.box;
  const H = p.h;
  // Floor under everything (the rooms lay their own finishes over it), the ceiling.
  h.box(look.floor ?? 0x8a7a64, u0, u1, t0, t1, -0.02, 0);
  h.d.W(look.ceiling, u0, u1, t0, t1, p.y + H, p.y + H + 0.04, true);
  // The outer walls, their openings (windows, the balcony door) cut out and glazed.
  const openings = (side: Side): { a: number; b: number; y0: number; y1: number }[] => [
    ...p.windows.filter((w) => w.side === side),
    ...(p.balcony?.side === side ? [{ a: Math.min(p.balcony.glass[0], p.balcony.open[0]), b: Math.max(p.balcony.glass[1], p.balcony.open[1]), y0: 0, y1: 2.0 }] : []),
  ];
  const wall = (side: Side): void => {
    const [a0, a1] = side === 't0' || side === 't1' ? [u0 - WALL, u1 + WALL] : [t0, t1];
    const seg = (a: number, bb: number, y0: number, y1: number): void => {
      if (bb - a < 0.001 || y1 - y0 < 0.001) return;
      if (side === 't0') h.box(look.wall, a, bb, t0 - WALL, t0, y0, y1);
      if (side === 't1') h.box(look.wall, a, bb, t1, t1 + WALL, y0, y1);
      if (side === 'u0') h.box(look.wall, u0 - WALL, u0, a, bb, y0, y1);
      if (side === 'u1') h.box(look.wall, u1, u1 + WALL, a, bb, y0, y1);
    };
    const ops = openings(side).sort((x, y) => x.a - y.a);
    let a = a0;
    for (const o of ops) {
      seg(a, o.a, 0, H);
      seg(o.a, o.b, 0, o.y0);
      seg(o.a, o.b, o.y1, H);
      a = o.b;
    }
    seg(a, a1, 0, H);
    // Glass in the windows (and the balcony door's closed half), with frames.
    for (const o of p.windows.filter((w) => w.side === side)) glaze(side, o.a, o.b, o.y0, o.y1);
    if (p.balcony?.side === side) glaze(side, p.balcony.glass[0], p.balcony.glass[1], 0.02, 2.0);
  };
  const glaze = (side: Side, a: number, bb: number, y0: number, y1: number): void => {
    const y = p.y;
    if (side === 't0' || side === 't1') {
      const t = side === 't0' ? t0 - WALL / 2 : t1 + WALL / 2;
      k.pane(a, bb, y + y0, y + y1, t);
      for (const aa of [a, (a + bb) / 2, bb]) h.box(0x9a9a9a, aa - 0.02, aa + 0.02, t - 0.04, t + 0.04, y0, y1);
      h.box(0x9a9a9a, a, bb, t - 0.05, t + 0.05, y0 - 0.02, y0);
    } else {
      const u = side === 'u0' ? u0 - WALL / 2 : u1 + WALL / 2;
      k.paneT(u, a, bb, y + y0, y + y1);
      for (const aa of [a, (a + bb) / 2, bb]) h.box(0x9a9a9a, u - 0.04, u + 0.04, aa - 0.02, aa + 0.02, y0, y1);
      h.box(0x9a9a9a, u - 0.05, u + 0.05, a, bb, y0 - 0.02, y0);
    }
  };
  for (const s of ['t0', 't1', 'u0', 'u1'] as const) wall(s);
  // The front door, shut: a steel or wooden leaf on the wall's inner face, its handle, a peephole.
  const dr = p.door;
  const inset = 0.015;
  if (dr.side === 't0') h.box(0x5a5e62, dr.a, dr.b, t0, t0 + inset, 0, 2.0);
  if (dr.side === 't1') h.box(0x5a5e62, dr.a, dr.b, t1 - inset, t1, 0, 2.0);
  if (dr.side === 'u0') h.box(0x5a5e62, u0, u0 + inset, dr.a, dr.b, 0, 2.0);
  if (dr.side === 'u1') h.box(0x5a5e62, u1 - inset, u1, dr.a, dr.b, 0, 2.0);
  // The partitions.
  for (const w of p.walls) h.box(look.wall, w[0], w[1], w[2], w[3], 0, H);
  // The balcony: its slab, the rail, a drain.
  if (p.balcony) {
    const { floor, rails } = balconyRects(p);
    if (floor) h.box(0x9a968e, floor[0], floor[1], floor[2], floor[3], -0.15, 0);
    for (const r of rails) h.box(0x8a8e92, r[0], r[1], r[2], r[3], 0, 1.1);
  }
  furnish(h);
}

/** A small printed sign for a home's walls (a calendar, a notice). */
export function printed(g: CanvasRenderingContext2D, W: number, H: number, bg: string, lines: readonly [string, string, number][]): void {
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  lines.forEach(([s, color, y]) => text(g, s, W / 2, H * y, `bold ${Math.round(H * 0.12)}px 'Yu Gothic', sans-serif`, color));
}
