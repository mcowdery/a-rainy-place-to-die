import type { Controls } from '../../race/vehicle';
import { CELL, type CellPlan3, type Road3 } from './plan';

/**
 * Auto drive: your car (or bike) drives itself to the GPS's destination along the GPS's driving route (gps.ts),
 * on the streets (not the expressway). It works the car's own controls (race/vehicle.ts `Controls`), so the
 * handling, the sound, the lights and the damage are the car's as ever, and any key takes the wheel back.
 *
 * `lanePath` turns the route (road centrelines, corner to corner) into the line to drive: the lane to keep on each
 * road (keep left: the kerb lane of an avenue, the left half of a street, the middle of a narrow lane), the corners
 * rounded as the traffic's are, and the junctions along it (a signal, a road with traffic to give way to, or a
 * side street). `AutoDrive` follows it: steering at a point ahead on the lane, at a speed for the road, the bends
 * ahead, the vehicle ahead in the lane, the lights and whatever stands in the way, pulling in at the kerb at the
 * end. Three ways of driving (`AutoMode`):
 * - `traffic`: as the traffic drives. Its speeds, stopping at red (and at amber when it can), right turns giving
 *   way to oncoming traffic, never out of its lane.
 * - `careful`: slow, and no rules: a red light is a give-way line (through when nothing's coming), and it goes
 *   round a stopped vehicle on the other side of the road when that's clear.
 * - `fast`: as quick as stays clean: high speeds on the straights, braking late for the bends at what the grip
 *   allows, red lights as give-way lines, overtaking in an avenue's inner lane (never the oncoming one).
 * It doesn't see the crowd (nobody stands in the road, and people cross on the walk light); story npcs, parked
 * cars, poles and walls it steers round or stops for (`AutoWorld.solid`). Pure: tests/autoDrive.test.ts.
 *
 * A fourth way, `pursuit`, is not yours to pick: it's how the cars in a chase drive (district/chaseCar.ts): flat out,
 * corners as fast as they'll go, no lights, no giving way, round anything on either side.
 */
export type AutoMode = 'traffic' | 'careful' | 'fast' | 'pursuit';
/** The ways you can pick (N at the wheel, the Maps app). */
export const AUTO_MODES: readonly AutoMode[] = ['traffic', 'careful', 'fast'];
export const AUTO_NAMES: Readonly<Record<AutoMode, string>> = { traffic: 'with the traffic', careful: 'slow, no rules', fast: 'fast', pursuit: 'pursuit' };

interface Style {
  /** Cruising speed (m/s) in a narrow lane, on a street, on an avenue. */
  readonly cruise: readonly [number, number, number];
  /** The sideways pull it takes bends at, the deceleration it plans its braking by and the hardest it will brake (m/s^2). */
  readonly pull: number;
  readonly brake: number;
  readonly hard: number;
  /** The most throttle it gives. */
  readonly throttle: number;
  /** Following: the time gap (s) and the standstill gap (m). */
  readonly gap: number;
  readonly s0: number;
  /** Whether it stops at red; else the speed it comes to a red light's line at (and crosses when nothing's coming). */
  readonly lights: boolean;
  /** The speed it comes to a give-way line at, and crosses a side street at. */
  readonly creep: number;
  readonly minor: number;
  /** Going round what's ahead: never, onto the other side of the road too, or only into a lane going its way. */
  readonly pass: 'none' | 'any' | 'same';
  /** The sideways pull it takes a street corner at (the traffic's, unless it's in a chase). */
  readonly corner: number;
  /** In a chase: junctions are nothing to it (no lights, no giving way, no slowing for a side street). */
  readonly reckless?: boolean;
}

const STYLE: Readonly<Record<AutoMode, Style>> = {
  traffic: { cruise: [5, 12, 13.5], pull: 2.2, brake: 2.4, hard: 7, throttle: 0.45, gap: 1.3, s0: 2.6, lights: true, creep: 4.5, minor: 8, pass: 'none', corner: 2.6 },
  careful: { cruise: [4, 6.5, 6.5], pull: 1.8, brake: 2.2, hard: 7, throttle: 0.3, gap: 1.2, s0: 2.4, lights: false, creep: 3, minor: 5, pass: 'any', corner: 2.6 },
  fast: { cruise: [7, 19, 26], pull: 4.4, brake: 4.6, hard: 8, throttle: 1, gap: 0.8, s0: 3, lights: false, creep: 6, minor: 11, pass: 'same', corner: 2.6 },
  pursuit: { cruise: [9, 23, 31], pull: 6, brake: 6, hard: 9, throttle: 1, gap: 0.45, s0: 2, lights: false, creep: 14, minor: 18, pass: 'any', corner: 5.2, reckless: true },
};

/** A road as the driver needs it: where its centreline is, how wide, its pavements and its median. */
export interface RoadInfo {
  readonly vertical: boolean;
  /** The centreline: x of a north-south road, z of an east-west one. */
  readonly centre: number;
  readonly width: number;
  readonly sidewalk: number;
  readonly median: number;
  readonly avenue: boolean;
}

export type RoadFinder = (x: number, z: number, vertical: boolean) => RoadInfo | null;

/** The road running north-south (`vertical`) or east-west under a point, from the cells' plans (and the street bridges). */
export function roadFinder(plan: (mx: number, my: number) => CellPlan3 | null, bridges: readonly { readonly road: Road3 }[] = []): RoadFinder {
  const info = (r: Road3): RoadInfo => ({
    vertical: r.vertical,
    centre: r.vertical ? r.rect.x + r.rect.w / 2 : r.rect.y + r.rect.h / 2,
    width: r.vertical ? r.rect.w : r.rect.h,
    sidewalk: r.sidewalk,
    median: r.median,
    avenue: r.kind === 'boulevard',
  });
  return (x, z, vertical) => {
    let best: RoadInfo | null = null;
    let bestD = Infinity;
    const see = (r: Road3): void => {
      if (r.kind === 'coast' || r.vertical !== vertical) return;
      const q = r.rect;
      if (x < q.x - 0.5 || x > q.x + q.w + 0.5 || z < q.y - 0.5 || z > q.y + q.h + 0.5) return;
      const d = Math.abs((vertical ? q.x + q.w / 2 : q.y + q.h / 2) - (vertical ? x : z));
      if (d < bestD) [best, bestD] = [info(r), d];
    };
    for (const r of plan(Math.floor(x / CELL), Math.floor(z / CELL))?.roads ?? []) see(r);
    for (const b of bridges) see(b.road);
    return best;
  };
}

