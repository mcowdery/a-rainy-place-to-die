import { hash, rng, type Rng } from '../../core/hash';
import type { Building3 } from '../district/plan';
import type { Light } from './lightmap';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';
import type { Prop } from './props';

/**
 * Manila's street dressing (CityConfig.filipino): what the zones' `look.street` share puts along the frontages and
 * the kerbs, and how each new prop kind is drawn (dressing.ts hands its unknown kinds here). Sari-sari kiosks, push
 * carts and barbecue grills, jeepney stops and tricycle terminals, parols (Christmas star lanterns), political
 * tarpaulins, roadside shrines, garbage piles, a barangay hall's porch with its flag and notice board, and the steel
 * trusses of a covered court. Nothing here reads real people or brands; the tarps' lettering is bars of colour.
 */

type C3 = [number, number, number];

export const MANILA_KINDS = new Set<Prop['kind']>(['sarisari', 'cart', 'jeepstop', 'parol', 'tarp', 'shrine', 'garbage', 'barangay', 'trusses']);

const PAINTS = [0x2f6ab0, 0xb8363a, 0x3a8a5a, 0xe0b830, 0x8a5a3a, 0xd8d4c8, 0x6a3a8a, 0xd86a1e];
const UMBRELLA = [0xb8363a, 0x2f6ab0, 0xe0b830, 0x3a8a5a, 0xd86a9a, 0xe8e8e0];
const PAROLS: C3[] = [[1.0, 0.25, 0.2], [1.0, 0.85, 0.25], [0.3, 0.9, 0.4], [0.3, 0.6, 1.0], [1.0, 0.55, 0.85], [1.0, 0.95, 0.8]];
const TARPS = [0xa8403c, 0x3a5a98, 0x4a7a58, 0xc8a840, 0xd8d4c8, 0xc86a2a];

/** Which slots of a frontage are taken: [u0, u1] ranges. */
function free(used: [number, number][], u0: number, u1: number): boolean {
  return !used.some(([a, c]) => u0 < c + 0.2 && u1 > a - 0.2);
}

export interface FrontCtx {
  readonly props: Prop[];
  readonly lights: Light[];
  /** Whether a spot along the front is where a bus stop can stand. */
  readonly atStop: (u: number) => boolean;
  /** The front's frame and span. */
  readonly f: { p: C3; r: C3; n: C3 };
  readonly s0: number;
  readonly s1: number;
  /** Ranges along the front already taken (vending machines, pots). */
  readonly used: [number, number][];
  /** The building's ground floor height and its floors above it. */
  readonly gf: number;
  readonly floors: number;
}

