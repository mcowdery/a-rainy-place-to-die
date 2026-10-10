import { filipino } from '../district/cityConfig';
import * as THREE from 'three';
import { splitByTile } from './tiles';
import { passengerMesh, type PassengerSpot } from './people';
import { portalOffset, type RailKind, type RailLine3, type RoadUnder } from '../district/rail';
import { leftOf } from '../district/rail';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { PLATFORM_Y, RAIL_Y, STATION, type StationNames } from './station';
import { dwellDoors, RideTimeline, type RideEvent, type RideState } from '../district/rideTimeline';
import { carSet2, type CarMaterials, type TrainSet2 } from './trainCar';
import type { Ridable } from './cabinRider';

/**
 * The elevated railways on the main thread (district/rail.ts lays them out): for each line its viaduct along the
 * path (a train line: deck, parapets, two tracks, piers, catenary; a monorail: two concrete beams on T-piers),
 * skipping the stations (they build their own), and its trains: three-car sets in the line's colours (stainless
 * commuter cars, or white straddle monorail cars), lit interiors you can see into, running a timetable both ways
 * and stopping at every station, each car following the curves. Trains keep left. startRide() puts the camera in
 * a car for the trip between two stations of the line.
 */

const DECK_TOP = 8.0;
const TRACK = 2.2;
const CAR = 18;
const GAP = 0.4;
const CARS = 3;
const TRAIN_HALF = (CARS * CAR + (CARS - 1) * GAP) / 2;
const V_MAX: Readonly<Record<RailKind, number>> = { train: 17, monorail: 20 };
const ACCEL = 1.0;
const DWELL = 16;
const LAYOVER = 24;
/** Piers stand this far apart along the line, and never in a junction (this near a grid corner). */
const PIER_STEP: Readonly<Record<RailKind, number>> = { train: 24, monorail: 20 };
const JUNCTION_CLEAR = 17;

export interface RailStation {
  readonly id: string;
  readonly line: string;
  readonly names: StationNames;
  /** The platforms' centre along the line. */
  readonly s: number;
  /** +1 if the station building is left of the line's heading (increasing s), -1 right. */
  readonly side: number;
  /** Length along the line that the station builds itself (the viaduct skips it). */
  readonly s0: number;
  readonly s1: number;
}

/** A station on its line: where it stands along it, and on which side. */
export function railStation(line: RailLine3, id: string, names: StationNames, x: number, z: number): RailStation {
  const { s } = line.path.project(x, z);
  const h = line.path.at(s);
  const [lx, lz] = leftOf(h);
  const side = Math.sign((x - h.x) * lx + (z - h.z) * lz) || 1;
  return { id, line: line.id, names, s, side, s0: s - STATION.fw / 2, s1: s + STATION.fw / 2 };
}

const nearJunction = (x: number, z: number): boolean => {
  const dx = Math.abs(x - Math.round(x / 128) * 128);
  const dz = Math.abs(z - Math.round(z / 128) * 128);
  return dx < JUNCTION_CLEAR && dz < JUNCTION_CLEAR;
};

/**
 * Whether a column at (x, z) stands on a carriageway (a road without a median: the median is where a column belongs,
 * the pavements are clear of it). The grid roads run along the multiples of the cell size.
 */
function onCarriageway(x: number, z: number, under: RoadUnder): boolean {
  for (const vertical of [true, false]) {
    const road = under(x, z, vertical);
    if (!road || road.median) continue;
    const lateral = Math.abs(vertical ? x - Math.round(x / 128) * 128 : z - Math.round(z / 128) * 128);
    if (lateral < road.half) return true;
  }
  return false;
}

/**
 * The piers' places along the line (s), outside the stations and junctions, and one under each end. With the road
 * under it known, none whose columns would stand in a carriageway: on a corner's arc the line swings out of its
 * road, and its portal frames' columns would land in the crossing street.
 */
function pierPlaces(line: RailLine3, stations: readonly RailStation[], under: RoadUnder | null = null): number[] {
  const out: number[] = [];
  const step = PIER_STEP[line.kind];
  const L = line.path.length;
  const clear = (s: number): boolean => !stations.some((st) => s > st.s0 - 2 && s < st.s1 + 2);
  const free = (s: number): boolean => {
    if (!under) return true;
    const p = pierAt(line, s, under);
    if (!p.off) return !onCarriageway(p.x, p.z, under);
    const [lx, lz] = [p.hz, -p.hx];
    return [1, -1].every((side) => !onCarriageway(p.x + lx * p.off * side, p.z + lz * p.off * side, under));
  };
  if (clear(2) && free(2)) out.push(2);
  for (let s = step / 2; s < L; s += step) {
    if (!clear(s) || s < 8 || s > L - 8) continue;
    const p = line.path.at(s);
    if (!nearJunction(p.x, p.z) && free(s)) out.push(s);
  }
  if (clear(L - 2) && free(L - 2)) out.push(L - 2);
  return out;
}

/** A pier column's half-width across the line (a portal frame's columns are slimmer than a single one). */
const COLUMN: Readonly<Record<RailKind, number>> = { train: 0.5, monorail: 0.4 };

/**
 * How the pier at s stands: one column on the line (`off` 0: in the road's median, or with no road under it),
 * or a portal frame (門型橋脚), a column at the back of each pavement and a beam across under the deck,
 * so the carriageway under the line is clear (`off`: the columns' distance from the line).
 */
function pierAt(line: RailLine3, s: number, under: RoadUnder | null): { x: number; z: number; hx: number; hz: number; off: number } {
  const h = line.path.at(s);
  const road = under?.(h.x, h.z, Math.abs(h.hz) > Math.abs(h.hx)) ?? null;
  const off = road && !road.median ? portalOffset(road) : 0;
  return { x: h.x, z: h.z, hx: h.hx, hz: h.hz, off };
}