/** The lane a road gives you (metres left of its centreline), where its kerb is, and the next lane over to the right. */
function laneOf(r: RoadInfo | null): { o: number; kerb: number; cls: 0 | 1 | 2; shift: number; oncoming: boolean } {
  // (Off the road: the way out to it from where the car stands.)
  if (!r) return { o: 0, kerb: 0, cls: 0, shift: 0, oncoming: false };
  const c = r.width / 2 - r.sidewalk;
  // Two lanes each way (an avenue): the kerb lane, as the traffic keeps to; the inner one is the next over.
  if (c >= 9) {
    const w = (c - r.median / 2) / 2;
    return { o: c - w / 2, kerb: c - 1.1, cls: 2, shift: w, oncoming: false };
  }
  // A shared lane (no pavements): its middle, or just left of it where there's room.
  if (r.sidewalk === 0 && !r.avenue) return { o: Math.max(0, Math.min(c / 2, c - 1.5)), kerb: Math.max(0, c - 1.2), cls: 0, shift: 0, oncoming: false };
  // A street inside a block (no traffic runs there, and cars are parked along its kerbs): near its middle.
  if (Math.abs(r.centre - Math.round(r.centre / CELL) * CELL) > 0.01 && c < 4.5) return { o: Math.min(0.4, c / 2), kerb: Math.max(0.4, c - 1.1), cls: 1, shift: 0, oncoming: false };
  const o = Math.max(1.1, c / 2);
  return { o, kerb: Math.max(o, c - 1.1), cls: r.avenue ? 2 : 1, shift: c >= 2.2 ? 2 * o : 0, oncoming: true };
}

/** A junction on the way: where to stop short of it, and what it asks of you. */
export interface AutoJunction {
  /** Along the path: where the car's centre stops with its nose at the line, and where it's through. */
  readonly stop: number;
  readonly exit: number;
  /** The box's middle. */
  readonly x: number;
  readonly z: number;
  /** A signal (its grid corner, and whether you come along the north-south road), a road with traffic to give way to, or a side street. */
  readonly kind: 'signal' | 'giveway' | 'minor';
  readonly gx: number;
  readonly gy: number;
  readonly ns: boolean;
  readonly turn: 'left' | 'right' | null;
}

/** The line to drive, sampled about every metre. */
export interface LanePath {
  readonly n: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Unit direction of travel. */
  readonly dx: Float64Array;
  readonly dz: Float64Array;
  /** Curvature (1/m, unsigned) and distance along. */
  readonly k: Float64Array;
  readonly s: Float64Array;
  /** The road's class: 0 a narrow lane (and the way on and off the road), 1 a street, 2 an avenue. */
  readonly cls: Uint8Array;
  /** The next lane over, metres to the right (0: none), and whether it's the oncoming one. */
  readonly shift: Float32Array;
  readonly oncoming: Uint8Array;
  readonly junctions: readonly AutoJunction[];
  readonly length: number;
}

type Pt = readonly [number, number];

