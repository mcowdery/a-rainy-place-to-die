import { overlaps, pad, type Rect } from '../../core/coords';
import { hash, rng, type Rng } from '../../core/hash';
import type { Building3, OpenLot3 } from '../district/plan';
import { subtract } from './ground';
import type { Light } from './lightmap';
import { localFrame, localRect, toWorld, type LocalFrame } from './localFrame';
import { KIND } from './meshBuilder';
import type { Prop } from './props';

/**
 * Open ground (plan.ts OpenLot3): coin parking, pocket playgrounds, vacant lots, the plazas round towers,
 * and parks. openLayout is a pure function of the lot (and the buildings standing in it), shared by the
 * ground (base stage), the props and lights (cellDetail), collision and the crowd.
 *
 * Layouts use the lot's local frame (localFrame.ts): u along its street face, t inward from it.
 */

type C3 = [number, number, number];

/** A piece of ground: a slab from 0 to top, of a surface kind and colour. */
export interface GroundPiece {
  readonly rect: Rect;
  readonly top: number;
  readonly kind: number;
  readonly hex: number;
}

export interface OpenLayout {
  readonly lot: OpenLot3;
  readonly ground: readonly GroundPiece[];
  /** Painted lines (parking bays), flat on the ground piece under them. */
  readonly paint: readonly { readonly rect: Rect; readonly y: number; readonly hex: number }[];
  readonly props: readonly Prop[];
  /** Solid areas that aren't props (ponds, the toilet block, planters): collision and crowd clearance. */
  readonly solids: readonly Rect[];
  readonly lights: readonly Light[];
  /** Where people gather, and how thickly (the chance per 4.2 m spot). */
  readonly crowd: readonly { readonly rect: Rect; readonly density: number }[];
}

const LAMP: C3 = [1.0, 0.8, 0.55];
const COOL: C3 = [0.85, 0.92, 1.0];
const PARK_LAMP: C3 = [1.0, 0.86, 0.66];

/** A rect's local frame, as if it were a building fronting o.front. */
function frameOf(rect: Rect, front: OpenLot3['front']): LocalFrame {
  return localFrame({ id: 0, x: rect.x + rect.w / 2, z: rect.y + rect.h / 2, w: rect.w, d: rect.h, h: 0, front });
}

/** A builder for one lot's layout in its local frame. */
class Layout {
  readonly ground: GroundPiece[] = [];
  readonly paint: { rect: Rect; y: number; hex: number }[] = [];
  readonly props: Prop[] = [];
  readonly solids: Rect[] = [];
  readonly lights: Light[] = [];
  readonly crowd: { rect: Rect; density: number }[] = [];
  readonly f: LocalFrame;
  readonly W: number;
  readonly D: number;

  constructor(
    readonly lot: OpenLot3,
    readonly rnd: Rng,
    readonly buildings: readonly Building3[],
  ) {
    this.f = frameOf(lot.rect, lot.front);
    this.W = this.f.fw;
    this.D = this.f.depth;
  }

  at(u: number, t: number): [number, number] {
    return toWorld(this.f, u, t);
  }

  /** World direction of a local one (du along the face, dt inward). */
  dir(du: number, dt: number): [number, number] {
    const f = this.f;
    return [f.r[0] * du - f.n[0] * dt, f.r[2] * du - f.n[2] * dt];
  }

  rect(u0: number, u1: number, t0: number, t1: number): Rect {
    return localRect(this.f, Math.min(u0, u1), Math.max(u0, u1), Math.min(t0, t1), Math.max(t0, t1));
  }

  /** A prop at (u, t) facing local (du, dt). */
  prop(kind: Prop['kind'], u: number, t: number, du: number, dt: number, extra: Partial<Prop> = {}): void {
    const [x, z] = this.at(u, t);
    const [nx, nz] = this.dir(du, dt);
    this.props.push({ kind, x, z, nx, nz, radius: 0.3, variant: 0, ...extra });
  }

  /** A prop in world coordinates. */
  propW(kind: Prop['kind'], x: number, z: number, nx: number, nz: number, extra: Partial<Prop> = {}): void {
    this.props.push({ kind, x, z, nx, nz, radius: 0.3, variant: 0, ...extra });
  }

