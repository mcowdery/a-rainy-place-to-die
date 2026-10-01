import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import { roadClass } from './gps';
import type { Rect } from '../../core/coords';
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
  /** Generated car loops over the rest of the city (`carLoops`): their size in cells and their spacing. */
  readonly auto: { readonly size: number; readonly spacing: number } | null;
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
    return { cars: [], buses: [], auto: null };
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
  let auto: TrafficContent['auto'] = null;
  if (doc.auto !== undefined) {
    const a = doc.auto as Record<string, unknown>;
    if (!Number.isInteger(a?.size) || (a.size as number) < 1 || (a.size as number) > 4) err('auto.size: 1-4 cells');
    else auto = { size: a.size as number, spacing: typeof a.spacing === 'number' && a.spacing >= 12 ? a.spacing : 50 };
  }
  return { cars, buses, auto };
}

/**
 * Every car loop: the authored ones, then (with `auto`) generated ones tiling the rest of the city, a square of
 * `size` cells on a fixed lattice, wherever it overlaps no other loop, has generated cells on both sides of every
 * edge, and every road along its edges is a proper street (raised pavements, or an avenue: the roads the GPS
 * drives, gps.ts `roadClass`). So traffic comes with each new district; the narrow lanes stay quiet.
 */
export function carLoops(macro: MacroMap, traffic: TrafficContent, plan: (mx: number, my: number) => CellPlan3 | null, avoid: readonly Rect[] = []): TrafficLoop[] {
  const out = [...traffic.cars];
  const a = traffic.auto;
  if (!a) return out;
  const n = a.size;
  const overlaps = (p: readonly number[], q: readonly number[]): boolean => p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3];
  // The roads along a grid line between two points on it, as the planner laid them out in the cells beside it.
  const proper = (vertical: boolean, line: number, a0: number, a1: number): boolean => {
    for (let k = a0; k < a1; k++) {
      let found = false;
      for (const side of [line - 1, line]) {
        for (const r of plan(vertical ? side : k, vertical ? k : side)?.roads ?? []) {
          if (r.vertical !== vertical || r.kind === 'coast') continue;
          const q = r.rect;
          const at = line * CELL;
          if (vertical ? !(q.x < at && q.x + q.w > at) : !(q.y < at && q.y + q.h > at)) continue;
          found = true;
          if (roadClass(r) !== 'main') return false;
        }
      }
      if (!found) return false;
    }
    return true;
  };
  // Generated cells on both sides of every edge (by the plans: a residential cell no zone paints isn't built).
  const builtRound = ([c0, r0, c1, r1]: readonly number[]): boolean => {
    for (let r = r0 - 1; r <= r1; r++) for (let c = c0 - 1; c <= c1; c++) if (!plan(c, r)) return false;
    return true;
  };
  for (let r0 = 0; r0 + n <= macro.rows; r0 += n) {
    for (let c0 = 0; c0 + n <= macro.cols; c0 += n) {
      const rect = [c0, r0, c0 + n, r0 + n] as const;
      if (out.some((l) => overlaps(l.rect, rect)) || !builtRound(rect)) continue;
      if (!proper(false, r0, c0, c0 + n) || !proper(false, r0 + n, c0, c0 + n) || !proper(true, c0, r0, r0 + n) || !proper(true, c0 + n, r0, r0 + n)) continue;
      // Not along a street with an expressway ramp's walled foot in it (it stands in the kerb lane).
      const X0 = c0 * CELL;
      const X1 = (c0 + n) * CELL;
      const Z0 = r0 * CELL;
      const Z1 = (r0 + n) * CELL;
      const onEdge = (q: Rect): boolean =>
        q.x < X1 + 16 && q.x + q.w > X0 - 16 && q.y < Z1 + 16 && q.y + q.h > Z0 - 16 && !(q.x > X0 + 16 && q.x + q.w < X1 - 16 && q.y > Z0 + 16 && q.y + q.h < Z1 - 16);
      if (avoid.some(onEdge)) continue;
      out.push({ rect, spacing: a.spacing });
    }
  }
  return out;
}

export type Side = 'north' | 'east' | 'south' | 'west';
export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