/** The ground-level colliders of a line's piers (the stations add their own). */
export function viaductPiers(line: RailLine3, stations: readonly RailStation[], under: RoadUnder | null = null): { x: number; y: number; w: number; h: number }[] {
  return pierPlaces(line, stations, under).flatMap((s) => {
    const p = pierAt(line, s, under);
    if (!p.off) {
      const half = line.kind === 'monorail' ? 0.7 : 1.2;
      return [{ x: p.x - half, y: p.z - half, w: half * 2, h: half * 2 }];
    }
    const c = COLUMN[line.kind];
    const [lx, lz] = [p.hz, -p.hx];
    return [1, -1].map((side) => ({ x: p.x + lx * p.off * side - c, y: p.z + lz * p.off * side - c, w: c * 2, h: c * 2 }));
  });
}

/** Distance covered after t seconds of a stop-to-stop run of length d, and the run's duration. */
function run(d: number, vmax: number): { T: number; at: (t: number) => number } {
  const tA = vmax / ACCEL;
  const dA = (vmax * vmax) / (2 * ACCEL);
  if (d <= 2 * dA) {
    const tp = Math.sqrt(d / ACCEL);
    return { T: 2 * tp, at: (t) => (t < tp ? 0.5 * ACCEL * t * t : d - 0.5 * ACCEL * (2 * tp - t) ** 2) };
  }
  const tC = (d - 2 * dA) / vmax;
  return {
    T: 2 * tA + tC,
    at: (t) => (t < tA ? 0.5 * ACCEL * t * t : t < tA + tC ? dA + vmax * (t - tA) : d - 0.5 * ACCEL * (2 * tA + tC - t) ** 2),
  };
}

type Leg = { kind: 'run'; from: number; to: number; T: number; at: (t: number) => number } | { kind: 'wait'; s: number; T: number; dir: number; doors: boolean };

/** A crossover's length (m): the train eases across the 4.4 m between the tracks over it. */
const CROSS = 36;

/**
 * Where a line's trains turn back at each end. Past a terminal station with room enough beyond it (a stub of
 * track), they run on past the platform, cross over to the other track and stand at the end of the stub; where the
 * station is the end of the line, they cross over before it and stand at its platform on the departure track.
 * `stop`: where the train stands to turn; `zone`: the crossover, [s0, s1] along the line. Trains keep left, so a
 * train going up (increasing s) is on the +TRACK side and coming down on the -TRACK side; through a crossover
 * the track is +TRACK at its low end and -TRACK at its high end (up trains cross into the high end's stub or
 * platform, down trains into the low end's).
 */
export interface Turnback {
  readonly stop: number;
  readonly zone: readonly [number, number];
  readonly station: boolean;
}
export interface Turnbacks {
  readonly lo: Turnback;
  readonly hi: Turnback;
}

export function turnbacks(L: number, stations: readonly { readonly s: number; readonly s0: number; readonly s1: number }[]): Turnbacks {
  const byS = [...stations].sort((a, b) => a.s - b.s);
  const room = 2 * TRAIN_HALF + CROSS + 10;
  const first = byS[0];
  const last = byS[byS.length - 1];
  const lo: Turnback = !first || first.s0 >= room
    ? { stop: TRAIN_HALF, zone: first ? [first.s0 - 8 - CROSS, first.s0 - 8] : [2 * TRAIN_HALF + 4, 2 * TRAIN_HALF + 4 + CROSS], station: false }
    : { stop: first.s, zone: [first.s1 + 8, first.s1 + 8 + CROSS], station: true };
  const hi: Turnback = !last || L - last.s1 >= room
    ? { stop: L - TRAIN_HALF, zone: last ? [last.s1 + 8, last.s1 + 8 + CROSS] : [L - 2 * TRAIN_HALF - 4 - CROSS, L - 2 * TRAIN_HALF - 4], station: false }
    : { stop: last.s, zone: [last.s0 - 8 - CROSS, last.s0 - 8], station: true };
  return { lo, hi };
}