/** Ways through a tight gap: sideways off the lane (m to the right), the nearest first. */
const SQUEEZE: readonly number[] = Array.from({ length: 25 }, (_, k) => (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.2).filter((v) => v >= -1.4);

/** How fast it moves over sideways, metres across per metre along: sharply at a crawl, a gentle lane change at speed. */
const slew = (u: number): number => Math.max(0.25, Math.min(0.6, 0.7 - 0.05 * Math.abs(u)));

/** Tightest radius of a turn (m): left round the near kerb, right across the junction (the traffic's: traffic.ts). */
const TURN_R = { left: 5.2, right: 8.5 } as const;

/**
 * The line to drive for a GPS route (its first and last points are where you were and the place itself; between
 * them it runs down road centrelines), from where the car is now. `hl`: the car's half length (for the stop lines).
 * Null if there's nothing to drive (you're there).
 */
export function lanePath(route: readonly Pt[], from: { readonly x: number; readonly z: number }, road: RoadFinder, hl = 2.2): LanePath | null {
  // The centreline's corners.
  const C: Pt[] = [];
  for (const p of route.slice(1, -1)) if (!C.length || Math.hypot(p[0] - C[C.length - 1][0], p[1] - C[C.length - 1][1]) > 0.5) C.push(p);
  if (C.length < 2) return null;
  // Standing off the road (a garage's bay, a forecourt): first straight out to it, then the turn onto its lane (a
  // corner like any other, with a give-way line where it meets a road with traffic).
  {
    const vertical = Math.abs(C[1][1] - C[0][1]) >= Math.abs(C[1][0] - C[0][0]);
    const r = road(from.x, from.z, vertical);
    const onIt = !!r && Math.abs((vertical ? from.x : from.z) - r.centre) < r.width / 2 - r.sidewalk + 0.3;
    if (!onIt && Math.hypot(from.x - C[0][0], from.z - C[0][1]) > 2.5) C.unshift([from.x, from.z]);
  }
  const m = C.length - 1;
  // Each leg: its direction, and the lane's offset along it (the road under it changes: a street widens into an
  // avenue), eased so the lane never jumps sideways.
  const STEP = 8;
  const legs = Array.from({ length: m }, (_, i) => {
    const [ax, az] = C[i];
    const [bx, bz] = C[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const d: Pt = [(bx - ax) / len, (bz - az) / len];
    const vertical = Math.abs(d[1]) >= Math.abs(d[0]);
    const n = Math.max(1, Math.ceil(len / STEP));
    const infos: (RoadInfo | null)[] = [];
    let last: RoadInfo | null = null;
    for (let k = 0; k <= n; k++) {
      const t = (len * k) / n;
      last = road(ax + d[0] * t, az + d[1] * t, vertical) ?? last;
      infos.push(last);
    }
    // (A leg starting in a junction may find its road only further on.)
    const first = infos.find((r) => r) ?? null;
    const lanes = infos.map((r) => laneOf(r ?? first));
    const o = lanes.map((l) => l.o);
    const slope = 0.12 * (len / n);
    for (let k = 1; k <= n; k++) o[k] = Math.min(o[k], o[k - 1] + slope);
    for (let k = n - 1; k >= 0; k--) o[k] = Math.min(o[k], o[k + 1] + slope);
    // (Eased toward the narrower: a lane further out is given up before a narrow stretch, never held into it.)
    const at = (t: number): number => {
      const f = Math.max(0, Math.min(n, (t / len) * n));
      const k = Math.min(n - 1, Math.floor(f));
      return o[k] + (o[k + 1] - o[k]) * (f - k);
    };
    const laneAt = (t: number): (typeof lanes)[number] => lanes[Math.max(0, Math.min(n, Math.round((t / len) * n)))];
    const infoAt = (t: number): RoadInfo | null => infos[Math.max(0, Math.min(n, Math.round((t / len) * n)))] ?? first;
    return { a: C[i], d, left: [d[1], -d[0]] as Pt, len, vertical, at, laneAt, infoAt, infos, a0: 0, a1: len, tl0: 0, tl1: 0 };
  });
  // Pulling in at the kerb over the last stretch.
  {
    const L = legs[m - 1];
    const at = L.at;
    const kerb = L.laneAt(L.len).kerb;
    const run = Math.min(22, L.len);
    L.at = (t) => {
      const f = Math.max(0, Math.min(1, (t - (L.len - run)) / Math.max(run, 1e-3)));
      return at(t) + (kerb - at(t)) * f * f * (3 - 2 * f);
    };
  }
  // The corners: where consecutive lane lines cross, rounded by an arc.
  const corners: ({ kx: number; kz: number; R: number; tl: number; right: boolean; ang: number } | null)[] = [null];
  for (let i = 1; i < m; i++) {
    const A = legs[i - 1];
    const B = legs[i];
    const cross = A.d[0] * B.d[1] - A.d[1] * B.d[0];
    const dot = A.d[0] * B.d[0] + A.d[1] * B.d[1];
    if (Math.abs(cross) < 0.2 && dot > 0) {
      corners.push(null);
      continue;
    }
    // Lane line A through pa along A.d, lane line B through pb along B.d.
    const oa = A.at(A.len);
    const ob = B.at(0);
    const pa: Pt = [C[i][0] + A.left[0] * oa, C[i][1] + A.left[1] * oa];
    const pb: Pt = [C[i][0] + B.left[0] * ob, C[i][1] + B.left[1] * ob];
    let kx = pa[0];
    let kz = pa[1];
    if (Math.abs(cross) > 1e-3) {
      const t = ((pb[0] - pa[0]) * B.d[1] - (pb[1] - pa[1]) * B.d[0]) / cross;
      kx = pa[0] + A.d[0] * t;
      kz = pa[1] + A.d[1] * t;
    }
    const right = cross > 0;
    const ang = Math.atan2(Math.abs(cross), dot);
    const endA = A.len + (kx - C[i][0]) * A.d[0] + (kz - C[i][1]) * A.d[1];
    const startB = (kx - C[i][0]) * B.d[0] + (kz - C[i][1]) * B.d[1];
    // The arc's tangent length, no more than the legs have room for.
    let R: number = right ? TURN_R.right : TURN_R.left;
    const room = Math.max(0.5, Math.min(endA * 0.45, (B.len - startB) * 0.45));
    let tl = R * Math.tan(ang / 2);
    if (tl > room) {
      tl = room;
      R = tl / Math.tan(ang / 2);
    }
    A.a1 = endA;
    A.tl1 = tl;
    B.a0 = startB;
    B.tl0 = tl;
    corners.push({ kx, kz, R, tl, right, ang });
  }
  // Samples: the way onto the road, then each leg's straight and the arc at its end.
  const X: number[] = [];
  const Z: number[] = [];
  const CL: number[] = [];
  const SH: number[] = [];
  const ON: number[] = [];
  /** Per sample: its leg, and how far along that leg (the arcs count as the leg before). */
  const LEG: number[] = [];
  const AL: number[] = [];
  const push = (x: number, z: number, cls: number, shift: number, on: boolean, leg: number, along: number): void => {
    const n = X.length;
    if (n && Math.hypot(x - X[n - 1], z - Z[n - 1]) < 0.3) return;
    X.push(x);
    Z.push(z);
    CL.push(cls);
    SH.push(shift);
    ON.push(on ? 1 : 0);
    LEG.push(leg);
    AL.push(along);
  };
  const lanePoint = (i: number, t: number): Pt => {
    const L = legs[i];
    const o = L.at(t);
    return [L.a[0] + L.d[0] * t + L.left[0] * o, L.a[1] + L.d[1] * t + L.left[1] * o];
  };
  // Onto the road: from where the car stands to the lane a little way on (so it joins at an angle).
  const L0 = legs[0];
  const end0 = L0.a1 - L0.tl1;
  const af = (from.x - L0.a[0]) * L0.d[0] + (from.z - L0.a[1]) * L0.d[1];
  let join = Math.max(0, Math.min(end0, Math.max(0, af) + 7));
  {
    const [jx, jz] = lanePoint(0, join);
    const dist = Math.hypot(jx - from.x, jz - from.z);
    if (dist > 1.5) {
      const n = Math.ceil(dist);
      for (let k = 0; k < n; k++) push(from.x + ((jx - from.x) * k) / n, from.z + ((jz - from.z) * k) / n, 0, 0, false, 0, join);
    } else join = Math.max(0, Math.min(end0, af));
  }
  for (let i = 0; i < m; i++) {
    const L = legs[i];
    const s0 = i === 0 ? join : L.a0 + L.tl0;
    const s1 = L.a1 - L.tl1;
    const n = Math.max(1, Math.ceil((s1 - s0) / 1));
    for (let k = 0; k <= n; k++) {
      const t = s0 + ((s1 - s0) * k) / n;
      if (s1 < s0 && k > 0) break;
      const lane = L.laneAt(t);
      // (Pulling in at the end, there's no lane over to move into.)
      const last = i === m - 1 && L.len - t < 30;
      push(...lanePoint(i, t), lane.cls, last ? 0 : lane.shift, lane.oncoming, i, t);
    }
    const c = corners[i + 1];
    if (i + 1 < m && c) {
      const B = legs[i + 1];
      // The arc: from the tangent point on this leg's lane line to the one on the next's.
      const sx = c.kx - L.d[0] * c.tl;
      const sz = c.kz - L.d[1] * c.tl;
      // Toward the inside of the turn: right of travel turning right, left turning left.
      const nx = c.right ? -L.d[1] : L.d[1];
      const nz = c.right ? L.d[0] : -L.d[0];
      const ox = sx + nx * c.R;
      const oz = sz + nz * c.R;
      const steps = Math.max(2, Math.ceil((c.R * c.ang) / 0.8));
      const lane = B.laneAt(0);
      for (let k = 1; k < steps; k++) {
        const a = (c.ang * k) / steps * (c.right ? 1 : -1);
        // (x east, z south: a positive angle turns clockwise seen from above, to the right.)
        const rx = sx - ox;
        const rz = sz - oz;
        push(ox + rx * Math.cos(a) - rz * Math.sin(a), oz + rx * Math.sin(a) + rz * Math.cos(a), Math.min(lane.cls, L.laneAt(L.len).cls), 0, false, i, s1);
      }
    }
  }
  const n = X.length;
  if (n < 2) return null;
  const x = Float64Array.from(X);
  const z = Float64Array.from(Z);
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], z[i] - z[i - 1]);
  const dx = new Float64Array(n);
  const dz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const l = Math.hypot(x[b] - x[a], z[b] - z[a]) || 1;
    dx[i] = (x[b] - x[a]) / l;
    dz[i] = (z[b] - z[a]) / l;
  }
  // Curvature from how the direction turns, over a few metres (a kink where it joins the road reads as a tight bend).
  const k = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    const turn = Math.abs(Math.atan2(dx[a] * dz[b] - dz[a] * dx[b], dx[a] * dx[b] + dz[a] * dz[b]));
    k[i] = Math.min(0.45, turn / Math.max(1, s[b] - s[a]));
  }
  // Junctions: the boxes each leg's road crosses, and the one it turns in at its end.
  const sAt = (leg: number, along: number): number => {
    let lastOf = -1;
    for (let i = 0; i < n; i++) {
      if (LEG[i] !== leg) continue;
      lastOf = i;
      if (AL[i] >= along) return s[i] - Math.min(1.2, Math.max(0, AL[i] - along));
    }
    return lastOf < 0 ? 0 : s[lastOf];
  };
  const grid = (v: number): boolean => Math.abs(v - Math.round(v / CELL) * CELL) < 0.01;
  // Junctions: every road a leg crosses or turns into, found by walking the leg and asking what runs across it.
  const junctions: AutoJunction[] = [];
  for (let i = 0; i < m; i++) {
    const L = legs[i];
    const axis = L.vertical ? 1 : 0;
    const seen: RoadInfo[] = [];
    const across: RoadInfo[] = [];
    for (let t = 0; t <= L.len + 2; t += 2) {
      const at = Math.min(t, L.len);
      const r = road(L.a[0] + L.d[0] * at, L.a[1] + L.d[1] * at, !L.vertical);
      if (r) across.push(r);
    }
    // (A side street it turns into at the leg's end stops at this road's edge, short of its centreline: the next leg's road.)
    const into = i + 1 < m && corners[i + 1] ? legs[i + 1].infos.find((q) => q) : null;
    if (into && into.vertical !== L.vertical) across.push(into);
    for (const r of across) {
      if (seen.some((q) => Math.abs(q.centre - r.centre) < 0.01)) continue;
      seen.push(r);
      // Where it lies along the leg: its middle, and its near and far sides.
      const tc = (r.centre - L.a[axis]) / (L.d[axis] || 1);
      const half = r.width / 2;
      // The leg starts in it (the turn before, or where you set out).
      if (tc - half < 0.5) continue;
      const turning = tc + half > L.len - 0.5 && i + 1 < m && !!corners[i + 1];
      // (Ending in a junction: nothing to cross.)
      if (tc + half > L.len - 0.5 && !turning) continue;
      const own = L.infoAt(Math.max(0, tc - half - 2));
      const mine = !!own && grid(own.centre) && own.width >= 8;
      const theirs = grid(r.centre) && r.width >= 8;
      // (On the main road, a side street crossing it is nothing to it.)
      if (mine && !theirs && !turning) continue;
      const kind: AutoJunction['kind'] = mine && theirs ? 'signal' : theirs ? 'giveway' : 'minor';
      const c = corners[i + 1];
      // The line: before a signal's zebra, else at the edge of the carriageway it meets; and before the turn begins.
      const edge = kind === 'signal' ? tc - half - 4.5 : tc - (half - r.sidewalk) - 1.2;
      const line = Math.min(edge, turning ? L.a1 - L.tl1 - 0.5 : Infinity);
      // (Setting out already over a signal's line: it goes on through. A give-way line it's at: it gives way from there.)
      const raw = sAt(i, line) - hl - 0.4;
      const stop = raw < -0.5 && kind === 'signal' ? -3 : Math.max(0, raw);
      const exit = turning ? sAt(i + 1, legs[i + 1].a0 + legs[i + 1].tl0) + 3 : sAt(i, tc + half) + 2;
      const cx = L.a[0] + L.d[0] * tc;
      const cz = L.a[1] + L.d[1] * tc;
      junctions.push({ stop, exit: Math.max(exit, stop + 4), x: cx, z: cz, kind, gx: Math.round(cx / CELL), gy: Math.round(cz / CELL), ns: L.vertical, turn: turning && c ? (c.right ? 'right' : 'left') : null });
    }
  }
  junctions.sort((a, b) => a.stop - b.stop);
  return { n, x, z, dx, dz, k, s, cls: Uint8Array.from(CL), shift: Float32Array.from(SH), oncoming: Uint8Array.from(ON), junctions, length: s[n - 1] };
}