  /** A run of fence or hedge from (u0, t0) to (u1, t1), in pieces of at most 6 m (capsules for collision). */
  run(kind: 'fence' | 'hedge', u0: number, t0: number, u1: number, t1: number, variant: number, radius: number): void {
    const len = Math.hypot(u1 - u0, t1 - t0);
    if (len < 0.4) return;
    const n = Math.ceil(len / 6);
    for (let i = 0; i < n; i++) {
      const a = i / n;
      const b = (i + 1) / n;
      const [ax, az] = this.at(u0 + (u1 - u0) * a, t0 + (t1 - t0) * a);
      const [bx, bz] = this.at(u0 + (u1 - u0) * b, t0 + (t1 - t0) * b);
      const l = Math.hypot(bx - ax, bz - az);
      // n = (-az, ax) of the run's direction, so the prop's right vector (nz, -nx) runs along it.
      this.propW(kind, (ax + bx) / 2, (az + bz) / 2, -(bz - az) / l, (bx - ax) / l, { half: l / 2, radius, variant });
    }
  }

  lamp(u: number, t: number, r = 9, color: C3 = PARK_LAMP, i = 0.7): void {
    this.prop('postlamp', u, t, 0, -1, { radius: 0.15 });
    const [x, z] = this.at(u, t);
    this.lights.push({ x, z, r, color, i });
  }

  /** Whether a world point is within m of a building standing in the lot. */
  nearBuilding(x: number, z: number, m: number): boolean {
    return this.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);
  }

  done(): OpenLayout {
    return { lot: this.lot, ground: this.ground, paint: this.paint, props: this.props, solids: this.solids, lights: this.lights, crowd: this.crowd };
  }
}

/** The layout of an open lot; buildings: those standing in it (a plaza's towers) or around it. */
export function openLayout(lot: OpenLot3, buildings: readonly Building3[]): OpenLayout {
  const L = new Layout(lot, rng(lot.seed), buildings.filter((b) => overlaps(pad(lot.rect, 3), { x: b.x - b.w / 2, y: b.z - b.d / 2, w: b.w, h: b.d })));
  switch (lot.kind) {
    case 'parking': parking(L); break;
    case 'playground': playground(L, 0, 0, L.W, L.D, true); break;
    case 'vacant': vacant(L); break;
    case 'plaza': plaza(L); break;
    case 'park': park(L); break;
  }
  return L.done();
}

/**
 * Coin parking (コインパーキング): asphalt with white bays, wheel stops, a pay machine and a lit yellow
 * P sign on the street, a lamp, and cars in most bays. Shallow lots are one row of bays nose-in from the
 * street; deeper ones have an aisle with bays either side (or one side, if narrow).
 */
