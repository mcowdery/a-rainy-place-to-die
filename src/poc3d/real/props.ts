import { overlaps } from '../../core/coords';
import { hash, rng } from '../../core/hash';
import type { Building3, CellPlan3, Road3 } from '../district/plan';
import { frontFrame, styleFor } from './buildings';
import type { Light } from './lightmap';
import { EMIT, KIND, lin, type MeshBuilder } from './meshBuilder';

/**
 * Street furniture derived from a cell plan (pure: same plan, same props): street lamps along roads with
 * pavements, concrete utility poles with overhead wires along the narrow streets, and vending machines
 * against some buildings. Also the cell's lights for the lightmap (lamp pools, shop spill, vending glow).
 * A prop belongs to the cell containing it, so the shared edge roads aren't furnished twice.
 */

type C3 = [number, number, number];

export interface Prop {
  readonly kind: 'lamp' | 'pole' | 'vending' | 'tree' | 'car' | 'signal';
  readonly x: number;
  readonly z: number;
  /** Facing: towards the road for lamps and poles, out from the wall for vending machines. */
  readonly nx: number;
  readonly nz: number;
  readonly radius: number;
  readonly variant: number;
  /** Cars: half-length of the collision capsule along the road. */
  readonly half?: number;
  /** Signals: arm length out over the road. */
  readonly arm?: number;
}

export interface CellDetail {
  readonly props: readonly Prop[];
  /** Overhead wires as polylines. */
  readonly wires: readonly (readonly C3[])[];
  readonly lights: readonly Light[];
}

const LAMP_SPACING = 22;
const POLE_SPACING = 27;
const LAMP_COLOR: C3 = [1.0, 0.8, 0.55];
const POLE_LAMP: C3 = [0.8, 0.9, 1.0];

/** Along-road spans of r not covered by crossing roads (with a margin), in the road's own axis. */
function freeSpans(r: Road3, roads: readonly Road3[], margin: number): [number, number][] {
  const q = r.rect;
  let spans: [number, number][] = [r.vertical ? [q.y, q.y + q.h] : [q.x, q.x + q.w]];
  for (const o of roads) {
    if (o === r || o.vertical === r.vertical || o.kind === 'coast' || !overlaps(o.rect, q)) continue;
    const [a, b] = r.vertical ? [o.rect.y - margin, o.rect.y + o.rect.h + margin] : [o.rect.x - margin, o.rect.x + o.rect.w + margin];
    spans = spans.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : ([[s, a], [b, e]] as [number, number][]).filter(([p, t]) => t - p > 2)));
  }
  return spans;
}

