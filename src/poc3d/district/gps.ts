import type { Rect } from '../../core/coords';
import type { CellPlan3, Road3 } from './plan';

/**
 * The GPS: routes on foot or by car from where you are to a marked destination, along the streets.
 *
 * A graph of the road network (`RoadNet`): each road's centreline, cut at the junctions where the roads that
 * cross it (or end at it) meet it; nodes merged by position, so a road runs on through the cell corners. It's
 * built a cell at a time as a search reaches it, so it costs nothing where no one goes and grows with the city.
 * The roads are classed (`roadClass`) and each way of getting about prices them (`COST`):
 * - walk: every street and lane; alleys a little dearer.
 * - drive: the proper streets (raised pavements, 8 m and up, where the traffic drives) and the avenues; the
 *   narrow shared lanes only at a heavy price (`LANE`), so a route takes one only to reach a place on it; no
 *   alleys or lanes too tight for a car.
 * A route snaps its ends to the nearest road it may use, then A* over the graph (driving prefers the avenues,
 * and every turn costs a little, so routes run along the big roads with few turns, as a GPS's do); its points
 * are the ends, where they meet the road, and the junctions where it turns.
 *
 * Walks of up to `WALK_GRID` metres go over a grid instead (`NavGrid`, built over just the area round the
 * trip), which crosses plazas and parks and cuts through the gaps between buildings. `Router` picks. Pure:
 * tests build them from the district's plans.
 */

export const NAV = 3;
const ROAD = 1;
const OPEN = 1.6;
const YARD = 4;
/** Walks up to this far (straight line, m) go over the grid; longer ones, and all driving, over the road graph. */
export const WALK_GRID = 800;
/** Driving: a shared lane (no pavements) at least this wide takes a car, but costs `LANE` a metre. */
const TIGHT = 3.5;
const LANE = 12;

export interface NavSource {
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly cells: readonly (readonly [number, number])[];
  plan(mx: number, my: number): CellPlan3 | null;
  /** Set pieces' footprints (stamps). */
  readonly blocked: readonly Rect[];
  readonly cell: number;
}

export type NavMode = 'walk' | 'drive';
export type RoadClass = 'main' | 'lane' | 'alley';

/** Cost per metre of each class of road, for each way of getting about (0: closed). */
const COST: Readonly<Record<NavMode, Readonly<Record<RoadClass, number>>>> = {
  walk: { main: 1, lane: 1, alley: 1.2 },
  drive: { main: 1, lane: LANE, alley: 0 },
};

/** A road's class: proper streets and avenues, shared lanes, and alleys (or lanes too tight for a car). */
export function roadClass(r: Road3): RoadClass {
  if (r.kind === 'alley') return 'alley';
  if (r.kind === 'boulevard' || r.sidewalk > 0) return 'main';
  return (r.vertical ? r.rect.w : r.rect.h) - 2 * r.sidewalk < TIGHT ? 'alley' : 'lane';
}

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly len: number;
  readonly cls: RoadClass;
  /** An avenue or boulevard (driving prefers them, as a GPS does). */
  readonly fast: boolean;
}

/** Driving along an avenue costs this much a metre against a street's 1; each turn costs `TURN` metres. */
const FAST = 0.8;
const TURN: Readonly<Record<NavMode, number>> = { drive: 40, walk: 6 };

/** Where a point meets the nearest usable road: the edge, how far along it (0 at a, 1 at b), the point. */
interface Snap {
  readonly e: number;
  readonly t: number;
  readonly x: number;
  readonly z: number;
}

export class RoadNet {
  private readonly xs: number[] = [];
  private readonly zs: number[] = [];
  private readonly adj: number[][] = [];
  private readonly edges: Edge[] = [];
  private readonly nodeAt = new Map<string, number>();
  private readonly built = new Set<string>();
  private readonly seen = new Set<string>();
  /** Edges by the cells they pass through (for snapping). */
  private readonly byCell = new Map<string, number[]>();

  constructor(
    private readonly src: NavSource,
    readonly mode: NavMode = 'walk',
  ) {}

  /** How many junctions and road pieces the graph holds so far (it grows as searches reach new cells). */
  get size(): { nodes: number; edges: number } {
    return { nodes: this.xs.length, edges: this.edges.length };
  }

  private node(x: number, z: number): number {
    const k = `${Math.round(x * 2)},${Math.round(z * 2)}`;
    let n = this.nodeAt.get(k);
    if (n === undefined) {
      n = this.xs.length;
      this.xs.push(x);
      this.zs.push(z);
      this.adj.push([]);
      this.nodeAt.set(k, n);
    }
    return n;
  }

