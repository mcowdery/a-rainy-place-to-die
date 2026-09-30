import YAML from 'yaml';
import { ID_PATTERN } from '../../content/stamps';
import { frontPoint } from './plan';
import type { RailLine3 } from './rail';
import type { Placed3 } from './stamps';

/**
 * The rail network (content/world3d/subway.yaml, plus the elevated Toto Line from rail.yaml), in world
 * metres. A subway line runs straight under a road;
 * its stations are placements of subway stamps (landmark: subway) whose street face is SUBWAY_AXIS m from
 * the line, listed in order along it. Pure: parsing, routes between stations, and the timetable the
 * trains, departure boards and rides all share.
 *
 *   lines:
 *     - id: yako
 *       name: 夜光線
 *       nameEn: YAKŌ LINE
 *       letter: Y              # station codes: Y01, Y02, ... in order
 *       color: '#9b6cff'
 *       stations: [y01_station, y02_station, ...]
 *   transfers:
 *     - [y04_station, w02_station]   # change lines here (Toto Line stations too)
 *
 * The Toto Line joins the network as a line of kind 'elevated' (its stations are the station landmarks
 * along the viaduct, T01... in order), so routes and the route picker cover both.
 */

/** The line runs this far out from a subway station's street face. */
export const SUBWAY_AXIS = 10;
/** The platform's middle, along the station's street face (u, from real/subwayStation.ts). */
export const PLATFORM_U = 6;
/** Tracks either side of the line's centre (the island platform between them). */
export const TRACK_OFFSET = 5.65;

export interface SubwayStop3 {
  /** The station's placement id. */
  readonly key: string;
  readonly line: string;
  readonly index: number;
  /** Station number: the line's letter and its place on the line (Y04). */
  readonly code: string;
  readonly jp: string;
  readonly en: string;
  /** The platform's middle on the line: world x, z, and s, the coordinate along the line. */
  readonly x: number;
  readonly z: number;
  readonly s: number;
}

export interface SubwayLine3 {
  readonly id: string;
  /** subway: tunnels, trains and rides here (real/subway.ts); elevated: the Toto Line (real/rail.ts). */
  readonly kind: 'subway' | 'elevated';
  readonly name: string;
  readonly nameEn: string;
  readonly letter: string;
  readonly color: number;
  /** The world axis the line runs along, and its coordinate across (z for an east-west line). */
  readonly along: 'x' | 'z';
  readonly at: number;
  readonly stops: readonly SubwayStop3[];
}

export interface SubwayNet3 {
  readonly lines: readonly SubwayLine3[];
  readonly transfers: readonly (readonly [string, string])[];
  /** Every stop by placement id. */
  readonly stops: ReadonlyMap<string, SubwayStop3>;
}

export const EMPTY_SUBWAY: SubwayNet3 = { lines: [], transfers: [], stops: new Map() };