export function cellDetail(plan: CellPlan3, extraBuildings: readonly Building3[]): CellDetail {
  const props: Prop[] = [];
  const wires: C3[][] = [];
  const lights: Light[] = [];
  const cell = plan.rect;
  const mine = (x: number, z: number): boolean => x >= cell.x && z >= cell.y && x < cell.x + cell.w && z < cell.y + cell.h;
  const buildings = [...plan.buildings, ...extraBuildings];
  const inBuilding = (x: number, z: number, m: number): boolean => buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);

  for (const r of plan.roads) {
    if (r.kind === 'coast') continue;
    const q = r.rect;
    const rnd = rng(hash(Math.round(q.x * 4), Math.round(q.y * 4), Math.round(q.w * 4), Math.round(q.h * 4)));
    const along = (t: number, side: number, inset: number): [number, number, number, number] =>
      r.vertical
        ? side < 0 ? [q.x + inset, t, 1, 0] : [q.x + q.w - inset, t, -1, 0]
        : side < 0 ? [t, q.y + inset, 0, 1] : [t, q.y + q.h - inset, 0, -1];
    if (r.sidewalk > 0) {
      const width = r.vertical ? q.w : q.h;
      const boulevard = width >= 14;
      for (const side of [-1, 1]) {
        for (const [s, e] of freeSpans(r, plan.roads, 2)) {
          // Street lamps on both pavements at the kerb, staggered; street trees between them on boulevards.
          const phase = side > 0 ? LAMP_SPACING / 2 : 0;
          for (let t = s + 4 + phase; t < e - 3; t += LAMP_SPACING) {
            const [x, z, nx, nz] = along(t, side, r.sidewalk - 0.45);
            if (mine(x, z)) {
              props.push({ kind: 'lamp', x, z, nx, nz, radius: 0.2, variant: 0 });
              lights.push({ x: x + nx * 1.4, z: z + nz * 1.4, r: 9, color: LAMP_COLOR, i: 0.7 });
            }
            const tt = t + LAMP_SPACING / 2;
            if (boulevard && tt < e - 3) {
              const [x2, z2, nx2, nz2] = along(tt, side, r.sidewalk - 0.9);
              if (mine(x2, z2)) props.push({ kind: 'tree', x: x2, z: z2, nx: nx2, nz: nz2, radius: 0.3, variant: hash(Math.round(x2), Math.round(z2)) % 8 });
            }
          }
          // Traffic signals where the road meets a junction (one per approach; traffic keeps left).
          const q0 = r.vertical ? q.y : q.x;
          const q1 = r.vertical ? q.y + q.h : q.x + q.w;
          if (width >= 8) {
            const ends: [number, number][] = [[e - 1.5, -1], [s + 1.5, 1]];
            for (const [t, sd] of ends) {
              if (sd !== side || Math.abs(t - q0) < 2 || Math.abs(t - q1) < 2) continue;
              const [x, z, nx, nz] = along(t, side, r.sidewalk - 0.35);
              if (mine(x, z)) props.push({ kind: 'signal', x, z, nx, nz, radius: 0.2, variant: hash(Math.round(x), Math.round(z)) % 3, arm: (width - 2 * r.sidewalk) / 2 - 0.5 });
            }
          }
          // Parked cars along the kerb.
          for (let t = s + 7; t < e - 7; t += 6.5) {
            const h = hash(Math.round(t * 10), Math.round(q.x), Math.round(q.y), side + 5);
            if (h % 100 > 32) continue;
            const [x, z, nx, nz] = along(t, side, r.sidewalk + 1.05);
            if (!mine(x, z)) continue;
            props.push({ kind: 'car', x, z, nx, nz, radius: 0.95, variant: (h >>> 8) % 12, half: 1.4 });
          }
        }
      }
    } else if (q.w >= 2.5 && q.h >= 2.5 && Math.min(q.w, q.h) < 8) {
      // Utility poles along one edge of narrow streets, wired pole to pole.
      const side = rnd.chance(0.5) ? -1 : 1;
      for (const [s, e] of freeSpans(r, plan.roads, 1)) {
        let prev: [number, number, number, number] | null = null;
        for (let t = s + 3 + rnd.float() * 6; t < e - 2; t += POLE_SPACING) {
          const pt = along(t, side, 0.35);
          const [x, z, nx, nz] = pt;
          if (!mine(x, z) || inBuilding(x, z, 0.2)) {
            prev = null;
            continue;
          }
          const variant = hash(Math.round(x * 10), Math.round(z * 10)) % 10;
          props.push({ kind: 'pole', x, z, nx, nz, radius: 0.25, variant });
          if (variant < 3) lights.push({ x: x + nx * 1.2, z: z + nz * 1.2, r: 7, color: POLE_LAMP, i: 0.5 });
          if (prev) {
            for (const [off, y] of [[-0.7, 8.9], [0, 8.9], [0.7, 8.9], [0, 7.5]] as const) {
              // Crossarms run across the street: offset along the pole's facing.
              const a: C3 = [prev[0] + prev[2] * off, y, prev[1] + prev[3] * off];
              const b: C3 = [x + nx * off, y, z + nz * off];
              const sag = 0.35 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.012;
              const line: C3[] = [];
              for (let k = 0; k <= 4; k++) {
                const f = k / 4;
                line.push([a[0] + (b[0] - a[0]) * f, y - sag * 4 * f * (1 - f), a[2] + (b[2] - a[2]) * f]);
              }
              wires.push(line);
            }
          }
          prev = pt;
        }
      }
    }
  }

  // Shopfront spill and vending machines.
  for (const b of buildings) {
    const s = styleFor(b);
    const f = frontFrame(b);
    const mid = { x: f.p[0] + f.r[0] * (f.fw / 2), z: f.p[2] + f.r[2] * (f.fw / 2) };
    if (!mine(mid.x, mid.z)) continue;
    if (s.shopOpen) {
      const color: C3 = s.shopPal === 0 ? [1.0, 0.78, 0.5] : s.shopPal === 1 ? [0.85, 0.92, 1.0] : s.shopPal === 2 ? (b.id % 2 ? [1.0, 0.45, 0.8] : [0.4, 0.85, 1.0]) : [0.9, 0.4, 0.2];
      lights.push({
        x: f.p[0] + f.r[0] * 0.4,
        z: f.p[2] + f.r[2] * 0.4,
        r: 0,
        color,
        i: s.shopPal === 3 ? 0.3 : 0.6,
        band: { dx: f.r[0] * (f.fw - 0.8), dz: f.r[2] * (f.fw - 0.8), nx: f.n[0], nz: f.n[2], depth: 4.5 },
      });
    }
    const rnd = rng(hash(b.id, 0x7e4d));
    if (f.fw > 6 && b.hue === undefined && rnd.chance(0.14)) {
      const count = rnd.int(1, 3);
      const start = rnd.chance(0.5) ? 0.4 : f.fw - 0.4 - count * 1.05;
      for (let i = 0; i < count; i++) {
        const u = start + i * 1.05 + 0.5;
        const x = f.p[0] + f.r[0] * u + f.n[0] * 0.45;
        const z = f.p[2] + f.r[2] * u + f.n[2] * 0.45;
        props.push({ kind: 'vending', x, z, nx: f.n[0], nz: f.n[2], radius: 0.55, variant: rnd.int(0, 3) });
        lights.push({ x: x + f.n[0] * 0.8, z: z + f.n[2] * 0.8, r: 3.5, color: [0.8, 0.9, 1.0], i: 0.55 });
      }
    }
  }
  return { props, wires, lights };
}