  /** The plans of the cells a rectangle (grown by `grow`) overlaps. */
  private plansOver(x0: number, z0: number, x1: number, z1: number, grow: number): CellPlan3[] {
    const C = this.src.cell;
    const out: CellPlan3[] = [];
    for (let my = Math.floor((z0 - grow) / C); my <= Math.floor((z1 + grow) / C); my++) {
      for (let mx = Math.floor((x0 - grow) / C); mx <= Math.floor((x1 + grow) / C); mx++) {
        const p = this.src.plan(mx, my);
        if (p) out.push(p);
      }
    }
    return out;
  }

  /** Adds the cell's roads to the graph (once). */
  private ensure(mx: number, my: number): void {
    const key = `${mx},${my}`;
    if (this.built.has(key)) return;
    this.built.add(key);
    for (const r of this.src.plan(mx, my)?.roads ?? []) {
      if (r.kind === 'coast') continue;
      const q = r.rect;
      const k = `${q.x},${q.y},${q.w},${q.h},${r.vertical ? 1 : 0}`;
      if (this.seen.has(k)) continue;
      this.seen.add(k);
      this.addRoad(r);
    }
  }

  /** The cells round a point (a junction on a cell's edge or corner touches up to four). */
  private ensureAround(x: number, z: number, reach = 20): void {
    const C = this.src.cell;
    for (let my = Math.floor((z - reach) / C); my <= Math.floor((z + reach) / C); my++) {
      for (let mx = Math.floor((x - reach) / C); mx <= Math.floor((x + reach) / C); mx++) this.ensure(mx, my);
    }
  }

  /** A road's centreline, cut at every junction along it (roads crossing it, or ending at its side). */
  private addRoad(r: Road3): void {
    const q = r.rect;
    const half = (r.vertical ? q.w : q.h) / 2;
    const c = r.vertical ? q.x + half : q.y + half;
    const s0 = r.vertical ? q.y : q.x;
    const s1 = r.vertical ? q.y + q.h : q.x + q.w;
    const stations = [s0, s1];
    for (const p of this.plansOver(q.x, q.y, q.x + q.w, q.y + q.h, 20)) {
      for (const o of p.roads) {
        if (o.vertical === r.vertical || o.kind === 'coast') continue;
        const oq = o.rect;
        const oHalf = (o.vertical ? oq.w : oq.h) / 2;
        const oc = o.vertical ? oq.x + oHalf : oq.y + oHalf;
        const o0 = o.vertical ? oq.y : oq.x;
        const o1 = o.vertical ? oq.y + oq.h : oq.x + oq.w;
        // They meet where each one's centreline reaches the other (a road ending at another's side stops at its
        // kerb, half that road's width short of its centreline).
        if (c < o0 - half - 1 || c > o1 + half + 1) continue;
        if (oc < s0 - oHalf - 1 || oc > s1 + oHalf + 1) continue;
        stations.push(oc);
      }
    }
    const sorted = [...new Set(stations.map((v) => Math.round(v * 2) / 2))].sort((u, v) => u - v);
    const cls = roadClass(r);
    const at = (s: number): [number, number] => (r.vertical ? [c, s] : [s, c]);
    const C = this.src.cell;
    for (let i = 0; i + 1 < sorted.length; i++) {
      const [ax, az] = at(sorted[i]);
      const [bx, bz] = at(sorted[i + 1]);
      const a = this.node(ax, az);
      const b = this.node(bx, bz);
      if (a === b) continue;
      const e = this.edges.length;
      this.edges.push({ a, b, len: Math.hypot(bx - ax, bz - az), cls, fast: r.kind === 'boulevard' });
      this.adj[a].push(e);
      this.adj[b].push(e);
      for (let my = Math.floor(Math.min(az, bz) / C); my <= Math.floor(Math.max(az, bz) / C); my++) {
        for (let mx = Math.floor(Math.min(ax, bx) / C); mx <= Math.floor(Math.max(ax, bx) / C); mx++) {
          const k = `${mx},${my}`;
          const list = this.byCell.get(k);
          if (list) list.push(e);
          else this.byCell.set(k, [e]);
        }
      }
    }
  }

