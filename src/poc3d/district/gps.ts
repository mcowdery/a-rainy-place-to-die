import type { Rect } from '../../core/coords';
import type { CellPlan3 } from './plan';

/**
 * The GPS: routes on foot or by car from where you are to a marked destination, along the streets.
 *
 * A navigation grid over the district (NAV metres a square): roads and plazas are the cheapest, open ground
 * (parks, car parks) a little dearer, the gaps between buildings (yards, setbacks) dearest, and buildings and
 * set pieces blocked. An A* search over it (8 neighbours, no cutting corners past a blocked square) gives the
 * route, kept as a polyline of its turns. Pure: tests build it from the district's plans.
 */

export const NAV = 3;
const ROAD = 1;
const OPEN = 1.6;
const YARD = 4;

export interface NavSource {
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly cells: readonly (readonly [number, number])[];
  plan(mx: number, my: number): CellPlan3 | null;
  /** Set pieces' footprints (stamps): blocked. */
  readonly blocked: readonly Rect[];
  readonly cell: number;
}

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly x0: number;
  readonly z0: number;
  /** Cost to enter each square (0 = can't). */
  readonly cost: Float32Array;

  constructor(src: NavSource) {
    const b = src.bounds;
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
    for (const [mx, my] of src.cells) fill(mx * src.cell, my * src.cell, src.cell, src.cell, YARD);
    for (const [mx, my] of src.cells) for (const q of src.plan(mx, my)?.buildings ?? []) fill(q.x - q.w / 2, q.z - q.d / 2, q.w, q.d, 0, 0.4);
    for (const r of src.blocked) fill(r.x, r.y, r.w, r.h, 0, 0.2);
    for (const [mx, my] of src.cells) {
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
    // Keep the turns only.
    const pts: [number, number][] = [[ax, az]];
    for (let q = 1; q < cells.length - 1; q++) {
      const [p0, p1, p2] = [cells[q - 1], cells[q], cells[q + 1]];
      const d1 = [(p1 % W) - (p0 % W), Math.floor(p1 / W) - Math.floor(p0 / W)];
      const d2 = [(p2 % W) - (p1 % W), Math.floor(p2 / W) - Math.floor(p1 / W)];
      if (d1[0] !== d2[0] || d1[1] !== d2[1]) pts.push(this.centre(p1));
    }
    pts.push([bx, bz]);
    return pts;
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