const VENDING = [0xd8d8d4, 0xb8242a, 0x2a4a8a, 0x2a2a2e];

/** Geometry for a cell's props and wires. */
export function addProps(mb: MeshBuilder, d: CellDetail): void {
  mb.id = 0;
  mb.flags = 0;
  for (const p of d.props) {
    const r: C3 = [p.nz, 0, -p.nx];
    const n: C3 = [p.nx, 0, p.nz];
    const o: C3 = [p.x, 0, p.z];
    if (p.kind === 'lamp') {
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = lin(0x5a5e64);
      mb.cylinder(p.x, p.z, 0, 6.6, 0.09, 6);
      mb.box(p.x, p.z, 0, 0.5, 0.3, 0.3);
      // Arm out over the road and the lamp head.
      mb.frameBox(o, r, n, -0.05, 0.05, 6.45, 6.55, 0, 1.6);
      mb.color = lin(0x3a3c40);
      mb.frameBox(o, r, n, -0.18, 0.18, 6.35, 6.5, 1.1, 1.75);
      mb.kind = KIND.emit;
      mb.color = [1.0, 0.85, 0.62];
      mb.style = [EMIT.lamp, 0, 0, 0];
      mb.frameBox(o, r, n, -0.15, 0.15, 6.33, 6.36, 1.15, 1.7);
      mb.style = [0, 0, 0, 0];
    } else if (p.kind === 'pole') {
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = lin(0x8a8884);
      mb.cylinder(p.x, p.z, 0, 10, 0.16, 7);
      mb.color = lin(0x4a4a4c);
      // Crossarms across the street.
      mb.frameBox(o, r, n, -0.06, 0.06, 8.8, 8.95, -0.9, 0.9);
      mb.frameBox(o, r, n, -0.05, 0.05, 7.45, 7.55, -0.3, 0.3);
      if (p.variant >= 6) {
        // Pole transformer.
        mb.color = lin(0x7a8288);
        mb.cylinder(p.x - r[0] * 0.35, p.z - r[2] * 0.35, 6.6, 7.6, 0.28, 8);
      }
      // Yellow-and-black guard sleeve at the foot.
      mb.color = lin(0xc8a020);
      mb.cylinder(p.x, p.z, 0.2, 2.0, 0.19, 7, false);
      if (p.variant < 3) {
        mb.color = lin(0x3a3c40);
        mb.frameBox(o, r, n, -0.04, 0.04, 5.9, 6.0, 0, 1.0);
        mb.kind = KIND.emit;
        mb.color = [0.85, 0.92, 1.0];
        mb.style = [EMIT.lamp, 0, 0, 0];
        mb.frameBox(o, r, n, -0.12, 0.12, 5.8, 5.9, 0.7, 1.1);
        mb.style = [0, 0, 0, 0];
      }
    } else if (p.kind === 'tree') {
      tree(mb, p);
    } else if (p.kind === 'car') {
      car(mb, p);
    } else if (p.kind === 'signal') {
      signal(mb, p);
    } else {
      // Vending machine: body, a glowing display front, and a dark slot strip.
      mb.kind = KIND.plain;
      mb.style = [0, 0, 0, 0];
      mb.color = lin(VENDING[p.variant % VENDING.length]);
      mb.frameBox(o, r, n, -0.5, 0.5, 0, 1.83, -0.4, 0.4);
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [0.75, 0.8, 0.85];
      mb.quad([o[0] - r[0] * 0.44 + n[0] * 0.405, 0.95, o[2] - r[2] * 0.44 + n[2] * 0.405], [r[0] * 0.88, 0, r[2] * 0.88], [0, 0.78, 0]);
      mb.color = [0.9, 0.35, 0.3];
      mb.quad([o[0] - r[0] * 0.44 + n[0] * 0.405, 0.78, o[2] - r[2] * 0.44 + n[2] * 0.405], [r[0] * 0.88, 0, r[2] * 0.88], [0, 0.06, 0]);
      mb.style = [0, 0, 0, 0];
    }
  }
  mb.kind = KIND.plain;
  mb.color = [0.02, 0.02, 0.02];
  for (const w of d.wires) for (let i = 0; i + 1 < w.length; i++) mb.beam(w[i], w[i + 1], 0.035);
}

