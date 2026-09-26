import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import { CELL, STYLES3, type CellPlan3 } from './plan';

/**
 * Traffic routes (content/world3d/traffic.yaml): loops round rectangles of L0 grid lines, driven in the
 * kerb-side lane of the cell-edge roads (Japan keeps left). A route is a closed polyline of lane points in
 * world metres; buses also get their stops (distance along the route, and the kerb point for the shelter).
 */
export interface TrafficLoop {
  readonly rect: readonly [number, number, number, number];
  readonly spacing: number;
}

export interface BusLine {
  readonly id: string;
  readonly name: string;
  readonly en: string;
  readonly rect: readonly [number, number, number, number];
  readonly buses: number;
  readonly stops: readonly string[];
}

export interface TrafficContent {
  readonly cars: readonly TrafficLoop[];
  readonly buses: readonly BusLine[];
}

const isRect = (v: unknown): v is [number, number, number, number] => Array.isArray(v) && v.length === 4 && v.every((n) => Number.isInteger(n)) && v[0] < v[2] && v[1] < v[3];

/** Whether every edge of a grid rectangle has generated cells on both sides. */
export function loopValid(macro: MacroMap, [c0, r0, c1, r1]: readonly [number, number, number, number]): boolean {
  const gen = (c: number, r: number): boolean => macro.kindAt(c, r) in STYLES3;
  for (const c of [c0, c1]) for (let r = r0; r < r1; r++) if (!gen(c - 1, r) || !gen(c, r)) return false;
  for (const r of [r0, r1]) for (let c = c0; c < c1; c++) if (!gen(c, r - 1) || !gen(c, r)) return false;
  return true;
}

export function parseTraffic3(file: string, text: string, macro: MacroMap, errors: string[]): TrafficContent {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: Record<string, unknown>;
  try {
    doc = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return { cars: [], buses: [] };
  }
  const cars: TrafficLoop[] = [];
  for (const [i, raw] of (Array.isArray(doc.cars) ? doc.cars : []).entries()) {
    const r = raw as Record<string, unknown>;
    if (!isRect(r.rect)) err(`cars ${i}: rect must be [col0, row0, col1, row1]`);
    else if (!loopValid(macro, r.rect)) err(`cars ${i}: every edge of [${r.rect.join(', ')}] needs generated cells on both sides`);
    else cars.push({ rect: r.rect, spacing: typeof r.spacing === 'number' && r.spacing >= 12 ? r.spacing : 50 });
  }
  const buses: BusLine[] = [];
  for (const [i, raw] of (Array.isArray(doc.buses) ? doc.buses : []).entries()) {
    const r = raw as Record<string, unknown>;
    if (!isRect(r.rect)) err(`buses ${i}: rect must be [col0, row0, col1, row1]`);
    else if (!loopValid(macro, r.rect)) err(`buses ${i}: every edge of [${r.rect.join(', ')}] needs generated cells on both sides`);
    else if (!Array.isArray(r.stops) || r.stops.length !== 4) err(`buses ${i}: stops must name the 4 stops (north, east, south, west edge)`);
    else buses.push({ id: String(r.id), name: String(r.name), en: String(r.en), rect: r.rect, buses: typeof r.buses === 'number' ? r.buses : 1, stops: r.stops.map(String) });
  }
  return { cars, buses };
}

export type Side = 'north' | 'east' | 'south' | 'west';
export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

export interface Route {
  /** Closed polyline of lane points (x, z); the last point joins the first. */
  readonly pts: readonly (readonly [number, number])[];
  /** Cumulative distance at each point (and the total at the end). */
  readonly dist: readonly number[];
  readonly length: number;
  /** Per edge: the left kerb offset from the lane (for bus shelters) and the edge's mid distance. */
  readonly edges: readonly { readonly mid: number; readonly kerb: readonly [number, number]; readonly dir: readonly [number, number]; readonly side: Side }[];
  /** The signal-controlled junctions along the route (every grid corner it passes), in route order. */
  readonly junctions: readonly Junction[];
}

/** A junction on a route: a grid corner where two cell-edge roads cross. */
export interface Junction {
  /** Grid corner (L0 column and row of the crossing lines). */
  readonly gx: number;
  readonly gy: number;
  /** Distance along the route of the junction centre, and of the stop line before it. */
  readonly s: number;
  readonly stop: number;
  /** The route approaches along the north-south road (travel in z). */
  readonly ns: boolean;
  /** Whether the route turns here (at the rectangle's corners). Right turns cross the oncoming lane. */
  readonly turn: 'left' | 'right' | null;
  /** Width of the road it crosses (the junction box's depth). */
  readonly cross: number;
  readonly x: number;
  readonly z: number;
}

