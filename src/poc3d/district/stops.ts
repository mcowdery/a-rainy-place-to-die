import type { Rect } from '../../core/coords';
import { CELL } from './plan';
import { edgeRoad, kerbSample, onPlaced, type Behind, type SiteEnv } from './sites';
import { laneOffset, STOP_BUS_HALF, STOP_KERB_GAP, STOP_PULL_MAX, type BusLine, type Side } from './traffic';

/**
 * Where a bus line's stops stand (docs/street-furniture-plan.md). A line is a loop of main roads; a stop is a
 * block of it (the 128 m between two grid junctions) and a spot on that block's kerb, chosen for what is beside
 * it: clear of side streets' mouths, of the junctions at each end, of set pieces' entrances, car parks and gaps
 * between lots, on a pavement with room for it. What kind of stop it is follows the room: a shelter where the
 * kerb has 3 m clear behind it, a pole and a bench from 2 m, the pole alone from 1.6 m, and none under that.
 *
 * A line says which places it serves (`BusLine.serves`: a set piece, or a cell) and each becomes a stop in the
 * block of its loop nearest that place; a line with only four names (Manila's jeepney lines) gets one a side, as
 * near its side's middle as a good spot is.
 *
 * Pure: the page's traffic (routeFor) and every thread's model (the ground the street furniture keeps off) work it
 * out alike.
 */
export type StopKind = 'shelter' | 'bench' | 'pole' | 'jeep';

export interface StopSite {
  readonly line: string;
  readonly name: string;
  readonly kind: StopKind;
  /** The route's edge (0 to 3, in the order a bus drives its loop) and metres along it from the edge's first grid corner. */
  readonly edge: number;
  readonly t: number;
  readonly side: Side;
  /** The middle of the pavement at the stop's centre (where the bus's middle stands). */
  readonly x: number;
  readonly z: number;
  /** The way the bus travels, and the way to the buildings (unit axis vectors). */
  readonly dir: readonly [number, number];
  readonly out: readonly [number, number];
  /** The pavement's width, and the clear depth from the kerb's edge back to what stands behind (m). */
  readonly pavement: number;
  readonly depth: number;
  /** From the route's grid line out to the pavement's middle. */
  readonly kerb: number;
  /** No spot passed the rules: it stands at the best of a bad block. */
  readonly forced: boolean;
}

/** Along the kerb from the stop's centre, the ground each kind takes: what it stands on and where people wait. */
export const STOP_SPAN: Record<StopKind, readonly [number, number]> = {
  shelter: [-2.6, 3.8],
  bench: [-1.4, 3.8],
  pole: [-1.0, 3.8],
  // (A jeepney's pole is by its back step, 4.2 m behind its middle, the bench on from it.)
  jeep: [-5.2, 1.4],
};
/** The clear depth a kind needs behind the kerb's edge. */
const STOP_DEPTH: Record<Exclude<StopKind, 'jeep'>, number> = { shelter: 3, bench: 2, pole: 1.6 };
/** A bus line's road: this wide at least, with a raised pavement. */
const MIN_ROAD = 10;
/** Clear of a junction: this far past the one behind (its box's edge), and before the one ahead (the queue at its lights). */
const PAST_JUNCTION = 12;
const BEFORE_JUNCTION = 20;
/** Clear of a side street's mouth by this much. */
const MOUTH = 3;

const SIDE_ORDER: readonly Side[] = ['north', 'east', 'south', 'west'];

interface Edge {
  readonly i: number;
  readonly side: Side;
  /** Its first grid corner, the way along it, and the way to its kerb (a bus keeps left: the loop's inside). */
  readonly a: readonly [number, number];
  readonly d: readonly [number, number];
  readonly left: readonly [number, number];
  readonly vertical: boolean;
  /** The grid line it runs along (x for a north-south edge). */
  readonly line: number;
  readonly blocks: number;
}

/** A loop's four edges as a bus drives them (anticlockwise: the same order and corners as routeFor's). */
function loopEdges(rect: readonly [number, number, number, number]): Edge[] {
  const [c0, r0, c1, r1] = rect;
  const X0 = c0 * CELL;
  const X1 = c1 * CELL;
  const Z0 = r0 * CELL;
  const Z1 = r1 * CELL;
  const corners: [number, number][] = [[X0, Z0], [X0, Z1], [X1, Z1], [X1, Z0]];
  return corners.map((a, i) => {
    const b = corners[(i + 1) % 4];
    const d: [number, number] = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
    const vertical = d[0] === 0;
    const side: Side = vertical ? (a[0] === X0 ? 'west' : 'east') : a[1] === Z0 ? 'north' : 'south';
    return { i, side, a, d, left: [d[1], -d[0]] as [number, number], vertical, line: vertical ? a[0] : a[1], blocks: Math.round(Math.abs(vertical ? b[1] - a[1] : b[0] - a[0]) / CELL) };
  });
}