/** Collision: is a circle at (x, z) blocked by one of these props? (Cars are capsules along the road.) */
export function propBlocked(props: readonly Prop[], x: number, z: number, r: number): boolean {
  return props.some((p) => {
    let dx = x - p.x;
    let dz = z - p.z;
    if (p.half) {
      // Project onto the car's long axis (perpendicular to its facing) and clamp to the segment.
      const ax = p.nz;
      const az = -p.nx;
      const t = Math.max(-p.half, Math.min(p.half, dx * ax + dz * az));
      dx -= ax * t;
      dz -= az * t;
    }
    return Math.hypot(dx, dz) < p.radius + r;
  });
}

const LEAVES = [0x2e4a26, 0x36522a, 0x2a4222, 0x3e5a2e];

/** Street tree: a grate, a trunk and a lumpy low-poly canopy. */
function tree(mb: MeshBuilder, p: Prop): void {
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  mb.color = lin(0x2a2a2a);
  mb.box(p.x, p.z, 0.15, 0.17, 1.2, 1.2);
  mb.color = lin(0x4a3a2c);
  mb.cylinder(p.x, p.z, 0.15, 3.4, 0.14, 6, false);
  const s = 0.85 + (p.variant % 4) * 0.08;
  mb.color = lin(LEAVES[p.variant % LEAVES.length]);
  mb.lathe(p.x, p.z, [[2.6, 0.2], [3.1, 1.5 * s], [4.2, 2.0 * s], [5.4, 1.7 * s], [6.3, 0.9 * s], [6.7, 0.1]], 7);
  mb.color = lin(LEAVES[(p.variant + 1) % LEAVES.length]);
  const ox = p.variant % 2 ? 0.7 : -0.7;
  mb.lathe(p.x + ox * p.nz, p.z - ox * p.nx, [[3.6, 0.2], [4.0, 1.1 * s], [4.9, 1.4 * s], [5.8, 1.0 * s], [6.3, 0.1]], 6);
}