export interface Route {
  /** The lane lines' corners (x, z), where the lane lines cross; the driven path rounds them (`path`). */
  readonly pts: readonly (readonly [number, number])[];
  /** The driven path: straights joined by turns, sampled (see `along`). */
  readonly path: Path;
  readonly length: number;
  /** Per edge: the left kerb offset from the lane (for bus shelters) and where its stop is (`mid`, a distance
   * along the path: mid-block near the edge's middle, on a stretch of kerb clear of crossing streets). */
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
  /** The turn's tightest radius (m), for the speed to take it at; 0 when going straight on. */
  readonly radius: number;
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

  /**
   * When people on foot may cross at a junction: walking parallel to the north-south road (`alongNS`) they go
   * with its green, otherwise with the east-west road's; at a scramble everyone goes in the scramble phase.
   * The walk light starts at `start` (seconds, mod `cycle`, on the same clock as `state`) and lasts `length`.
   */
  walkPhase(gx: number, gy: number, alongNS: boolean): { cycle: number; start: number; length: number } {
    const cycle = this.cycle(gx, gy);
    const offset = (((gx * 7919 + gy * 104729) % cycle) + cycle) % cycle;
    const leg = Signals.GREEN + Signals.AMBER + Signals.CLEAR;
    const scramble = this.isScramble(gx, gy);
    const at = scramble ? 2 * leg : alongNS ? 0 : leg;
    return { cycle, start: (((at - offset) % cycle) + cycle) % cycle, length: scramble ? Signals.SCRAMBLE : Signals.GREEN };
  }
}

/** The scramble junctions (grid points "gx,gy"), from the stamps that mark one. */
export function scrambleKeys(placed: readonly { readonly rect: { readonly x: number; readonly y: number }; readonly stamp: { readonly scramble?: readonly [number, number] | null } }[], cell: number): Set<string> {
  return new Set(placed.filter((p) => p.stamp.scramble).map((p) => `${Math.round((p.rect.x + p.stamp.scramble![0]) / cell)},${Math.round((p.rect.y + p.stamp.scramble![1]) / cell)}`));
}

/**
 * The lane path round a grid rectangle. clockwise (x east, z south, seen from above): north edge east,
 * east edge south... Keep left: the lane is left of the travel direction, half-way across the carriageway
 * half (the narrowest along the edge); at least 2.4 m out from the centre line where a viaduct's piers stand.
 */