function parking(L: Layout): void {
  const { W, D, rnd } = L;
  L.ground.push({ rect: L.lot.rect, top: 0.02, kind: KIND.asphalt, hex: 0x2a2a2e });
  const line = (u0: number, u1: number, t0: number, t1: number, hex = 0xd8d8d0): void => void L.paint.push({ rect: L.rect(u0, u1, t0, t1), y: 0.03, hex });
  const bays: { u: number; t: number; du: number; dt: number }[] = [];
  if (D < 11) {
    const n = Math.floor((W - 0.4) / 2.5);
    const u0 = (W - n * 2.5) / 2;
    const t0 = Math.max(0.3, D - 5.3);
    for (let i = 0; i <= n; i++) line(u0 + i * 2.5 - 0.06, u0 + i * 2.5 + 0.06, t0 + 0.3, D - 0.3);
    for (let i = 0; i < n; i++) bays.push({ u: u0 + i * 2.5 + 1.25, t: t0 + 2.6, du: 0, dt: 1 });
  } else {
    const sides = W >= 10.5 ? [0.3, W - 5.3] : [0.3];
    const n = Math.floor((D - 1.8) / 2.5);
    for (const us of sides) {
      for (let i = 0; i <= n; i++) line(us, us + 5, 1.5 + i * 2.5 - 0.06, 1.5 + i * 2.5 + 0.06);
      for (let i = 0; i < n; i++) bays.push({ u: us + 2.5, t: 1.5 + i * 2.5 + 1.25, du: us < W / 2 ? -1 : 1, dt: 0 });
    }
  }
  // Yellow edge line across the entrance.
  line(0.3, W - 0.3, 0.15, 0.3, 0xd8a830);
  for (const b of bays) {
    // Wheel stop at the bay's inner end; a car in most bays, nose in or out.
    const stopU = b.u + b.du * 1.9;
    const stopT = b.t + b.dt * 1.9;
    L.prop('wheelstop', stopU, stopT, b.du, b.dt, { solid: false, radius: 0.1, half: 0.6 });
    if (!rnd.chance(0.65)) continue;
    const [x, z] = L.at(b.u, b.t);
    const [wx, wz] = L.dir(b.du, b.dt);
    L.propW('car', x, z, -wz, wx, { radius: 0.95, half: 1.4, variant: rnd.int(0, 99999) });
  }
  // Pay machine and the P sign at the front corners; a lamp at the back.
  const left = rnd.chance(0.5);
  L.prop('paymachine', left ? 0.6 : W - 0.6, 0.9, 0, -1, { radius: 0.4 });
  L.prop('psign', left ? W - 0.35 : 0.35, 0.35, 0, -1, { radius: 0.12 });
  const [sx, sz] = L.at(left ? W - 0.35 : 0.35, 0.2);
  L.lights.push({ x: sx, z: sz, r: 4.5, color: [1.0, 0.85, 0.3], i: 0.5 });
  L.prop('postlamp', left ? W - 0.4 : 0.4, D - 0.4, 0, -1, { radius: 0.15, variant: 1 });
  const [cx, cz] = L.at(W / 2, D / 2);
  L.lights.push({ x: cx, z: cz, r: Math.max(W, D) * 0.6 + 3, color: COOL, i: 0.45 });
}

/**
 * A pocket playground (児童遊園) in (u0..u1, t0..t1): earth, a low fence (with a gap to the street when
 * it fronts one), a swing, a slide, a sandbox, benches, a tree or two and a lamp.
 */
function playground(L: Layout, u0: number, t0: number, u1: number, t1: number, own: boolean): void {
  const { rnd } = L;
  const w = u1 - u0;
  const d = t1 - t0;
  L.ground.push({ rect: L.rect(u0, u1, t0, t1), top: own ? 0.05 : 0.11, kind: KIND.gravel, hex: 0x9a8468 });
  // Fence: back and sides, and the front either side of a gate.
  const gate = 2.4;
  L.run('fence', u0 + 0.15, t1 - 0.15, u1 - 0.15, t1 - 0.15, 1, 0.08);
  L.run('fence', u0 + 0.15, t0 + 0.15, u0 + 0.15, t1 - 0.15, 1, 0.08);
  L.run('fence', u1 - 0.15, t0 + 0.15, u1 - 0.15, t1 - 0.15, 1, 0.08);
  L.run('fence', u0 + 0.15, t0 + 0.15, u0 + w / 2 - gate / 2, t0 + 0.15, 1, 0.08);
  L.run('fence', u0 + w / 2 + gate / 2, t0 + 0.15, u1 - 0.15, t0 + 0.15, 1, 0.08);
  const swingLeft = rnd.chance(0.5);
  const su = swingLeft ? u0 + Math.max(2.4, w * 0.32) : u1 - Math.max(2.4, w * 0.32);
  L.prop('swing', su, t1 - 2.6, 0, -1, { half: 1.6, radius: 0.7, variant: rnd.int(0, 3) });
  L.prop('slide', swingLeft ? u1 - 1.6 : u0 + 1.6, t0 + d * 0.55, 0, -1, { half: 0.4, radius: 1.6, variant: rnd.int(0, 3) });
  L.prop('sandbox', swingLeft ? u0 + w * 0.3 : u1 - w * 0.3, t0 + d * 0.38, 0, -1, { solid: false, radius: 1.5 });
  L.prop('bench', u0 + 0.8, t0 + d * 0.3, 1, 0, { half: 0.8, radius: 0.35 });
  if (w > 14) L.prop('bench', u1 - 0.8, t0 + d * 0.72, -1, 0, { half: 0.8, radius: 0.35 });
  const trees = rnd.int(1, 3);
  const spots: [number, number][] = [[u0 + 1.3, t1 - 1.3], [u1 - 1.3, t1 - 1.3], [u1 - 1.3, t0 + 1.4], [u0 + 1.3, t0 + 1.4]];
  for (let i = 0; i < trees; i++) {
    const [u, t] = spots[(i * 2 + (swingLeft ? 1 : 0)) % spots.length];
    const [x, z] = L.at(u, t);
    L.propW('tree', x, z, 0, 1, { radius: 0.3, variant: hash(Math.round(x), Math.round(z)) % 8, size: 0.8 + rnd.float() * 0.3 });
  }
  L.lamp(u0 + w / 2 + gate / 2 + 0.6, t0 + 0.6, 8);
  L.crowd.push({ rect: L.rect(u0 + 1, u1 - 1, t0 + 1, t1 - 1), density: 0.35 });
}