/** A building's frontage: kiosk, cart, shrine, rubbish, hall porch, tarp, parols, by the zone's street share. */
export function frontage(b: Building3, street: number, c: FrontCtx): void {
  if (street <= 0) return;
  const rnd = rng(hash(b.id, 0xf11e));
  const { f, s0, s1, used } = c;
  const sw = s1 - s0;
  const pt = (u: number, out: number): [number, number] => [f.p[0] + f.r[0] * u + f.n[0] * out, f.p[2] + f.r[2] * u + f.n[2] * out];
  const place = (len: number, atEnd: boolean): number | null => {
    for (let k = 0; k < 4; k++) {
      const u = atEnd ? (k % 2 ? s1 - 0.4 - len / 2 : s0 + 0.4 + len / 2) : s0 + 0.4 + len / 2 + rnd.float() * Math.max(0, sw - 0.8 - len);
      if (free(used, u - len / 2, u + len / 2) && !c.atStop(u - len / 2) && !c.atStop(u + len / 2)) {
        used.push([u - len / 2, u + len / 2]);
        return u;
      }
    }
    return null;
  };
  const add = (kind: Prop['kind'], u: number, out: number, extra: Partial<Prop>): void => {
    const [x, z] = pt(u, out);
    c.props.push({ kind, x, z, nx: f.n[0], nz: f.n[2], radius: 0.3, variant: rnd.int(0, 99999), ...extra });
  };
  if (sw > 5 && rnd.chance(0.24 * street)) {
    // A sari-sari store built onto the house's front, warm light at the hatch.
    const u = place(2.6, false);
    if (u !== null) {
      add('sarisari', u, 0, { radius: 0.5, half: 1.0 });
      const [x, z] = pt(u, 1.8);
      c.lights.push({ x, z, r: 4.5, color: [1.0, 0.78, 0.45], i: 0.7 });
    }
  } else if (sw > 5 && rnd.chance(0.14 * street)) {
    const u = place(2.0, false);
    if (u !== null) {
      add('cart', u, 1.7, { radius: 0.4, half: 0.8 });
      const [x, z] = pt(u, 1.7);
      c.lights.push({ x, z, r: 3.5, color: [1.0, 0.7, 0.4], i: 0.5 });
    }
  }
  if (sw > 3 && rnd.chance(0.08 * street)) {
    const u = place(0.9, true);
    if (u !== null) {
      add('shrine', u, 0, { radius: 0.3, solid: false });
      const [x, z] = pt(u, 0.6);
      c.lights.push({ x, z, r: 3, color: [0.75, 0.85, 1.0], i: 0.55 });
    }
  }
  if (sw > 3 && rnd.chance(0.16 * street)) {
    const u = place(1.6, true);
    if (u !== null) add('garbage', u, 0.8, { radius: 0.5, solid: false, size: 0.7 + rnd.float() * 0.6 });
  }
  if (sw > 9 && b.h < 14 && rnd.chance(0.03 * street)) {
    const u = place(5.5, false);
    if (u !== null) add('barangay', u, 0, { radius: 0.5, half: 2.7 });
  }
  if (c.floors >= 1 && b.h >= 6 && sw > 4 && rnd.chance(0.12 * street)) {
    const w = Math.min(sw - 1, 3 + rnd.float() * 2.5);
    const u = s0 + 0.5 + w / 2 + rnd.float() * Math.max(0, sw - 1 - w);
    add('tarp', u, 0.06, { radius: 0.1, half: w / 2, solid: false, arm: Math.min(b.h - 2.6, c.gf + 1.0 + rnd.int(0, Math.max(0, c.floors - 1)) * 3) });
  }
  if (c.floors >= 1 && rnd.chance(0.32 * street)) {
    const k = rnd.chance(0.35) ? 2 : 1;
    for (let i = 0; i < k; i++) {
      const u = s0 + 0.8 + rnd.float() * Math.max(0.1, sw - 1.6);
      const [x, z] = pt(u, 0.5);
      const fl = rnd.int(0, Math.max(0, c.floors - 1));
      const y = c.gf + fl * 3 + 1.7;
      c.props.push({ kind: 'parol', x, z, nx: f.n[0], nz: f.n[2], radius: 0, variant: rnd.int(0, 5), solid: false, arm: y });
      c.lights.push({ x: x + f.n[0] * 1.2, z: z + f.n[2] * 1.2, r: 3.2, color: PAROLS[rnd.int(0, 5)], i: 0.45 });
    }
  }
}

export interface RoadCtx {
  readonly props: Prop[];
  readonly lights: Light[];
  readonly mine: (x: number, z: number) => boolean;
}

/** A parol hung from a street lamp's pole, out toward the road. */
export function lampParol(x: number, z: number, nx: number, nz: number, hashed: number, street: number, c: RoadCtx): void {
  if ((hashed % 1000) / 1000 >= 0.36 * street || !c.mine(x, z)) return;
  const v = hashed % 6;
  c.props.push({ kind: 'parol', x: x + nx * 0.7, z: z + nz * 0.7, nx: -nz, nz: nx, radius: 0, variant: v, solid: false, arm: 5.0 });
  c.lights.push({ x: x + nx * 1.6, z: z + nz * 1.6, r: 3.4, color: PAROLS[v], i: 0.5 });
}

/** A jeepney stop or tricycle terminal sign with a bench, at a kerb point facing the road. */
export function stopSign(x: number, z: number, nx: number, nz: number, hashed: number, c: RoadCtx): void {
  if (!c.mine(x, z)) return;
  c.props.push({ kind: 'jeepstop', x, z, nx, nz, radius: 0.35, variant: hashed % 4, half: 0.9 });
}