/** Piers: viaducts' straight runs along grid lines (x0, z0 to x1, z1): an edge under one keeps its lane clear of the piers. */
export function routeFor(rect: readonly [number, number, number, number], clockwise: boolean, plan: (mx: number, my: number) => CellPlan3 | null, piers: readonly { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }[]): Route {
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
    // Two lanes each way (an avenue): the kerb lane (keep left; the inner one is for overtaking and the
    // expressway's ramps). One lane: its middle.
    let o = h.c >= 9 ? h.c - 3 : Math.max(1.1, h.c / 2);
    const [ea, eb] = vertical ? [Math.min(a[1], b[1]), Math.max(a[1], b[1])] : [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const under = piers.some((q) => (vertical ? q.x0 === q.x1 && Math.abs(q.x0 - line) < 1 && q.z0 < eb && q.z1 > ea : q.z0 === q.z1 && Math.abs(q.z0 - line) < 1 && q.x0 < eb && q.x1 > ea));
    if (under) o = Math.max(o, 2.4);
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
  // The driven path: each corner rounded by a turn (steering wound in, held, wound out: see TURN), tighter
  // for left turns (round the near kerb) than right ones (across the junction). Corner i joins lane i-1 to i.
  const turnAt = lanes.map((l, i) => {
    const din = lanes[(i + 3) % 4].d;
    const right = din[0] * l.d[1] - din[1] * l.d[0] > 0;
    const R = right ? TURN_R.right : TURN_R.left;
    return { right, R, leg: TURN.leg * R, len: TURN.len * R };
  });
  const edgeLen = pts.map((p, i) => Math.hypot(pts[(i + 1) % 4][0] - p[0], pts[(i + 1) % 4][1] - p[1]));
  const straight = edgeLen.map((len, i) => len - turnAt[i].leg - turnAt[(i + 1) % 4].leg);
  // s where each edge's straight starts: the path starts on edge 0's straight, then turn 1, straight 1...
  const start: number[] = [0];
  for (let i = 1; i < 4; i++) start.push(start[i - 1] + straight[i - 1] + turnAt[i].len);
  const length = start[3] + straight[3] + turnAt[0].len;
  /** Distance along the path of the point `proj` metres along edge i from its corner (turns share it out). */
  const onEdge = (i: number, proj: number): number => {
    const a = turnAt[i];
    const b = turnAt[(i + 1) % 4];
    let s: number;
    if (proj < a.leg) s = start[i] - ((a.leg - proj) / a.leg) * (a.len / 2);
    else if (proj > edgeLen[i] - b.leg) s = start[i] + straight[i] + ((proj - (edgeLen[i] - b.leg)) / b.leg) * (b.len / 2);
    else s = start[i] + proj - a.leg;
    return ((s % length) + length) % length;
  };
  const path = buildPath(pts, lanes.map((l) => l.d), turnAt, straight, start, length);
  // A crossing street (one running across this edge) at (x, z): a bus stop can't stand there.
  const crossing = (x: number, z: number, vertical: boolean): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const r of plan(Math.floor(x / CELL) + dx, Math.floor(z / CELL) + dy)?.roads ?? []) {
          if (r.vertical === vertical || r.kind === 'coast') continue;
          const q = r.rect;
          if (x > q.x - 0.5 && x < q.x + q.w + 0.5 && z > q.y - 0.5 && z < q.y + q.h + 0.5) return true;
        }
      }
    }
    return false;
  };
  const edges = lanes.map((l, i) => {
    const left: [number, number] = [l.d[1], -l.d[0]];
    const side: Side = l.d[0] === 0 ? (l.p[0] === X0 ? 'west' : 'east') : l.p[1] === Z0 ? 'north' : 'south';
    const kerb: [number, number] = [left[0] * (l.kerb - l.o), left[1] * (l.kerb - l.o)];
    // The stop: mid-block (an edge's middle is often a junction), the block nearest the middle first, moved
    // along until the shelter and its pole (3 m behind to 4 m ahead) stand clear of any crossing street.
    const vertical = l.d[0] === 0;
    const blocks = Math.max(1, Math.round(edgeLen[i] / CELL));
    const origin = (pts[i][0] - l.p[0]) * l.d[0] + (pts[i][1] - l.p[1]) * l.d[1];
    const at = (t: number): [number, number] => [l.p[0] + l.d[0] * t + left[0] * l.kerb, l.p[1] + l.d[1] * t + left[1] * l.kerb];
    const clear = (t: number): boolean => [-3, -1, 1, 3, 4].every((k) => !crossing(...at(t + k), vertical));
    const mids = Array.from({ length: blocks }, (_, k) => (k + 0.5) * CELL).sort((p, q) => Math.abs(p - (blocks * CELL) / 2) - Math.abs(q - (blocks * CELL) / 2));
    let stop = mids[0];
    search: for (const m of mids) {
      for (let off = 0; off <= 48; off += 4) {
        for (const t of off ? [m + off, m - off] : [m]) {
          if (clear(t)) {
            stop = t;
            break search;
          }
        }
      }
    }
    return { mid: onEdge(i, Math.max(0, Math.min(edgeLen[i], stop - origin))), kerb, dir: l.d, side };
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
      const cross = half(!vertical, vertical ? G[1] : G[0], (vertical ? G[0] : G[1]) - CELL / 2, (vertical ? G[0] : G[1]) + CELL / 2).w;
      const t = k === n ? turnAt[(i + 1) % 4] : null;
      const turn: Junction['turn'] = t ? (t.right ? 'right' : 'left') : null;
      // The stop line: before the crossing road's zebra, and before the turn starts.
      const stopProj = Math.min(proj - cross / 2 - 5, t ? edgeLen[i] - t.leg - 0.5 : Infinity);
      junctions.push({ gx: Math.round(G[0] / CELL), gy: Math.round(G[1] / CELL), s: onEdge(i, proj), stop: onEdge(i, stopProj), ns: vertical, turn, radius: t?.R ?? 0, cross, x: G[0], z: G[1] });
    }
  }
  return { pts, path, length, edges, junctions };
}

/** Tightest turn radius at a corner (m): left turns hug the near kerb, right turns sweep across the junction. */
export const TURN_R = { left: 5.2, right: 8.5 } as const;

/**
 * The shape of a 90-degree turn for a tightest radius of 1, as a driver steers it: the wheel wound in
 * (curvature rising linearly: a clothoid), held (an arc), wound out again, a third of the length each. `pts`
 * run from the entry (0, 0) heading +x to the exit, turning toward +y; `leg` is how far before and after the
 * corner (where the lane lines cross) the turn starts and ends.
 */