  /** The nearest point on a road this way of getting about may use, within `reach` metres. */
  private snapEdge(x: number, z: number, reach: number): Snap | null {
    this.ensureAround(x, z, reach + 20);
    const C = this.src.cell;
    let best: Snap | null = null;
    let bestD = reach;
    const checked = new Set<number>();
    for (let my = Math.floor((z - reach) / C); my <= Math.floor((z + reach) / C); my++) {
      for (let mx = Math.floor((x - reach) / C); mx <= Math.floor((x + reach) / C); mx++) {
        for (const e of this.byCell.get(`${mx},${my}`) ?? []) {
          if (checked.has(e)) continue;
          checked.add(e);
          const E = this.edges[e];
          if (COST[this.mode][E.cls] <= 0) continue;
          const ax = this.xs[E.a];
          const az = this.zs[E.a];
          const dx = this.xs[E.b] - ax;
          const dz = this.zs[E.b] - az;
          const L2 = dx * dx + dz * dz;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
          const px = ax + dx * t;
          const pz = az + dz * t;
          const d = Math.hypot(px - x, pz - z);
          if (d < bestD) {
            bestD = d;
            best = { e, t, x: px, z: pz };
          }
        }
      }
    }
    return best;
  }

  private reach(): number {
    return this.mode === 'drive' ? 120 : 60;
  }

  /** The nearest point on a usable road to (x, z), within `reach` metres; null if none. */
  snap(x: number, z: number, reach = this.reach()): [number, number] | null {
    const s = this.snapEdge(x, z, reach);
    return s ? [s.x, s.z] : null;
  }

  /**
   * The route from (ax, az) to (bx, bz): a polyline (world x, z) from the start, where it meets the road, the
   * junctions where it turns, where it leaves the road, to the end; null if there's no way (or an end is
   * nowhere near a usable road).
   */
  route(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    const s = this.snapEdge(ax, az, this.reach());
    const t = this.snapEdge(bx, bz, this.reach());
    if (!s || !t) return null;
    const cost = (e: number): number => {
      const E = this.edges[e];
      const c = COST[this.mode][E.cls];
      return this.mode === 'drive' && E.fast ? c * FAST : c;
    };
    // The direction each node was reached in (for the turn penalty: fewer, simpler turns, as a GPS gives).
    const heading = new Map<number, [number, number]>();
    const turnCost = (n: number, dx: number, dz: number): number => {
      const h = heading.get(n);
      return h && h[0] * dx + h[1] * dz < 0.7 ? TURN[this.mode] : 0;
    };
    const S = this.edges[s.e];
    const T = this.edges[t.e];
    const START = -1;
    const GOAL = -2;
    const g = new Map<number, number>();
    const from = new Map<number, number>();
    const closed = new Set<number>();
    const heap = new MinHeap();
    // (The heuristic prices the rest at the cheapest rate, avenues, so it never overestimates.)
    const hMul = this.mode === 'drive' ? FAST : 1;
    const hOf = (n: number): number => Math.hypot(this.xs[n] - t.x, this.zs[n] - t.z) * hMul;
    const relax = (n: number, cst: number, prev: number, dir?: [number, number]): void => {
      if (cst < (g.get(n) ?? Infinity)) {
        g.set(n, cst);
        from.set(n, prev);
        if (dir) heading.set(n, dir);
        heap.push(n, cst + (n === GOAL ? 0 : hOf(n)));
      }
    };
    relax(S.a, s.t * S.len * cost(s.e), START);
    relax(S.b, (1 - s.t) * S.len * cost(s.e), START);
    // Both on the same stretch of road: straight along it.
    if (s.e === t.e) relax(GOAL, Math.abs(s.t - t.t) * S.len * cost(s.e), START);
    while (heap.size) {
      const n = heap.pop();
      if (n === GOAL) break;
      if (closed.has(n)) continue;
      closed.add(n);
      const gn = g.get(n)!;
      if (n === T.a) relax(GOAL, gn + t.t * T.len * cost(t.e), n);
      if (n === T.b) relax(GOAL, gn + (1 - t.t) * T.len * cost(t.e), n);
      this.ensureAround(this.xs[n], this.zs[n]);
      for (const e of this.adj[n]) {
        const c = cost(e);
        if (c <= 0) continue;
        const E = this.edges[e];
        const m = E.a === n ? E.b : E.a;
        if (closed.has(m)) continue;
        const dx = (this.xs[m] - this.xs[n]) / E.len;
        const dz = (this.zs[m] - this.zs[n]) / E.len;
        relax(m, gn + E.len * (this.mode === 'drive' && E.fast ? c * FAST : c) + turnCost(n, dx, dz), n, [dx, dz]);
      }
    }
    if (!from.has(GOAL)) return null;
    const nodes: number[] = [];
    for (let n = from.get(GOAL)!; n !== START; n = from.get(n)!) nodes.push(n);
    nodes.reverse();
    const pts: [number, number][] = [[ax, az], [s.x, s.z], ...nodes.map((n) => [this.xs[n], this.zs[n]] as [number, number]), [t.x, t.z], [bx, bz]];
    // Drop repeats, and the junctions the way only runs straight through (keeping the ends as they are).
    const out: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const last = out[out.length - 1];
      if (i < pts.length - 1 && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5) continue;
      if (out.length >= 3 && i < pts.length - 1) {
        const [x0, z0] = out[out.length - 2];
        const [x1, z1] = last;
        // Off the line from the point before to this one by under 1.5 m (a straight run, or a jog where two
        // roads' centrelines meet slightly apart), and not doubling back: drop it.
        const L = Math.hypot(p[0] - x0, p[1] - z0);
        const off = L > 0 ? Math.abs((p[0] - x0) * (z1 - z0) - (p[1] - z0) * (x1 - x0)) / L : 0;
        const ahead = (x1 - x0) * (p[0] - x1) + (z1 - z0) * (p[1] - z1) > 0;
        if (ahead && off < 1.5) out.pop();
      }
      out.push(p);
    }
    return out;
  }
}