/** A tarpaulin banner strung across the road at (x, z), `half` each way, tied to bamboo poles at the kerbs. */
export function roadTarp(x: number, z: number, axisX: number, axisZ: number, half: number, hashed: number, c: RoadCtx): void {
  if (!c.mine(x, z)) return;
  c.props.push({ kind: 'tarp', x, z, nx: axisX, nz: axisZ, radius: 0.1, variant: hashed % 99991, half, solid: false, high: true, arm: 5.2 });
}

// ---------------------------------------------------------------- drawing

const quad2 = (mb: MeshBuilder, c: C3, a: C3, b: C3): void => {
  mb.quad(c, a, b);
  mb.quad(c, b, a);
};

export function addManilaProp(mb: MeshBuilder, p: Prop): void {
  if (!MANILA_KINDS.has(p.kind)) return;
  const r: C3 = [p.nz, 0, -p.nx];
  const n: C3 = [p.nx, 0, p.nz];
  const o: C3 = [p.x, 0, p.z];
  const at = (u: number, out: number, y = 0): C3 => [p.x + r[0] * u + n[0] * out, y, p.z + r[2] * u + n[2] * out];
  const rnd = rng(hash(p.variant, Math.round(p.x * 8), Math.round(p.z * 8)));
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  switch (p.kind) {
    case 'sarisari': return sarisari(mb, p, rnd, o, r, n, at);
    case 'cart': return cart(mb, p, rnd, o, r, n, at);
    case 'jeepstop': {
      const tri = p.variant % 2 === 1;
      mb.color = lin(0x6a6e72);
      mb.cylinder(p.x, p.z, 0, 2.7, 0.045, 6);
      // The plate: blue for a jeepney stop (white bus-ish bars), yellow-green for a tricycle terminal.
      mb.color = lin(tri ? 0xe0b830 : 0x2a5aaa);
      mb.frameBox(o, r, n, -0.32, 0.32, 1.95, 2.65, 0.05, 0.1);
      mb.color = lin(tri ? 0x2a6a3a : 0xe8e8e0);
      mb.frameBox(o, r, n, -0.24, 0.24, 2.25, 2.45, 0.1, 0.12);
      mb.frameBox(o, r, n, -0.2, 0.2, 2.05, 2.2, 0.1, 0.12);
      mb.color = lin(0x1a1a1a);
      for (const u of [-0.14, 0.14]) mb.frameBox(o, r, n, u - 0.045, u + 0.045, 1.97, 2.03, 0.1, 0.12);
      // A bench beside it.
      mb.color = lin(0x7a5a3c);
      mb.frameBox(o, r, n, 0.55, 2.0, 0.42, 0.47, -0.2, 0.2);
      mb.color = lin(0x3a3c40);
      for (const u of [0.7, 1.85]) mb.frameBox(o, r, n, u - 0.03, u + 0.03, 0, 0.42, -0.15, 0.15);
      return;
    }
    case 'parol': return parol(mb, p, o, r, n);
    case 'tarp': return tarp(mb, p, rnd, o, r, n, at);
    case 'shrine': {
      // A glass-fronted box on the wall: the Santo Nino in his robe, a candle, a plastic garland.
      mb.color = lin(0x2a4a8a);
      mb.frameBox(o, r, n, -0.28, 0.28, 1.25, 2.0, 0, 0.3);
      mb.color = lin(0xe8e4d8);
      mb.frameBox(o, r, n, -0.24, 0.24, 1.29, 1.96, 0.04, 0.3);
      mb.color = lin(0xb8363a);
      mb.lathe(p.x + n[0] * 0.17, p.z + n[2] * 0.17, [[1.3, 0.13], [1.55, 0.09], [1.75, 0.05]], 7);
      mb.color = lin(0xe8c8a0);
      mb.lathe(p.x + n[0] * 0.17, p.z + n[2] * 0.17, [[1.75, 0.06], [1.82, 0.06], [1.9, 0.02]], 7);
      mb.color = lin(0xe0b830);
      mb.frameBox(o, r, n, -0.3, 0.3, 1.96, 2.06, 0, 0.34);
      mb.kind = KIND.glass;
      mb.quad(at(-0.24, 0.31, 1.29), [r[0] * 0.48, 0, r[2] * 0.48], [0, 0.67, 0]);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [0.9, 0.85, 0.7];
      mb.frameBox(o, r, n, 0.12, 0.18, 1.29, 1.36, 0.1, 0.16);
      mb.color = [0.6, 0.75, 1.0];
      mb.frameBox(o, r, n, -0.22, 0.22, 1.93, 1.95, 0.06, 0.28);
      return;
    }
    case 'garbage': {
      const k = p.size ?? 1;
      const bags = [0x1a1a1c, 0x2a3a6a, 0xd8d4c8, 0x2a5a3a, 0x1a1a1c, 0xb8363a];
      const m = 4 + Math.floor(k * 4);
      for (let i = 0; i < m; i++) {
        const c = at((rnd.float() - 0.5) * 1.5 * k, (rnd.float() - 0.5) * 0.9 * k);
        const rr = 0.2 + rnd.float() * 0.2;
        mb.color = lin(rnd.pick(bags));
        mb.lathe(c[0], c[2], [[0, rr * 0.8], [rr * 0.7, rr], [rr * 1.5, rr * 0.4], [rr * 1.7, 0.03]], 6);
      }
      if (rnd.chance(0.5)) {
        const c = at(0.7 * k, 0.1);
        mb.color = lin(0x2a6a3a);
        mb.cylinder(c[0], c[2], 0, 0.8, 0.28, 8);
        mb.color = lin(0x1a3a22);
        mb.cylinder(c[0], c[2], 0.8, 0.84, 0.3, 8);
      }
      return;
    }
    case 'barangay': {
      // A porch against the hall's front: a flat slab on two columns, a green board, a flag and a notice board.
      const h = 2.9;
      mb.color = lin(0xc8c4b4);
      for (const u of [-2.4, 2.4]) mb.frameBox(o, r, n, u - 0.15, u + 0.15, 0, h, 1.9, 2.2);
      mb.frameBox(o, r, n, -2.7, 2.7, h, h + 0.3, 0, 2.4);
      mb.color = lin(0x1f5a3a);
      mb.frameBox(o, r, n, -2.5, 2.5, h + 0.3, h + 1.0, 2.2, 2.28);
      mb.color = lin(0xe8e8e0);
      for (const [a, b] of [[-2.0, -0.4], [-0.2, 1.1], [1.3, 2.1]]) mb.frameBox(o, r, n, a, b, h + 0.52, h + 0.8, 2.28, 2.3);
      // The flag on a pole at one end.
      const pole = at(-2.9, 1.4);
      mb.color = lin(0xb0b4b8);
      mb.cylinder(pole[0], pole[2], 0, 6.2, 0.04, 6);
      for (const [y, col] of [[5.5, 0x2a4aa0], [5.1, 0xb8363a]] as const) {
        mb.color = lin(col);
        quad2(mb, [pole[0], y, pole[2]], [r[0] * 1.5, 0, r[2] * 1.5], [0, 0.4, 0]);
      }
      mb.color = lin(0xe0b830);
      quad2(mb, [pole[0] + r[0] * 0.05, 5.15, pole[2] + r[2] * 0.05], [r[0] * 0.5, 0, r[2] * 0.5], [0, 0.7, 0]);
      // The notice board: a glass-fronted case with papers.
      mb.color = lin(0x3a3a3c);
      mb.frameBox(o, r, n, 0.6, 2.0, 1.2, 2.3, 0.02, 0.08);
      mb.color = lin(0xd8d4c0);
      mb.frameBox(o, r, n, 0.66, 1.94, 1.26, 2.24, 0.08, 0.1);
      for (let i = 0; i < 6; i++) {
        mb.color = lin(rnd.pick([0xe8e8e0, 0xe0c860, 0xa8c8e0, 0xe8e8e0]));
        const u = 0.75 + (i % 3) * 0.4;
        const y = 1.32 + Math.floor(i / 3) * 0.45;
        mb.frameBox(o, r, n, u, u + 0.32, y, y + 0.38, 0.1, 0.11);
      }
      return;
    }
    case 'trusses': return trusses(mb, p, rnd, o, r, n, at);
    default:
  }
}