export const TURN = (() => {
  const a = Math.PI / 4;
  const len = 3 * a;
  const N = 36;
  const steps = N * 20;
  const kappa = (u: number): number => (u < a ? u / a : u < 2 * a ? 1 : (len - u) / a);
  const pts: { u: number; x: number; y: number; th: number; k: number }[] = [{ u: 0, x: 0, y: 0, th: 0, k: 0 }];
  let x = 0;
  let y = 0;
  let th = 0;
  const du = len / steps;
  for (let s = 1; s <= steps; s++) {
    const um = (s - 0.5) * du;
    const thm = th + (kappa(um) * du) / 2;
    x += Math.cos(thm) * du;
    y += Math.sin(thm) * du;
    th += kappa(um) * du;
    if (s % (steps / N) === 0) pts.push({ u: s * du, x, y, th, k: kappa(s * du) });
  }
  // Symmetric: the corner is where the entry line (y = 0) meets the exit line (x = end x).
  return { len, leg: x, pts };
})();

export interface Path {
  /** Samples: distance, position, heading (unit), signed curvature (1/m, positive turning right). */
  readonly s: Float64Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly hx: Float64Array;
  readonly hz: Float64Array;
  readonly k: Float64Array;
}

function buildPath(
  pts: readonly (readonly [number, number])[],
  dirs: readonly (readonly [number, number])[],
  turns: readonly { right: boolean; R: number; leg: number; len: number }[],
  straight: readonly number[],
  start: readonly number[],
  length: number,
): Path {
  const S: number[] = [];
  const X: number[] = [];
  const Z: number[] = [];
  const HX: number[] = [];
  const HZ: number[] = [];
  const K: number[] = [];
  const push = (s: number, x: number, z: number, hx: number, hz: number, k: number): void => {
    S.push(s);
    X.push(x);
    Z.push(z);
    HX.push(hx);
    HZ.push(hz);
    K.push(k);
  };
  for (let i = 0; i < 4; i++) {
    const d = dirs[i];
    const t0 = turns[i];
    const s0 = start[i];
    // The straight along edge i.
    push(s0, pts[i][0] + d[0] * t0.leg, pts[i][1] + d[1] * t0.leg, d[0], d[1], 0);
    // The turn at corner i+1, from the unit shape: along the entry direction (x) and toward the exit (y).
    const j = (i + 1) % 4;
    const t = turns[j];
    const out = dirs[j];
    const C = pts[j];
    const ox = C[0] - d[0] * t.leg;
    const oz = C[1] - d[1] * t.leg;
    const sgn = t.right ? 1 : -1;
    for (const p of TURN.pts) {
      const c = Math.cos(p.th);
      const sn = Math.sin(p.th);
      push(s0 + straight[i] + p.u * t.R, ox + (d[0] * p.x + out[0] * p.y) * t.R, oz + (d[1] * p.x + out[1] * p.y) * t.R, d[0] * c + out[0] * sn, d[1] * c + out[1] * sn, (sgn * p.k) / t.R);
    }
  }
  push(length, X[0], Z[0], HX[0], HZ[0], 0);
  return { s: Float64Array.from(S), x: Float64Array.from(X), z: Float64Array.from(Z), hx: Float64Array.from(HX), hz: Float64Array.from(HZ), k: Float64Array.from(K) };
}

/** Position, heading and curvature (1/m, positive turning right) at distance s along a route. */
export function along(route: Route, s: number): { x: number; z: number; dx: number; dz: number; k: number } {
  const L = route.length;
  const P = route.path;
  s = ((s % L) + L) % L;
  let lo = 0;
  let hi = P.s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (P.s[m] <= s) lo = m;
    else hi = m;
  }
  const span = P.s[hi] - P.s[lo];
  const f = span > 0 ? (s - P.s[lo]) / span : 0;
  const hx = P.hx[lo] + (P.hx[hi] - P.hx[lo]) * f;
  const hz = P.hz[lo] + (P.hz[hi] - P.hz[lo]) * f;
  const n = Math.hypot(hx, hz) || 1;
  return { x: P.x[lo] + (P.x[hi] - P.x[lo]) * f, z: P.z[lo] + (P.z[hi] - P.z[lo]) * f, dx: hx / n, dz: hz / n, k: P.k[lo] + (P.k[hi] - P.k[lo]) * f };
}