/** The lateral offset of the track a train going `dir` is on at s (left of the line's heading), crossovers included. */
export function trackAt(tb: Turnbacks, s: number, dir: number): number {
  const across = (z: readonly [number, number]): number => TRACK * (1 - 2 * smoothstep((s - z[0]) / (z[1] - z[0])));
  if (dir > 0) return s <= tb.hi.zone[0] ? TRACK : across(tb.hi.zone);
  return s >= tb.lo.zone[1] ? -TRACK : across(tb.lo.zone);
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * A train's round trip: up the line from the low end's turnback to the high end's, a dwell at every station
 * between, a layover there (in view: at a stub, or with the doors open at a terminal platform), then back down.
 */
function schedule(tb: Turnbacks, stations: readonly { readonly s: number }[], vmax: number): { legs: Leg[]; period: number } {
  const between = stations.map((st) => st.s).filter((s) => s > tb.lo.stop + 1 && s < tb.hi.stop - 1).sort((a, b) => a - b);
  const legs: Leg[] = [];
  const leg = (stops: number[], dir: number, end: Turnback): void => {
    for (let i = 0; i + 1 < stops.length; i++) {
      const r = run(Math.abs(stops[i + 1] - stops[i]), vmax);
      legs.push({ kind: 'run', from: stops[i], to: stops[i + 1], T: r.T, at: r.at });
      if (i + 2 < stops.length) legs.push({ kind: 'wait', s: stops[i + 1], T: DWELL, dir, doors: true });
    }
    // Turning: facing the way it'll leave.
    legs.push({ kind: 'wait', s: end.stop, T: LAYOVER, dir: -dir, doors: end.station });
  };
  leg([tb.lo.stop, ...between, tb.hi.stop], 1, tb.hi);
  leg([tb.hi.stop, ...[...between].reverse(), tb.lo.stop], -1, tb.lo);
  return { legs, period: legs.reduce((t, l) => t + l.T, 0) };
}

function where(legs: readonly Leg[], t: number): { s: number; dir: number; doors: number } {
  for (const l of legs) {
    if (t < l.T) {
      if (l.kind === 'wait') return { s: l.s, dir: l.dir, doors: l.doors ? dwellDoors(t, l.T) : 0 };
      return { s: l.from + Math.sign(l.to - l.from) * l.at(t), dir: Math.sign(l.to - l.from), doors: 0 };
    }
    t -= l.T;
  }
  const last = legs[legs.length - 1];
  return { s: last.kind === 'run' ? last.to : last.s, dir: 1, doors: 0 };
}

/**
 * One car at the origin, along +z, rail top at y 0. cab: a driving end at +z with lamps of this colour. mono: a
 * straddle monorail car (white, skirts down either side of the beam, a rounded nose).
 */
function buildCar(stripe: number, cab: [number, number, number] | null, mono = false): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const mb = new MeshBuilder();
  const gb = new MeshBuilder();
  mb.flags = 0;
  mb.style = [0, 0, 0, 0];
  const box = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: number = KIND.plain): void => {
    mb.kind = kind;
    mb.color = lin(hex);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, Math.abs(x1 - x0), Math.abs(z1 - z0), kind, true);
  };
  const glow = (rgb: [number, number, number], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = rgb;
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, Math.abs(x1 - x0), Math.abs(z1 - z0), KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  /** Inside the car: surfaces under its ceiling lights, always lit. */
  const inner = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.interior, 0, 0, 0];
    mb.color = lin(hex);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, Math.abs(x1 - x0), Math.abs(z1 - z0), KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const paneX = (x: number, y0: number, y1: number, z0: number, z1: number): void => gb.quad([x, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0]);
  const paneZ = (z: number, x0: number, x1: number, y0: number, y1: number): void => gb.quad([x0, y0, z], [x1 - x0, 0, 0], [0, y1 - y0, 0]);
  const STEEL = mono ? 0xeef0f2 : 0xb4b8bc;
  const H = CAR / 2;
  const W = 1.45;
  const FLOOR = 0.9;
  const SILL = 1.75;
  const HEAD = 2.95;
  const TOP = 3.45;
  const DOORS = [-6.9, -2.3, 2.3, 6.9];

  // Running gear and the floor.
  if (mono) {
    // Skirts down either side of the beam (the bogies hidden inside), a stripe along their foot.
    for (const s of [-1, 1]) {
      box(STEEL, s * 0.55, s * W, -1.05, 0.75, -H + 0.4, H - 0.4);
      box(stripe, s * W, s * (W + 0.012), -0.2, 0.05, -H + 0.4, H - 0.4);
    }
    box(0x2a2a2c, -0.55, 0.55, 0.2, 0.75, -H + 0.4, H - 0.4);
  } else {
    for (const z of [-6.5, 6.5]) box(0x1a1a1c, -1.1, 1.1, 0.05, 0.75, z - 1.25, z + 1.25);
    box(0x2a2a2c, -1.25, 1.25, 0.35, 0.75, -4.5, 4.5);
  }
  box(0x2a2a2c, -W, W, 0.75, FLOOR, -H, H);
  inner(0x8a7e70, -1.4, 1.4, FLOOR, FLOOR + 0.01, -H + 0.1, H - 0.1);
  // Side walls: sill band, head band, piers between windows and at the doors, the stripes.
  for (const s of [-1, 1]) {
    const x0 = s * (W - 0.05);
    const x1 = s * W;
    box(STEEL, x0, x1, FLOOR, SILL, -H, H);
    box(STEEL, x0, x1, HEAD - 0.05, TOP, -H, H);
    box(stripe, x1, x1 + s * 0.012, SILL - 0.2, SILL - 0.06, -H, H);
    box(stripe, x1, x1 + s * 0.012, TOP - 0.28, TOP - 0.2, -H, H);
    const solid: [number, number][] = [];
    let z = -H;
    for (const d of DOORS) {
      const seg0 = z;
      const seg1 = d - 0.65;
      const n = Math.max(1, Math.round((seg1 - seg0) / 1.6));
      for (let k = 0; k <= n; k++) {
        const zc = seg0 + ((seg1 - seg0) * k) / n;
        solid.push([zc - (k === 0 || k === n ? 0 : 0.07), zc + (k === 0 || k === n ? 0.08 : 0.07)]);
      }
      for (let k = 0; k < n; k++) paneX(s * (W - 0.02), SILL, HEAD - 0.05, seg0 + ((seg1 - seg0) * k) / n, seg0 + ((seg1 - seg0) * (k + 1)) / n);
      solid.push([d - 0.65, d - 0.45], [d - 0.02, d + 0.02], [d + 0.45, d + 0.65]);
      paneX(s * (W - 0.02), SILL - 0.1, HEAD - 0.1, d - 0.45, d - 0.02);
      paneX(s * (W - 0.02), SILL - 0.1, HEAD - 0.1, d + 0.02, d + 0.45);
      z = d + 0.65;
    }
    const n = Math.max(1, Math.round((H - z) / 1.6));
    for (let k = 0; k <= n; k++) {
      const zc = z + ((H - z) * k) / n;
      solid.push([zc - 0.07, zc + 0.07]);
    }
    for (let k = 0; k < n; k++) paneX(s * (W - 0.02), SILL, HEAD - 0.05, z + ((H - z) * k) / n, z + ((H - z) * (k + 1)) / n);
    for (const [a, b] of solid) box(STEEL, x0, x1, SILL, HEAD, Math.max(-H, a), Math.min(H, b));
    // Doors: slightly darker leaves with a black rubber edge down the middle.
    for (const d of DOORS) {
      box(0xa4a8ac, x1, x1 + s * 0.01, FLOOR + 0.02, SILL - 0.2, d - 0.64, d + 0.64);
      box(0x1a1a1a, x1, x1 + s * 0.015, FLOOR, HEAD, d - 0.02, d + 0.02);
    }
    // Inside: the wall lining (below and above the windows), bench seats, backrests, ad panels, door screens.
    inner(0xe8e4d8, s * (W - 0.06), s * (W - 0.07), FLOOR, SILL, -H, H);
    inner(0xe8e4d8, s * (W - 0.06), s * (W - 0.07), HEAD, TOP - 0.15, -H, H);
    let z0 = -H + 0.2;
    for (const d of [...DOORS, H + 0.85]) {
      const z1 = d - 0.85;
      if (z1 - z0 > 0.6) {
        const edge = z0 < -H + 1 || z1 > H - 1;
        inner(0x5a5c60, s * 1.4, s * 0.98, FLOOR, FLOOR + 0.43, z0, z1);
        inner(edge ? 0xb04a70 : 0x4a6ac0, s * 1.4, s * 0.96, FLOOR + 0.43, FLOOR + 0.52, z0, z1);
        inner(edge ? 0xb04a70 : 0x4a6ac0, s * 1.4, s * 1.3, FLOOR + 0.52, SILL - 0.05, z0, z1);
        for (let a = z0 + 0.2; a < z1 - 0.9; a += 1.1) inner([0xd83a2a, 0xf0c020, 0x2a6ad0, 0xffffff, 0x30a050][Math.abs(Math.round(a * 3 + s * 7)) % 5], s * 1.4, s * 1.39, HEAD + 0.05, TOP - 0.2, a, a + 0.8);
      }
      z0 = d + 0.85;
    }
    for (const d of DOORS) glow([0.15, 0.35, 0.6], s * 1.4, s * 1.39, HEAD + 0.1, HEAD + 0.4, d - 0.3, d + 0.3);
  }
  // Stanchions, grab rails and straps, the ceiling with its light strips, the roof and its gear.
  mb.kind = KIND.plain;
  mb.color = lin(0xd0d4d8);
  for (const d of DOORS) for (const s of [-1, 1]) for (const e of [-0.8, 0.8]) mb.cylinder(s * 0.97, d + e, FLOOR, TOP - 0.15, 0.02, 6);
  for (const s of [-1, 1]) {
    mb.beam([s * 0.8, TOP - 0.3, -H + 0.3], [s * 0.8, TOP - 0.3, H - 0.3], 0.03);
    for (let z = -H + 0.5; z < H - 0.4; z += 0.5) box(0xf0f0ec, s * 0.78, s * 0.82, TOP - 0.62, TOP - 0.3, z - 0.02, z + 0.02);
  }
  inner(0xf4f4f0, -W, W, TOP - 0.15, TOP, -H, H);
  for (const s of [-1, 1]) glow([1.5, 1.52, 1.5], s * 0.62, s * 0.42, TOP - 0.17, TOP - 0.15, -H + 0.4, H - 0.4);
  box(0x9a9ea2, -1.42, 1.42, TOP, TOP + 0.18, -H, H);
  for (const z of [-4.5, 4.5]) box(0xc8ccd0, -0.9, 0.9, TOP + 0.18, TOP + 0.5, z - 1.2, z + 1.2);
  // Ends: a gangway at -z always; at +z a gangway, or the driving cab.
  const endWall = (z: number, dir: number): void => {
    box(STEEL, -W, -0.45, FLOOR, TOP, z - dir * 0.08, z);
    box(STEEL, 0.45, W, FLOOR, TOP, z - dir * 0.08, z);
    box(STEEL, -0.45, 0.45, 2.8, TOP, z - dir * 0.08, z);
    box(0x1a1a1c, -0.55, 0.55, FLOOR, 2.9, z, z + dir * (GAP / 2 + 0.01));
  };
  endWall(-H, -1);
  if (!cab) endWall(H, 1);
  else {
    box(0x2a2c30, -W, W, 0.75, 1.85, H - 0.05, H + 0.25);
    box(STEEL, -W, W, 2.9, TOP, H - 0.05, H + 0.2);
    box(STEEL, -W, -1.15, 1.85, 2.9, H - 0.05, H + 0.22);
    box(STEEL, 1.15, W, 1.85, 2.9, H - 0.05, H + 0.22);
    box(stripe, -W, W, 1.6, 1.85, H + 0.25, H + 0.27);
    paneZ(H + 0.2, -1.15, 1.15, 1.85, 2.9);
    for (const s of [-1, 1]) glow(cab, s * 1.15, s * 0.8, 1.2, 1.45, H + 0.25, H + 0.28);
    glow([1.4, 0.55, 0.1], -0.6, 0.6, 3.0, 3.28, H + 0.2, H + 0.23);
    if (mono) {
      // The rounded nose: stepped in over the skirts, the stripe round it.
      for (let k = 0; k < 4; k++) box(STEEL, -W + k * 0.2, W - k * 0.2, -1.05 + k * 0.25, 1.85 - k * 0.15, H + 0.25 + k * 0.22, H + 0.47 + k * 0.22);
      box(stripe, -W + 0.1, W - 0.1, 0.1, 0.35, H + 0.25, H + 0.72);
    } else box(0x1a1a1c, -1.2, 1.2, 0.05, 0.6, H - 0.1, H + 0.3);
  }
  return { body: mb.build()!, glass: gb.build()! };
}