type At = (u: number, out: number, y?: number) => C3;

function sarisari(mb: MeshBuilder, p: Prop, rnd: Rng, o: C3, r: C3, n: C3, at: At): void {
  const paint = lin(PAINTS[p.variant % PAINTS.length]);
  const D = 1.5;
  mb.color = paint;
  // The box: two side walls, the front below and above the hatch, the back is the house.
  mb.frameBox(o, r, n, -1.2, 1.2, 0, 1.0, 0, D);
  mb.frameBox(o, r, n, -1.2, -0.95, 1.0, 2.3, 0, D);
  mb.frameBox(o, r, n, 0.95, 1.2, 1.0, 2.3, 0, D);
  mb.frameBox(o, r, n, -1.2, 1.2, 1.9, 2.3, 0, D);
  // Roof: a corrugated sheet, a little forward, with a rust edge.
  mb.color = lin(rnd.pick([0x8c8e8c, 0x7a4a2a, 0x6a6e72]));
  quad2(mb, at(-1.35, -0.05, 2.3), [r[0] * 2.7, 0, r[2] * 2.7], [n[0] * 1.9, -0.12, n[2] * 1.9]);
  // The hatch: dark, with the counter and its warm light at night.
  mb.kind = KIND.emit;
  mb.style = [EMIT.lamp, 0, 0, 0];
  mb.color = [1.0, 0.78, 0.45];
  mb.quad(at(-0.92, D + 0.01, 1.0), [r[0] * 1.84, 0, r[2] * 1.84], [0, 0.9, 0]);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  mb.color = lin(0x2a2420);
  mb.frameBox(o, r, n, -0.95, 0.95, 0.96, 1.04, D, D + 0.28);
  // A hanging row of snack packets: foil strips on a string across the hatch.
  mb.color = lin(0x4a4a48);
  mb.beam(at(-0.9, D + 0.1, 1.86), at(0.9, D + 0.1, 1.86), 0.008);
  for (let i = 0; i < 14; i++) {
    mb.color = lin(rnd.pick([0xe0b830, 0xb8363a, 0x2f6ab0, 0x3a8a5a, 0xd86a1e, 0xe8e8e0, 0xd86a9a]));
    quad2(mb, at(-0.88 + i * 0.136, D + 0.11, 1.5), [r[0] * 0.11, 0, r[2] * 0.11], [0, 0.34, 0]);
  }
  // The shutter propped up on a stick, and the signboard above the roof's front.
  mb.color = paint;
  quad2(mb, at(-0.95, D, 1.95), [r[0] * 1.9, 0, r[2] * 1.9], [n[0] * 0.7, 0.35, n[2] * 0.7]);
  mb.color = lin(0x4a4a48);
  mb.beam(at(0.9, D + 0.7, 2.3), at(0.9, D + 0.55, 1.1), 0.012);
  mb.color = lin(0xe8e4d0);
  mb.frameBox(o, r, n, -1.0, 1.0, 2.35, 2.8, 0.5, 0.56);
  mb.color = lin(0x2a2a2e);
  for (const [a, b, y] of [[-0.8, 0.4, 2.62], [-0.8, -0.1, 2.46], [0.1, 0.8, 2.46]] as const) mb.frameBox(o, r, n, a, b, y, y + 0.1, 0.56, 0.58);
  // A bench with a plank and a coloured umbrella over it.
  mb.color = lin(0x7a5a3c);
  mb.frameBox(o, r, n, -0.7, 0.9, 0.42, 0.47, D + 0.5, D + 0.85);
  mb.color = lin(0x3a3c40);
  for (const u of [-0.55, 0.75]) mb.frameBox(o, r, n, u - 0.03, u + 0.03, 0, 0.42, D + 0.6, D + 0.75);
  const c = at(1.45, D + 0.8);
  mb.color = lin(0x9a9a98);
  mb.cylinder(c[0], c[2], 0, 2.35, 0.025, 5);
  mb.color = lin(rnd.pick(UMBRELLA));
  mb.lathe(c[0], c[2], [[2.1, 1.25], [2.3, 0.7], [2.45, 0.04]], 8);
}