/** The cell on the kerb's side of an edge's block k. */
function kerbCell(e: Edge, k: number): [number, number] {
  const t = (k + 0.5) * CELL;
  return [Math.floor((e.a[0] + e.d[0] * t + e.left[0] * (CELL / 2)) / CELL), Math.floor((e.a[1] + e.d[1] * t + e.left[1] * (CELL / 2)) / CELL)];
}

interface Spot {
  readonly t: number;
  readonly kind: StopKind;
  readonly x: number;
  readonly z: number;
  readonly pavement: number;
  readonly depth: number;
  readonly kerb: number;
  /** How good a spot it is for what stands behind it and the room it has (higher is better). */
  readonly worth: number;
}

/** How wide the crossing road is at one end of a block (half of it is the junction box's reach along this edge). */
function crossHalf(env: SiteEnv, e: Edge, k: number, end: 0 | 1): number {
  const [mx, my] = kerbCell(e, k);
  const t = (k + end) * CELL;
  const at = e.vertical ? e.a[1] + e.d[1] * t : e.a[0] + e.d[0] * t;
  // Its two arms, either side of this edge's road, may differ: the box is the wider's (as routeFor's `cross`).
  let half = 0;
  for (const [cx, cy] of [[mx, my], [mx - e.left[0], my - e.left[1]]]) {
    const r = edgeRoad(env.plan(cx, cy), !e.vertical, at);
    if (r) half = Math.max(half, (e.vertical ? r.rect.h : r.rect.w) / 2);
  }
  return half || 8;
}

/**
 * A spot on an edge's block k, t metres along the edge: what kind of stop fits there, or null if none may stand
 * (`strict` false keeps only what would put it in a road, a junction or a set piece's ground).
 */
function spotAt(env: SiteEnv, e: Edge, k: number, t: number, jeep: boolean, strict = true): Spot | null {
  const [mx, my] = kerbCell(e, k);
  const road = edgeRoad(env.plan(mx, my), e.vertical, e.line);
  if (!road) return null;
  const w = e.vertical ? road.rect.w : road.rect.h;
  const s = road.sidewalk;
  // (A slip lane, or a ramp's foot in it, lies between the bus's lane and this kerb.)
  if (s <= 0 || road.slip) return null;
  if (!jeep && strict && (w < MIN_ROAD || s < STOP_DEPTH.pole)) return null;
  const edge = w / 2 - s;
  // (The bus's lane is this block's own, routeFor's `laneProfile`: the kerb is never further than it eases over.)
  if (strict && edge - laneOffset(edge) - STOP_BUS_HALF - STOP_KERB_GAP > STOP_PULL_MAX) return null;
  const at = (u: number, out: number): [number, number] => [e.a[0] + e.d[0] * (t + u) + e.left[0] * (edge + out), e.a[1] + e.d[1] * (t + u) + e.left[1] * (edge + out)];
  const lo = k * CELL + crossHalf(env, e, k, 0) + PAST_JUNCTION;
  const hi = (k + 1) * CELL - crossHalf(env, e, k, 1) - BEFORE_JUNCTION;
  for (const kind of (jeep ? ['jeep'] : ['shelter', 'bench', 'pole']) as StopKind[]) {
    const [f0, f1] = STOP_SPAN[kind];
    if (t + f0 < lo || t + f1 > hi) continue;
    let ok = true;
    let depth = Infinity;
    const seen = new Set<Behind>();
    for (let u = f0 - MOUTH; u <= f1 + MOUTH + 0.01 && ok; u += 0.5) {
      const [x, z] = at(u, 0);
      const q = kerbSample(env, x, z, e.left, s);
      // A street's mouth: under the stop, or close beside it.
      if (q.behind === 'road') ok = false;
      if (u < f0 || u > f1) continue;
      // (The pavement itself on a set piece's ground: its forecourt runs to the kerb here.)
      if (onPlaced(env, ...at(u, s / 2)) || onPlaced(env, ...at(u, s / 2 + 0.6))) ok = false;
      seen.add(q.behind);
      depth = Math.min(depth, q.depth);
    }
    if (!ok) continue;
    // The biggest kind the room allows (the pole alone where nothing does and the rules are off).
    if (kind !== 'jeep' && depth < STOP_DEPTH[kind] && (strict || kind !== 'pole')) continue;
    let worth = Math.min(depth, 4) * 6 + (kind === 'shelter' ? 20 : kind === 'bench' ? 10 : 0);
    if (strict) {
      // A set piece's entrance, a car park's, a playground's gate, a yard's fence: not across any of them.
      if (seen.has('door') || seen.has('open:parking') || seen.has('open:playground') || seen.has('open:yard') || seen.has('open:court')) continue;
      // A gap between two lots (a service alley, the yards behind a row): people come out of it.
      if (seen.has('gap') && seen.size > 1) continue;
      if (seen.has('gap')) worth -= 25;
      else if (seen.has('open:vacant')) worth -= 6;
      else if (seen.has('open:park') || seen.has('open:plaza')) worth += 6;
      else worth += 8;
    }
    // Just past a junction is where a stop usually is.
    if (t + f0 - lo < 30) worth += 4;
    const [x, z] = at(0, s / 2);
    return { t, kind, x, z, pavement: s, depth, kerb: edge + s / 2, worth };
  }
  return null;
}

