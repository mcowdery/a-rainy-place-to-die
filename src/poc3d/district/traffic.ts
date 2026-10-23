import YAML from 'yaml';
import type { MacroMap } from '../../gen/macro';
import { roadClass } from './gps';
import type { Rect } from '../../core/coords';
import { CELL, STYLES3, type CellPlan3 } from './plan';
import type { StopKind, StopSite } from './stops';

/**
 * Traffic routes (content/world3d/traffic.yaml): loops round rectangles of L0 grid lines, driven in the
 * kerb-side lane of the cell-edge roads (Japan keeps left). A route is a closed polyline of lane points in
 * world metres; buses also get their stops (distance along the route, and the kerb point for the shelter).
 */
export interface TrafficLoop {
  readonly rect: readonly [number, number, number, number];
  readonly spacing: number;
}

/**
 * A place a bus line serves: a set piece (`at`, a placement's id: the stop stands in the block of the loop nearest
 * it, as near it as a good spot is) or a cell beside the loop (`cell`: [col, row] of the cell on the kerb's side, the
 * loop's inside; `side` picks the loop's side for a corner cell).
 */
export interface StopSpec {
  readonly name: string;
  readonly at?: string;
  readonly cell?: readonly [number, number];
  readonly side?: Side;
}

export interface BusLine {
  readonly id: string;
  readonly name: string;
  readonly en: string;
  readonly rect: readonly [number, number, number, number];
  readonly buses: number;
  /** Its stops' names (four, by the loop's north, east, south and west side, on a line that serves no named places). */
  readonly stops: readonly string[];
  /** The places it serves, each a stop (stops.ts); null: one stop a side, named by `stops`. */
  readonly serves: readonly StopSpec[] | null;
  /** A jeepney line (Manila): the livery its jeepneys wear (index into JEEPNEY_LIVERIES, whose route board is the line's). */
  readonly jeepney?: number;
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
    else if (!Array.isArray(r.stops) || r.stops.length === 0) err(`buses ${i}: stops must name the 4 stops (north, east, south, west edge) or list the places served`);
    else {
      // Four names: one stop a side. A list of places ({ name, at } or { name, cell, side? }): a stop at each.
      const named = r.stops.every((q) => typeof q === 'string');
      const serves: StopSpec[] = [];
      if (named && r.stops.length !== 4) err(`buses ${i}: stops by name must be 4 (north, east, south, west edge)`);
      if (!named) {
        for (const [j, q] of (r.stops as unknown[]).entries()) {
          const o = (typeof q === 'object' && q !== null ? q : {}) as Record<string, unknown>;
          const cell = Array.isArray(o.cell) && o.cell.length === 2 && o.cell.every((n) => Number.isInteger(n)) ? (o.cell as [number, number]) : null;
          const side = SIDES.includes(o.side as Side) ? (o.side as Side) : null;
          if (typeof o.name !== 'string' || !o.name.trim()) err(`buses ${i} stop ${j}: needs a name`);
          else if ((typeof o.at === 'string') === !!cell) err(`buses ${i} stop ${o.name}: needs one of at (a placement's id) or cell ([col, row])`);
          else if (o.side !== undefined && !side) err(`buses ${i} stop ${o.name}: side is north, east, south or west`);
          else serves.push({ name: o.name.trim(), ...(typeof o.at === 'string' ? { at: o.at } : {}), ...(cell ? { cell } : {}), ...(side ? { side } : {}) });
        }
      }
      buses.push({ id: String(r.id), name: String(r.name), en: String(r.en), rect: r.rect, buses: typeof r.buses === 'number' ? r.buses : 1, stops: named ? r.stops.map(String) : serves.map((q) => q.name), serves: named ? null : serves, ...(Number.isInteger(r.jeepney) ? { jeepney: r.jeepney as number } : {}) });
    }
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
      // Not along a street with an expressway ramp's walled foot in it (in the inner lane, which turning traffic crosses).
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
  /** Per edge: from the lane to the left kerb's pavement (its middle), the way along it, and which side of the loop it is. */
  readonly edges: readonly { readonly kerb: readonly [number, number]; readonly dir: readonly [number, number]; readonly side: Side }[];
  /** A bus line's stops in the order it was given them (stops.ts chose the spots); none on a car loop. */
  readonly stops: readonly RouteStop[];
  /** The signal-controlled junctions along the route (every grid corner it passes), in route order. */
  readonly junctions: readonly Junction[];
}