function cart(mb: MeshBuilder, p: Prop, rnd: Rng, o: C3, r: C3, n: C3, at: At): void {
  const kind = p.variant % 3; // 0 fruit, 1 a barbecue grill, 2 a fishball wok
  const wheel = (u: number): void => {
    mb.color = lin(0x1a1a1c);
    const c = at(u, 0);
    const R = 0.3;
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      const a1 = ((i + 1) / 8) * Math.PI * 2;
      mb.beam([c[0] + n[0] * Math.cos(a0) * R, R + Math.sin(a0) * R, c[2] + n[2] * Math.cos(a0) * R], [c[0] + n[0] * Math.cos(a1) * R, R + Math.sin(a1) * R, c[2] + n[2] * Math.cos(a1) * R], 0.03);
    }
  };
  wheel(-0.7);
  wheel(0.7);
  mb.color = lin(rnd.pick([0x8a6a3a, 0x3a6a8a, 0xb8363a, 0x5a7a4a]));
  mb.frameBox(o, r, n, -0.9, 0.9, 0.6, 0.8, -0.4, 0.4);
  mb.frameBox(o, r, n, -0.9, 0.9, 0.8, 0.95, -0.4, -0.35);
  mb.frameBox(o, r, n, -0.9, 0.9, 0.8, 0.95, 0.35, 0.4);
  mb.color = lin(0x5a5a58);
  for (const [u, out] of [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]]) mb.beam(at(u, out, 0.3), at(u, out, 0.6), 0.02);
  mb.beam(at(-0.9, 0, 0.7), at(-1.5, 0.2, 0.9), 0.02);
  mb.beam(at(-1.5, 0.2, 0.9), at(-1.5, -0.2, 0.9), 0.02);
  if (kind === 0) {
    for (let i = 0; i < 9; i++) {
      mb.color = lin(rnd.pick([0xe0b830, 0xb8363a, 0x3a8a5a, 0xd86a1e, 0xe0b830]));
      const c = at(-0.75 + (i % 5) * 0.37, -0.2 + Math.floor(i / 5) * 0.4);
      mb.lathe(c[0], c[2], [[0.95, 0.13], [1.04, 0.12], [1.1, 0.03]], 6);
    }
  } else if (kind === 1) {
    mb.color = lin(0x2a2a2c);
    mb.frameBox(o, r, n, -0.7, 0.7, 0.95, 1.05, -0.28, 0.28);
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = [1.0, 0.38, 0.08];
    mb.frameBox(o, r, n, -0.62, 0.62, 1.05, 1.08, -0.2, 0.2);
    mb.kind = KIND.plain;
    mb.style = [0, 0, 0, 0];
    mb.color = lin(0x6a4a2a);
    for (let i = 0; i < 12; i++) mb.beam(at(-0.6 + i * 0.1, -0.3, 1.12), at(-0.6 + i * 0.1, 0.3, 1.12), 0.008);
  } else {
    mb.color = lin(0x3a3a3c);
    const c = at(0.2, 0);
    mb.lathe(c[0], c[2], [[1.0, 0.2], [1.1, 0.34], [1.2, 0.36]], 9);
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = [1.0, 0.5, 0.1];
    mb.lathe(c[0], c[2], [[1.15, 0.3], [1.17, 0.3]], 9);
    mb.kind = KIND.plain;
    mb.style = [0, 0, 0, 0];
  }
  // The umbrella on a pole.
  const u = at(-0.5, -0.3);
  mb.color = lin(0x9a9a98);
  mb.cylinder(u[0], u[2], 0.8, 2.2, 0.025, 5);
  mb.color = lin(rnd.pick(UMBRELLA));
  mb.lathe(u[0], u[2], [[1.95, 1.3], [2.15, 0.7], [2.3, 0.04]], 8);
}