/** The best spot in a block: `score` adds to each spot's own worth what the caller wants of it (near a place, mid-block). */
function bestIn(env: SiteEnv, e: Edge, k: number, jeep: boolean, score: (s: Spot) => number, strict = true): Spot | null {
  let best: Spot | null = null;
  let bestScore = -Infinity;
  for (let t = k * CELL + 2; t < (k + 1) * CELL; t += 2) {
    const s = spotAt(env, e, k, t, jeep, strict);
    if (!s) continue;
    const v = s.worth + score(s);
    if (v > bestScore) [best, bestScore] = [s, v];
  }
  return best;
}

export interface LineStops {
  readonly sites: readonly StopSite[];
  /** What couldn't be done as asked (a place with no good block, two places in one block): for the tests and the audit. */
  readonly problems: readonly string[];
}

export function lineStops(line: BusLine, env: SiteEnv): LineStops {
  const edges = loopEdges(line.rect);
  const jeep = line.jeepney !== undefined;
  const sites: StopSite[] = [];
  const problems: string[] = [];
  const taken = new Set<string>();
  const put = (e: Edge, s: Spot, name: string, forced: boolean): void => {
    sites.push({ line: line.id, name, kind: s.kind, edge: e.i, t: s.t, side: e.side, x: s.x, z: s.z, dir: e.d, out: e.left, pavement: s.pavement, depth: s.depth, kerb: s.kerb, forced });
  };
  /** A stop in block k of an edge, or in the next block either way if that one has no good spot. */
  const place = (e: Edge, k: number, name: string, score: (s: Spot) => number): boolean => {
    for (const kk of [k, k + 1, k - 1]) {
      if (kk < 0 || kk >= e.blocks || taken.has(`${e.i}:${kk}`)) continue;
      const s = bestIn(env, e, kk, jeep, score);
      if (!s) continue;
      taken.add(`${e.i}:${kk}`);
      put(e, s, name, false);
      return true;
    }
    return false;
  };
  const midOf = (k: number): number => (k + 0.5) * CELL;
  if (line.serves) {
    for (const spec of line.serves) {
      // The block the place is by: nearest a set piece's ground, or beside a cell.
      let target: { e: Edge; k: number; x: number; z: number } | null = null;
      if (spec.at !== undefined) {
        const p = env.placed.find((q) => q.id === spec.at);
        if (!p) {
          problems.push(`${line.id}: stop ${spec.name}: no set piece '${spec.at}'`);
          continue;
        }
        const px = p.rect.x + p.rect.w / 2;
        const pz = p.rect.y + p.rect.h / 2;
        let bd = Infinity;
        for (const e of edges) {
          for (let k = 0; k < e.blocks; k++) {
            // From the set piece's middle to the block's stretch of the grid line.
            const along = Math.min((k + 1) * CELL, Math.max(k * CELL, (px - e.a[0]) * e.d[0] + (pz - e.a[1]) * e.d[1]));
            const d = Math.hypot(px - (e.a[0] + e.d[0] * along), pz - (e.a[1] + e.d[1] * along));
            // (Only from the kerb's side of the road: the stop is on the loop's inside.)
            const inside = (px - e.a[0]) * e.left[0] + (pz - e.a[1]) * e.left[1] > 0;
            if (d + (inside ? 0 : 40) < bd) [bd, target] = [d + (inside ? 0 : 40), { e, k, x: px, z: pz }];
          }
        }
      } else if (spec.cell) {
        for (const e of edges) {
          if (spec.side && e.side !== spec.side) continue;
          for (let k = 0; k < e.blocks && !target; k++) {
            const [mx, my] = kerbCell(e, k);
            if (mx === spec.cell[0] && my === spec.cell[1]) target = { e, k, x: e.a[0] + e.d[0] * midOf(k), z: e.a[1] + e.d[1] * midOf(k) };
          }
          if (target) break;
        }
        if (!target) {
          problems.push(`${line.id}: stop ${spec.name}: cell ${spec.cell.join(',')} isn't beside the loop${spec.side ? ` on its ${spec.side} side` : ''}`);
          continue;
        }
      }
      if (!target) continue;
      const { e, k, x, z } = target;
      // Near the place it serves (a metre is worth a point), or mid-block beside a cell.
      const near = spec.at !== undefined ? (s: Spot): number => -Math.hypot(s.x - x, s.z - z) : (s: Spot): number => -Math.abs(s.t - midOf(k)) * 0.15;
      if (!place(e, k, spec.name, near)) problems.push(`${line.id}: stop ${spec.name}: no good spot in ${e.side} block ${k} or the blocks beside it`);
    }
  } else {
    // One a side: the block nearest the side's middle with a good spot, the spot nearest that block's middle.
    for (const e of edges) {
      const name = line.stops[SIDE_ORDER.indexOf(e.side)] ?? '';
      const order = Array.from({ length: e.blocks }, (_, k) => k).sort((p, q) => Math.abs(p + 0.5 - e.blocks / 2) - Math.abs(q + 0.5 - e.blocks / 2));
      let done = false;
      for (const k of order) {
        const s = bestIn(env, e, k, jeep, (q) => -Math.abs(q.t - midOf(k)) * 0.15);
        if (!s) continue;
        put(e, s, name, false);
        done = true;
        break;
      }
      // No block has a good spot: the best that is at least out of the roads and junctions, then the middle whatever.
      for (const k of done ? [] : order) {
        const s = bestIn(env, e, k, jeep, (q) => -Math.abs(q.t - midOf(k)) * 0.15, false);
        if (!s) continue;
        put(e, s, name, true);
        problems.push(`${line.id}: ${e.side} stop ${name}: no good spot on that side; stands at the least bad`);
        done = true;
        break;
      }
      if (!done) {
        const k = order[0];
        const [mx, my] = kerbCell(e, k);
        const road = edgeRoad(env.plan(mx, my), e.vertical, e.line);
        const w = road ? (e.vertical ? road.rect.w : road.rect.h) : 8;
        const sw = road?.sidewalk ?? 0;
        const kerb = w / 2 - sw / 2;
        put(e, { t: midOf(k), kind: jeep ? 'jeep' : 'pole', x: e.a[0] + e.d[0] * midOf(k) + e.left[0] * kerb, z: e.a[1] + e.d[1] * midOf(k) + e.left[1] * kerb, pavement: sw, depth: sw, kerb, worth: 0 }, name, true);
        problems.push(`${line.id}: ${e.side} stop ${name}: nowhere on that side to stand; put at its middle`);
      }
    }
  }
  sites.sort((p, q) => p.edge - q.edge || p.t - q.t);
  return { sites, problems };
}

/** The ground a stop takes: nothing else of the street's furniture stands in it (real/props.ts cellDetail's `claimed`). */
export function stopClaim(s: StopSite): Rect {
  const [f0, f1] = STOP_SPAN[s.kind];
  // From the kerb's edge back across the pavement to the wall (what leans on the wall there is in the way too).
  const e0 = -s.pavement / 2;
  const e1 = Math.min(s.depth, s.pavement + 3) - s.pavement / 2 + 0.6;
  const xs = [s.x + s.dir[0] * (f0 - 0.6) + s.out[0] * e0, s.x + s.dir[0] * (f1 + 0.6) + s.out[0] * e1];
  const zs = [s.z + s.dir[1] * (f0 - 0.6) + s.out[1] * e0, s.z + s.dir[1] * (f1 + 0.6) + s.out[1] * e1];
  const x = Math.min(...xs);
  const z = Math.min(...zs);
  return { x, y: z, w: Math.max(...xs) - x, h: Math.max(...zs) - z };
}