/** A stop on a bus line's route. */
export interface RouteStop {
  /** Where along the path the bus's middle stands. */
  readonly s: number;
  /** From the lane there to the middle of the pavement, the way the bus travels, and the loop's side. */
  readonly kerb: readonly [number, number];
  readonly dir: readonly [number, number];
  readonly side: Side;
  readonly name: string;
  readonly kind: StopKind;
  /** The pavement's width and the clear depth behind its kerb (m). */
  readonly pavement: number;
  readonly depth: number;
  /** How far the bus eases over to its left as it comes in, to stand by the kerb (m). */
  readonly pull: number;
}

/** The lane moves sideways no faster than this (m a metre along), stays this far inside a narrow block before and after it, and its corners are rounded over this many metres. */
const LANE_SLOPE = 0.16;
const LANE_PAD = 8;
const LANE_ROUND = 6;

/**
 * A lane's offset from its road's centre line along an edge, given each block's own (`ob`, metres along from the
 * edge's first grid corner): each block's where the road is that wide, easing from one to the next on the wider
 * block's side of the junction between them (never further out than a narrow block allows, even beside it), smooth
 * enough to drive without a swerve.
 */
function laneProfile(ob: readonly number[]): (t: number) => number {
  if (ob.every((o) => o === ob[0])) return () => ob[0];
  const len = ob.length * CELL;
  const env = (t: number): number => {
    const tt = Math.min(len, Math.max(0, t));
    let v = Infinity;
    for (let k = 0; k < ob.length; k++) v = Math.min(v, ob[k] + LANE_SLOPE * Math.max(0, k * CELL - LANE_PAD - tt, tt - (k + 1) * CELL - LANE_PAD));
    return v;
  };
  let f = Float64Array.from({ length: len + 1 }, (_, m) => env(m));
  for (let pass = 0; pass < 2; pass++) {
    const g = new Float64Array(len + 1);
    for (let m = 0; m <= len; m++) {
      let sum = 0;
      for (let j = m - LANE_ROUND; j <= m + LANE_ROUND; j++) sum += f[Math.min(len, Math.max(0, j))];
      g[m] = sum / (2 * LANE_ROUND + 1);
    }
    f = g;
  }
  return (t) => {
    const u = Math.min(len - 1e-6, Math.max(0, t));
    const i = Math.floor(u);
    return f[i] + (f[i + 1] - f[i]) * (u - i);
  };
}

/** A bus's half width, the gap it leaves to the kerb at a stop, and the furthest it will ease over for one (m). */
export const STOP_BUS_HALF = 1.25;
export const STOP_KERB_GAP = 0.4;
export const STOP_PULL_MAX = 4.5;

/**
 * The traffic's lane, from a road's centre line, for a carriageway half `c` (kerb to centre): on two lanes each way
 * (an avenue) the kerb lane (keep left; the inner one is for overtaking and the expressway's ramps), on one lane
 * its middle.
 */