/** The line through a subway station: the axis it runs along and where (SUBWAY_AXIS out from the face). */
export function stationAxis(p: Placed3): { along: 'x' | 'z'; at: number } {
  const r = p.rect;
  switch (p.stamp.front) {
    case 'north': return { along: 'x', at: r.y - SUBWAY_AXIS };
    case 'south': return { along: 'x', at: r.y + r.h + SUBWAY_AXIS };
    case 'west': return { along: 'z', at: r.x - SUBWAY_AXIS };
    case 'east': return { along: 'z', at: r.x + r.w + SUBWAY_AXIS };
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The elevated lines (rail.yaml) join the network: each one's station landmarks (station.line, or the first line)
 * in order along it, numbered by its letter.
 */
export function parseSubway3(file: string, text: string, placed: readonly Placed3[], errors: string[], elevated: readonly RailLine3[] = []): SubwayNet3 {
  const err = (m: string): void => void errors.push(`${file}: ${m}`);
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    err(`YAML: ${(e as Error).message}`);
    return EMPTY_SUBWAY;
  }
  if (!isObj(doc) || !Array.isArray(doc.lines)) return err('expected lines: [...]'), EMPTY_SUBWAY;
  const byId = new Map(placed.map((p) => [p.id, p]));
  const lines: SubwayLine3[] = [];
  const stops = new Map<string, SubwayStop3>();
  const stations = placed.filter((p) => p.stamp.landmark === 'station');
  for (const p of stations) {
    const want = p.stamp.station?.line;
    if (want !== undefined && !elevated.some((l) => l.id === want)) err(`station '${p.id}': no rail line '${want}'`);
  }
  for (const [li, el] of elevated.entries()) {
    const mine = stations.filter((p) => (p.stamp.station?.line ?? elevated[0].id) === el.id);
    const on = mine.map((p) => ({ p, at: el.path.project(p.building.x, p.building.z) }));
    for (const { p, at } of on) if (at.d > 30) err(`station '${p.id}' is ${at.d.toFixed(0)} m from the ${el.id} line (its face must be 10 m from it)`);
    on.sort((a, b) => a.at.s - b.at.s);
    if (on.length < 2) {
      if (li === 0 || on.length) err(`rail line '${el.id}' needs at least two stations`);
      continue;
    }
    const ls = on.map(({ p, at }, k): SubwayStop3 => {
      const q = el.path.at(at.s);
      return { key: p.id, line: el.id, index: k, code: `${el.letter}${String(k + 1).padStart(2, '0')}`, jp: p.stamp.station?.jp ?? p.id, en: p.stamp.station?.en ?? p.id, x: q.x, z: q.z, s: at.s };
    });
    for (const s of ls) stops.set(s.key, s);
    const h = el.path.at(0);
    lines.push({ id: el.id, kind: 'elevated', name: el.name, nameEn: el.nameEn, letter: el.letter, color: el.color, along: Math.abs(h.hx) > 0.5 ? 'x' : 'z', at: Math.abs(h.hx) > 0.5 ? h.z : h.x, stops: ls });
  }
  doc.lines.forEach((raw: unknown, i: number) => {
    const at = `line ${i}`;
    if (!isObj(raw)) return err(`${at} must be a mapping`);
    const id = String(raw.id);
    if (!ID_PATTERN.test(id)) return err(`${at}: id must match ${ID_PATTERN}`);
    if (lines.some((l) => l.id === id)) return err(`${at}: duplicate line id '${id}'`);
    if (typeof raw.name !== 'string' || typeof raw.nameEn !== 'string') err(`${at} (${id}): needs name and nameEn`);
    if (typeof raw.letter !== 'string' || !/^[A-Z]$/.test(raw.letter)) return err(`${at} (${id}): letter must be one capital`);
    if (!/^#[0-9a-f]{6}$/i.test(String(raw.color))) err(`${at} (${id}): color must be '#rrggbb'`);
    if (!Array.isArray(raw.stations) || raw.stations.length < 2) return err(`${at} (${id}): needs at least two stations`);
    const places: Placed3[] = [];
    for (const k of raw.stations) {
      const p = byId.get(String(k));
      if (!p) err(`${at} (${id}): no placement '${String(k)}'`);
      else if (p.stamp.landmark !== 'subway') err(`${at} (${id}): '${p.id}' is not a subway station (landmark: subway)`);
      else if (stops.has(p.id)) err(`${at} (${id}): '${p.id}' is already a station of another line`);
      else places.push(p);
    }
    if (places.length !== raw.stations.length) return;
    // Every station on the same straight line, in order along it, far enough apart for their platforms.
    const axes = places.map(stationAxis);
    const [a0] = axes;
    const bad = places.find((_, k) => axes[k].along !== a0.along || Math.abs(axes[k].at - a0.at) > 0.5);
    if (bad) return err(`${at} (${id}): '${bad.id}' is not on the line (its face must be ${SUBWAY_AXIS} m from the same road centre as '${places[0].id}')`);
    const centres = places.map((p) => frontPoint(p.building, PLATFORM_U, SUBWAY_AXIS));
    const ss = centres.map((c) => (a0.along === 'x' ? c.x : c.z));
    const dir = Math.sign(ss[1] - ss[0]);
    for (let k = 1; k < ss.length; k++) {
      if (Math.sign(ss[k] - ss[k - 1]) !== dir) return err(`${at} (${id}): stations must be listed in order along the line ('${places[k].id}')`);
      if (Math.abs(ss[k] - ss[k - 1]) < 90) return err(`${at} (${id}): '${places[k - 1].id}' and '${places[k].id}' are closer than 90 m (their platforms overlap)`);
    }
    const letter = raw.letter;
    const lineStops = places.map((p, k): SubwayStop3 => ({
      key: p.id,
      line: id,
      index: k,
      code: `${letter}${String(k + 1).padStart(2, '0')}`,
      jp: p.stamp.station?.jp ?? p.id,
      en: p.stamp.station?.en ?? p.id,
      x: centres[k].x,
      z: centres[k].z,
      s: ss[k],
    }));
    for (const s of lineStops) stops.set(s.key, s);
    lines.push({ id, kind: 'subway', name: String(raw.name), nameEn: String(raw.nameEn), letter, color: parseInt(String(raw.color).slice(1), 16), along: a0.along, at: a0.at, stops: lineStops });
  });
  const transfers: [string, string][] = [];
  for (const [i, t] of (Array.isArray(doc.transfers) ? doc.transfers : []).entries()) {
    if (!Array.isArray(t) || t.length !== 2) {
      err(`transfer ${i} must be [station, station]`);
      continue;
    }
    const [a, b] = t.map(String);
    const sa = stops.get(a);
    const sb = stops.get(b);
    if (!sa || !sb) err(`transfer ${i}: '${!sa ? a : b}' is not a station on a line`);
    else if (sa.line === sb.line) err(`transfer ${i}: '${a}' and '${b}' are on the same line`);
    else transfers.push([a, b]);
  }
  // Every subway station must be on a line.
  for (const p of placed) if (p.stamp.landmark === 'subway' && !stops.has(p.id)) err(`subway station '${p.id}' is not on any line`);
  return { lines, transfers, stops };
}

/** A journey's legs: rides along one line (stop indices), and changes of line. */
export type RouteLeg =
  | { readonly kind: 'ride'; readonly line: string; readonly from: number; readonly to: number }
  | { readonly kind: 'transfer'; readonly from: string; readonly to: string };

/** The journey with the fewest stops and changes between two stations, or null if there's none. */
export function subwayRoute(net: SubwayNet3, from: string, to: string): RouteLeg[] | null {
  if (!net.stops.has(from) || !net.stops.has(to) || from === to) return null;
  const lineOf = new Map(net.lines.map((l) => [l.id, l]));
  // Breadth-first over stops; a change of line costs like a stop, so direct rides win.
  const prev = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const k = queue.shift()!;
    if (k === to) break;
    const s = net.stops.get(k)!;
    const line = lineOf.get(s.line)!;
    const next = [line.stops[s.index - 1]?.key, line.stops[s.index + 1]?.key, ...net.transfers.filter((t) => t.includes(k)).map((t) => (t[0] === k ? t[1] : t[0]))];
    for (const n of next) {
      if (n === undefined || prev.has(n)) continue;
      prev.set(n, k);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  for (let k: string | null = to; k !== null; k = prev.get(k)!) path.unshift(k);
  const legs: RouteLeg[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = net.stops.get(path[i - 1])!;
    const b = net.stops.get(path[i])!;
    if (a.line !== b.line) {
      legs.push({ kind: 'transfer', from: a.key, to: b.key });
      continue;
    }
    const last = legs[legs.length - 1];
    if (last?.kind === 'ride' && last.line === a.line) legs[legs.length - 1] = { ...last, to: b.index };
    else legs.push({ kind: 'ride', line: a.line, from: a.index, to: b.index });
  }
  return legs;
}

// ---- Timetable ----

/** Running: top speed (m/s), acceleration (m/s^2), dwell at a station and layover beyond the ends (s). */
export const SUBWAY_RUN = { vmax: 20, acc: 1.1, dwell: 20, layover: 25 } as const;
/** Half a three-car train's length (18 m cars, 0.4 m gaps). */
export const SUBWAY_TRAIN_HALF = 27.4;
/** How far past the end stations the trains turn back (in the tunnel, out of sight). */
const BEYOND = 90;

/** Distance covered t seconds into a stop-to-stop run of length d, and the run's duration. */
export function runProfile(d: number): { T: number; at: (t: number) => number } {
  const { vmax: V, acc: A } = SUBWAY_RUN;
  const tA = V / A;
  const dA = (V * V) / (2 * A);
  if (d <= 2 * dA) {
    const tp = Math.sqrt(d / A);
    return { T: 2 * tp, at: (t) => (t <= 0 ? 0 : t < tp ? 0.5 * A * t * t : t < 2 * tp ? d - 0.5 * A * (2 * tp - t) ** 2 : d) };
  }
  const tC = (d - 2 * dA) / V;
  const T = 2 * tA + tC;
  return { T, at: (t) => (t <= 0 ? 0 : t < tA ? 0.5 * A * t * t : t < tA + tC ? dA + V * (t - tA) : t < T ? d - 0.5 * A * (T - t) ** 2 : d) };
}

export type TimetableLeg =
  | { readonly kind: 'run'; readonly from: number; readonly to: number; readonly T: number; readonly at: (t: number) => number }
  | { readonly kind: 'wait'; readonly s: number; readonly T: number; readonly stop: number | null; readonly hidden: boolean };

/** One direction's cycle (dir 1: in station order): turn back unseen, then each stop in turn with dwells. */
export function lineSchedule(line: SubwayLine3, dir: 1 | -1): { legs: TimetableLeg[]; period: number } {
  const order = dir > 0 ? line.stops : [...line.stops].reverse();
  const sgn = Math.sign(order[order.length - 1].s - order[0].s) || 1;
  const pts: { s: number; stop: number | null }[] = [
    { s: order[0].s - sgn * BEYOND, stop: null },
    ...order.map((st) => ({ s: st.s, stop: st.index })),
    { s: order[order.length - 1].s + sgn * BEYOND, stop: null },
  ];
  const legs: TimetableLeg[] = [{ kind: 'wait', s: pts[0].s, T: SUBWAY_RUN.layover, stop: null, hidden: true }];
  for (let i = 0; i + 1 < pts.length; i++) {
    const r = runProfile(Math.abs(pts[i + 1].s - pts[i].s));
    legs.push({ kind: 'run', from: pts[i].s, to: pts[i + 1].s, T: r.T, at: r.at });
    if (i + 2 < pts.length) legs.push({ kind: 'wait', s: pts[i + 1].s, T: SUBWAY_RUN.dwell, stop: pts[i + 1].stop, hidden: false });
  }
  return { legs, period: legs.reduce((t, l) => t + l.T, 0) };
}

/** Where a train is t seconds into its cycle: s along the line, whether it's out of sight, and at which stop it stands. */
export function trainAt(legs: readonly TimetableLeg[], t: number): { s: number; hidden: boolean; stop: number | null; speed: number } {
  for (const l of legs) {
    if (t < l.T) {
      if (l.kind === 'wait') return { s: l.s, hidden: l.hidden, stop: l.stop, speed: 0 };
      const sgn = Math.sign(l.to - l.from);
      return { s: l.from + sgn * l.at(t), hidden: false, stop: null, speed: Math.abs(l.at(t + 0.05) - l.at(t)) / 0.05 };
    }
    t -= l.T;
  }
  const last = legs[legs.length - 1];
  return { s: last.kind === 'run' ? last.to : last.s, hidden: true, stop: null, speed: 0 };
}

/** Seconds into the cycle at which a train leaves a stop (the end of its dwell there). */
export function departsAt(legs: readonly TimetableLeg[], stop: number): number | null {
  let t = 0;
  for (const l of legs) {
    t += l.T;
    if (l.kind === 'wait' && l.stop === stop) return t;
  }
  return null;
}

/** Trains per direction, spread evenly over the cycle. */
export const TRAINS_PER_DIRECTION = 2;
/** A train's offset into the cycle (k-th of the direction's trains). */
export const trainOffset = (period: number, k: number, dir: 1 | -1): number => (period * k) / TRAINS_PER_DIRECTION + (dir > 0 ? 0 : period * 0.23);

/** Seconds until the next trains leave a stop in one direction (soonest first), at clock time. */
export function nextDepartures(line: SubwayLine3, stop: number, dir: 1 | -1, clock: number, count = 2): number[] {
  const { legs, period } = lineSchedule(line, dir);
  const d = departsAt(legs, stop);
  if (d === null) return [];
  const out: number[] = [];
  for (let k = 0; k < TRAINS_PER_DIRECTION; k++) {
    const phase = (clock + trainOffset(period, k, dir)) % period;
    let w = (d - phase + period) % period;
    for (let n = 0; n < count; n++, w += period) out.push(w);
  }
  return out.sort((a, b) => a - b).slice(0, count);
}