/** A parol: a five-pointed star lantern hung from `arm` m, facing n, with its tails; lit at night. */
function parol(mb: MeshBuilder, p: Prop, _o: C3, r: C3, n: C3): void {
  const col = PAROLS[p.variant % PAROLS.length];
  const y = p.arm ?? 4.5;
  const R = 0.5;
  const ri = 0.2;
  const pts: C3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? R : ri;
    pts.push([p.x + r[0] * Math.cos(a) * rr, y + Math.sin(a) * rr, p.z + r[2] * Math.cos(a) * rr]);
  }
  const lit = (c: C3): C3 => [Math.min(1, c[0] * 0.9), Math.min(1, c[1] * 0.9), Math.min(1, c[2] * 0.9)];
  // The frame by day: bright paper and bamboo; at night the glow channel adds to it.
  mb.color = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55];
  for (let i = 0; i < 10; i++) mb.beam(pts[i], pts[(i + 1) % 10], 0.022);
  for (let i = 0; i < 10; i += 2) mb.beam([p.x, y, p.z], pts[i], 0.014);
  mb.kind = KIND.emit;
  mb.style = [EMIT.lamp, 0, 0, 0];
  mb.color = lit(col);
  mb.box(p.x, p.z, y - 0.07, y + 0.07, 0.14, 0.14);
  for (let i = 0; i < 10; i += 2) mb.beam([p.x, y, p.z], [(pts[i][0] + p.x * 2) / 3, (pts[i][1] + y * 2) / 3, (pts[i][2] + p.z * 2) / 3], 0.02);
  for (let i = 0; i < 10; i++) mb.beam(pts[i], pts[(i + 1) % 10], 0.012);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  // Tails from the lowest points, and the cord up.
  mb.color = [col[1] * 0.8, col[2] * 0.8, col[0] * 0.8];
  const low = pts[5];
  for (const [dx, len] of [[-0.12, 0.45], [0, 0.6], [0.12, 0.45]] as const) mb.beam([low[0] + r[0] * dx, low[1], low[2] + r[2] * dx], [low[0] + r[0] * dx * 1.6, low[1] - len, low[2] + r[2] * dx * 1.6], 0.012);
  mb.color = lin(0x3a3a3a);
  mb.beam([p.x, y + R, p.z], [p.x - n[0] * 0.15, y + R + 0.5, p.z - n[2] * 0.15], 0.008);
}

