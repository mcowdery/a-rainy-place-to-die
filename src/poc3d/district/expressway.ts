import YAML from 'yaml';
import type { Rect } from '../../core/coords';
import { CELL, edgeKey } from './plan';

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
  /**
   * Metres of deck left off its start and its end (an open route's): where nothing runs on past its last ramp or
   * junction, the deck stops there behind an end wall instead of running on to its point as a dead stub. Its
   * ramps are still placed from the points; each must join the deck that's left, and stand beside it while it's
   * up on arms from the deck's piers.
   */
  readonly trim?: readonly [number, number];
}

export interface ExpresswayDef {
  readonly name: string;
  readonly nameEn: string;
  readonly deck: number;
  readonly radius: number;
  readonly half: number;
  readonly routes: readonly RouteDef[];
  /**
   * Metres added to the width of every cell-edge road a ramp stands on (the avenue's edge, both sides of its line),
   * so the ramp has a lane of its own beside the median and the through lanes keep the width they had. 0 or absent:
   * the ramp's foot takes the inner lane.
   */
  readonly slipLane?: number;
  /**
   * Junctions between routes that cross: a connector deck leaves route `from` and joins route `to` along a
   * circular arc of `radius` metres tangent to both (where their lines cross), so a car turns from one to the
   * other without slowing for a right angle. `cutFrom`: `from` ends where the connector leaves it (a merge, or a
   * route that has run its course); `cutTo`: `to` begins where the connector joins it (a diverge). What a cut
   * takes off is the stub that would otherwise run on across the other deck.
   */
  readonly links?: readonly { readonly id: string; readonly from: string; readonly to: string; readonly radius: number; readonly cutFrom?: boolean; readonly cutTo?: boolean }[];
  /** On a route's leg (from point `leg` to the next), in its 128 m `block` (counted from the leg's start). */
  readonly ramps: readonly { readonly id: string; readonly kind: 'on' | 'off'; readonly route: string; readonly leg: number; readonly block: number; readonly name: string }[];
  /**
   * Suspension bridges (a look: the decks are the routes'): towers on a grid line at `from` and `to` (L0 rows or
   * cols, fractional), straddling `width` metres of deck, main cables slung between them and down to anchors.
   */
  readonly suspension?: readonly { readonly col?: number; readonly row?: number; readonly from: number; readonly to: number; readonly width: number; readonly name: string }[];
  /**
   * Parking areas (PA): a raised apron where a route's decks end, on a grid point's line, `length` metres along `dir`
   * (an axis) from `from` m past the point, `width` across (centred on the line). A road of kind 'deck' (driven
   * anywhere on it, its edges walls, the routes that end on it merging), drawn by `real/expressway.ts`, with the lots
   * under it cleared (`expresswayReserved`).
   */
  readonly plazas?: readonly { readonly id: string; readonly name: string; readonly at: readonly [number, number]; readonly dir: readonly [number, number]; readonly from: number; readonly length: number; readonly width: number }[];
  /** At a route's point `at` (a loop's corner, or an open route's last point), straight on into a tunnel. */
  readonly exits: readonly { readonly id: string; readonly venue: string; readonly route: string; readonly at: number; readonly length: number; readonly name: string; readonly hill?: number; readonly tube?: number }[];
  /**
   * The way out of a tunnel: at an open route's first point (untrimmed), a road comes out of a mouth `length` metres
   * behind the point, down a roofed tube `tube` metres deep (the start of the game: you roll out of it), and runs on
   * as the route. Where it comes out (`length`, set against the exit spur's mouth) is measured back from the point.
   */
  readonly entries?: readonly { readonly id: string; readonly venue?: string; readonly route: string; readonly length: number; readonly tube: number; readonly name: string }[];
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
  if (d.slipLane !== undefined && (!num(d.slipLane) || (d.slipLane as number) < 0 || (d.slipLane as number) > 24)) err('slipLane: metres of width added to the road under a ramp, 0-24');
  for (const k of ['deck', 'radius', 'half']) if (!num(d[k]) || (d[k] as number) <= 0) err(`${k}: a positive number`);
  const routes = new Map<string, { loop: boolean; legs: number[]; trim: [number, number] }>();
  if (!Array.isArray(d.routes)) err('routes: a list (empty for a city with no expressway)');
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
      const trim = (r.trim ?? [0, 0]) as [number, number];
      if (r.trim !== undefined) {
        const whole = Array.isArray(trim) && trim.length === 2 && trim.every((v) => Number.isInteger(v) && v >= 0);
        const last = legs.length - 1;
        if (!whole || r.loop) return err(`routes[${i}]: trim is [start, end], whole metres off an open route's ends`);
        if (trim[0] > legs[0] - 40 || trim[1] > legs[last] - 40 || (last === 0 && trim[0] + trim[1] > legs[0] - 40)) return err(`routes[${i}]: trim leaves no deck`);
      }
      routes.set(r.id as string, { loop: r.loop as boolean, legs, trim });
    });
  if (d.links !== undefined) {
    if (!Array.isArray(d.links)) err('links: a list');
    else
      d.links.forEach((l: Record<string, unknown>, i: number) => {
        if (typeof l?.id !== 'string' || typeof l.from !== 'string' || typeof l.to !== 'string' || !num(l.radius) || (l.radius as number) < 20) return err(`links[${i}]: { id, from, to, radius (m, 20 or more), cutFrom?, cutTo? }`);
        const [A, B] = [routes.get(l.from), routes.get(l.to)];
        if (!A || !B) return err(`links[${i}]: no route ${A ? l.to : l.from}`);
        if (l.cutFrom && A.loop) err(`links[${i}]: a loop can't be cut`);
        if (l.cutTo && B.loop) err(`links[${i}]: a loop can't be cut`);
      });
  }
  if (d.plazas !== undefined) {
    if (!Array.isArray(d.plazas)) err('plazas: a list');
    else
      d.plazas.forEach((p: Record<string, unknown>, i: number) => {
        const at = p?.at as unknown;
        const dir = p?.dir as unknown;
        const pair = (v: unknown): v is number[] => Array.isArray(v) && v.length === 2 && v.every((q) => Number.isFinite(q));
        if (typeof p?.id !== 'string' || typeof p.name !== 'string' || !pair(at) || !pair(dir) || !num(p.from) || !num(p.length) || !num(p.width)) return err(`plazas[${i}]: { id, name, at: [col, row], dir: [dx, dz], from, length, width }`);
        if (Math.abs(dir[0]) + Math.abs(dir[1]) !== 1) err(`plazas[${i}]: dir is one axis, [0, 1] south, [1, 0] east, ...`);
        if (p.length < 40 || p.width < 30 || p.width > 120) err(`plazas[${i}]: length 40+, width 30-120 m`);
      });
  }
  if (!Array.isArray(d.ramps)) err('ramps: a list');
  else
    d.ramps.forEach((r: Record<string, unknown>, i: number) => {
      if (typeof r?.id !== 'string' || !['on', 'off'].includes(r.kind as string) || typeof r.route !== 'string' || !Number.isInteger(r.leg) || !Number.isInteger(r.block) || typeof r.name !== 'string') return err(`ramps[${i}]: { id, kind: on|off, route, leg, block, name }`);
      const R = routes.get(r.route);
      if (!R) return err(`ramps[${i}]: no route ${r.route}`);
      const leg = R.legs[r.leg as number];
      if (leg === undefined || (r.block as number) < 0 || ((r.block as number) + 1) * CELL > leg) return err(`ramps[${i}]: route ${r.route} has no leg ${r.leg} block ${r.block}`);
      // Where it needs the deck (along its leg): from where it's up on arms from the deck's piers to where it joins.
      const a = r.kind === 'on' ? (r.block as number) * CELL + 16 : (r.block as number) * CELL + 112 - RAMP;
      const [d0, d1] = r.kind === 'on' ? [a + RAMP - RAMP_ARMS, a + RAMP] : [a, a + RAMP_ARMS];
      const from = r.leg === 0 ? R.trim[0] : 0;
      const to = leg - (r.leg === R.legs.length - 1 ? R.trim[1] : 0);
      if (d0 < from || d1 > to) err(`ramps[${i}]: route ${r.route}'s trim leaves no deck beside ramp ${r.id}`);
    });
  if (!Array.isArray(d.exits)) err('exits: a list');
  else
    d.exits.forEach((x: Record<string, unknown>, i: number) => {
      if (typeof x?.id !== 'string' || typeof x.venue !== 'string' || typeof x.route !== 'string' || !Number.isInteger(x.at) || !num(x.length) || typeof x.name !== 'string') return err(`exits[${i}]: { id, venue, route, at, length, name }`);
      const R = routes.get(x.route);
      if (!R) return err(`exits[${i}]: no route ${x.route}`);
      const n = R.loop ? R.legs.length : R.legs.length + 1;
      if ((x.at as number) < 0 || (x.at as number) >= n || (!R.loop && x.at !== n - 1)) err(`exits[${i}]: at must be a corner of the loop, or an open route's last point`);
      else if (R.trim[1] > 0) err(`exits[${i}]: route ${x.route}'s end is trimmed off`);
      if (x.tube !== undefined && (!num(x.tube) || x.tube < 14)) err(`exits[${i}]: tube is the roofed run before the portal's wall, at least 14 m`);
    });
  if (d.entries !== undefined && !Array.isArray(d.entries)) err('entries: a list');
  else
    ((d.entries ?? []) as Record<string, unknown>[]).forEach((x, i) => {
      if (typeof x?.id !== 'string' || typeof x.route !== 'string' || !num(x.length) || !num(x.tube) || typeof x.name !== 'string') return err(`entries[${i}]: { id, route, length, tube, name }`);
      const R = routes.get(x.route);
      if (!R) return err(`entries[${i}]: no route ${x.route}`);
      if (R.loop) err(`entries[${i}]: route ${x.route} is a loop: an entry comes out at an open route's start`);
      else if (R.trim[0] > 0) err(`entries[${i}]: route ${x.route}'s start is trimmed off`);
      if ((x.length as number) < 20 || (x.tube as number) < 20) err(`entries[${i}]: length and tube are at least 20 m`);
      if (x.venue !== undefined && typeof x.venue !== 'string') err(`entries[${i}]: venue is the pass its tunnel leads to (the exit with the same venue is where you come back out of it)`);
    });
  if (errors.length > before) return null;
  return d as unknown as ExpresswayDef;
}