/**
 * The lane ahead of (x, z), for the GPS's chevrons (so they lie where the car drives): points along the path from
 * `first` metres on, every `step`, as far as `dist`. `hint`: the sample it was nearest last time (searched from
 * there; the whole path if that's lost it); `i` is the one it's nearest now.
 */
export function laneAhead(path: LanePath, x: number, z: number, hint: number, dist: number, step: number, first = step): { i: number; pts: { x: number; z: number; dx: number; dz: number }[] } {
  const nearest = (a: number, b: number): [number, number] => {
    let bi = a;
    let bd = Infinity;
    for (let k = a; k <= b; k++) {
      const d = (path.x[k] - x) ** 2 + (path.z[k] - z) ** 2;
      if (d < bd) [bi, bd] = [k, d];
    }
    return [bi, bd];
  };
  let [i, d] = hint >= 0 ? nearest(Math.max(0, hint - 12), Math.min(path.n - 1, hint + 90)) : [0, Infinity];
  if (d > 25 * 25) [i, d] = nearest(0, path.n - 1);
  const pts: { x: number; z: number; dx: number; dz: number }[] = [];
  let k = i;
  for (let s = path.s[i] + first; s <= Math.min(path.length, path.s[i] + dist); s += step) {
    while (k + 1 < path.n - 1 && path.s[k + 1] <= s) k++;
    const f = Math.max(0, Math.min(1, (s - path.s[k]) / Math.max(1e-6, path.s[k + 1] - path.s[k])));
    pts.push({ x: path.x[k] + (path.x[k + 1] - path.x[k]) * f, z: path.z[k] + (path.z[k + 1] - path.z[k]) * f, dx: path.dx[k], dz: path.dz[k] });
  }
  return { i, pts };
}