/**
 * Walking over short distances: a grid (NAV metres a square) over the area round the trip. Roads and plazas
 * are the cheapest, open ground (parks, car parks) a little dearer, the gaps between buildings (yards,
 * setbacks) dearest; buildings and set pieces blocked. An A* search (8 neighbours, no cutting corners past a
 * blocked square), straightened (a leg runs straight while the ground under it stays as cheap) so its corners
 * are real turns. It crosses plazas and parks and cuts through gaps, which the road graph can't.
 */
export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly x0: number;
  readonly z0: number;
  /** Cost to enter each square (0 = can't). */
  readonly cost: Float32Array;

  constructor(
    src: NavSource,
    /** The area to cover (metres): the trip's surroundings. */
    b: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number },
  ) {
    this.x0 = b.minX;
    this.z0 = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / NAV);
    this.h = Math.ceil((b.maxZ - b.minZ) / NAV);
    this.cost = new Float32Array(this.w * this.h);
    const fill = (x: number, z: number, w: number, d: number, c: number, grow = 0): void => {
      const i0 = Math.max(0, Math.ceil((x - grow - this.x0) / NAV - 0.5));
      const i1 = Math.min(this.w - 1, Math.floor((x + w + grow - this.x0) / NAV - 0.5));
      const j0 = Math.max(0, Math.ceil((z - grow - this.z0) / NAV - 0.5));
      const j1 = Math.min(this.h - 1, Math.floor((z + d + grow - this.z0) / NAV - 0.5));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cost[j * this.w + i] = c;
    };
    // Everything in the district is walkable (dear), then buildings and set pieces out, then streets and open
    // ground in (cheap: a street can't overlap a building).
    const C = src.cell;
    const cells = src.cells.filter(([mx, my]) => (mx + 1) * C > b.minX && mx * C < b.maxX && (my + 1) * C > b.minZ && my * C < b.maxZ);
    for (const [mx, my] of cells) fill(mx * C, my * C, C, C, YARD);
    for (const [mx, my] of cells) for (const q of src.plan(mx, my)?.buildings ?? []) fill(q.x - q.w / 2, q.z - q.d / 2, q.w, q.d, 0, 0.4);
    for (const r of src.blocked) fill(r.x, r.y, r.w, r.h, 0, 0.2);
    for (const [mx, my] of cells) {
      const p = src.plan(mx, my);
      if (!p) continue;
      for (const o of p.open) fill(o.rect.x, o.rect.y, o.rect.w, o.rect.h, o.kind === 'plaza' ? ROAD : OPEN);
      for (const r of p.roads) if (r.kind !== 'coast') fill(r.rect.x, r.rect.y, r.rect.w, r.rect.h, ROAD);
    }
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / NAV);
    const j = Math.floor((z - this.z0) / NAV);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i;
  }

  /** The nearest walkable square's centre to (x, z), searching outward up to `reach` metres; null if none. */
  snap(x: number, z: number, reach = 60): [number, number] | null {
    const k = this.idx(x, z);
    if (k >= 0 && this.cost[k] > 0) return this.centre(k);
    const ci = Math.floor((x - this.x0) / NAV);
    const cj = Math.floor((z - this.z0) / NAV);
    const R = Math.ceil(reach / NAV);
    let best = -1;
    let bestD = Infinity;
    for (let r = 1; r <= R && best < 0; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h || this.cost[j * this.w + i] <= 0) continue;
          const d = di * di + dj * dj;
          if (d < bestD) [best, bestD] = [j * this.w + i, d];
        }
      }
    }
    return best < 0 ? null : this.centre(best);
  }

  private centre(k: number): [number, number] {
    return [this.x0 + ((k % this.w) + 0.5) * NAV, this.z0 + (Math.floor(k / this.w) + 0.5) * NAV];
  }

  /**
   * The route from (ax, az) to (bx, bz): a polyline (world x, z) from start to end through its turns, the ends
   * snapped onto walkable ground; null if there's no way (or an end is nowhere near walkable ground).
   */
  route(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    const a = this.snap(ax, az);
    const b = this.snap(bx, bz);
    if (!a || !b) return null;
    const s = this.idx(a[0], a[1]);
    const t = this.idx(b[0], b[1]);
    const W = this.w;
    const n = this.cost.length;
    const g = new Float32Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const ti = t % W;
    const tj = Math.floor(t / W);
    const hOf = (k: number): number => {
      const dx = Math.abs((k % W) - ti);
      const dz = Math.abs(Math.floor(k / W) - tj);
      return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * ROAD;
    };
    const heap = new MinHeap();
    g[s] = 0;
    heap.push(s, hOf(s));
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]] as const;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k]) continue;
      if (k === t) break;
      closed[k] = 1;
      const i = k % W;
      const j = Math.floor(k / W);
      for (const [di, dj, len] of D) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        const c = this.cost[nk];
        if (c <= 0 || closed[nk]) continue;
        // No cutting a corner past a blocked square.
        if (di && dj && (this.cost[j * W + ni] <= 0 || this.cost[nj * W + i] <= 0)) continue;
        const ng = g[k] + len * c;
        if (ng < g[nk]) {
          g[nk] = ng;
          from[nk] = k;
          heap.push(nk, ng + hOf(nk));
        }
      }
    }
    if (from[t] < 0 && s !== t) return null;
    const cells: number[] = [];
    for (let k = t; k >= 0; k = from[k]) cells.push(k);
    cells.reverse();
    // Straighten: from each kept square, run on to the farthest one in a straight line over ground no dearer
    // than the dearer of the two ends (so a leg never cuts through a yard to skip a street corner).
    const keep: number[] = [cells[0]];
    let at = 0;
    while (at < cells.length - 1) {
      let next = at + 1;
      // (Up to 90 squares on: long straights come out as a few legs, which is fine.)
      for (let q = Math.min(cells.length - 1, at + 90); q > at + 1; q--) {
        if (this.clearLine(cells[at], cells[q])) {
          next = q;
          break;
        }
      }
      keep.push(cells[next]);
      at = next;
    }
    const pts: [number, number][] = [[ax, az]];
    for (let q = 1; q < keep.length - 1; q++) pts.push(this.centre(keep[q]));
    pts.push([bx, bz]);
    return pts;
  }

  /** Whether the straight line between two squares' centres stays on ground no dearer than its ends. */
  private clearLine(a: number, b: number): boolean {
    const [ax, az] = this.centre(a);
    const [bx, bz] = this.centre(b);
    const limit = Math.max(this.cost[a], this.cost[b]);
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(L / (NAV * 0.4));
    for (let i = 1; i < n; i++) {
      const x = ax + ((bx - ax) * i) / n;
      const z = az + ((bz - az) * i) / n;
      // The walker's width: both sides of the line too.
      for (const [ox, oz] of [[0, 0], [(-(bz - az) / L) * 0.8, ((bx - ax) / L) * 0.8], [((bz - az) / L) * 0.8, (-(bx - ax) / L) * 0.8]] as const) {
        const k = this.idx(x + ox, z + oz);
        if (k < 0 || this.cost[k] <= 0 || this.cost[k] > limit) return false;
      }
    }
    return true;
  }
}