export interface Road {
  readonly id: string;
  /**
   * A closed route (a loop), an open one, a ramp or a spur to a tunnel; or a deck: a raised driving surface of
   * a set piece (the multi-storey car park's floors and ramps), on the network for driving but drawn by its owner.
   */
  readonly kind: 'loop' | 'route' | 'ramp' | 'spur' | 'deck';
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
  /** Spurs: the height of the hill its tunnel bores into (drawn round the portal), if any. */
  readonly hill?: number;
  /**
   * A spur that comes out of its tunnel (an entry) instead of going in: it starts deep in the tube (sample 0, a black
   * wall), is roofed for its first `tube` metres, comes out at the mouth there and runs on into its route. It is no way
   * to a venue, and the portal drawn is at its start.
   */
  readonly out?: boolean;
  readonly tube?: number;
  /** Metres left of its grid line (a two-way route's decks): its piers stand back on the line. */
  readonly offset?: number;
  /**
   * A route whose deck stops short of its points (`RouteDef.trim`): the metres left off its start and its end.
   * Sample i is `trim[0] + i` metres along the route as written; a trimmed end is closed by an end wall.
   */
  readonly trim?: readonly [number, number];
  /** A parking area's apron (kind 'deck'): its name and size, for drawing it. */
  readonly plaza?: { readonly name: string; readonly length: number; readonly width: number; readonly wings: readonly { readonly u0: number; readonly u1: number; readonly t0: number; readonly t1: number }[] };
  /** Ramps: where the foot stands, metres left of the grid line (a slip lane on the kerb side, or the inner lane by the median). */
  readonly foot?: number;
  /** Ends (start, end) where the road runs into another deck (a junction's connector), so no end wall stands there. */
  readonly joins?: readonly [boolean, boolean];
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
/** A ramp's half-width: one wide lane (7.2 m between the parapets: two cars' width), room to line up with it at speed. */
export const RAMP_HALF = 3.6;
/**
 * Where a ramp's foot stands: the avenue's inner lane, its centre this far from the grid line (the 2.4 m median's
 * edge, a gap, then the ramp), so the kerb lane stays open beside it whatever the route above.
 */
export const RAMP_FOOT = 1.2 + 0.4 + RAMP_HALF;
/**
 * Metres a ramp takes to angle into (out of) the deck's outside lane, level with the deck all the way (it climbs over the
 * rest of its run), so the two are one open surface there and no wall stands between them.
 */
export const RAMP_MERGE = 50;
/**
 * Along a ramp from its foot (m): it stays in the inner lane while it's an embankment, swings out beside the
 * deck over [SWING0, SWING1] once it's high enough to clear the street, then angles into the deck's outside lane
 * over the last 60 m.
 */
/** How far back from the deck (m along it) a ramp is still high enough to stand on arms from the deck's piers. */
const RAMP_ARMS = 130;
const SWING0 = 100;
const SWING1 = 175;
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

export function makeRoad(id: string, kind: Road['kind'], x: number[], z: number[], y: (i: number, n: number) => number, half: number, closed: boolean, extra: Partial<Road> = {}): Road {
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
  /** The widest road's half-width (the search reach round a point). */
  private maxHalf: number;

  constructor(
    readonly def: ExpresswayDef,
    /** The width of the cell-edge road under a ramp (edgeKey; the road as widened by `slipLane`), where the city knows it. */
    roadWidth?: (key: string) => { readonly width: number; readonly slip: number } | undefined,
    /**
     * The ground's height (the page's terrain): the spurs and entries to a tunnel in a headland rise to stand just
     * above it where it climbs to the deck's height and over (else the deck is buried in the land there).
     */
    ground?: (x: number, z: number) => number,
  ) {
    this.maxHalf = def.half;
    const edgeOf = rampEdgeKeys(def);
    // With a slip lane: in the middle of it, along the kerb (the road's carriageway runs to its width less 2 x 3 m of pavement,
    // the traffic's lanes to half the slip lane inside that).
    const footOf = (id: string): number => {
      if (!def.slipLane) return RAMP_FOOT;
      const spec = roadWidth ? roadWidth(edgeOf.get(id) ?? '') : { width: 32 + def.slipLane, slip: def.slipLane };
      // (A road that couldn't be widened, for a set piece beside it, has the ramp in its inner lane as before.)
      if (!spec || !spec.slip) return RAMP_FOOT;
      return spec.width / 2 - Math.min(3, spec.width * 0.2) - spec.slip / 4;
    };
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
    /** Each route's centreline before any cut (its offset applied). */
    const lines = new Map<string, { x: number[]; z: number[]; r: RouteDef }>();
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
      lines.set(r.id, { x: L.x, z: L.z, r });
    }
    // Junctions: a connector deck along an arc tangent to both routes where their lines cross. Each takes the
    // stub of a route that would run on across the other deck (the cuts), counted in samples (metres).
    const cuts = new Map<string, [number, number]>();
    const joins = new Map<string, [boolean, boolean]>();
    const connectors: Road[] = [];
    type Line = { x: number[]; z: number[]; r: RouteDef };
    const at = (q: Line, i: number): [number, number] => {
      const n = q.x.length;
      const k = q.r.loop ? ((Math.floor(i) % n) + n) % n : Math.max(0, Math.min(n - 1, Math.floor(i)));
      const k2 = q.r.loop ? (k + 1) % n : Math.min(n - 1, k + 1);
      const f = i - Math.floor(i);
      return [q.x[k] + (q.x[k2] - q.x[k]) * f, q.z[k] + (q.z[k2] - q.z[k]) * f];
    };
    const dirAt = (q: Line, i: number): [number, number] => {
      const a = at(q, i - 1);
      const b = at(q, i + 1);
      return norm(b[0] - a[0], b[1] - a[1]);
    };
    // An open route's line runs on past its ends for the crossing (an offset deck stops at its grid point, short of
    // a deck that crosses beyond it); `EXT` samples each way.
    const EXT = 16;
    const extended = (q: Line): Line => {
      if (q.r.loop) return q;
      const n = q.x.length;
      const t0 = dirAt(q, 1);
      const t1 = dirAt(q, n - 2);
      const x: number[] = [];
      const z: number[] = [];
      for (let k = EXT; k >= 1; k--) {
        x.push(q.x[0] - t0[0] * k);
        z.push(q.z[0] - t0[1] * k);
      }
      for (let i = 0; i < n; i++) {
        x.push(q.x[i]);
        z.push(q.z[i]);
      }
      for (let k = 1; k <= EXT; k++) {
        x.push(q.x[n - 1] + t1[0] * k);
        z.push(q.z[n - 1] + t1[1] * k);
      }
      return { x, z, r: q.r };
    };
    for (const l of def.links ?? []) {
      const A = extended(lines.get(l.from)!);
      const B = extended(lines.get(l.to)!);
      const [shA, shB] = [A.r.loop ? 0 : EXT, B.r.loop ? 0 : EXT];
      // Where the two lines cross: the nearest pair of samples, found coarsely then refined.
      let ia = 0;
      let ib = 0;
      let bd = Infinity;
      for (let i = 0; i < A.x.length; i += 4)
        for (let j = 0; j < B.x.length; j += 4) {
          const d2 = (A.x[i] - B.x[j]) ** 2 + (A.z[i] - B.z[j]) ** 2;
          if (d2 < bd) {
            bd = d2;
            ia = i;
            ib = j;
          }
        }
      const [ci, cj] = [ia, ib];
      for (let i = Math.max(0, ci - 4); i <= Math.min(A.x.length - 1, ci + 4); i++)
        for (let j = Math.max(0, cj - 4); j <= Math.min(B.x.length - 1, cj + 4); j++) {
          const d2 = (A.x[i] - B.x[j]) ** 2 + (A.z[i] - B.z[j]) ** 2;
          if (d2 < bd) {
            bd = d2;
            ia = i;
            ib = j;
          }
        }
      const ta = dirAt(A, ia);
      const tb = dirAt(B, ib);
      const cross = ta[0] * tb[1] - ta[1] * tb[0];
      const theta = Math.acos(Math.max(-1, Math.min(1, ta[0] * tb[0] + ta[1] * tb[1])));
      const sg = cross >= 0 ? 1 : -1;
      const T = l.radius * Math.tan(theta / 2);
      const S = at(A, ia - T);
      const nrm: [number, number] = [-ta[1] * sg, ta[0] * sg];
      const xs: number[] = [];
      const zs: number[] = [];
      const steps = Math.max(8, Math.ceil(l.radius * theta));
      for (let k = 0; k <= steps; k++) {
        const f = (theta * k) / steps;
        xs.push(S[0] + l.radius * (ta[0] * Math.sin(f) + nrm[0] * (1 - Math.cos(f))));
        zs.push(S[1] + l.radius * (ta[1] * Math.sin(f) + nrm[1] * (1 - Math.cos(f))));
      }
      const cA = cuts.get(l.from) ?? [0, 0];
      const cB = cuts.get(l.to) ?? [0, 0];
      const jA = joins.get(l.from) ?? [false, false];
      const jB = joins.get(l.to) ?? [false, false];
      if (l.cutFrom) {
        cA[1] = Math.max(cA[1], A.x.length - shA - 1 - Math.floor(ia - T));
        jA[1] = true;
      }
      if (l.cutTo) {
        cB[0] = Math.max(cB[0], Math.ceil(ib - shB + T));
        jB[0] = true;
      }
      cuts.set(l.from, cA);
      cuts.set(l.to, cB);
      joins.set(l.from, jA);
      joins.set(l.to, jB);
      connectors.push(makeRoad(l.id, 'route', xs, zs, () => D, def.half, false, { sign: `${A.r.name} → ${B.r.name}`, joins: [true, true] as const }));
    }
    // The deck's height along an open route's end, a spur or an entry: `D`, or the land's (+ 0.25 m) where that is higher
    // (the headland at the Wangan's east end stands over the deck's height; a metre over it, so the land beside never shows through at the deck's edge). The same rule everywhere on the stretch, so the
    // routes and the spurs over them meet level.
    const headland = (xs: readonly number[], zs: readonly number[]): number[] => xs.map((x, j) => D + (ground ? Math.max(0, ground(x, zs[j]) + 1 - D) : 0));
    for (const r of def.routes) {
      const L = lines.get(r.id)!;
      // The deck stops short of a point nothing runs on past (its ramps are placed from the points all the same),
      // and where a junction's connector takes it over.
      const [y0, y1] = r.loop ? [0, 0] : (r.trim ?? [0, 0]);
      const [c0, c1] = cuts.get(r.id) ?? [0, 0];
      const t0 = Math.max(y0, c0);
      const t1 = Math.max(y1, c1);
      const cut = t0 > 0 || t1 > 0;
      const x = cut ? L.x.slice(t0, L.x.length - t1) : L.x;
      const z = cut ? L.z.slice(t0, L.z.length - t1) : L.z;
      const j = joins.get(r.id);
      const off = r.offset ?? 0;
      const rise = r.loop ? null : headland(x, z);
      const road = makeRoad(r.id, r.loop ? 'loop' : 'route', x, z, rise ? (j) => rise[j] : () => D, def.half, r.loop, { sign: r.name, ...(off ? { offset: off } : {}), ...(cut ? { trim: [t0, t1] as const } : {}), ...(j ? { joins: j } : {}) });
      routeRoads.set(r.id, road);
      this.roads.push(road);
    }
    this.roads.push(...connectors);
    // Parking areas: a wide raised deck, one road sampled every metre along its length.
    for (const p of def.plazas ?? []) {
      const [sx, sz] = world(p.at);
      const xs: number[] = [];
      const zs: number[] = [];
      for (let u = 0; u <= p.length; u++) {
        xs.push(sx + p.dir[0] * (p.from + u));
        zs.push(sz + p.dir[1] * (p.from + u));
      }
      // The two thin buildings under its sides that hold it up and take people down to the street: one each side of the
      // avenue (its pavements 16 m out, so 20 m clears them), from the junction at the north end to the south.
      const wings = [{ u0: 28, u1: p.length - 6, t0: 20, t1: 31 }, { u0: 28, u1: p.length - 6, t0: -31, t1: -20 }];
      this.roads.push(makeRoad(p.id, 'deck', xs, zs, () => D, p.width / 2, false, { sign: p.name, plaza: { name: p.name, length: p.length, width: p.width, wings } }));
    }
    // (A city with no expressway, Manila's: a stub of road far off the map stands in for the loop, with nothing on or near it.)
    this.loop = this.roads.find((r) => r.kind === 'loop') ?? this.roads[0] ?? makeRoad('none', 'loop', [-1e7, -1e7 + 10, -1e7 + 20, -1e7 + 30], [-1e7, -1e7, -1e7, -1e7], () => 0, def.half, true);
    // Ramps: a single wide lane. Its foot is in the avenue's inner lane beside the median (keep to the inner
    // lane for the expressway; the kerb lane runs on past it), and it stays there while it's low enough to be a
    // walled embankment; once it clears the street it swings out to stand beside the deck on its left, overlapping
    // its edge by 0.6 m, and over the last 60 m angles into the deck's outside lane, so you drive straight on and
    // merge (or drift out of the lane and off). It's carried on arms from the deck's piers in the median, so
    // nothing of it stands in a lane. Each works within one block of its leg (the 128 m between two junctions,
    // counted from the leg's start in the direction of travel): an on-ramp's foot is at the start of its block and
    // the walled part stays inside the block; an off-ramp comes down to its foot at the end of its block.
    const rh = RAMP_HALF;
    for (const r of def.ramps) {
      const foot = footOf(r.id);
      // A slip lane ramp swings in over its lane only once it is high enough to clear the through lanes (75 m from its foot) and
      // is in by 125 m, the far side of the junction box, so its outer edge never reaches the lots on the street's old width.
      const [sw0, sw1] = foot > 8 ? [75, 125] : [SWING0, SWING1];
      const route = def.routes.find((q) => q.id === r.route)!;
      const { start, dir } = legsOf(route)[r.leg];
      const left: [number, number] = [dir[1], -dir[0]];
      const beside = def.half + rh - 0.6 + (route.offset ?? 0);
      const lane = 1.8 + (route.offset ?? 0);
      const s0 = r.block * CELL;
      const a = r.kind === 'on' ? s0 + 16 : s0 + 112 - RAMP;
      const xs: number[] = [];
      const zs: number[] = [];
      for (let d = 0; d <= RAMP; d++) {
        // Metres from the foot.
        const f = r.kind === 'on' ? d : RAMP - d;
        const swing = smooth((f - sw0) / (sw1 - sw0));
        const merge = smooth((f - (RAMP - RAMP_MERGE)) / RAMP_MERGE);
        const o = foot + (beside - foot) * swing + (lane - beside) * merge;
        xs.push(start[0] + dir[0] * (a + d) + left[0] * o);
        zs.push(start[1] + dir[1] * (a + d) + left[1] * o);
      }
      // Height by metres from the foot: the climb over all but the merge (a half-and-half blend of straight and eased, under 10%).
      const climb = (f: number): number => {
        const t = Math.max(0, Math.min(1, f / (RAMP - RAMP_MERGE)));
        return D * (0.5 * t + 0.5 * smooth(t));
      };
      const y = r.kind === 'off' ? (i: number): number => climb(RAMP - i) : (i: number): number => climb(i);
      this.roads.push(makeRoad(r.id, 'ramp', xs, zs, y, rh, false, { sign: r.name, rampKind: r.kind, foot }));
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
      // (Over the last of the route it overlaps the deck stays at the deck's height; past the route's point it clears the land.)
      const y = headland(xs, zs);
      this.roads.push(makeRoad(e.id, 'spur', xs, zs, (j) => y[j], def.half, false, { venue: e.venue, sign: e.name, ...(e.hill ? { hill: e.hill } : {}), ...(e.tube ? { tube: e.tube } : {}) }));
    }
    // Entries: the same, the other way. The road starts `length + tube` m behind the route's first point, deep in a
    // tube, and runs on over the route's first R + 10 m (as an exit spur starts over its route's last), so the two
    // are one surface there.
    for (const e of def.entries ?? []) {
      const route = def.routes.find((q) => q.id === e.route)!;
      const dir = legsOf(route)[0].dir;
      const o = route.offset ?? 0;
      const w = world(route.pts[0]);
      const c: [number, number] = [w[0] + dir[1] * o, w[1] - dir[0] * o];
      const xs: number[] = [];
      const zs: number[] = [];
      for (let d = -e.length - e.tube; d <= R + 10; d++) {
        xs.push(c[0] + dir[0] * d);
        zs.push(c[1] + dir[1] * d);
      }
      const y = headland(xs, zs);
      this.roads.push(makeRoad(e.id, 'spur', xs, zs, (j) => y[j], def.half, false, { sign: e.name, out: true, tube: e.tube, ...(e.venue ? { venue: e.venue } : {}) }));
    }
    for (const road of this.roads) this.index(road);
  }