/** A three-car set on its own, rail top at y 0, pointing +z (for the showroom). */
export function trainModel(color: number, city: THREE.Material, mono = false): THREE.Group {
  const g = carSet(color, city, mono)();
  g.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR + GAP)));
  return g;
}

/**
 * Makes three-car sets in a line's colour (the car geometry built once and shared): tail, middle and lead cars as
 * the group's children, each along +z with its origin at the car's centre (the tail's cab faces back).
 */
function carSet(color: number, city: THREE.Material, mono = false): () => THREE.Group {
  const glass = new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
  const lead = buildCar(color, [1.6, 1.55, 1.3], mono);
  const mid = buildCar(color, null, mono);
  const tail = buildCar(color, [1.4, 0.1, 0.08], mono);
  return () => {
    const g = new THREE.Group();
    [tail, mid, lead].forEach((c, i) => {
      const car = new THREE.Group();
      const inner = new THREE.Group();
      const body = new THREE.Mesh(c.body, city);
      body.castShadow = true;
      const gl = new THREE.Mesh(c.glass, glass);
      gl.renderOrder = 3;
      inner.add(body, gl);
      if (i === 0) inner.rotation.y = Math.PI;
      car.add(inner);
      // Its passengers (a different crowd in every car).
      const people = passengerMesh(OLD_SEATS, OLD_STANDING, carCount++, { seat: 0.55, stand: 0.22 });
      if (people) car.add(people);
      g.add(car);
    });
    return g;
  };
}