/**
 * The traffic signal at every grid-corner junction: north-south green, amber, all red; then east-west
 * green, amber, all red (and at scramble crossings an all-red pedestrian phase). Each junction runs on its
 * own offset. A pure function of the junction and the time, so the cars and the lamps always agree.
 */
export class Signals {
  static readonly GREEN = 20;
  static readonly AMBER = 3;
  static readonly CLEAR = 3;
  static readonly SCRAMBLE = 14;

  constructor(private readonly scrambles: ReadonlySet<string> = new Set()) {}

  cycle(gx: number, gy: number): number {
    const leg = Signals.GREEN + Signals.AMBER + Signals.CLEAR;
    return 2 * leg + (this.scrambles.has(`${gx},${gy}`) ? Signals.SCRAMBLE : 0);
  }

  /** The light facing traffic on the north-south (ns) or east-west road at a junction, at time t. */
  state(gx: number, gy: number, ns: boolean, t: number): 'green' | 'amber' | 'red' {
    const cycle = this.cycle(gx, gy);
    const offset = (((gx * 7919 + gy * 104729) % cycle) + cycle) % cycle;
    const leg = Signals.GREEN + Signals.AMBER + Signals.CLEAR;
    const u = (((t + offset) % cycle) + cycle) % cycle - (ns ? 0 : leg);
    if (u < 0 || u >= leg) return 'red';
    return u < Signals.GREEN ? 'green' : u < Signals.GREEN + Signals.AMBER ? 'amber' : 'red';
  }

  isScramble(gx: number, gy: number): boolean {
    return this.scrambles.has(`${gx},${gy}`);
  }
}

/**
 * The lane path round a grid rectangle. clockwise (x east, z south, seen from above): north edge east,
 * east edge south... Keep left: the lane is left of the travel direction, half-way across the carriageway
 * half (the narrowest along the edge); at least 2.4 m out from the centre line where a viaduct's piers stand.
 */