/** A vacant lot (空き地): gravel and weeds behind a post-and-chain fence, with a for-sale board. */
function vacant(L: Layout): void {
  const { W, D, rnd } = L;
  L.ground.push({ rect: L.lot.rect, top: 0.04, kind: KIND.gravel, hex: 0x7a7266 });
  L.run('fence', 0.2, 0.3, W - 0.2, 0.3, 2, 0.08);
  L.prop('board', 0.4 + rnd.float() * (W - 1.6), 0.55, 0, -1, { radius: 0.1, half: 0.6 });
  const tufts = Math.floor((W * D) / 5);
  for (let i = 0; i < tufts; i++) {
    // Weeds thicker along the edges.
    const edge = rnd.chance(0.5);
    const u = edge ? (rnd.chance(0.5) ? 0.3 + rnd.float() * 1.2 : W - 0.3 - rnd.float() * 1.2) : 0.5 + rnd.float() * (W - 1);
    const t = 0.8 + rnd.float() * (D - 1.2);
    L.prop('weeds', u, t, 0, -1, { solid: false, radius: 0.3, size: 0.5 + rnd.float() * (edge ? 0.9 : 0.5), variant: rnd.int(0, 7) });
  }
  if (rnd.chance(0.4)) L.prop('cones', W * (0.3 + rnd.float() * 0.4), D * (0.4 + rnd.float() * 0.4), 0, -1, { radius: 0.5, variant: rnd.int(0, 3) });
}

/**
 * The public plaza round towers (公開空地): paving, lamps round the edge, a loose grid of trees in grates,
 * planters and benches, and a clear forecourt in front of each tower's entrance.
 */
function plaza(L: Layout): void {
  const { rnd } = L;
  const q = L.lot.rect;
  L.ground.push({ rect: q, top: 0.15, kind: KIND.sidewalk, hex: 0xa8a298 });
  const clear = (x: number, z: number, m: number): boolean => {
    if (L.nearBuilding(x, z, m)) return false;
    // The forecourt: a corridor out from the middle of each tower's street face.
    return !L.buildings.some((b) => {
      const f = frameOf({ x: b.x - b.w / 2, y: b.z - b.d / 2, w: b.w, h: b.d }, b.front);
      const dx = x - (f.p[0] + f.r[0] * (f.fw / 2));
      const dz = z - (f.p[2] + f.r[2] * (f.fw / 2));
      const out = dx * f.n[0] + dz * f.n[2];
      const across = Math.abs(dx * f.r[0] + dz * f.r[2]);
      return out > -1 && out < 16 && across < 5;
    });
  };
  // Lamps round the edge, facing in.
  for (let x = q.x + 6; x < q.x + q.w - 4; x += 14) {
    for (const [z, nz] of [[q.y + 1.2, 1], [q.y + q.h - 1.2, -1]] as const) {
      if (!clear(x, z, 1)) continue;
      L.propW('postlamp', x, z, 0, nz, { radius: 0.15 });
      L.lights.push({ x, z, r: 9, color: LAMP, i: 0.6 });
    }
  }
  for (let z = q.y + 13; z < q.y + q.h - 10; z += 14) {
    for (const [x, nx] of [[q.x + 1.2, 1], [q.x + q.w - 1.2, -1]] as const) {
      if (!clear(x, z, 1)) continue;
      L.propW('postlamp', x, z, nx, 0, { radius: 0.15 });
      L.lights.push({ x, z, r: 9, color: LAMP, i: 0.6 });
    }
  }
  for (let x = q.x + 5; x < q.x + q.w - 4; x += 8) {
    for (let z = q.y + 5; z < q.y + q.h - 4; z += 8) {
      const px = x + (rnd.float() - 0.5) * 1.5;
      const pz = z + (rnd.float() - 0.5) * 1.5;
      const roll = rnd.float();
      if (roll > 0.72 || !clear(px, pz, 3)) continue;
      if (roll < 0.52) {
        L.propW('tree', px, pz, 0, 1, { radius: 0.3, variant: hash(Math.round(px), Math.round(pz)) % 8, size: 1.0 + rnd.float() * 0.3 });
        if (rnd.chance(0.3)) L.propW('bench', px + 1.6, pz, 1, 0, { half: 0.8, radius: 0.35 });
      } else {
        const s = 2.2 + rnd.float() * 1.2;
        L.propW('planter', px, pz, 0, 1, { radius: s * 0.72, size: s, variant: rnd.int(0, 7) });
        L.solids.push({ x: px - s / 2, y: pz - s / 2, w: s, h: s });
      }
    }
  }
  L.crowd.push({ rect: q, density: 0.12 });
  L.lights.push({ x: q.x + q.w / 2, z: q.y + q.h / 2, r: Math.max(q.w, q.h) * 0.5, color: [0.85, 0.85, 0.9], i: 0.2 });
}