const CAR_PAINT = [0xd8d8d6, 0xd8d8d6, 0x9a9ca0, 0x151516, 0x151516, 0x1c2a44, 0x7a1a1a, 0x3a3e44, 0x151516, 0x2a5a3a, 0xc8b030, 0xd8d8d6];

/** Parked car along the kerb: wheels, body, cabin with dark glass, tail lights; some are taxis with a roof sign. */
function car(mb: MeshBuilder, p: Prop): void {
  const n: C3 = [p.nx, 0, p.nz];
  const r: C3 = [p.nz, 0, -p.nx]; // along the road
  const o: C3 = [p.x, 0, p.z];
  const taxi = p.variant === 3 || p.variant === 9 || p.variant === 10;
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  const paint = lin(CAR_PAINT[p.variant]);
  mb.color = lin(0x111111);
  for (const u of [-1.45, 1.45]) for (const w of [-0.9, 0.62]) mb.frameBox(o, r, n, u - 0.33, u + 0.33, 0.02, 0.64, w, w + 0.28);
  mb.color = paint;
  mb.frameBox(o, r, n, -2.3, 2.3, 0.3, 0.92, -0.87, 0.87);
  // Cabin: slightly inset, dark glass all round, painted roof.
  mb.color = [0.02, 0.025, 0.03];
  mb.frameBox(o, r, n, -1.2, 1.05, 0.92, 1.36, -0.78, 0.78);
  mb.color = paint;
  mb.frameBox(o, r, n, -1.1, 0.95, 1.36, 1.44, -0.74, 0.74);
  mb.kind = KIND.emit;
  mb.style = [EMIT.always, 0, 0, 0];
  mb.color = [0.12, 0.0, 0.0];
  mb.frameBox(o, r, n, -2.31, -2.29, 0.7, 0.82, -0.8, -0.5);
  mb.frameBox(o, r, n, -2.31, -2.29, 0.7, 0.82, 0.5, 0.8);
  if (taxi) {
    mb.style = [EMIT.lamp, 0, 0, 0];
    mb.color = [0.5, 0.35, 0.05];
    mb.frameBox(o, r, n, -0.15, 0.15, 1.44, 1.62, -0.25, 0.25);
  }
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
}

/** Japanese traffic signal: pole, an arm over the road and a horizontal three-lamp head. */
function signal(mb: MeshBuilder, p: Prop): void {
  const n: C3 = [p.nx, 0, p.nz];
  const r: C3 = [p.nz, 0, -p.nx];
  const o: C3 = [p.x, 0, p.z];
  const arm = Math.max(1.5, p.arm ?? 3);
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
  mb.color = lin(0x8a8c90);
  mb.cylinder(p.x, p.z, 0, 5.6, 0.1, 6);
  mb.frameBox(o, r, n, -0.05, 0.05, 5.3, 5.4, 0, arm);
  mb.color = lin(0x5a5e62);
  mb.frameBox(o, r, n, -0.25, 0.0, 5.0, 5.45, arm - 1.2, arm);
  const lamps: C3[] = [[0.1, 0.8, 0.55], [1.0, 0.65, 0.05], [1.0, 0.08, 0.04]];
  for (const face of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const a = arm - 1.1 + i * 0.37;
      const on = i === p.variant;
      mb.kind = on ? KIND.emit : KIND.plain;
      mb.style = [on ? EMIT.always : 0, 0, 0, 0];
      mb.color = on ? lamps[i] : [0.03, 0.03, 0.03];
      // A lamp disc on each broad face of the head (facing -r and +r).
      const du = face < 0 ? -0.255 : 0.005;
      const c: C3 = [o[0] + r[0] * du + n[0] * (face < 0 ? a : a + 0.3), 5.06, o[2] + r[2] * du + n[2] * (face < 0 ? a : a + 0.3)];
      const along: C3 = face < 0 ? [n[0] * 0.3, 0, n[2] * 0.3] : [-n[0] * 0.3, 0, -n[2] * 0.3];
      mb.quad(c, along, [0, 0.32, 0]);
    }
  }
  mb.kind = KIND.plain;
  mb.style = [0, 0, 0, 0];
}