export function routeFor(rect: readonly [number, number, number, number], clockwise: boolean, plan: (mx: number, my: number) => CellPlan3 | null, piers: readonly number[]): Route {
  const [c0, r0, c1, r1] = rect;
  const X0 = c0 * CELL;
  const X1 = c1 * CELL;
  const Z0 = r0 * CELL;
  const Z1 = r1 * CELL;
  // Corners and edge directions in travel order.
  const cw: [number, number][] = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
  const corners = clockwise ? cw : [cw[0], cw[3], cw[2], cw[1]];
  // The carriageway half-width of the road under a grid line, the narrowest along [a, b].
  const half = (vertical: boolean, line: number, a: number, b: number): { c: number; w: number; s: number } => {
    let best = { c: Infinity, w: 8, s: 1.6 };
    for (let p = Math.min(a, b) + CELL / 2; p < Math.max(a, b); p += CELL) {
      const mx = Math.floor((vertical ? line : p) / CELL);
      const my = Math.floor((vertical ? p : line) / CELL);
      for (const r of plan(mx, my)?.roads ?? []) {
        if (r.vertical !== vertical || r.kind === 'coast') continue;
        const q = r.rect;
        const on = vertical ? q.x < line && q.x + q.w > line : q.y < line && q.y + q.h > line;
        if (!on) continue;
        const w = vertical ? q.w : q.h;
        const c = w / 2 - r.sidewalk;
        if (c < best.c) best = { c, w, s: r.sidewalk };
      }
    }
    return Number.isFinite(best.c) ? best : { c: 2.4, w: 8, s: 1.6 };
  };
  const lanes: { p: [number, number]; d: [number, number]; o: number; kerb: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const d: [number, number] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const vertical = d[0] === 0;
    const line = vertical ? a[0] : a[1];
    const h = half(vertical, line, vertical ? a[1] : a[0], vertical ? b[1] : b[0]);
    let o = Math.max(1.1, h.c / 2);
    if (vertical && piers.some((x) => Math.abs(x - line) < 1)) o = Math.max(o, 2.4);
    // Left of travel: (dz, -dx).
    lanes.push({ p: a, d, o, kerb: h.w / 2 - h.s * 0.5 });
  }
  // Lane line i: p + left * o; consecutive lane lines cross at the new corners.
  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const A = lanes[(i + 3) % 4];
    const B = lanes[i];
    const la: [number, number] = [A.d[1], -A.d[0]];
    const lb: [number, number] = [B.d[1], -B.d[0]];
    // One of the two is vertical: take x from the vertical lane line, z from the horizontal one.
    const vx = A.d[0] === 0 ? A.p[0] + la[0] * A.o : B.p[0] + lb[0] * B.o;
    const hz = A.d[0] !== 0 ? A.p[1] + la[1] * A.o : B.p[1] + lb[1] * B.o;
    pts.push([vx, hz]);
  }
  const dist = [0];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    dist.push(dist[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const edges = lanes.map((l, i) => {
    const left: [number, number] = [l.d[1], -l.d[0]];
    const side: Side = l.d[0] === 0 ? (l.p[0] === X0 ? 'west' : 'east') : l.p[1] === Z0 ? 'north' : 'south';
    return { mid: (dist[i] + dist[i + 1]) / 2, kerb: [left[0] * (l.kerb - l.o), left[1] * (l.kerb - l.o)] as [number, number], dir: l.d, side };
  });
  // Junctions: every grid corner along each edge (including the corner it turns at, not the one it
  // started from), projected onto the lane; the stop line sits before the crossing road's zebra.
  const junctions: Junction[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const l = lanes[i];
    const vertical = l.d[0] === 0;
    const n = Math.round(Math.abs(vertical ? b[1] - a[1] : b[0] - a[0]) / CELL);
    for (let k = 1; k <= n; k++) {
      const G: [number, number] = vertical ? [a[0], a[1] + l.d[1] * k * CELL] : [a[0] + l.d[0] * k * CELL, a[1]];
      const proj = (G[0] - pts[i][0]) * l.d[0] + (G[1] - pts[i][1]) * l.d[1];
      const s = dist[i] + proj;
      const cross = half(!vertical, vertical ? G[1] : G[0], (vertical ? G[0] : G[1]) - CELL / 2, (vertical ? G[0] : G[1]) + CELL / 2).w;
      let turn: Junction['turn'] = null;
      if (k === n) {
        const nd = lanes[(i + 1) % 4].d;
        turn = l.d[0] * nd[1] - l.d[1] * nd[0] > 0 ? 'right' : 'left';
      }
      junctions.push({ gx: Math.round(G[0] / CELL), gy: Math.round(G[1] / CELL), s, stop: s - cross / 2 - 5, ns: vertical, turn, cross, x: G[0], z: G[1] });
    }
  }
  return { pts, dist, length: dist[4], edges, junctions };
}

/** Position and heading at distance s along a route (headings ease round the corners). */
export function along(route: Route, s: number): { x: number; z: number; dx: number; dz: number } {
  const L = route.length;
  s = ((s % L) + L) % L;
  let i = 0;
  while (i < 3 && s >= route.dist[i + 1]) i++;
  const a = route.pts[i];
  const b = route.pts[(i + 1) % 4];
  const len = route.dist[i + 1] - route.dist[i];
  const t = s - route.dist[i];
  const d: [number, number] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  let [dx, dz] = d;
  const R = 5;
  if (t < R) {
    const p = route.pts[(i + 3) % 4];
    const dp: [number, number] = [(a[0] - p[0]) / Math.hypot(a[0] - p[0], a[1] - p[1]), (a[1] - p[1]) / Math.hypot(a[0] - p[0], a[1] - p[1])];
    const k = 0.5 + (t / R) * 0.5;
    dx = dp[0] * (1 - k) + d[0] * k;
    dz = dp[1] * (1 - k) + d[1] * k;
  } else if (len - t < R) {
    const c = route.pts[(i + 2) % 4];
    const dn: [number, number] = [(c[0] - b[0]) / Math.hypot(c[0] - b[0], c[1] - b[1]), (c[1] - b[1]) / Math.hypot(c[0] - b[0], c[1] - b[1])];
    const k = 0.5 + ((len - t) / R) * 0.5;
    dx = d[0] * k + dn[0] * (1 - k);
    dz = d[1] * k + dn[1] * (1 - k);
  }
  const n = Math.hypot(dx, dz) || 1;
  return { x: a[0] + d[0] * t, z: a[1] + d[1] * t, dx: dx / n, dz: dz / n };
}

