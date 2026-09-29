import YAML from 'yaml';
import type { Rect } from '../../core/coords';
import { CELL } from './plan';

/**
 * The Tōto Expressway (content/world3d/expressway.yaml): a network of elevated routes over the cell-edge roads,
 * ramps down to the street and back up, and spurs that run on into tunnels to the passes. A route is a list of
 * L0 grid points (its corners, rounded at `radius`); a closed one is a loop (the inner loop, C1), an open one
 * runs from its first point to its last (a radial, the Wangan). Routes are one-way, driven in the order of their
 * points; keep left, so the outside lane is the left one, and ramps and exits leave from it.
 *
 * Pure geometry, so the tests drive it: each road is a centreline sampled every metre with a height and a
 * half-width, and the network is their union. A point is on the network where it lies within a road at (about)
 * the height you're at, so ramps and routes merge where their areas overlap at the same height (a route that
 * starts or ends on another joins it there), and everywhere else the edge is a wall. Also: the piers and the
 * ramps' solid undersides, as rects for the street's collision.
 */

export interface RouteDef {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  /** Closed (a loop, back to its first point) or open. */
  readonly loop: boolean;
  /** Its corners: L0 grid points [col, row], in the direction of travel. */
  readonly pts: readonly (readonly [number, number])[];
  /**
   * Metres to the left of the grid line (keep left): a two-way expressway is two routes, one each way, each
   * offset to its own left, so their decks stand side by side over one avenue. Their piers stay on the line
   * (in the median), under both decks.
   */
  readonly offset?: number;
}

export interface ExpresswayDef {
  readonly name: string;
  readonly nameEn: string;
  readonly deck: number;
  readonly radius: number;
  readonly half: number;
  readonly routes: readonly RouteDef[];
  /** On a route's leg (from point `leg` to the next), in its 128 m `block` (counted from the leg's start). */
  readonly ramps: readonly { readonly id: string; readonly kind: 'on' | 'off'; readonly route: string; readonly leg: number; readonly block: number; readonly name: string }[];
  /**
   * Suspension bridges (a look: the decks are the routes'): towers on a grid line at `from` and `to` (L0 rows or
   * cols, fractional), straddling `width` metres of deck, main cables slung between them and down to anchors.
   */
  readonly suspension?: readonly { readonly col?: number; readonly row?: number; readonly from: number; readonly to: number; readonly width: number; readonly name: string }[];
  /** At a route's point `at` (a loop's corner, or an open route's last point), straight on into a tunnel. */
  readonly exits: readonly { readonly id: string; readonly venue: string; readonly route: string; readonly at: number; readonly length: number; readonly name: string }[];
}

export function parseExpressway(file: string, text: string, errors: string[]): ExpresswayDef | null {
  const before = errors.length;
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let d: Record<string, unknown>;
  try {
    d = YAML.parse(text) as Record<string, unknown>;
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return null;
  }
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  for (const k of ['deck', 'radius', 'half']) if (!num(d[k]) || (d[k] as number) <= 0) err(`${k}: a positive number`);
  const routes = new Map<string, { loop: boolean; legs: number[] }>();
  if (!Array.isArray(d.routes) || d.routes.length === 0) err('routes: a list');
  else
    d.routes.forEach((r: Record<string, unknown>, i: number) => {
      const pts = r?.pts as unknown;
      const ok = typeof r?.id === 'string' && typeof r.name === 'string' && typeof r.nameEn === 'string' && typeof r.loop === 'boolean' && Array.isArray(pts) && pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isInteger(v)));
      if (!ok) return err(`routes[${i}]: { id, name, nameEn, loop: true|false, pts: [[col, row], ...] }`);
      const P = pts as [number, number][];
      if (P.length < (r.loop ? 3 : 2)) return err(`routes[${i}]: a loop needs 3 points, a route 2`);
      if (r.offset !== undefined && (!num(r.offset) || Math.abs(r.offset as number) > 12)) err(`routes[${i}]: offset is metres left of the line, up to 12`);
      if (routes.has(r.id as string)) return err(`routes[${i}]: id ${r.id} twice`);
      const legs: number[] = [];
      for (let k = 0; k < (r.loop ? P.length : P.length - 1); k++) {
        const [a, b] = [P[k], P[(k + 1) % P.length]];
        if (a[0] !== b[0] && a[1] !== b[1]) err(`routes[${i}]: leg ${k} must run along a grid line`);
        legs.push(Math.hypot(b[0] - a[0], b[1] - a[1]) * CELL);
      }
      routes.set(r.id as string, { loop: r.loop as boolean, legs });
    });
  if (!Array.isArray(d.ramps)) err('ramps: a list');
  else
    d.ramps.forEach((r: Record<string, unknown>, i: number) => {
      if (typeof r?.id !== 'string' || !['on', 'off'].includes(r.kind as string) || typeof r.route !== 'string' || !Number.isInteger(r.leg) || !Number.isInteger(r.block) || typeof r.name !== 'string') return err(`ramps[${i}]: { id, kind: on|off, route, leg, block, name }`);
      const R = routes.get(r.route);
      if (!R) return err(`ramps[${i}]: no route ${r.route}`);
      const leg = R.legs[r.leg as number];
      if (leg === undefined || (r.block as number) < 0 || ((r.block as number) + 1) * CELL > leg) err(`ramps[${i}]: route ${r.route} has no leg ${r.leg} block ${r.block}`);
    });
  if (!Array.isArray(d.exits)) err('exits: a list');
  else
    d.exits.forEach((x: Record<string, unknown>, i: number) => {
      if (typeof x?.id !== 'string' || typeof x.venue !== 'string' || typeof x.route !== 'string' || !Number.isInteger(x.at) || !num(x.length) || typeof x.name !== 'string') return err(`exits[${i}]: { id, venue, route, at, length, name }`);
      const R = routes.get(x.route);
      if (!R) return err(`exits[${i}]: no route ${x.route}`);
      const n = R.loop ? R.legs.length : R.legs.length + 1;
      if ((x.at as number) < 0 || (x.at as number) >= n || (!R.loop && x.at !== n - 1)) err(`exits[${i}]: at must be a corner of the loop, or an open route's last point`);
    });
  if (errors.length > before) return null;
  return d as unknown as ExpresswayDef;
}