/** Where the old car's passengers go: a seat every 0.46 m on the benches between the doors, and the aisle. */
const OLD_SEATS: PassengerSpot[] = [];
const OLD_STANDING: PassengerSpot[] = [];
{
  const H = CAR / 2;
  const DOORS = [-6.9, -2.3, 2.3, 6.9];
  for (const s of [-1, 1]) {
    let z0 = -H + 0.2;
    for (const d of [...DOORS, H + 0.85]) {
      const z1 = d - 0.85;
      const n = Math.floor((z1 - z0) / 0.46);
      for (let i = 0; i < n; i++) OLD_SEATS.push({ x: s * 1.16, z: z0 + (z1 - z0) * ((i + 0.5) / n), y: 0.96, yaw: (-s * Math.PI) / 2 });
      z0 = d + 0.85;
    }
  }
  for (const z of [-8, -6.9, -5.4, -4.6, -3.4, -2.3, -1.2, 0, 1.2, 2.3, 3.4, 4.6, 5.4, 6.9, 8]) for (const x of [-0.45, 0.45]) OLD_STANDING.push({ x, z, y: 0.9, yaw: x > 0 ? -Math.PI / 2 : Math.PI / 2 });
}
let carCount = 0;

/** Three-car sets for a straight line (the subway): cars along +z, rail top at y 0, the lead cab at +z. */
export function trainFactory(color: number, city: THREE.Material): () => THREE.Group {
  const set = carSet(color, city);
  return () => {
    const g = set();
    g.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR + GAP)));
    return g;
  };
}

/** An oriented box: along the heading from a0 to a1, across (left of it) from b0 to b1, from y0 to y1, about (x, z). */
function obox(mb: MeshBuilder, x: number, z: number, hx: number, hz: number, a0: number, a1: number, b0: number, b1: number, y0: number, y1: number, bottom = y0 > 0.3): void {
  const lx = hz;
  const lz = -hx;
  const P = (a: number, b: number, y: number): [number, number, number] => [x + hx * a + lx * b, y, z + hz * a + lz * b];
  const T = (d: number): [number, number, number] => [hx * d, 0, hz * d];
  const L = (d: number): [number, number, number] => [lx * d, 0, lz * d];
  const up: [number, number, number] = [0, y1 - y0, 0];
  mb.quad(P(a1, b0, y0), L(b1 - b0), up);
  mb.quad(P(a0, b1, y0), L(b0 - b1), up);
  mb.quad(P(a1, b1, y0), T(a0 - a1), up);
  mb.quad(P(a0, b0, y0), T(a1 - a0), up);
  mb.quad(P(a0, b0, y1), T(a1 - a0), L(b1 - b0));
  if (bottom) mb.quad(P(a0, b0, y0), L(b1 - b0), T(a1 - a0));
}

type Train = { cars: THREE.Group; set: TrainSet2 | null; dir: number; legs: Leg[]; period: number; offset: number };

/** A ride in the new cars (?transit=new): you walk about inside while it runs (real/cabinRider.ts). */
interface Ride2 {
  readonly timeline: RideTimeline;
  readonly set: TrainSet2;
}

/** One line's viaduct and trains. */
export class TrainSystem {
  readonly group = new THREE.Group();
  private readonly trains: Train[] = [];
  private readonly tb: Turnbacks;
  private readonly dests: { up: StationNames; down: StationNames };
  private readonly rideTrain: THREE.Group;
  private time = 0;
  private ride: { from: RailStation; to: RailStation; t: number; T: number; at: (t: number) => number; resolve: () => void } | null = null;
  private ride2: Ride2 | null = null;
  private readonly rideSet: TrainSet2 | null = null;
  /** Departures, arrivals and doors on a ride in the new cars (chimes). */
  onEvent: ((e: RideEvent) => void) | null = null;