/** The GPS's router for one way of getting about: the road graph, or for short walks a grid round the trip. */
export class Router {
  private readonly net: RoadNet;

  constructor(
    private readonly src: NavSource,
    readonly mode: NavMode = 'walk',
  ) {
    this.net = new RoadNet(src, mode);
  }

  /** The nearest point you can route from to (x, z): on foot any walkable ground, driving a usable road. */
  snap(x: number, z: number): [number, number] | null {
    if (this.mode === 'drive') return this.net.snap(x, z);
    const m = 80;
    return new NavGrid(this.src, { minX: x - m, maxX: x + m, minZ: z - m, maxZ: z + m }).snap(x, z);
  }

  route(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    if (this.mode === 'walk' && Math.hypot(bx - ax, bz - az) <= WALK_GRID) {
      const m = 160;
      const grid = new NavGrid(this.src, { minX: Math.min(ax, bx) - m, maxX: Math.max(ax, bx) + m, minZ: Math.min(az, bz) - m, maxZ: Math.max(az, bz) + m });
      const r = grid.route(ax, az, bx, bz);
      if (r) return r;
    }
    return this.net.route(ax, az, bx, bz);
  }
}

/** A binary min-heap of (key, priority). */
class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, pri: number): void {
    this.k.push(key);
    this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (this.p[up] <= this.p[i]) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): number {
    const top = this.k[0];
    const lastK = this.k.pop()!;
    const lastP = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lastK;
      this.p[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l] < this.p[m]) m = l;
        if (r < this.k.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.p[a], this.p[b]] = [this.p[b], this.p[a]];
  }
}