/** A political tarpaulin: a coloured sheet with a title band, a head and bars of print (no real names; lettering is not drawn). */
function tarp(mb: MeshBuilder, p: Prop, rnd: Rng, _o: C3, r: C3, _n: C3, at: At): void {
  const half = p.half ?? 2;
  const y0 = p.arm ?? 5.0;
  const h = half > 2.5 ? 1.7 : 1.3;
  const base = TARPS[p.variant % TARPS.length];
  const high = p.high === true;
  if (high) {
    // Bamboo poles at the kerbs, the sheet tied between with a sag in its rope.
    mb.color = lin(0x8a7a4a);
    for (const u of [-half - 0.2, half + 0.2]) {
      const c = at(u, 0);
      mb.cylinder(c[0], c[2], 0, y0 + h + 0.8, 0.045, 5);
    }
    mb.color = lin(0x2a2a2a);
    mb.beam(at(-half - 0.2, 0, y0 + h + 0.4), at(0, 0, y0 + h + 0.2), 0.01);
    mb.beam(at(0, 0, y0 + h + 0.2), at(half + 0.2, 0, y0 + h + 0.4), 0.01);
  }
  const side = (s: number): void => {
    const out = (high ? 0 : 0.02) * s + 0.02 * s;
    const Q = (u0: number, u1: number, ya: number, yb: number): void => {
      const c = at(s > 0 ? u0 : u1, out);
      mb.quad([c[0], ya, c[2]], [r[0] * (u1 - u0) * s, 0, r[2] * (u1 - u0) * s], [0, yb - ya, 0]);
    };
    if (!high && s < 0) return;
    mb.color = lin(base);
    Q(-half, half, y0, y0 + h);
    const dark = base === 0xe8e8e0 || base === 0xe0b830 ? 0x1a1a2a : 0xf0ece0;
    // A title band at the top, a head and body on one side, bars of print on the other, a slogan at the foot.
    mb.color = lin(dark);
    Q(-half + 0.1, half - 0.1, y0 + h - 0.32, y0 + h - 0.12);
    mb.color = lin(0xd8a878);
    Q(-half + 0.35, -half + 0.35 + Math.min(0.7, h * 0.4), y0 + 0.28, y0 + 0.28 + Math.min(0.7, h * 0.4));
    mb.color = lin(rnd.pick([0x1a1a2a, 0x2a2a4a, 0x2a4a3a]));
    Q(-half + 0.2, -half + 0.2 + Math.min(1.0, h * 0.6), y0 + 0.08, y0 + 0.28);
    mb.color = lin(dark);
    for (let i = 0; i < 3; i++) Q(-half + 1.4 + (i % 2) * 0.2, half - 0.3 - rnd.float() * 0.8, y0 + h - 0.62 - i * 0.22, y0 + h - 0.5 - i * 0.22);
    Q(-half + 0.1, half - 0.1, y0 + 0.05, y0 + 0.17);
  };
  side(1);
  if (!high) return;
  side(-1);
}