  constructor(
    readonly line: RailLine3,
    private readonly stations: readonly RailStation[],
    city: THREE.Material,
    /** The new cars (?transit=new): their materials. Without, the district's cars and standing rides. */
    cars: CarMaterials | null = null,
    /** The road under the line (where its piers stand: in a median, or a portal frame over the carriageway). */
    private readonly under: RoadUnder | null = null,
  ) {
    this.tb = turnbacks(line.path.length, stations);
    this.group.add(this.buildViaduct(city));
    const byS0 = [...stations].sort((a, b) => a.s - b.s);
    const first = byS0[0]?.names ?? { jp: '', en: '' };
    const last = byS0[byS0.length - 1]?.names ?? { jp: '', en: '' };
    const old = carSet(line.color, city, line.kind === 'monorail');
    // The monorail keeps its own cars for now.
    const makers = cars && line.kind !== 'monorail' ? { up: carSet2(line.color, cars, { dest: last }), down: carSet2(line.color, cars, { dest: first }) } : null;
    const setsByGroup = new Map<THREE.Group, TrainSet2>();
    const set = (dir = 1): THREE.Group => {
      if (!makers) return old();
      const t = (dir > 0 ? makers.up : makers.down)();
      setsByGroup.set(t.group, t);
      return t.group;
    };
    // Four trains shuttling the line, a quarter of the round trip apart (as often as two each way), each turning
    // back at the ends over a crossover rather than vanishing.
    const { legs, period } = schedule(this.tb, stations, V_MAX[line.kind]);
    for (const k of [0, 0.25, 0.5, 0.75]) {
      const cars = set(1);
      this.group.add(cars);
      this.trains.push({ cars, set: setsByGroup.get(cars) ?? null, dir: 0, legs, period, offset: period * k });
    }
    this.dests = { up: last, down: first };
    this.rideTrain = set();
    this.rideSet = setsByGroup.get(this.rideTrain) ?? null;
    this.rideTrain.visible = false;
    this.group.add(this.rideTrain);
  }

  /** Rides walk about inside (the new cars). */
  get walkable(): boolean {
    return this.rideSet !== null;
  }

  /**
   * Ride in the new cars through these stations in order (the first where you board, the last where you're
   * going, stopping at each between): the rider walks about inside the returned ride. It ends once you've got
   * off and the train has pulled away (riding false).
   */
  startRide2(stations: readonly RailStation[]): Ridable {
    const set = this.rideSet!;
    const timeline = new RideTimeline(
      stations.map((st) => ({ s: st.s, key: st.id, jp: st.names.jp, en: st.names.en })),
      (d) => run(d, V_MAX[this.line.kind]),
      12,
    );
    this.ride2 = { timeline, set };
    this.rideTrain.visible = true;
    this.place2();
    // Trains keep left, with their platforms outside the tracks: the doors open on the left.
    return { cars: set.cars, doorSide: 1, doors: () => timeline.state().doors };
  }

  /** The ride in the new cars (its timeline's state), if one is on. */
  get ride2State(): RideState | null {
    return this.ride2?.timeline.state() ?? null;
  }

  /** You got off (or are getting off): the train shuts its doors and pulls away. */
  alight(): void {
    this.ride2?.timeline.alight();
  }

  private place2(): void {
    const r = this.ride2!;
    const st = r.timeline.state();
    this.pose(this.rideTrain, st.s, r.timeline.dir);
    r.set.setDoors(1, st.doors);
    const stops = r.timeline.stops;
    const last = stops[stops.length - 1];
    const next = st.at ?? st.next;
    r.set.setScreens(next ? { jp: next.jp, en: next.en } : null, { jp: last.jp, en: last.en }, st.at ? 'stopped' : '');
  }

  /** Trains run (false after the last train: the line is empty). */
  running = true;

  get riding(): boolean {
    return this.ride !== null || this.ride2 !== null;
  }

  /** HUD line while riding. */
  get status(): string | null {
    if (this.ride2) {
      const st = this.ride2.timeline.state();
      const stops = this.ride2.timeline.stops;
      const last = stops[stops.length - 1];
      if (st.leaving) return null;
      const where = st.arrived
        ? `${last.jp} ${last.en}: your stop · walk out of the open doors (or [E])`
        : st.at && st.doors > 0
          ? `${st.at.jp} ${st.at.en} · doors open`
          : st.next
            ? `next: ${st.next.jp} ${st.next.en}`
            : '';
      return `${this.line.name} ${this.line.nameEn} · ${filipino() ? `for ${last.jp}` : `${last.jp} 行き`}  ·  ${where}`;
    }
    if (!this.ride) return null;
    const { to, t } = this.ride;
    const state = t < 0 ? 'doors closing' : t < this.ride.T ? 'next' : 'arriving at';
    return `${this.line.name} ${this.line.nameEn} · ${filipino() ? `for ${to.names.jp}` : `${to.names.jp} 行き`}  ·  ${state}: ${to.names.jp} ${to.names.en}  ·  [E] skip`;
  }

  /** Ride from one station to another with the camera in the middle car; resolves on arrival. */
  startRide(from: RailStation, to: RailStation, camera: THREE.Camera): Promise<void> {
    const r = run(Math.abs(to.s - from.s), V_MAX[this.line.kind]);
    return new Promise((resolve) => {
      this.ride = { from, to, t: -3, T: r.T, at: r.at, resolve };
      this.rideTrain.visible = true;
      this.place(camera);
    });
  }

  skip(): void {
    if (this.ride) this.ride.t = Math.max(this.ride.t, this.ride.T);
    this.ride2?.timeline.skip();
  }