/** Another vehicle: where it is, the way it points, its speed along that, and its size. */
export interface AutoVehicle {
  readonly x: number;
  readonly z: number;
  readonly dx: number;
  readonly dz: number;
  readonly v: number;
  readonly half: number;
  readonly width: number;
}

export type Solid = 'wall' | 'car' | 'pole' | 'soft' | 'person';

/** What the driver can see. */
export interface AutoWorld {
  /** The light facing you at a signal (its grid corner; `ns`: you come along the north-south road). */
  light(gx: number, gy: number, ns: boolean): 'green' | 'amber' | 'red';
  /** The other vehicles within r of a point (not your own). */
  vehicles(x: number, z: number, r: number): readonly AutoVehicle[];
  /** What stands within r of a point at street level (not vehicles in the traffic): walls, parked cars, poles, people. */
  solid(x: number, z: number, r: number): Solid | null;
}

/** The car as the driver feels it: where it is, the way it points (rad, as race/vehicle.ts), its forward speed. */
export interface AutoCar {
  readonly x: number;
  readonly z: number;
  readonly h: number;
  readonly u: number;
}

export type AutoStatus = 'driving' | 'lights' | 'giving way' | 'following' | 'passing' | 'in the way' | 'backing up' | 'arriving' | 'arrived';

export class AutoDrive {
  /** How it's doing, for the HUD. */
  status: AutoStatus = 'driving';
  arrived = false;
  /** Seconds it has stood with no way on (the page gives up on it after a while). */
  blockedFor = 0;
  /** Its pace: a share of the style's cruising speeds (a chase car's own). */
  pace = 1;
  /** Seconds for which it takes no notice of other vehicles (a chase car held up in a queue shoves through). */
  shove = 0;
  /** Where it is along the path (sample index). */
  private i = 0;
  /** The junction ahead (index), and whether it's gone past its line. */
  private j = 0;
  private committed = false;
  /** Sideways off the lane (m to the right): a lane over to pass, and round something in the way. */
  private shift = 0;
  private shiftWant = 0;
  private dodge = 0;
  private dodgeWant = 0;
  /** Now and then: what stands ahead (m, or Infinity), and whether to pass. */
  private lookIn = 0;
  private solidAhead = Infinity;
  /** Squeezing through a tight gap (between parked cars): at a crawl, with little to spare. */
  private squeeze = false;
  /** Standing still when it wants to go, and backing out of it (or `room`: back from a stopped vehicle, to pull out round it). */
  private stuck = 0;
  private backing = 0;
  private backSteer = 0;
  private backs = 0;
  private room: false | 'vehicle' | 'solid' = false;
  /** The controls as it holds them (eased: feet and hands move, they don't switch), and the speed it wanted last. */
  private steer = 0;
  private gas = 0;
  private brake = 0;
  private wanted = 0;
  private easing = 0;
  private held = false;

  constructor(
    readonly path: LanePath,
    public mode: AutoMode,
    private readonly world: AutoWorld,
    /** The car's half length and half width. */
    private readonly hl = 2.2,
    private readonly hw = 0.85,
  ) {}

  /**
   * Carries on from another drive of the same car (its route planned again from where it is: a chase car's, as what
   * it's after moves): the controls as they were held, so it doesn't lift off and start again.
   */
  carryOn(prev: AutoDrive): void {
    this.steer = prev.steer;
    this.gas = prev.gas;
    this.brake = prev.brake;
    this.wanted = prev.wanted;
    this.easing = prev.easing;
    this.shove = prev.shove;
  }

  /** Metres still to go. */
  get left(): number {
    return this.path.length - this.path.s[this.i];
  }

  /** The sample index `ahead` metres on from i. */
  private on(i: number, ahead: number): number {
    const P = this.path;
    const target = P.s[i] + ahead;
    let j = i;
    while (j < P.n - 1 && P.s[j] < target) j++;
    return j;
  }

  /** A point on the lane at sample j, `side` metres to its right. */
  private point(j: number, side: number): [number, number] {
    const P = this.path;
    return [P.x[j] - P.dz[j] * side, P.z[j] + P.dx[j] * side];
  }

  /**
   * The nearest vehicle ahead in the corridor `side` metres right of the lane, from `from` metres behind the car to
   * `to` ahead: its gap (bumper to bumper, m; negative alongside) and its speed along the lane (negative: oncoming).
   */
  private inLane(vs: readonly AutoVehicle[], side: number, from: number, to: number): { gap: number; v: number } | null {
    const P = this.path;
    const s0 = P.s[this.i];
    const lo = this.on(Math.max(0, this.i - Math.ceil(-Math.min(0, from)) - 2), 0);
    const hi = this.on(this.i, to + 6);
    let best: { gap: number; v: number } | null = null;
    for (const o of vs) {
      let bj = -1;
      let bd = Infinity;
      for (let j = lo; j <= hi; j++) {
        const d = (o.x - P.x[j]) ** 2 + (o.z - P.z[j]) ** 2;
        if (d < bd) [bj, bd] = [j, d];
      }
      if (bj < 0 || bd > 144) continue;
      const rx = o.x - P.x[bj];
      const rz = o.z - P.z[bj];
      const lat = -rx * P.dz[bj] + rz * P.dx[bj];
      const along = Math.abs(o.dx * P.dx[bj] + o.dz * P.dz[bj]);
      // Across the lane it's as wide as it's long.
      const wide = along * (o.width / 2) + (1 - along) * o.half;
      if (Math.abs(lat - side) > wide + this.hw + 0.3) continue;
      const ds = P.s[bj] + rx * P.dx[bj] + rz * P.dz[bj] - s0;
      const gap = ds - this.hl - (along * o.half + (1 - along) * (o.width / 2));
      if (ds < from || gap > to) continue;
      const v = o.v * (o.dx * P.dx[bj] + o.dz * P.dz[bj]);
      if (!best || gap < best.gap) best = { gap, v };
    }
    return best;
  }