/** The covered court's steel trusses: columns on the fence line, shallow gable rafters, a corrugated roof, purlins. */
function trusses(mb: MeshBuilder, p: Prop, rnd: Rng, o: C3, r: C3, n: C3, at: At): void {
  const L = p.half ?? 7; // half-length along r
  const Wd = p.size ?? 7; // half-width along n
  const eave = 5.0;
  const ridge = 6.8;
  mb.color = lin(0x4a5058);
  const bays = Math.max(2, Math.round((L * 2) / 6));
  for (let i = 0; i <= bays; i++) {
    const u = -L + (L * 2 * i) / bays;
    for (const out of [-Wd, Wd]) mb.beam(at(u, out, 0), at(u, out, eave), 0.07);
    mb.beam(at(u, -Wd, eave), at(u, 0, ridge), 0.05);
    mb.beam(at(u, Wd, eave), at(u, 0, ridge), 0.05);
    mb.beam(at(u, -Wd, eave), at(u, Wd, eave), 0.035);
    mb.beam(at(u, -Wd * 0.5, (eave + ridge) / 2 - 0.1), at(u, 0, eave), 0.025);
    mb.beam(at(u, Wd * 0.5, (eave + ridge) / 2 - 0.1), at(u, 0, eave), 0.025);
  }
  // Purlins and the roof sheets (two slopes), their colour faded green or rust.
  mb.beam(at(-L, 0, ridge), at(L, 0, ridge), 0.05);
  for (const s of [-1, 1]) {
    for (const f of [0.35, 0.7, 1]) {
      const out = Wd * f;
      mb.beam(at(-L, s * out, ridge - (ridge - eave) * f), at(L, s * out, ridge - (ridge - eave) * f), 0.03);
    }
    mb.color = lin(rnd.pick([0x6a7a6a, 0x8c8e8c, 0x8a5a3c, 0x3e5a48, 0x4a6a8a]));
    const c0 = at(-L - 0.2, s * (Wd + 0.4), eave - 0.1);
    const c1 = at(-L - 0.2, 0, ridge + 0.03);
    quad2(mb, c0, [r[0] * (L * 2 + 0.4), 0, r[2] * (L * 2 + 0.4)], [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]]);
    mb.color = lin(0x5a5a58);
    for (let u = -L; u <= L; u += 1.0) mb.beam([c0[0] + r[0] * (u + L + 0.2), c0[1] + 0.01, c0[2] + r[2] * (u + L + 0.2)], [c1[0] + r[0] * (u + L + 0.2), c1[1] + 0.01, c1[2] + r[2] * (u + L + 0.2)], 0.01);
    mb.color = lin(0x4a5058);
  }
  // Floodlights under the eaves (lit at night).
  mb.kind = KIND.emit;
  mb.style = [EMIT.lamp, 0, 0, 0];
  mb.color = [1.0, 0.92, 0.75];
  for (const u of [-L * 0.5, L * 0.5]) mb.frameBox(o, r, n, u - 0.3, u + 0.3, eave - 0.3, eave - 0.2, -0.3, 0.3);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
}