export interface Road {
  readonly id: string;
  /** A closed route (a loop), an open one, a ramp or a spur to a tunnel. */
  readonly kind: 'loop' | 'route' | 'ramp' | 'spur';
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly y: Float64Array;
  /** Unit direction of travel at each sample. */
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  readonly half: number;
  readonly closed: boolean;
  /** Spurs: the venue their tunnel leads to, and its sign. Ramps: the district they serve, and on or off. */
  readonly venue?: string;
  readonly sign?: string;
  readonly rampKind?: 'on' | 'off';
  /** Metres left of its grid line (a two-way route's decks): its piers stand back on the line. */
  readonly offset?: number;
}

/** Where a point is on the network. */
export interface OnRoad {
  readonly road: Road;
  readonly i: number;
  /** Metres left of the centreline (in the direction of travel). */
  readonly lateral: number;
  readonly height: number;
}

const GRID = 16;
/** A ramp's run (m): the climb to the deck at under 10% at its steepest. */
export const RAMP = 240;
const smooth = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Resample a dense polyline every metre, with directions. */
function resample(pts: readonly [number, number][], closed: boolean): { x: number[]; z: number[] } {
  const all = closed ? [...pts, pts[0]] : pts;
  const x: number[] = [all[0][0]];
  const z: number[] = [all[0][1]];
  let carry = 0;
  for (let i = 1; i < all.length; i++) {
    const [ax, az] = all[i - 1];
    const [bx, bz] = all[i];
    const seg = Math.hypot(bx - ax, bz - az);
    let at = 1 - carry;
    while (at <= seg) {
      x.push(ax + ((bx - ax) * at) / seg);
      z.push(az + ((bz - az) * at) / seg);
      at += 1;
    }
    carry = seg - (at - 1);
  }
  if (closed) {
    x.pop();
    z.pop();
  }
  return { x, z };
}

function makeRoad(id: string, kind: Road['kind'], x: number[], z: number[], y: (i: number, n: number) => number, half: number, closed: boolean, extra: Partial<Road> = {}): Road {
  const n = x.length;
  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l;
    tz[i] = dz / l;
  }
  return { id, kind, x: Float64Array.from(x), z: Float64Array.from(z), y: Float64Array.from(x.map((_, i) => y(i, n))), tx, tz, half, closed, ...extra };
}

export class Expressway {
  readonly roads: Road[] = [];
  /** The first loop (the inner loop): its traffic runs on it. */
  readonly loop: Road;
  private readonly grid = new Map<number, [Road, number][]>();