export const laneOffset = (c: number): number => (c >= 9 ? c - 3 : Math.max(1.1, c / 2));

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
  // (Long enough to walk a scramble's diagonal at a stroll, corner to corner, with the cars all stopped.)
  static readonly SCRAMBLE = 25;

  constructor(private readonly scrambles: ReadonlySet<string> = new Set()) {}

  cycle(gx: number, gy: number): number {
    const leg = Signals.GREEN + Signals.AMBER + Signals.CLEAR;
    return 2 * leg + (this.scrambles.has(`${gx},${gy}`) ? Signals.SCRAMBLE : 0);
  }

  /** The light facing traffic on the north-south (ns) or east-west road at a junction, at time t. */
  /** A junction with no power (a brownout, Manila): its lamps are dark and the traffic takes turns. */
  dead: (gx: number, gy: number) => boolean = () => false;

  state(gx: number, gy: number, ns: boolean, t: number): 'green' | 'amber' | 'red' {
    if (this.dead(gx, gy)) {
      // Give way: each road in turn, 6 s a go with the gaps between, nothing lit.
      const u = (((t + gx * 3 + gy * 5) % 16) + 16) % 16;
      return (ns ? u < 6 : u >= 8 && u < 14) ? 'green' : 'red';
    }
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
export function routeFor(
  rect: readonly [number, number, number, number],
  clockwise: boolean,
  plan: (mx: number, my: number) => CellPlan3 | null,
  piers: readonly { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }[],
  /** A bus line's stops (stops.ts lineStops: the model's `DistrictModel.busStops`); none for a car loop. */
  sites: readonly StopSite[] = [],
): Route {
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
        // (A slip lane along each kerb isn't one of the traffic's lanes.)
        const c = w / 2 - r.sidewalk - (r.slip ?? 0) / 2;
        if (c < best.c) best = { c, w, s: r.sidewalk };
      }
    }
    return Number.isFinite(best.c) ? best : { c: 2.4, w: 8, s: 1.6 };
  };
  const lanes: { p: [number, number]; d: [number, number]; o: number; kerb: number; off: (t: number) => number; len: number; flat: boolean }[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const d: [number, number] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const vertical = d[0] === 0;
    const line = vertical ? a[0] : a[1];
    const h = half(vertical, line, vertical ? a[1] : a[0], vertical ? b[1] : b[0]);
    const [ea, eb] = vertical ? [Math.min(a[1], b[1]), Math.max(a[1], b[1])] : [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const under = piers.some((q) => (vertical ? q.x0 === q.x1 && Math.abs(q.x0 - line) < 1 && q.z0 < eb && q.z1 > ea : q.z0 === q.z1 && Math.abs(q.z0 - line) < 1 && q.x0 < eb && q.x1 > ea));
    // The lane block by block (a block: the 128 m between two grid junctions). Two lanes each way (an avenue): the
    // kerb lane (keep left; the inner one is for overtaking and the expressway's ramps). One lane: its middle. An
    // edge whose road widens along its length (into an avenue) has its lane follow the kerb lane out (`laneProfile`):
    // it used to keep to the narrowest block's all along, so on the wide blocks the traffic drove by the median.
    const blocks = Math.max(1, Math.round((eb - ea) / CELL));
    const a0 = vertical ? a[1] : a[0];
    const sg = vertical ? d[1] : d[0];
    const ob = Array.from({ length: blocks }, (_, k) => {
      const o = laneOffset(half(vertical, line, a0 + sg * k * CELL, a0 + sg * (k + 1) * CELL).c);
      return under ? Math.max(o, 2.4) : o;
    });
    // Left of travel: (dz, -dx).
    lanes.push({ p: a, d, o: Math.min(...ob), kerb: h.w / 2 - h.s * 0.5, off: laneProfile(ob), len: blocks * CELL, flat: ob.every((o) => o === ob[0]) });
  }
  // Lane line i: p + left * its offset; consecutive lane lines cross at the new corners (each at its offset there:
  // the end of the edge coming in, the start of the one going out).
  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const A = lanes[(i + 3) % 4];
    const B = lanes[i];
    const la: [number, number] = [A.d[1], -A.d[0]];
    const lb: [number, number] = [B.d[1], -B.d[0]];
    const ao = A.off(A.len);
    const bo = B.off(0);
    // One of the two is vertical: take x from the vertical lane line, z from the horizontal one.
    const vx = A.d[0] === 0 ? A.p[0] + la[0] * ao : B.p[0] + lb[0] * bo;
    const hz = A.d[0] !== 0 ? A.p[1] + la[1] * ao : B.p[1] + lb[1] * bo;
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
  // (Along the edge: its two corners needn't be the same distance out from its grid line.)
  const edgeLen = pts.map((p, i) => (pts[(i + 1) % 4][0] - p[0]) * lanes[i].d[0] + (pts[(i + 1) % 4][1] - p[1]) * lanes[i].d[1]);
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
  // How far left of its corner's lane line the lane is, `tau` metres along edge i from that corner.
  const origins = lanes.map((l, i) => (pts[i][0] - l.p[0]) * l.d[0] + (pts[i][1] - l.p[1]) * l.d[1]);
  const lateral = (i: number, tau: number): number => lanes[i].off(origins[i] + tau) - lanes[i].off(0);
  const path = buildPath(pts, lanes.map((l) => l.d), turnAt, straight, start, length, lanes.map((l) => !l.flat), lateral);
  const edges = lanes.map((l) => {
    const left: [number, number] = [l.d[1], -l.d[0]];
    const side: Side = l.d[0] === 0 ? (l.p[0] === X0 ? 'west' : 'east') : l.p[1] === Z0 ? 'north' : 'south';
    return { kerb: [left[0] * (l.kerb - l.o), left[1] * (l.kerb - l.o)] as [number, number], dir: l.d, side };
  });
  // The stops (stops.ts chose where along each edge and on which kerb): where on the path the bus's middle stands,
  // and how far its lane is from the kerb there (an edge can widen along its length, into an avenue: the lane keeps
  // to the narrowest stretch's, so the bus eases over to the kerb as it comes in).
  const stops: RouteStop[] = sites.map((st) => {
    const l = lanes[st.edge];
    const left: [number, number] = [l.d[1], -l.d[0]];
    const origin = origins[st.edge];
    // (From the lane as it is at this block to the pavement's middle.)
    const out = st.kerb - l.off(st.t);
    return {
      s: onEdge(st.edge, Math.max(0, Math.min(edgeLen[st.edge], st.t - origin))),
      kerb: [left[0] * out, left[1] * out] as [number, number],
      dir: l.d,
      side: st.side,
      name: st.name,
      kind: st.kind,
      pavement: st.pavement,
      depth: st.depth,
      pull: Math.max(0, Math.min(STOP_PULL_MAX, out - st.pavement / 2 - STOP_BUS_HALF - STOP_KERB_GAP)),
    };
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
      // The junction box's depth: the wider of the crossing road's two arms, either side of this edge's line (the
      // crossings and stop lines stand off the one box: plan.ts junctionSpans).
      const [crossLine, here] = vertical ? [G[1], G[0]] : [G[0], G[1]];
      const cross = Math.max(half(!vertical, crossLine, here - CELL, here).w, half(!vertical, crossLine, here, here + CELL).w);
      const t = k === n ? turnAt[(i + 1) % 4] : null;
      const turn: Junction['turn'] = t ? (t.right ? 'right' : 'left') : null;
      // The stop line: before the crossing road's zebra, and before the turn starts.
      const stopProj = Math.min(proj - cross / 2 - 5, t ? edgeLen[i] - t.leg - 0.5 : Infinity);
      junctions.push({ gx: Math.round(G[0] / CELL), gy: Math.round(G[1] / CELL), s: onEdge(i, proj), stop: onEdge(i, stopProj), ns: vertical, turn, radius: t?.R ?? 0, cross, x: G[0], z: G[1] });
    }
  }
  return { pts, path, length, edges, stops, junctions };
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
  /** Per edge, whether its lane shifts sideways along it, and how far left of its corner's lane line it is at `tau` m along. */
  shifts: readonly boolean[] = [],
  lateral: (i: number, tau: number) => number = () => 0,
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
    // The straight along edge i (sampled every 2 m where its lane shifts with the road's width: the heading
    // leans with the shift, so a vehicle still points the way it moves).
    push(s0, pts[i][0] + d[0] * t0.leg, pts[i][1] + d[1] * t0.leg, d[0], d[1], 0);
    if (shifts[i]) {
      const left = [d[1], -d[0]];
      for (let tau = t0.leg + 2; tau < t0.leg + straight[i] - 1; tau += 2) {
        const l = lateral(i, tau);
        const slope = lateral(i, tau + 0.5) - lateral(i, tau - 0.5);
        const n = Math.hypot(1, slope);
        push(s0 + tau - t0.leg, pts[i][0] + d[0] * tau + left[0] * l, pts[i][1] + d[1] * tau + left[1] * l, (d[0] + left[0] * slope) / n, (d[1] + left[1] * slope) / n, 0);
      }
    }
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

/** Where `along` puts its answer. */
export interface RoutePoint {
  x: number;
  z: number;
  dx: number;
  dz: number;
  k: number;
}

/**
 * Position, heading and curvature (1/m, positive turning right) at distance s along a route. Into `out` when given (the
 * traffic asks it several times a vehicle a frame, and a fresh object each time was garbage).
 */
export function along(route: Route, s: number, out?: RoutePoint): RoutePoint {
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
  const x = P.x[lo] + (P.x[hi] - P.x[lo]) * f;
  const z = P.z[lo] + (P.z[hi] - P.z[lo]) * f;
  const k = P.k[lo] + (P.k[hi] - P.k[lo]) * f;
  if (!out) return { x, z, dx: hx / n, dz: hz / n, k };
  out.x = x;
  out.z = z;
  out.dx = hx / n;
  out.dz = hz / n;
  out.k = k;
  return out;
}