  private index(road: Road): void {
    this.maxHalf = Math.max(this.maxHalf, road.half);
    for (let i = 0; i < road.x.length; i++) {
      const k = this.key(Math.floor(road.x[i] / GRID), Math.floor(road.z[i] / GRID));
      const l = this.grid.get(k);
      if (l) l.push([road, i]);
      else this.grid.set(k, [[road, i]]);
    }
  }

  /** Adds set pieces' decks (kind 'deck': a car park's floors and ramps) to the network for driving. */
  addDecks(roads: readonly Road[]): void {
    for (const r of roads) {
      this.roads.push(r);
      this.index(r);
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
    for (const [road, i] of this.near(x, z, this.maxHalf + 3)) {
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
    for (const [road, i] of this.near(x, z, this.maxHalf + 4)) {
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
    for (const [road, i] of this.near(x, z, this.maxHalf + 2)) {
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
    // A parking area's two wings, standing on the street.
    for (const road of this.roads) {
      for (const w of road.plaza?.wings ?? []) {
        const a = [road.x[0] + road.tx[0] * w.u0 + road.tz[0] * w.t0, road.z[0] + road.tz[0] * w.u0 - road.tx[0] * w.t0];
        const b = [road.x[0] + road.tx[0] * w.u1 + road.tz[0] * w.t1, road.z[0] + road.tz[0] * w.u1 - road.tx[0] * w.t1];
        out.push({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) });
      }
    }
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
    // An avenue's carriageways and pavements: within 17 m of a 128 m grid line.
    const overStreet = (x: number, z: number): boolean => Math.abs(x - Math.round(x / CELL) * CELL) < 17 || Math.abs(z - Math.round(z / CELL) * CELL) < 17;
    const out: { x: number; z: number; top: number }[] = [];
    for (const road of this.roads) {
      if (road.kind === 'ramp' || road.kind === 'deck') continue;
      // (A spur's first 40 m lie over its route, which has its own piers there; an entry's last.)
      const start = road.kind === 'spur' && !road.out ? 40 : 0;
      const stop = road.out ? road.x.length - 40 : road.x.length;
      // An offset deck's piers stand back on its grid line (the median), under both of a two-way route's decks.
      const o = road.offset ?? 0;
      // (Every 32 m of the route as written, so a trimmed deck's piers still stand with the other deck's.)
      const lead = road.trim?.[0] ?? 0;
      for (let i = start + ((32 - (lead % 32)) % 32); i < stop; i += 32) {
        // (A gradual corner cuts across the junction: no pier stands in the street there, the deck spans it.)
        // (A junction's connector stands on no pier over a street at all: its ends lie beside the decks it joins, which
        // have their own in the median, and its own would stand in a lane.)
        const connector = !!road.joins?.[0] && !!road.joins[1] && road.kind === 'route';
        if (overStreet(road.x[i], road.z[i]) && (connector || (Math.abs(road.tx[i]) > 0.02 && Math.abs(road.tz[i]) > 0.02))) continue;
        out.push({ x: road.x[i] - road.tz[i] * o, z: road.z[i] + road.tx[i] * o, top: road.y[i] - 1.2 });
      }
    }
    return out;
  }

  /** Is the point inside another road than `road`, at about the same height (so no wall there)? */
  insideOther(road: Road, x: number, z: number, y: number): boolean {
    for (const [r, i] of this.near(x, z, this.maxHalf + 2)) {
      if (r === road) continue;
      const dx = x - r.x[i];
      const dz = z - r.z[i];
      const lateral = dx * r.tz[i] - dz * r.tx[i];
      const along = dx * r.tx[i] + dz * r.tz[i];
      if (Math.abs(lateral) <= r.half + 0.1 && Math.abs(along) <= 0.75 && Math.abs(r.y[i] - y) < 1.0) return true;
    }
    return false;
  }

  /** Is (x, z) within `margin` m of the side of a tunnel road (a spur or an entry)? The woods and the fringe's houses keep off them. */
  nearTunnel(x: number, z: number, margin: number): boolean {
    // (Reach from the spurs' own half-width: `maxHalf` is the widest road's, a parking area's.)
    return this.near(x, z, margin + this.def.half).some(([road]) => road.kind === 'spur');
  }

  /** A spur's tunnel you're in (its last 14 m), or null. */
  portal(x: number, z: number, y: number): Road | null {
    const o = this.at(x, z, y);
    return o && o.road.kind === 'spur' && !o.road.out && o.i > o.road.x.length - 14 ? o.road : null;
  }
}

function norm(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

/**
 * Ground kept clear of buildings where a deck runs over the lots instead of the street: a gradual corner and a
 * junction's connector cut across the corner of a block, so the lots they pass over are open ground (the deck
 * stands 15 m up, over trees and plaza). The straights run over the avenues, which are clear already. The same
 * rects go to the chunk workers and the page (the plan is a pure function of them), so both build one city.
 */
export function expresswayReserved(ex: Expressway): Rect[] {
  const pad = ex.def.half + 4;
  const unit = 10;
  const seen = new Set<string>();
  const out: Rect[] = [];
  // A parking area's apron: the lots under it are open ground.
  for (const r of ex.roads) {
    if (!r.plaza) continue;
    const n = r.x.length - 1;
    const [x0, x1] = [Math.min(r.x[0], r.x[n]), Math.max(r.x[0], r.x[n])];
    const [z0, z1] = [Math.min(r.z[0], r.z[n]), Math.max(r.z[0], r.z[n])];
    const along = x1 - x0 > z1 - z0;
    const w = r.plaza.width / 2 + 3;
    out.push(along ? { x: x0 - 3, y: z0 - w, w: x1 - x0 + 6, h: 2 * w } : { x: x0 - w, y: z0 - 3, w: 2 * w, h: z1 - z0 + 6 });
  }
  for (const road of ex.roads) {
    if (road.kind === 'ramp' || road.kind === 'deck' || road.kind === 'spur') continue;
    for (let i = 0; i < road.x.length; i += 5) {
      const x = road.x[i];
      const z = road.z[i];
      // Over a street (within 17 m of a grid line) is clear already.
      if (Math.abs(x - Math.round(x / CELL) * CELL) < 17 || Math.abs(z - Math.round(z / CELL) * CELL) < 17) continue;
      const kx = Math.round(x / unit);
      const kz = Math.round(z / unit);
      const key = `${kx},${kz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: kx * unit - pad, y: kz * unit - pad, w: pad * 2, h: pad * 2 });
    }
  }
  return out;
}

/** `expresswayReserved` from a city's expressway.yaml text (none for a city without one). */
export function expresswayReservedFrom(file: string, text: string): Rect[] {
  if (!text.trim()) return [];
  const errors: string[] = [];
  const def = parseExpressway(file, text, errors);
  return def ? expresswayReserved(new Expressway(def)) : [];
}

/**
 * The cell-edge road under each ramp (ramp id to edgeKey: a ramp works within one 128 m block of its leg, which is one
 * cell edge), for widening it by `slipLane` and standing the ramp's foot in the lane that adds.
 */
export function rampEdgeKeys(def: ExpresswayDef): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of def.ramps) {
    const route = def.routes.find((q) => q.id === r.route);
    if (!route) continue;
    const a = route.pts[r.leg];
    const b = route.pts[(r.leg + 1) % route.pts.length];
    const dx = Math.sign(b[0] - a[0]);
    const dz = Math.sign(b[1] - a[1]);
    if (dx !== 0) out.set(r.id, edgeKey(dx > 0 ? a[0] + r.block : a[0] - r.block - 1, a[1] - 1, false));
    else out.set(r.id, edgeKey(a[0] - 1, dz > 0 ? a[1] + r.block : a[1] - r.block - 1, true));
  }
  return out;
}

/**
 * The cell edges a ramp runs along (each once): its foot's block and the neighbours it climbs over, so the road is as wide
 * wherever it swings in and no lot stands where it passes (it's 240 m long, two blocks and more).
 */
export function rampEdges(def: ExpresswayDef): string[] {
  const out = new Set<string>();
  for (const r of def.ramps) {
    const route = def.routes.find((q) => q.id === r.route);
    if (!route) continue;
    const a = route.pts[r.leg];
    const b = route.pts[(r.leg + 1) % route.pts.length];
    const dx = Math.sign(b[0] - a[0]);
    const dz = Math.sign(b[1] - a[1]);
    const cells = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    // The metres along the leg it covers, from the block's start.
    const from = r.block * CELL + (r.kind === 'on' ? 16 : 112 - RAMP);
    const to = from + RAMP;
    for (let e = Math.max(0, Math.floor(from / CELL)); e <= Math.min(cells - 1, Math.floor((to - 1) / CELL)); e++) {
      if (dx !== 0) out.add(edgeKey(dx > 0 ? a[0] + e : a[0] - e - 1, a[1] - 1, false));
      else out.add(edgeKey(a[0] - 1, dz > 0 ? a[1] + e : a[1] - e - 1, true));
    }
  }
  return [...out];
}

/** The ground under each parking area's apron: nothing is planted there (no sunlight). */
export function expresswayCovered(ex: Expressway): Rect[] {
  return expresswayReserved(ex).filter((_, i) => i < (ex.roads.filter((r) => r.plaza).length));
}

/** `expresswayCovered` from a city's expressway.yaml text. */
export function expresswayCoveredFrom(file: string, text: string): Rect[] {
  if (!text.trim()) return [];
  const def = parseExpressway(file, text, []);
  return def ? expresswayCovered(new Expressway(def)) : [];
}