  /** Looking out of the far side, across the car, away from the departure station: the view's yaw now. */
  get rideYaw(): number {
    if (!this.ride) return 0;
    const h = this.line.path.at(this.rideS());
    const [lx, lz] = leftOf(h);
    const dx = -this.ride.from.side * lx;
    const dz = -this.ride.from.side * lz;
    return (Math.atan2(-dx, -dz) * 180) / Math.PI;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const rideDir = this.ride ? Math.sign(this.ride.to.s - this.ride.from.s) : this.ride2 ? this.ride2.timeline.dir : 0;
    for (const tr of this.trains) {
      const p = where(tr.legs, (this.time + tr.offset) % tr.period);
      // Turned round: its destination on the screens.
      if (p.dir !== tr.dir) {
        tr.dir = p.dir;
        tr.set?.setScreens(null, p.dir > 0 ? this.dests.up : this.dests.down);
      }
      tr.cars.visible = this.running && !(rideDir !== 0 && tr.dir === rideDir);
      if (tr.cars.visible) {
        this.pose(tr.cars, p.s, tr.dir, true);
        tr.set?.setDoors(1, p.doors);
        tr.set?.cull(camera.position);
      }
    }
    if (this.ride2) {
      for (const e of this.ride2.timeline.advance(dt)) this.onEvent?.(e);
      this.place2();
      if (this.ride2.timeline.state().gone) {
        this.ride2 = null;
        this.rideTrain.visible = false;
      }
    }
    if (this.ride) {
      this.ride.t += dt;
      this.place(camera);
      if (this.ride.t > this.ride.T + 1.5) {
        const done = this.ride.resolve;
        this.ride = null;
        this.rideTrain.visible = false;
        done();
      }
    }
  }

  /** Each car on the track at its own place along the line (so the set bends round the curves). */
  /**
   * Each car on its track at s (the middle car's centre), facing dir. Timetabled trains follow the crossovers
   * (`crossing`); a ride's train keeps to its own track (the platform side its doors open on).
   */
  private pose(cars: THREE.Group, s: number, dir: number, crossing = false): void {
    const at = (q: number): [number, number] => {
      const h = this.line.path.at(q);
      const [lx, lz] = leftOf(h);
      const o = crossing ? trackAt(this.tb, q, dir) : dir * TRACK;
      return [h.x + o * lx, h.z + o * lz];
    };
    cars.children.forEach((car, k) => {
      const c = s + dir * (k - 1) * (CAR + GAP);
      const [fx, fz] = at(c + dir * CAR * 0.4);
      const [bx, bz] = at(c - dir * CAR * 0.4);
      car.position.set((fx + bx) / 2, RAIL_Y, (fz + bz) / 2);
      car.rotation.y = Math.atan2(fx - bx, fz - bz);
    });
  }

  private rideS(): number {
    const r = this.ride!;
    const dir = Math.sign(r.to.s - r.from.s);
    const d = r.t <= 0 ? 0 : r.t >= r.T ? Math.abs(r.to.s - r.from.s) : r.at(r.t);
    return r.from.s + dir * d;
  }

  private place(camera: THREE.Camera): void {
    const r = this.ride!;
    const dir = Math.sign(r.to.s - r.from.s);
    const s = this.rideS();
    this.pose(this.rideTrain, s, dir);
    // Standing in the middle car by the doors on the departure station's side, looking across the car.
    const h = this.line.path.at(s);
    const [lx, lz] = leftOf(h);
    const x = h.x + dir * TRACK * lx + r.from.side * 0.7 * lx + h.hx * dir * 1.2;
    const z = h.z + dir * TRACK * lz + r.from.side * 0.7 * lz + h.hz * dir * 1.2;
    camera.position.set(x, PLATFORM_Y + 1.6, z);
  }