  /**
   * How far ahead (m from the nose) something solid stands in the corridor `side` metres right of the lane, within
   * `reach`. `here`: where the car is across the lane now, if it's still on its way over to `side` (the corridor
   * then runs from there across to `side` over `run` metres: the path it will sweep).
   */
  private solidIn(side: number, reach: number, from = 1, here = side, run = 1, r = this.hw + 0.3): number {
    const P = this.path;
    for (let d = from; d <= reach; d += 1.6) {
      const j = this.on(this.i, this.hl + d);
      const [x, z] = this.point(j, here + (side - here) * Math.max(0, Math.min(1, d / run)));
      if (this.world.solid(x, z, r)) return d;
      if (j >= P.n - 1) break;
    }
    return Infinity;
  }

  /** Vehicles on their way through a junction that you'd cross: cross traffic (`cross`), and oncoming traffic turning right. */
  private conflict(J: AutoJunction, vs: readonly AutoVehicle[], cross: boolean, d: readonly [number, number]): boolean {
    for (const o of vs) {
      const along = o.dx * d[0] + o.dz * d[1];
      // Going your way: someone to follow, not to give way to.
      if (along > 0.5) continue;
      const oncoming = along < -0.5;
      if (oncoming ? J.turn !== 'right' : !cross) continue;
      const rx = J.x - o.x;
      const rz = J.z - o.z;
      const toward = rx * o.dx + rz * o.dz;
      const miss = Math.abs(rx * o.dz - rz * o.dx);
      if (miss > 13) continue;
      // In the box, or reaching it within a few seconds.
      if (toward > -5 && toward < 12 && o.v > 0.3) return true;
      if (o.v > 1 && toward > 0 && toward < Math.max(18, o.v * 4.5)) return true;
    }
    return false;
  }

  /** Straight back a few metres from what's stopped (or stands) ahead, for the room to pull out round it. */
  private backOff(from: 'vehicle' | 'solid'): void {
    this.backing = from === 'vehicle' ? 4 : 2.6;
    this.backSteer = 0;
    this.room = from;
  }