/**
 * A park: lawn behind a clipped hedge with gates in the middle of each side, a cross of paths to a paved
 * hub (and a ring path in a big one), trees everywhere else, lamps and benches along the paths, a pond, a
 * playground corner and a toilet block in the larger ones.
 */
function park(L: Layout): void {
  const { rnd } = L;
  const q = L.lot.rect;
  const cx = q.x + q.w / 2;
  const cz = q.y + q.h / 2;
  const small = Math.min(q.w, q.h);
  const big = small >= 50;
  const pw = 4;
  const paths: Rect[] = [
    { x: q.x, y: cz - pw / 2, w: q.w, h: pw },
    { x: cx - pw / 2, y: q.y, w: pw, h: q.h },
  ];
  const ring = 9;
  if (big) {
    paths.push({ x: q.x + ring, y: q.y + ring, w: q.w - 2 * ring, h: 3 });
    paths.push({ x: q.x + ring, y: q.y + q.h - ring - 3, w: q.w - 2 * ring, h: 3 });
    paths.push({ x: q.x + ring, y: q.y + ring, w: 3, h: q.h - 2 * ring });
    paths.push({ x: q.x + q.w - ring - 3, y: q.y + ring, w: 3, h: q.h - 2 * ring });
  }
  const hs = Math.min(20, small * 0.3);
  const hub: Rect = { x: cx - hs / 2, y: cz - hs / 2, w: hs, h: hs };
  // Quadrants between the cross paths (inside the ring when there is one).
  const inset = big ? ring + 5 : 3;
  const quads: Rect[] = [
    { x: q.x + inset, y: q.y + inset, w: cx - pw / 2 - 3 - q.x - inset, h: cz - pw / 2 - 3 - q.y - inset },
    { x: cx + pw / 2 + 3, y: q.y + inset, w: q.x + q.w - inset - cx - pw / 2 - 3, h: cz - pw / 2 - 3 - q.y - inset },
    { x: q.x + inset, y: cz + pw / 2 + 3, w: cx - pw / 2 - 3 - q.x - inset, h: q.y + q.h - inset - cz - pw / 2 - 3 },
    { x: cx + pw / 2 + 3, y: cz + pw / 2 + 3, w: q.x + q.w - inset - cx - pw / 2 - 3, h: q.y + q.h - inset - cz - pw / 2 - 3 },
  ];
  const k = rnd.int(0, 3);
  // Pond in one quadrant, playground in the opposite one, toilet block in another.
  let pond: Rect | null = null;
  const pq = quads[k];
  if (pq.w >= 18 && pq.h >= 18) {
    const w = pq.w * (0.6 + rnd.float() * 0.2);
    const h = pq.h * (0.6 + rnd.float() * 0.2);
    pond = { x: pq.x + (pq.w - w) / 2, y: pq.y + (pq.h - h) / 2, w, h };
  }
  let play: Rect | null = null;
  const yq = quads[3 - k];
  if (yq.w >= 16 && yq.h >= 14) {
    const w = Math.min(yq.w, 22);
    const h = Math.min(yq.h, 18);
    play = { x: yq.x + (yq.w - w) / 2, y: yq.y + (yq.h - h) / 2, w, h };
  }
  let toilet: Rect | null = null;
  const tq = quads[(k + 1) % 4];
  if (tq.w >= 8 && tq.h >= 8) {
    // At the quadrant's corner nearest the hub.
    const tx = tq.x + tq.w / 2 < cx ? tq.x + tq.w - 4.5 : tq.x + 0.5;
    const tz = tq.y + tq.h / 2 < cz ? tq.y + tq.h - 3.5 : tq.y + 0.5;
    toilet = { x: tx, y: tz, w: 4, h: 3 };
  }

  // Ground: lawn round the pond, then paths, hub and the pond with its stone rim.
  for (const g of subtract(q, pond ? [pond] : [])) L.ground.push({ rect: g, top: 0.1, kind: KIND.grass, hex: 0x3e5a30 });
  for (const p of paths) L.ground.push({ rect: p, top: 0.12, kind: KIND.gravel, hex: 0xb0a080 });
  L.ground.push({ rect: hub, top: 0.14, kind: KIND.sidewalk, hex: 0xa09a90 });
  if (pond) {
    L.ground.push({ rect: pond, top: 0.04, kind: KIND.water, hex: 0x1a2a2c });
    const r = 0.5;
    for (const e of [
      { x: pond.x - r, y: pond.y - r, w: pond.w + 2 * r, h: r },
      { x: pond.x - r, y: pond.y + pond.h, w: pond.w + 2 * r, h: r },
      { x: pond.x - r, y: pond.y, w: r, h: pond.h },
      { x: pond.x + pond.w, y: pond.y, w: r, h: pond.h },
    ]) L.ground.push({ rect: e, top: 0.3, kind: KIND.plain, hex: 0x7a766e });
    L.solids.push(pond);
  }
  if (play) {
    const f = L.f;
    // The playground in the park's own frame: find its local extent.
    const corners = [[play.x, play.y], [play.x + play.w, play.y + play.h]].map(([x, z]) => {
      const dx = x - f.p[0];
      const dz = z - f.p[2];
      return [dx * f.r[0] + dz * f.r[2], -(dx * f.n[0] + dz * f.n[2])];
    });
    playground(L, Math.min(corners[0][0], corners[1][0]), Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][0], corners[1][0]), Math.max(corners[0][1], corners[1][1]), false);
  }
  if (toilet) {
    // Facing the hub, with a vending machine beside it.
    const nz = toilet.y + toilet.h / 2 < cz ? 1 : -1;
    L.propW('toilet', toilet.x + toilet.w / 2, toilet.y + toilet.h / 2, 0, nz, { radius: 0, solid: false });
    L.solids.push(toilet);
    const vx = toilet.x + toilet.w + 0.8;
    const vz = toilet.y + toilet.h / 2;
    L.propW('vending', vx, vz, 0, nz, { radius: 0.55, variant: rnd.int(0, 3) });
    L.lights.push({ x: vx, z: vz + nz * 0.8, r: 3.5, color: COOL, i: 0.55 });
  }

  // Hedge round the edge, with gates where the cross paths meet it.
  const gate = pw + 3;
  const hedge = (x0: number, z0: number, x1: number, z1: number): void => {
    const vertical = x0 === x1;
    const mid = vertical ? cz : cx;
    const [a, b] = vertical ? [z0, z1] : [x0, x1];
    for (const [s, e] of [[a, mid - gate / 2], [mid + gate / 2, b]]) {
      if (e - s < 1) continue;
      const A = vertical ? [x0, s] : [s, z0];
      const B = vertical ? [x0, e] : [e, z0];
      const la = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const n = Math.ceil(la / 6);
      for (let i = 0; i < n; i++) {
        const p0 = [A[0] + ((B[0] - A[0]) * i) / n, A[1] + ((B[1] - A[1]) * i) / n];
        const p1 = [A[0] + ((B[0] - A[0]) * (i + 1)) / n, A[1] + ((B[1] - A[1]) * (i + 1)) / n];
        const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        L.propW('hedge', (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, -(p1[1] - p0[1]) / l, (p1[0] - p0[0]) / l, { half: l / 2, radius: 0.4, variant: 1 });
      }
    }
  };
  hedge(q.x + 0.6, q.y + 0.6, q.x + q.w - 0.6, q.y + 0.6);
  hedge(q.x + 0.6, q.y + q.h - 0.6, q.x + q.w - 0.6, q.y + q.h - 0.6);
  hedge(q.x + 0.6, q.y + 0.6, q.x + 0.6, q.y + q.h - 0.6);
  hedge(q.x + q.w - 0.6, q.y + 0.6, q.x + q.w - 0.6, q.y + q.h - 0.6);

  // Lamps and benches along the paths (either side, staggered).
  for (const p of paths) {
    const vertical = p.h > p.w;
    const [a, b] = vertical ? [p.y, p.y + p.h] : [p.x, p.x + p.w];
    let side = 1;
    for (let s = a + 6; s < b - 4; s += 16) {
      side = -side;
      const across = vertical ? p.x + p.w / 2 + side * (p.w / 2 + 0.6) : p.y + p.h / 2 + side * (p.h / 2 + 0.6);
      const [x, z] = vertical ? [across, s] : [s, across];
      if (overlaps(pad({ x, y: z, w: 0, h: 0 }, 1.5), hub) || (pond && overlaps(pad({ x, y: z, w: 0, h: 0 }, 1), pond))) continue;
      L.propW('postlamp', x, z, vertical ? -side : 0, vertical ? 0 : -side, { radius: 0.15 });
      L.lights.push({ x, z, r: 9, color: PARK_LAMP, i: 0.65 });
      const bs = s + 8;
      if (bs < b - 4 && rnd.chance(0.7)) {
        const [bx, bz] = vertical ? [across, bs] : [bs, across];
        if (!overlaps(pad({ x: bx, y: bz, w: 0, h: 0 }, 2), hub)) L.propW('bench', bx, bz, vertical ? -side : 0, vertical ? 0 : -side, { half: 0.8, radius: 0.35 });
      }
    }
  }
  // Benches round the hub, facing in.
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
    for (const off of [-hs / 4, hs / 4]) {
      const x = cx + dx * (hs / 2 - 0.6) + (dz !== 0 ? off : 0);
      const z = cz + dz * (hs / 2 - 0.6) + (dx !== 0 ? off : 0);
      L.propW('bench', x, z, -dx, -dz, { half: 0.8, radius: 0.35 });
    }
  }
  L.lights.push({ x: cx, z: cz, r: hs * 0.8, color: PARK_LAMP, i: 0.5 });

  // Trees on a jittered grid over the lawn, off the paths, hub, pond, playground and toilet.
  const keepOff = [...paths.map((p) => pad(p, 1.8)), pad(hub, 2.5), ...(pond ? [pad(pond, 2.5)] : []), ...(play ? [pad(play, 1)] : []), ...(toilet ? [pad(toilet, 2)] : [])];
  for (let x = q.x + 3; x < q.x + q.w - 2; x += 6.5) {
    for (let z = q.y + 3; z < q.y + q.h - 2; z += 6.5) {
      const px = x + (rnd.float() - 0.5) * 3;
      const pz = z + (rnd.float() - 0.5) * 3;
      if (!rnd.chance(0.72)) continue;
      if (px < q.x + 2 || pz < q.y + 2 || px > q.x + q.w - 2 || pz > q.y + q.h - 2) continue;
      if (keepOff.some((r) => px > r.x && px < r.x + r.w && pz > r.y && pz < r.y + r.h)) continue;
      L.propW('tree', px, pz, 0, 1, { radius: 0.3, variant: hash(Math.round(px), Math.round(pz)) % 8, size: 1.0 + rnd.float() * 0.5, grate: false });
    }
  }
  for (const p of paths) L.crowd.push({ rect: p, density: 0.2 });
  L.crowd.push({ rect: hub, density: 0.4 });
}