/** Where you are on a route: the nearest point on it, how far off it you are, and what's left. */
export function onRoute(route: readonly (readonly [number, number])[], x: number, z: number): { seg: number; t: number; off: number; left: number } {
  let best = { seg: 0, t: 0, off: Infinity };
  for (let i = 0; i + 1 < route.length; i++) {
    const [ax, az] = route[i];
    const [bx, bz] = route[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const off = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (off < best.off) best = { seg: i, t, off };
  }
  let left = 0;
  for (let i = best.seg; i + 1 < route.length; i++) {
    const L = Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
    left += i === best.seg ? L * (1 - best.t) : L;
  }
  return { ...best, left };
}

/** Points every `step` metres along the route from where you are (seg, t) for `dist` metres, with the heading there. */
export function pointsAhead(route: readonly (readonly [number, number])[], seg: number, t: number, dist: number, step: number, first = step): { x: number; z: number; dx: number; dz: number }[] {
  const out: { x: number; z: number; dx: number; dz: number }[] = [];
  const cum = [0];
  for (let i = 0; i + 1 < route.length; i++) cum.push(cum[i] + Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]));
  const end = cum[cum.length - 1];
  const s0 = cum[seg] + t * ((cum[seg + 1] ?? cum[seg]) - cum[seg]);
  let i = seg;
  for (let s = s0 + first; s <= Math.min(s0 + dist, end) + 1e-6; s += step) {
    while (i + 2 < cum.length && cum[i + 1] < s) i++;
    const L = cum[i + 1] - cum[i];
    const f = L > 0 ? (s - cum[i]) / L : 0;
    const [ax, az] = route[i];
    const [bx, bz] = route[i + 1];
    out.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, dx: (bx - ax) / (L || 1), dz: (bz - az) / (L || 1) });
  }
  return out;
}

/**
 * The next turn along the route from where you are (seg, t): how far to it and which way (a bend of more
 * than 30 degrees), or the destination if there's no turn before it.
 */
export function nextTurn(route: readonly (readonly [number, number])[], seg: number, t: number): { dist: number; dir: 'left' | 'right' | 'sharp-left' | 'sharp-right' | 'arrive' } {
  const len = (i: number): number => Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]);
  let dist = len(seg) * (1 - t);
  for (let i = seg + 1; i + 1 < route.length; i++) {
    const [ax, az] = route[i - 1];
    const [bx, bz] = route[i];
    const [cx, cz] = route[i + 1];
    const d1 = [bx - ax, bz - az];
    const d2 = [cx - bx, cz - bz];
    const n1 = Math.hypot(d1[0], d1[1]) || 1;
    const n2 = Math.hypot(d2[0], d2[1]) || 1;
    const cross = (d1[0] * d2[1] - d1[1] * d2[0]) / (n1 * n2);
    const dot = (d1[0] * d2[0] + d1[1] * d2[1]) / (n1 * n2);
    const ang = Math.atan2(cross, dot);
    // x east, z south: a positive cross product turns clockwise seen from above, to the right.
    if (Math.abs(ang) > Math.PI / 6) {
      const sharp = Math.abs(ang) > (Math.PI * 2) / 3;
      return { dist, dir: ang > 0 ? (sharp ? 'sharp-right' : 'right') : sharp ? 'sharp-left' : 'left' };
    }
    dist += len(i);
  }
  return { dist, dir: 'arrive' };
}