  private buildViaduct(city: THREE.Material): THREE.Group {
    const mb = new MeshBuilder();
    mb.flags = 0;
    mb.style = [0, 0, 0, 0];
    const path = this.line.path;
    const mono = this.line.kind === 'monorail';
    const set = (hex: number): void => {
      mb.kind = KIND.plain;
      mb.color = lin(hex);
    };
    const inStation = (s: number): boolean => this.stations.some((st) => s > st.s0 && s < st.s1);
    // The spans, in 3 m pieces (a hair longer, so they close over the curves).
    const STEP = 3;
    for (let s = 0; s < path.length; s += STEP) {
      const len = Math.min(STEP, path.length - s);
      const mid = s + len / 2;
      if (inStation(mid)) continue;
      const h = path.at(mid);
      const a0 = -len / 2 - 0.05;
      const a1 = len / 2 + 0.05;
      if (mono) {
        set(0xc8c4bc);
        for (const b of [-TRACK, TRACK]) obox(mb, h.x, h.z, h.hx, h.hz, a0, a1, b - 0.43, b + 0.43, 6.9, RAIL_Y, true);
        continue;
      }
      set(0x8a8a86);
      obox(mb, h.x, h.z, h.hx, h.hz, a0, a1, -5, 5, 6.8, DECK_TOP, true);
      set(0x9a9894);
      for (const b of [-5, 4.7]) obox(mb, h.x, h.z, h.hx, h.hz, a0, a1, b, b + 0.3, DECK_TOP, DECK_TOP + 1.2);
      for (const b of [-TRACK, TRACK]) {
        set(0x3a3a3c);
        obox(mb, h.x, h.z, h.hx, h.hz, a0, a1, b - 1.3, b + 1.3, DECK_TOP, DECK_TOP + 0.08);
        set(0xb0b0b4);
        for (const r of [-0.53, 0.53]) obox(mb, h.x, h.z, h.hx, h.hz, a0, a1, b + r - 0.035, b + r + 0.035, DECK_TOP + 0.08, RAIL_Y);
      }
    }
    // Sleepers (a train line), catenary masts and wires.
    if (!mono) {
      set(0x5a5a58);
      for (let s = 0.4; s < path.length; s += 0.8) {
        if (inStation(s)) continue;
        const h = path.at(s);
        for (const b of [-TRACK, TRACK]) obox(mb, h.x, h.z, h.hx, h.hz, -0.12, 0.12, b - 1.1, b + 1.1, DECK_TOP + 0.08, DECK_TOP + 0.12);
      }
      set(0x6a6e72);
      for (let s = 24; s < path.length; s += 48) {
        const h = path.at(s);
        const st = inStation(s);
        const top = st ? 12.3 : 13.8;
        for (const b of [-5.3, 5.3]) obox(mb, h.x, h.z, h.hx, h.hz, -0.12, 0.12, b - 0.12, b + 0.12, st ? 12.3 : DECK_TOP, top);
        if (!st) obox(mb, h.x, h.z, h.hx, h.hz, -0.08, 0.08, -5.4, 5.4, top - 0.2, top);
      }
      mb.kind = KIND.plain;
      mb.color = lin(0x2a2a2a);
      for (let s = 0; s < path.length; s += 6) {
        const a = path.at(s);
        const b = path.at(Math.min(path.length, s + 6));
        const [la, lza] = leftOf(a);
        const [lb, lzb] = leftOf(b);
        for (const o of [-TRACK, TRACK]) mb.beam([a.x + la * o, 12.2, a.z + lza * o], [b.x + lb * o, 12.2, b.z + lzb * o], 0.03);
      }
    }
    // Piers: a column and a cap (a train line); a column and a T-head under both beams (a monorail); over a road
    // without a median, a portal frame: a column on each pavement and a beam across. They reach below the
    // ground, into the water where the line crosses it.
    set(0x9a9894);
    for (const s of pierPlaces(this.line, this.stations, this.under)) {
      const p = pierAt(this.line, s, this.under);
      if (p.off) {
        const c = COLUMN[this.line.kind];
        const [y0, y1] = mono ? [5.9, 6.9] : [5.7, 6.8];
        for (const side of [1, -1]) obox(mb, p.x, p.z, p.hx, p.hz, -c, c, side * p.off - c, side * p.off + c, -3, y0);
        obox(mb, p.x, p.z, p.hx, p.hz, mono ? -0.55 : -0.7, mono ? 0.55 : 0.7, -p.off - c, p.off + c, y0, y1, true);
      } else if (mono) {
        obox(mb, p.x, p.z, p.hx, p.hz, -0.65, 0.65, -0.65, 0.65, -3, 6.1);
        obox(mb, p.x, p.z, p.hx, p.hz, -0.6, 0.6, -3.1, 3.1, 6.1, 6.9, true);
      } else {
        obox(mb, p.x, p.z, p.hx, p.hz, -1.2, 1.2, -0.8, 0.8, -3, 6.2);
        obox(mb, p.x, p.z, p.hx, p.hz, -1.4, 1.4, -4.5, 4.5, 6.2, 6.8, true);
      }
    }
    // The crossovers where the trains turn back: a track (a monorail: a beam) easing from one side to the other.
    for (const zone of [this.tb.lo.zone, this.tb.hi.zone]) {
      const P = (q: number): [number, number] => {
        const h = path.at(q);
        const [lx, lz] = leftOf(h);
        const o = TRACK * (1 - 2 * smoothstep((q - zone[0]) / (zone[1] - zone[0])));
        return [h.x + o * lx, h.z + o * lz];
      };
      for (let q = zone[0] - 3; q < zone[1] + 3; q += 1.5) {
        const [ax, az] = P(q);
        const [bx, bz] = P(q + 1.5);
        const len = Math.hypot(bx - ax, bz - az);
        const hx = (bx - ax) / len;
        const hz = (bz - az) / len;
        const cx = (ax + bx) / 2;
        const cz = (az + bz) / 2;
        if (mono) {
          set(0xc8c4bc);
          obox(mb, cx, cz, hx, hz, -len / 2 - 0.05, len / 2 + 0.05, -0.43, 0.43, 6.9, RAIL_Y - 0.01, true);
          continue;
        }
        set(0x3a3a3c);
        obox(mb, cx, cz, hx, hz, -len / 2 - 0.05, len / 2 + 0.05, -1.3, 1.3, DECK_TOP, DECK_TOP + 0.09);
        set(0xb0b0b4);
        for (const r of [-0.53, 0.53]) obox(mb, cx, cz, hx, hz, -len / 2 - 0.05, len / 2 + 0.05, r - 0.035, r + 0.035, DECK_TOP + 0.09, RAIL_Y + 0.005);
      }
    }
    // The ends of the line (a train line): an end wall across the deck, and a buffer stop on each track.
    if (!mono) {
      for (const end of [0, path.length]) {
        if (inStation(end === 0 ? 0.5 : end - 0.5)) continue;
        const h = path.at(end);
        const d = end === 0 ? -1 : 1;
        set(0x8a8a86);
        obox(mb, h.x, h.z, h.hx, h.hz, Math.min(0, d * 0.4), Math.max(0, d * 0.4), -5, 5, 6.8, DECK_TOP + 1.2, true);
        for (const b of [-TRACK, TRACK]) {
          set(0xc8a020);
          obox(mb, h.x, h.z, h.hx, h.hz, Math.min(-d * 2.2, -d * 1.2), Math.max(-d * 2.2, -d * 1.2), b - 1.0, b + 1.0, DECK_TOP + 0.1, DECK_TOP + 1.1, true);
          set(0x2a2a2a);
          obox(mb, h.x, h.z, h.hx, h.hz, Math.min(-d * 2.4, -d * 2.2), Math.max(-d * 2.4, -d * 2.2), b - 0.9, b - 0.5, DECK_TOP + 0.6, DECK_TOP + 0.9, true);
          obox(mb, h.x, h.z, h.hx, h.hz, Math.min(-d * 2.4, -d * 2.2), Math.max(-d * 2.4, -d * 2.2), b + 0.5, b + 0.9, DECK_TOP + 0.6, DECK_TOP + 0.9, true);
        }
      }
    }
    // In 256 m tiles, so the line is culled a stretch at a time rather than drawn whole from anywhere.
    const group = new THREE.Group();
    for (const g of splitByTile(mb.build()!, 256)) {
      const mesh = new THREE.Mesh(g, city);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}