  constructor(readonly def: ExpresswayDef) {
    const R = def.radius;
    const D = def.deck;
    const world = (p: readonly [number, number]): [number, number] => [p[0] * CELL, p[1] * CELL];
    // A route's centreline: straight along each leg, a fillet at each corner (every point of a loop; the
    // inner points of an open route, whose ends run straight).
    const legsOf = (r: RouteDef): { start: [number, number]; dir: [number, number] }[] => {
      const P = r.pts.map(world);
      const n = r.loop ? P.length : P.length - 1;
      return Array.from({ length: n }, (_, k) => ({ start: P[k], dir: norm(P[(k + 1) % P.length][0] - P[k][0], P[(k + 1) % P.length][1] - P[k][1]) }));
    };
    const routeRoads = new Map<string, Road>();
    for (const r of def.routes) {
      const P = r.pts.map(world);
      const dense: [number, number][] = [];
      if (!r.loop) dense.push(P[0]);
      for (let k = r.loop ? 0 : 1; k < (r.loop ? P.length : P.length - 1); k++) {
        const c = P[k];
        const prev = P[(k - 1 + P.length) % P.length];
        const next = P[(k + 1) % P.length];
        const din = norm(c[0] - prev[0], c[1] - prev[1]);
        const dout = norm(next[0] - c[0], next[1] - c[1]);
        const s0: [number, number] = [c[0] - din[0] * R, c[1] - din[1] * R];
        const e: [number, number] = [c[0] + dout[0] * R, c[1] + dout[1] * R];
        const cen: [number, number] = [s0[0] + dout[0] * R, s0[1] + dout[1] * R];
        const a0 = Math.atan2(s0[1] - cen[1], s0[0] - cen[0]);
        let a1 = Math.atan2(e[1] - cen[1], e[0] - cen[0]);
        while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
        while (a0 - a1 > Math.PI) a1 += Math.PI * 2;
        for (let t = 0; t <= 24; t++) {
          const a = a0 + ((a1 - a0) * t) / 24;
          dense.push([cen[0] + Math.cos(a) * R, cen[1] + Math.sin(a) * R]);
        }
        // (The straight to the next corner is the line between this fillet's end and the next one's start.)
      }
      if (!r.loop) dense.push(P[P.length - 1]);
      const L = resample(dense, r.loop);
      const off = r.offset ?? 0;
      if (off) {
        // To the left of the line by `off` (left of travel: (tz, -tx)).
        const base = makeRoad(r.id, 'route', L.x, L.z, () => D, def.half, r.loop);
        for (let i = 0; i < L.x.length; i++) {
          L.x[i] = base.x[i] + base.tz[i] * off;
          L.z[i] = base.z[i] - base.tx[i] * off;
        }
      }
      const road = makeRoad(r.id, r.loop ? 'loop' : 'route', L.x, L.z, () => D, def.half, r.loop, { sign: r.name, ...(off ? { offset: off } : {}) });
      routeRoads.set(r.id, road);
      this.roads.push(road);
    }
    this.loop = this.roads.find((r) => r.kind === 'loop') ?? this.roads[0];
    // Ramps: a single lane outside the deck (on the left), overlapping its edge by 0.6 m so the two join, over
    // the inner lane of the avenue below (next to its median). Each works within one block of its leg (the 128 m
    // between two junctions, counted from the leg's start in the direction of travel): an on-ramp's foot is at the
    // start of its block and the part too low to pass under (a wall to the street) stays inside the block; an
    // off-ramp comes down to its foot at the end of its block.
    const rh = 1.9;
    for (const r of def.ramps) {
      const route = def.routes.find((q) => q.id === r.route)!;
      const { start, dir } = legsOf(route)[r.leg];
      const left: [number, number] = [dir[1], -dir[0]];
      const off = def.half + rh - 0.6 + (route.offset ?? 0);
      const s0 = r.block * CELL;
      const a = r.kind === 'on' ? s0 + 16 : s0 + 112 - RAMP;
      const xs: number[] = [];
      const zs: number[] = [];
      // Where it meets the deck it angles in over the last (first) 60 m, into the deck's outside lane, so you
      // drive straight on and merge (or drift out of the lane and off).
      const lane = 1.8;
      for (let d = 0; d <= RAMP; d++) {
        const k = r.kind === 'on' ? smooth((d - (RAMP - 60)) / 60) : 1 - smooth(d / 60);
        const o = off - (off - lane - (route.offset ?? 0)) * k;
        xs.push(start[0] + dir[0] * (a + d) + left[0] * o);
        zs.push(start[1] + dir[1] * (a + d) + left[1] * o);
      }
      const y = r.kind === 'off' ? (i: number): number => D * (1 - smooth(i / RAMP)) : (i: number): number => D * smooth(i / RAMP);
      this.roads.push(makeRoad(r.id, 'ramp', xs, zs, y, rh, false, { sign: r.name, rampKind: r.kind }));
    }
    // Exits: at a route's point, straight on (the way the route arrived there) into a tunnel.
    for (const e of def.exits) {
      const route = def.routes.find((q) => q.id === e.route)!;
      const legs = legsOf(route);
      const dir = legs[(e.at - 1 + legs.length) % legs.length].dir;
      const o = route.offset ?? 0;
      const w = world(route.pts[e.at]);
      const c: [number, number] = [w[0] + dir[1] * o, w[1] - dir[0] * o];
      const xs: number[] = [];
      const zs: number[] = [];
      for (let d = -R - 10; d <= e.length; d++) {
        xs.push(c[0] + dir[0] * d);
        zs.push(c[1] + dir[1] * d);
      }
      this.roads.push(makeRoad(e.id, 'spur', xs, zs, () => D, def.half, false, { venue: e.venue, sign: e.name }));
    }
    for (const road of this.roads) {
      for (let i = 0; i < road.x.length; i++) {
        const k = this.key(Math.floor(road.x[i] / GRID), Math.floor(road.z[i] / GRID));
        const l = this.grid.get(k);
        if (l) l.push([road, i]);
        else this.grid.set(k, [[road, i]]);
      }
    }
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Every road sample within `reach` of (x, z): [road, index, distance]. */
  private near(x: number, z: number, reach: number): [Road, number, number][] {
    const out: [Road, number, number][] = [];
    const gi = Math.floor(x / GRID);
    const gj = Math.floor(z / GRID);
    const span = Math.ceil(reach / GRID);
    const best = new Map<Road, [number, number]>();
    for (let di = -span; di <= span; di++) {
      for (let dj = -span; dj <= span; dj++) {
        for (const [road, i] of this.grid.get(this.key(gi + di, gj + dj)) ?? []) {
          const d = Math.hypot(road.x[i] - x, road.z[i] - z);
          if (d > reach) continue;
          const b = best.get(road);
          if (!b || d < b[1]) best.set(road, [i, d]);
        }
      }
    }
    for (const [road, [i, d]] of best) out.push([road, i, d]);
    return out;
  }

  /**
   * Where (x, z) is on the network for someone at height y: the road there at the height nearest y (within
   * `tol`), or null (off it: the street below, or past a wall).
   */
  at(x: number, z: number, y: number, tol = 1.4): OnRoad | null {
    let best: OnRoad | null = null;
    for (const [road, i] of this.near(x, z, this.def.half + 3)) {
      const dx = x - road.x[i];
      const dz = z - road.z[i];
      // Across the road (left positive), and along it: past the end of a spur or ramp is off it.
      const lateral = dx * road.tz[i] - dz * road.tx[i];
      const along = dx * road.tx[i] + dz * road.tz[i];
      if (Math.abs(lateral) > road.half || Math.abs(along) > 0.75) continue;
      const h = road.y[i] + (i + 1 < road.y.length ? (road.y[i + 1] - road.y[i]) * along : 0);
      if (Math.abs(h - y) > tol) continue;
      if (!best || Math.abs(h - y) < Math.abs(best.height - y)) best = { road, i, lateral, height: h };
    }
    return best;
  }

  /**
   * The push that brings a point at height y back onto the network (it has run into a wall): toward the
   * centreline of the nearest road at that height, past its edge by a margin. Null if it's on it already or
   * not near any road at that height.
   */
  pushBack(x: number, z: number, y: number, margin = 0.05): { px: number; pz: number; nx: number; nz: number } | null {
    if (this.at(x, z, y)) return null;
    let best: { px: number; pz: number; nx: number; nz: number; d: number } | null = null;
    for (const [road, i] of this.near(x, z, this.def.half + 4)) {
      if (Math.abs(road.y[i] - y) > 1.6) continue;
      // A ramp's foot is at street level: no walls there (you drive on or off it from the street).
      if (road.y[i] < 0.35) continue;
      const dx = x - road.x[i];
      const dz = z - road.z[i];
      const lateral = dx * road.tz[i] - dz * road.tx[i];
      const along = dx * road.tx[i] + dz * road.tz[i];
      // Past a dead end (a spur's portal): straight back along the road.
      const end = !road.closed && ((i === road.x.length - 1 && along > 0) || (i === 0 && along < 0));
      if (end) {
        const s = Math.sign(along);
        const d = Math.abs(along) + margin;
        if (!best || d < best.d) best = { px: -road.tx[i] * s * d, pz: -road.tz[i] * s * d, nx: -road.tx[i] * s, nz: -road.tz[i] * s, d };
        continue;
      }
      const over = Math.abs(lateral) - road.half + margin;
      if (over <= 0) continue;
      const s = Math.sign(lateral);
      // The inward normal (toward the centreline) is -s * left.
      const nx = -s * road.tz[i];
      const nz = s * road.tx[i];
      if (!best || over < best.d) best = { px: nx * over, pz: nz * over, nx, nz, d: over };
    }
    return best && { px: best.px, pz: best.pz, nx: best.nx, nz: best.nz };
  }

  /** Is (x, z) under a raised part of the network, between `lo` and `hi` metres up (the street's walls)? */
  solidAbove(x: number, z: number, lo: number, hi: number): boolean {
    for (const [road, i] of this.near(x, z, this.def.half + 2)) {
      const dx = x - road.x[i];
      const dz = z - road.z[i];
      const lateral = dx * road.tz[i] - dz * road.tx[i];
      if (Math.abs(lateral) <= road.half && road.y[i] > lo && road.y[i] < hi) return true;
    }
    return false;
  }

  /**
   * The street's colliders: piers every 32 m along the loop and spurs (not within 20 m of a junction: a cell
   * corner, where traffic turns), and the ramps' solid undersides where they're between 0.35 m and 5 m up
   * (the ramp rising out of the lane: a wall beside you, a ramp under your wheels only from its foot).
   */
  streetColliders(): Rect[] {
    const out: Rect[] = [];
    const nearJunction = (x: number, z: number): boolean => {
      const cx = Math.round(x / CELL) * CELL;
      const cz = Math.round(z / CELL) * CELL;
      return Math.hypot(x - cx, z - cz) < 20;
    };
    for (const p of this.piers()) if (!nearJunction(p.x, p.z)) out.push({ x: p.x - 0.7, y: p.z - 0.7, w: 1.4, h: 1.4 });
    for (const road of this.roads) {
      if (road.kind !== 'ramp') continue;
      for (let i = 0; i + 4 < road.x.length; i += 4) {
        const h = (road.y[i] + road.y[i + 4]) / 2;
        if (h < 0.35 || h > 5.2) continue;
        const xs = [road.x[i], road.x[i + 4]];
        const zs = [road.z[i], road.z[i + 4]];
        const hw = road.half;
        const ax = Math.abs(road.tz[i]) * hw;
        const az = Math.abs(road.tx[i]) * hw;
        const x0 = Math.min(...xs) - ax;
        const z0 = Math.min(...zs) - az;
        out.push({ x: x0, y: z0, w: Math.max(...xs) + ax - x0, h: Math.max(...zs) + az - z0 });
      }
    }
    return out;
  }

  /** The ramps' walled feet alone (between 0.35 m and 5.2 m up): the generated traffic keeps off their edges. */
  rampColliders(): Rect[] {
    const piers = new Set(this.piers().map((p) => `${Math.round(p.x - 0.7)},${Math.round(p.z - 0.7)}`));
    return this.streetColliders().filter((q) => !(q.w === 1.4 && q.h === 1.4 && piers.has(`${Math.round(q.x)},${Math.round(q.y)}`)));
  }

  /** Where the deck's piers stand (every 32 m along the loop and spurs; the ramps stand on their own walls). */
  piers(): { x: number; z: number; top: number }[] {
    const out: { x: number; z: number; top: number }[] = [];
    for (const road of this.roads) {
      if (road.kind === 'ramp') continue;
      const start = road.kind === 'spur' ? 40 : 0;
      // An offset deck's piers stand back on its grid line (the median), under both of a two-way route's decks.
      const o = road.offset ?? 0;
      for (let i = start; i < road.x.length; i += 32) out.push({ x: road.x[i] - road.tz[i] * o, z: road.z[i] + road.tx[i] * o, top: road.y[i] - 1.2 });
    }
    return out;
  }

  /** Is the point inside another road than `road`, at about the same height (so no wall there)? */
  insideOther(road: Road, x: number, z: number, y: number): boolean {
    for (const [r, i] of this.near(x, z, this.def.half + 2)) {
      if (r === road) continue;
      const dx = x - r.x[i];
      const dz = z - r.z[i];
      const lateral = dx * r.tz[i] - dz * r.tx[i];
      const along = dx * r.tx[i] + dz * r.tz[i];
      if (Math.abs(lateral) <= r.half + 0.1 && Math.abs(along) <= 0.75 && Math.abs(r.y[i] - y) < 1.0) return true;
    }
    return false;
  }

  /** A spur's tunnel you're in (its last 14 m), or null. */
  portal(x: number, z: number, y: number): Road | null {
    const o = this.at(x, z, y);
    return o && o.road.kind === 'spur' && o.i > o.road.x.length - 14 ? o.road : null;
  }
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