  /** The controls for this step. `grip`: the road's (1 dry: rain and snow take from the bends and the braking). */
  step(dt: number, car: AutoCar, grip = 1): Controls {
    const P = this.path;
    const S = STYLE[this.mode];
    const { hl } = this;
    if (this.arrived) return { throttle: 0, brake: 0, steer: 0, handbrake: true };
    // Where it is along the path: the nearest sample a little way either side of the last.
    {
      let best = this.i;
      let bd = Infinity;
      for (let j = Math.max(0, this.i - 4); j <= Math.min(P.n - 1, this.i + 50); j++) {
        const d = (car.x - P.x[j]) ** 2 + (car.z - P.z[j]) ** 2;
        if (d < bd) [best, bd] = [j, d];
      }
      this.i = best;
    }
    const i = this.i;
    // (Between the samples, not on them: a stop line that comes a metre nearer at a time has the car braking in jerks.)
    const s = P.s[i] + Math.max(-1.5, Math.min(1.5, (car.x - P.x[i]) * P.dx[i] + (car.z - P.z[i]) * P.dz[i]));
    const left = P.length - s;
    const u = car.u;
    const fx = Math.sin(car.h);
    const fz = Math.cos(car.h);
    // Sideways, eased by the ground covered (`slew` a metre: a car can't move over standing still), and no faster
    // than a lane change takes.
    const SLEW = slew(u);
    const over1 = Math.min(1.5 * dt, SLEW * Math.abs(u) * dt);
    this.shift += Math.max(-over1, Math.min(over1, this.shiftWant - this.shift));
    this.dodge += Math.max(-over1, Math.min(over1, this.dodgeWant - this.dodge));
    const side = this.shift + this.dodge;
    // Where the car is across the lane now (it takes a moment to get over to `side`).
    const here = -(car.x - P.x[i]) * P.dz[i] + (car.z - P.z[i]) * P.dx[i];
    // Steering: at a point ahead on the lane.
    const look = Math.max(3, Math.min(20, 2.4 + Math.abs(u) * 0.5));
    const tj = this.on(i, s - P.s[i] + look);
    let [tx, tz] = this.point(tj, side);
    // (The point exactly `look` on: back from the sample past it, or on beyond the path's end.)
    const over = s + look - P.s[tj];
    tx += P.dx[tj] * over;
    tz += P.dz[tj] * over;
    const rx = tx - car.x;
    const rz = tz - car.z;
    const bearing = Math.atan2(rx * fz - rz * fx, rx * fx + rz * fz);
    // The wheel follows smoothly (a driver's hands, not a switch).
    this.steer += (Math.max(-1, Math.min(1, bearing * 2.6)) - this.steer) * Math.min(1, dt * 9);
    const steer = this.steer;
    const pull = S.pull * grip;
    const b = S.brake * grip;
    this.shove = Math.max(0, this.shove - dt);
    const vs = this.shove > 0 ? [] : this.world.vehicles(car.x, car.z, 90);
    const cruise = (cls: number): number => S.cruise[cls] * this.pace;
    // Backing out of a tight spot (nose-in at a wall, the way on behind it): a little way back, the wheel turned
    // so the nose swings round to the lane.
    if (this.backing > 0) {
      this.backing -= dt;
      this.status = 'backing up';
      // What's behind: straight back, and to the side the tail swings to with the wheel turned.
      const bx = car.x - fx * (hl + 1.3);
      const bz = car.z - fz * (hl + 1.3);
      const swing = -this.backSteer * (this.hw + 0.5);
      const behind = this.world.solid(bx, bz, this.hw + 0.1) || (swing !== 0 && this.world.solid(bx + fz * swing, bz - fx * swing, 0.5)) || vs.some((o) => Math.abs((o.x - car.x) * fx + (o.z - car.z) * fz + hl + 1.5) < o.half + 1.5 && Math.abs((o.x - car.x) * fz - (o.z - car.z) * fx) < o.width / 2 + this.hw + 0.3);
      const enough = this.room === 'vehicle' ? (this.inLane(vs, here, 0, 20)?.gap ?? 99) > 9 : this.room === 'solid' ? this.solidIn(here, 8) > 6 : Math.abs(bearing) < 0.35;
      if (behind || enough) this.backing = 0;
      if (this.backing > 0) return { throttle: 0, brake: u > -1.6 ? 0.6 : 0, steer: this.backSteer, handbrake: false };
      this.stuck = 0;
    }
    // Rolling backward (off a backing-up, or down a hill): the throttle stops it.
    if (u < -0.6) return { throttle: 0.5, brake: 0, steer: -steer, handbrake: false };

    // The speed it wants: the road's, the bends ahead (braking in time for each), and the end.
    let want: number = cruise(P.cls[i]);
    let status: AutoStatus = 'driving';
    const reach = (u * u) / (2 * b) + 14;
    for (let j = i; j < P.n && P.s[j] - s <= reach; j++) {
      const d = Math.max(0, P.s[j] - s - 1);
      // (A street corner is taken as the traffic takes it, however quick the driver: the pull it likes is for the sweeps.)
      const bend = Math.sqrt(Math.min(pull, P.k[j] > 0.1 ? S.corner * grip : pull) / Math.max(P.k[j], 1e-4));
      want = Math.min(want, Math.sqrt(Math.min(bend, cruise(P.cls[j])) ** 2 + 2 * b * d));
    }
    if (left < 40) status = 'arriving';
    want = Math.min(want, Math.sqrt(2 * b * Math.max(0, left - 0.6)) + (left > 0.8 ? 0.5 : 0));

    // The junction ahead.
    while (this.j < P.junctions.length && P.junctions[this.j].exit < s) {
      this.j++;
      this.committed = false;
    }
    const J = P.junctions[this.j];
    // (No changing lanes close to a junction, and none before a left turn: that's from the kerb lane.)
    let nearJunction = false;
    if (J) {
      const dist = J.stop - s;
      nearJunction = dist < 45 && (J.turn === 'left' || dist < 12);
      // (Over the line: it's going through.)
      if (dist < -1) this.committed = true;
      if (!this.committed && dist < 90 && !S.reckless) {
        const d: readonly [number, number] = [P.dx[i], P.dz[i]];
        const near = vs.filter((o) => Math.hypot(o.x - J.x, o.z - J.z) < 70);
        const light = J.kind === 'signal' ? this.world.light(J.gx, J.gy, J.ns) : null;
        let hold = false;
        let why: AutoStatus = 'giving way';
        if (J.kind === 'minor') want = Math.min(want, Math.sqrt(S.minor ** 2 + 2 * b * Math.max(0, dist)));
        else if (light && S.lights) {
          // The traffic's rules: stop at red while it still can, at amber when it can stop comfortably.
          if (light === 'red') hold = dist > (u * u) / (2 * S.hard * grip) - 1;
          else if (light === 'amber') hold = dist > (u * u) / (2 * b) + 0.5;
          why = 'lights';
        } else if (light !== 'green') {
          // A give-way line (and, without the rules, a red light): up to it slowly, and over when nothing's coming.
          want = Math.min(want, Math.sqrt(S.creep ** 2 + 2 * b * Math.max(0, dist)));
          hold = this.conflict(J, near, true, d);
        }
        // Turning right crosses the oncoming lane.
        if (!hold && J.turn === 'right') hold = this.conflict(J, near, false, d);
        if (hold) {
          want = Math.min(want, Math.sqrt(2 * b * Math.max(0, dist - 0.8)));
          if (dist < 30) status = why;
        }
      }
    }

    // The vehicle ahead in the lane: follow it at a gap, stop behind it.
    const ahead = this.inLane(vs, here, 0, 75);
    const across = Math.abs(side - here) > 0.4 ? this.inLane(vs, side, 0, 75) : null;
    const lead = ahead && across ? (across.gap < ahead.gap ? across : ahead) : (ahead ?? across);
    if (lead) {
      const lv = Math.max(0, lead.v);
      const room = Math.max(0, lead.gap - S.s0);
      let v = Math.sqrt(2 * b * room + lv * lv);
      // (Closer than its time gap: ease back to it.)
      const keep = S.s0 + S.gap * lv;
      if (lead.gap < keep) v = Math.min(v, lv * Math.max(0, lead.gap / keep));
      if (v < want) {
        want = v;
        status = 'following';
      }
    }

    // Now and then: what stands in the way, and whether to go round what's ahead.
    this.lookIn -= dt;
    if (this.lookIn <= 0) {
      this.lookIn = 0.15;
      const far = (u * u) / (2 * b) + 9 + Math.abs(u) * 1.5;
      const want2 = this.shiftWant + this.dodgeWant;
      const wide = this.hw + 0.3;
      const tight = this.hw + 0.2;
      // The corridor the car will sweep on its way over to `to`: from where it is across the lane, at `SLEW`.
      // (`whole`: from the car's middle, for a move not yet begun: its sides swing as it turns.)
      const sweep = (to: number, reach: number, r: number, whole = false): number => this.solidIn(to, reach, whole ? -hl : 1, here, Math.abs(to - here) / SLEW + look, r);
      this.solidAhead = sweep(want2, far, this.squeeze ? tight : wide);
      let roomWouldHelp = false;
      if (this.solidAhead < Infinity) {
        // Round it, if there is room a little to one side (toward the middle of the road first); failing that, through
        // whatever gap there is (a narrow street with cars parked on both sides) at a crawl. A way round counts
        // only if the car can get over to it from here without clipping anything.
        const from = Math.max(1, this.solidAhead - 5);
        const to = this.solidAhead + 8;
        const pick = (offs: readonly number[], r: number): boolean => {
          for (const off of offs) {
            if (this.solidIn(this.shiftWant + off, to, from, undefined, 1, r) < Infinity) continue;
            if (this.inLane(vs, this.shiftWant + off, -6, 40)) continue;
            const swept = sweep(this.shiftWant + off, far, r, true);
            if (swept < Infinity) {
              // (Clear over there, but not from here: with a few metres more room it would be.)
              roomWouldHelp = true;
              continue;
            }
            this.dodgeWant = off;
            this.squeeze = r === tight;
            this.solidAhead = swept;
            return true;
          }
          return false;
        };
        if (!pick([1.1, -1.1, 2, -2, 2.9], wide)) pick(SQUEEZE, tight);
      } else if ((this.dodgeWant !== 0 || this.squeeze) && this.solidIn(this.shiftWant, far + 6) === Infinity) {
        this.dodgeWant = 0;
        this.squeeze = false;
      }
      // A lane over, to pass a stopped or slow vehicle; back when its own lane is clear again.
      const next = P.shift[i];
      const mayPass = S.pass !== 'none' && next > 0 && !nearJunction && (S.pass === 'any' || !P.oncoming[i]);
      if (this.shiftWant === 0) {
        const slow = lead && lead.gap < 40 && (P.oncoming[i] ? lead.v < 0.5 : lead.v < S.cruise[P.cls[i]] - 3);
        if (mayPass && slow) {
          // Onto the oncoming side only round one stopped vehicle (not a queue), with a long clear view.
          const queue = P.oncoming[i] ? vs.filter((o) => o.v < 0.5 && Math.hypot(o.x - car.x, o.z - car.z) < 45).length > 2 : false;
          const clearOf = this.inLane(vs, next, -10, P.oncoming[i] ? 110 : 45);
          if (!queue && !clearOf && this.solidIn(next, P.oncoming[i] ? 45 : 60) === Infinity) {
            // (Stopped right behind it: back off first, for the room to pull out.)
            if (lead.gap > 6) this.shiftWant = next;
            else if (Math.abs(u) < 0.3) this.backOff('vehicle');
          }
        }
      } else if (!this.inLane(vs, 0, -(hl + 5), 16) || next === 0 || nearJunction) {
        // Its lane's clear alongside and ahead (or the lane over ends, or a junction's coming): back into it.
        if (!this.inLane(vs, 0, -(hl + 5), 8)) this.shiftWant = 0;
      }
      // On its way round something but stopped short of it, too close to swing out: back off for the room.
      if (Math.abs(u) < 0.3 && Math.abs(want2 - here) > 0.25 && ahead && ahead.gap < 6) this.backOff('vehicle');
      // The same with something standing in the way: there's a way round it, but from here the car would clip it.
      else if (Math.abs(u) < 0.3 && this.solidAhead < 4 && roomWouldHelp && this.backs < 8) {
        this.backs++;
        this.backOff('solid');
      }
    }
    if (this.shiftWant !== 0 || Math.abs(this.shift) > 0.3) status = 'passing';
    if (this.squeeze) want = Math.min(want, 2.5);
    // (Between looks, what stands ahead comes nearer as the car moves.)
    else if (this.solidAhead < Infinity) this.solidAhead = Math.max(0, this.solidAhead - Math.max(0, u) * dt);
    if (this.solidAhead < Infinity) {
      const v = Math.sqrt(2 * b * Math.max(0, this.solidAhead - 1.2));
      if (v < want) {
        want = v;
        status = 'in the way';
      }
    }
    this.status = status;

    // Standing when it wants to go (against a kerb or a wall, or the way on is behind it): back up and try again.
    const standing = Math.abs(u) < 0.3;
    const turnedAway = Math.abs(bearing) > 1.9;
    this.stuck = standing && (want > 1 || turnedAway) ? this.stuck + dt : 0;
    if ((this.stuck > 1.6 || (turnedAway && standing && this.stuck > 0.3)) && this.backs < 8) {
      this.backs++;
      this.room = false;
      this.backing = 2.2;
      this.backSteer = bearing > 0 ? -1 : 1;
      this.stuck = 0;
    }
    this.blockedFor = standing && (status === 'in the way' || this.backs >= 8) ? this.blockedFor + dt : 0;

    // The last stretch blocked (cars parked both sides of a narrow street): this is as near as it gets.
    if ((left < 1.4 && u < 0.6) || (left < 60 && this.blockedFor > 2.5)) {
      this.arrived = true;
      this.status = 'arrived';
      return { throttle: 0, brake: 0, steer: 0, handbrake: true };
    }
    // Throttle and brake for the speed it wants. (The brake at a standstill is reverse: hold on the handbrake.)
    // (Held until there's somewhere to go: a queue inching forward doesn't have it on and off the brake.)
    if (u < 0.8 && want < (this.held ? 0.8 : 0.2)) {
      this.held = true;
      this.gas = this.brake = 0;
      this.wanted = want;
      return { throttle: 0, brake: 0, steer, handbrake: true };
    }
    this.held = false;
    // The acceleration to ask for: toward the speed it wants, and while that's falling (braking for a bend, a
    // line, a car ahead) the braking it planned, so it follows the plan instead of chasing it.
    const falling = Math.max(-1.5 * b, Math.min(0, (want - this.wanted) / Math.max(dt, 1e-3)));
    this.wanted = want;
    this.easing += (falling - this.easing) * Math.min(1, dt * 6);
    const err = want - u;
    const acc = Math.max(-S.hard * grip, Math.min(4.5, this.easing + err * (err > 0 ? 1.1 : 3)));
    // One foot: on the throttle, off both (the engine and the road slow it a little), or on the brake; moved, not
    // stamped (a pedal that flicks on and off rocks the car).
    const gas = acc > 0.1 ? Math.min(S.throttle, acc / 6) : 0;
    const brake = acc < -0.5 && u > 0.8 ? Math.min(1, (-acc - 0.1) / 9.4) : 0;
    this.gas += Math.max(-5 * dt, Math.min(2.2 * dt, gas - this.gas));
    this.brake += Math.max(-5 * dt, Math.min((acc < -5 ? 12 : 6) * dt, brake - this.brake));
    if (this.brake > 0.01) this.gas = 0;
    return { throttle: this.gas, brake: u > 0.8 ? this.brake : 0, steer, handbrake: false };
  }
}
