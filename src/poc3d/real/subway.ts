import * as THREE from 'three';
import {
  lineSchedule, nextDepartures, runProfile, TRACK_OFFSET, trainAt, trainOffset, TRAINS_PER_DIRECTION,
  type SubwayLine3, type SubwayNet3, type SubwayStop3, type TimetableLeg,
} from '../district/subway';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { trainFactory } from './rail';
import { SUBWAY } from './subwayStation';
import { CAR } from '../district/cabin';
import { dwellDoors, RideTimeline, type RideEvent, type RideState } from '../district/rideTimeline';
import { carSet2, type CarMaterials, type TrainSet2 } from './trainCar';
import type { Ridable } from './cabinRider';

/**
 * The subway below ground: each line's tunnels (between the stations, which build their own platforms),
 * the trains running the timetable (district/subway.ts) in both directions, and rides. A ride puts the
 * camera in the middle car and runs in real time from station to station, stopping at the ones between
 * (E skips to the arrival); the car moves along the real line under the city, so the streets round the
 * destination stream in on the way. Trains keep left; the island platforms are on their right.
 */

const RAIL = SUBWAY.b2 - 0.9;
const BED = SUBWAY.b2 - 1.4;
const CEIL = -6.2;
/** Tunnel walls either side of the line's centre (the stations' track walls line up with them). */
const HALF = 7.5;
/** How far the tunnels run past the end stations (the trains turn back 130 m out: district/subway.ts). */
const BEYOND = 150;
/**
 * Past each end station the trains turn back: a crossover from 36 to 92 m beyond the platform's middle, out of
 * the platform's end, then the stand at 130 m on the track they leave on.
 */
const CROSS = [36, 92] as const;
/** Dwell at the stations between, on a ride (shorter than the timetable's, so rides keep moving). */
const RIDE_DWELL = 12;

/** World position of a point on a line: s along it, off across it (+ to the line's left when s grows), height y. */
function onLine(line: SubwayLine3, s: number, off: number, y: number): [number, number, number] {
  return line.along === 'x' ? [s, y, line.at + off] : [line.at + off, y, s];
}

/** Across-offset of the track a train uses moving with sgn (+1: s growing): trains keep left. */
function trackOff(line: SubwayLine3, sgn: number): number {
  // Moving +x the left is -z; moving +z the left is +x.
  return line.along === 'x' ? -sgn * TRACK_OFFSET : sgn * TRACK_OFFSET;
}

/** The track across the line at s for a train moving with sgn, through the crossovers past the end stations. */
function laneAt(line: SubwayLine3, s: number, sgn: number): number {
  const ss = line.stops.map((st) => st.s);
  const lo = Math.min(...ss);
  const hi = Math.max(...ss);
  // Through a crossover: the s-growing track at its low end, the other at its high end.
  const across = (z0: number, z1: number): number => {
    const t = Math.max(0, Math.min(1, (s - z0) / (z1 - z0)));
    return trackOff(line, 1) + (trackOff(line, -1) - trackOff(line, 1)) * t * t * (3 - 2 * t);
  };
  if (sgn > 0) return s <= hi + CROSS[0] ? trackOff(line, 1) : across(hi + CROSS[0], hi + CROSS[1]);
  return s >= lo - CROSS[0] ? trackOff(line, -1) : across(lo - CROSS[1], lo - CROSS[0]);
}

/** A timetabled train, each car on its track (round a crossover), the set facing sgn. */
function poseTrain(obj: THREE.Object3D, line: SubwayLine3, s: number, sgn: number): void {
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  for (const car of obj.children) {
    const a = (car.userData.along ??= car.position.z) as number;
    const c = s + sgn * a;
    const [fx, , fz] = onLine(line, c + sgn * 7, laneAt(line, c + sgn * 7, sgn), RAIL);
    const [bx, , bz] = onLine(line, c - sgn * 7, laneAt(line, c - sgn * 7, sgn), RAIL);
    car.position.set((fx + bx) / 2, RAIL, (fz + bz) / 2);
    car.rotation.y = Math.atan2(fx - bx, fz - bz);
  }
}

function placeTrain(obj: THREE.Object3D, line: SubwayLine3, s: number, sgn: number): void {
  const [x, y, z] = onLine(line, s, trackOff(line, sgn), RAIL);
  obj.position.set(x, y, z);
  obj.rotation.y = line.along === 'x' ? (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) : sgn > 0 ? 0 : Math.PI;
}

/** How open a timetabled train's doors are t seconds into its cycle (open while it stands at a stop). */
function doorsAt(legs: readonly TimetableLeg[], t: number): number {
  for (const l of legs) {
    if (t < l.T) return l.kind === 'wait' && !l.hidden ? dwellDoors(t, l.T) : 0;
    t -= l.T;
  }
  return 0;
}

interface Train {
  readonly line: SubwayLine3;
  readonly dir: 1 | -1;
  readonly sgn: number;
  readonly obj: THREE.Group;
  /** The new cars (?transit=new), with doors to open. */
  readonly set: TrainSet2 | null;
  readonly legs: readonly TimetableLeg[];
  readonly period: number;
  readonly offset: number;
}

interface Ride {
  readonly line: SubwayLine3;
  readonly stops: readonly SubwayStop3[];
  readonly sgn: number;
  /** The timeline: runs and dwells, from the doors closing to the doors opening at the end. */
  readonly legs: readonly ({ kind: 'run'; from: number; to: number; T: number; at: (t: number) => number; next: SubwayStop3 } | { kind: 'wait'; s: number; T: number; stop: SubwayStop3 })[];
  readonly T: number;
  t: number;
  lastLeg: number;
  readonly resolve: () => void;
}

export class SubwaySystem {
  /** Tunnels and trains: shown only below ground. */
  readonly group = new THREE.Group();
  private readonly trains: Train[] = [];
  private readonly rideTrains = new Map<string, THREE.Group>();
  private ride: Ride | null = null;
  /** A ride in the new cars: you walk about inside (real/cabinRider.ts). */
  private ride2: { line: SubwayLine3; timeline: RideTimeline; set: TrainSet2 } | null = null;
  private readonly rideSets = new Map<string, TrainSet2>();
  /** The timetable's clock (seconds). */
  clock = 0;
  /** Trains run (false after the last train). */
  running = true;
  /** Departures and arrivals on a ride (chimes and melodies). */
  onEvent: ((kind: 'depart' | 'arrive', stop: SubwayStop3) => void) | null = null;

  constructor(
    readonly net: SubwayNet3,
    city: THREE.Material,
    /** The new cars (?transit=new): their materials. Without, the district's cars and standing rides. */
    cars: CarMaterials | null = null,
  ) {
    for (const line of net.lines) {
      if (line.kind !== 'subway') continue;
      this.group.add(this.buildTunnels(line, city));
      const old = trainFactory(line.color, city);
      const ends = { first: line.stops[0], last: line.stops[line.stops.length - 1] };
      const makers = cars
        ? { up: carSet2(line.color, cars, { subway: true, dest: ends.last }), down: carSet2(line.color, cars, { subway: true, dest: ends.first }) }
        : null;
      const make = (dir: 1 | -1): { obj: THREE.Group; set: TrainSet2 | null } => {
        if (!makers) return { obj: old(), set: null };
        const set = (dir > 0 ? makers.up : makers.down)();
        set.group.children.forEach((car, i) => (car.position.z = (i - 1) * (CAR.L + CAR.GAP)));
        return { obj: set.group, set };
      };
      const order = Math.sign(line.stops[line.stops.length - 1].s - line.stops[0].s) || 1;
      for (const dir of [1, -1] as const) {
        const { legs, period } = lineSchedule(line, dir);
        for (let k = 0; k < TRAINS_PER_DIRECTION; k++) {
          const { obj, set } = make(dir);
          this.group.add(obj);
          this.trains.push({ line, dir, sgn: order * dir, obj, set, legs, period, offset: trainOffset(period, k, dir) });
        }
      }
      const ride = make(1);
      ride.obj.visible = false;
      this.group.add(ride.obj);
      this.rideTrains.set(line.id, ride.obj);
      if (ride.set) this.rideSets.set(line.id, ride.set);
    }
  }

  /** Rides walk about inside (the new cars). */
  get walkable(): boolean {
    return this.rideSets.size > 0;
  }

  /** Departures, arrivals and doors on a ride in the new cars. */
  onRideEvent: ((e: RideEvent) => void) | null = null;

  /** Ride a line in the new cars from one stop to another (indices), stopping at each between; you walk about inside. */
  startRide2(lineId: string, from: number, to: number): Ridable {
    const line = this.net.lines.find((l) => l.id === lineId)!;
    const step = to > from ? 1 : -1;
    const stops: SubwayStop3[] = [];
    for (let i = from; i !== to + step; i += step) stops.push(line.stops[i]);
    const timeline = new RideTimeline(
      stops.map((st) => ({ s: st.s, key: st.key, jp: st.jp, en: st.en, code: st.code })),
      runProfile,
      RIDE_DWELL,
    );
    const set = this.rideSets.get(line.id)!;
    this.ride2 = { line, timeline, set };
    set.group.visible = true;
    this.place2();
    // The island platforms are on the right of the way the train runs.
    return { cars: set.cars, doorSide: -1, doors: () => timeline.state().doors };
  }

  get ride2State(): RideState | null {
    return this.ride2?.timeline.state() ?? null;
  }

  /** You got off: the train shuts its doors and pulls away. */
  alight(): void {
    this.ride2?.timeline.alight();
  }

  private place2(): void {
    const r = this.ride2!;
    const st = r.timeline.state();
    placeTrain(r.set.group, r.line, st.s, r.timeline.dir);
    r.set.setDoors(-1, st.doors);
    const stops = r.timeline.stops;
    const last = stops[stops.length - 1];
    const next = st.at ?? st.next;
    r.set.setScreens(next ? { jp: next.jp, en: next.en, code: next.code } : null, { jp: last.jp, en: last.en }, st.at ? 'stopped' : '');
  }

  get riding(): boolean {
    return this.ride !== null || this.ride2 !== null;
  }

  /** Next departures from a station toward each end of its line (seconds). */
  departures(stop: SubwayStop3): { toFirst: number[]; toLast: number[] } {
    const line = this.net.lines.find((l) => l.id === stop.line)!;
    if (!this.running) return { toFirst: [], toLast: [] };
    return { toFirst: nextDepartures(line, stop.index, -1, this.clock), toLast: nextDepartures(line, stop.index, 1, this.clock) };
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
          ? `${st.at.jp} ${st.at.en} (${st.at.code}) · doors open`
          : st.next
            ? `next: ${st.next.jp} ${st.next.en} (${st.next.code})`
            : '';
      return `${this.ride2.line.name} ${this.ride2.line.nameEn} · ${last.jp} ${last.en} まで  ·  ${where}`;
    }
    const r = this.ride;
    if (!r) return null;
    const dest = r.stops[r.stops.length - 1];
    const leg = r.legs[Math.min(r.legs.length - 1, Math.max(0, r.lastLeg))];
    const where = r.t < 0 ? `doors closing · next: ${r.stops[1].jp} ${r.stops[1].en} (${r.stops[1].code})` : leg.kind === 'run' ? `next: ${leg.next.jp} ${leg.next.en} (${leg.next.code})` : `${leg.stop.jp} ${leg.stop.en} (${leg.stop.code})`;
    return `${r.line.name} ${r.line.nameEn} · ${dest.jp} ${dest.en} まで  ·  ${where}  ·  [E] skip`;
  }

  /** Ride a line from one stop to another (stop indices), in real time; resolves on arrival. */
  startRide(lineId: string, from: number, to: number, camera: THREE.Camera): Promise<void> {
    const line = this.net.lines.find((l) => l.id === lineId)!;
    const step = to > from ? 1 : -1;
    const stops: SubwayStop3[] = [];
    for (let i = from; i !== to + step; i += step) stops.push(line.stops[i]);
    const sgn = Math.sign(stops[stops.length - 1].s - stops[0].s) || 1;
    const legs: Ride['legs'][number][] = [];
    for (let i = 0; i + 1 < stops.length; i++) {
      const r = runProfile(Math.abs(stops[i + 1].s - stops[i].s));
      legs.push({ kind: 'run', from: stops[i].s, to: stops[i + 1].s, T: r.T, at: r.at, next: stops[i + 1] });
      if (i + 2 < stops.length) legs.push({ kind: 'wait', s: stops[i + 1].s, T: RIDE_DWELL, stop: stops[i + 1] });
    }
    return new Promise((resolve) => {
      this.ride = { line, stops, sgn, legs, T: legs.reduce((t, l) => t + l.T, 0), t: -3, lastLeg: -1, resolve };
      const train = this.rideTrains.get(line.id)!;
      train.visible = true;
      this.place(camera);
    });
  }

  skip(): void {
    if (this.ride) this.ride.t = Math.max(this.ride.t, this.ride.T);
    this.ride2?.timeline.skip();
  }

  /** The view across the car toward the platform side (degrees; camera yaw convention). */
  get rideYaw(): number {
    const r = this.ride;
    if (!r) return 0;
    // The platform is on the right of the direction of travel.
    const f = r.line.along === 'x' ? [r.sgn, 0] : [0, r.sgn];
    const right = [-f[1], f[0]];
    return (Math.atan2(-right[0], -right[1]) * 180) / Math.PI;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.clock += dt;
    const r2 = this.ride2;
    for (const tr of this.trains) {
      const t = (this.clock + tr.offset) % tr.period;
      const p = trainAt(tr.legs, t);
      // (Its layover, beyond an end station, is the stand before it starts back: in view, on its track.)
      const layover = p.hidden && t < tr.legs[0].T;
      poseTrain(tr.obj, tr.line, p.s, tr.sgn);
      tr.obj.visible =
        this.running && (!p.hidden || layover) && !(this.ride && this.ride.line === tr.line && this.ride.sgn === tr.sgn) && !(r2 && r2.line === tr.line && r2.timeline.dir === tr.sgn);
      if (tr.set && tr.obj.visible) {
        tr.set.setDoors(-1, doorsAt(tr.legs, t));
        tr.set.cull(camera.position);
      }
    }
    if (r2) {
      for (const e of r2.timeline.advance(dt)) {
        this.onRideEvent?.(e);
        // The stations' chimes and melodies, as before.
        if (e.kind === 'depart' || e.kind === 'arrive') {
          const stop = r2.line.stops.find((st) => st.key === e.stop.key);
          if (stop) this.onEvent?.(e.kind, stop);
        }
      }
      this.place2();
      if (r2.timeline.state().gone) {
        r2.set.group.visible = false;
        this.ride2 = null;
      }
    }
    const r = this.ride;
    if (!r) return;
    r.t += dt;
    this.place(camera);
    // Events: leaving each stop, arriving at each.
    let acc = 0;
    let leg = -1;
    for (let i = 0; i < r.legs.length; i++) {
      if (r.t >= acc) leg = i;
      acc += r.legs[i].T;
    }
    if (r.t >= r.T) leg = r.legs.length;
    while (r.lastLeg < leg) {
      r.lastLeg++;
      const l = r.legs[r.lastLeg - 1];
      if (r.lastLeg === 0) this.onEvent?.('depart', r.stops[0]);
      else if (l?.kind === 'run') this.onEvent?.('arrive', l.next);
      else if (l?.kind === 'wait') this.onEvent?.('depart', l.stop);
    }
    if (r.t > r.T + 1.5) {
      this.rideTrains.get(r.line.id)!.visible = false;
      this.ride = null;
      r.resolve();
    }
  }

  private place(camera: THREE.Camera): void {
    const r = this.ride!;
    let s = r.stops[0].s;
    let t = r.t;
    if (t >= r.T) s = r.stops[r.stops.length - 1].s;
    else if (t > 0) {
      for (const l of r.legs) {
        if (t < l.T) {
          s = l.kind === 'run' ? l.from + Math.sign(l.to - l.from) * l.at(t) : l.s;
          break;
        }
        t -= l.T;
      }
    }
    const train = this.rideTrains.get(r.line.id)!;
    placeTrain(train, r.line, s, r.sgn);
    // Standing in the middle car, on the side away from the platform, looking across at its doors.
    const [x, , z] = onLine(r.line, s, trackOff(r.line, r.sgn) * 1.12, RAIL);
    camera.position.set(x, RAIL + 2.5, z);
  }

  /** The tunnels of a line: walls, ceiling, track bed and rails between the stations, lamps along the walls. */
  private buildTunnels(line: SubwayLine3, city: THREE.Material): THREE.Mesh {
    const mb = new MeshBuilder(1 << 15);
    mb.flags = 0;
    mb.style = [0, 0, 0, 0];
    // Below ground there's no sky or street light: the tunnel is faintly self-lit (dark colours), its lamps bright.
    const box = (hex: number, s0: number, s1: number, o0: number, o1: number, y0: number, y1: number, bottom = false): void => {
      mb.kind = KIND.emit;
      mb.style = [EMIT.interior, 0, 0, 0];
      mb.color = lin(hex);
      const [x0, , z0] = onLine(line, Math.min(s0, s1), Math.min(o0, o1), 0);
      const [x1, , z1] = onLine(line, Math.max(s0, s1), Math.max(o0, o1), 0);
      mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, Math.abs(x1 - x0), Math.abs(z1 - z0), KIND.emit, bottom);
      mb.style = [0, 0, 0, 0];
    };
    const lamp = (s: number, o: number, y: number): void => {
      mb.kind = KIND.emit;
      mb.style = [EMIT.always, 0, 0, 0];
      mb.color = [1.3, 1.25, 1.1];
      const [x, , z] = onLine(line, s, o, 0);
      mb.box(x, z, y, y + 0.14, line.along === 'x' ? 0.6 : 0.12, line.along === 'x' ? 0.12 : 0.6, KIND.emit, true);
      mb.style = [0, 0, 0, 0];
    };
    const ss = line.stops.map((st) => st.s);
    const lo = Math.min(...ss) - BEYOND;
    const hi = Math.max(...ss) + BEYOND;
    // Spans between the stations' platform boxes (30 m either side of each platform's middle).
    const cuts = [...ss].sort((a, b) => a - b);
    const spans: [number, number][] = [];
    let a = lo;
    for (const c of cuts) {
      if (c - 30 > a) spans.push([a, c - 30]);
      a = c + 30;
    }
    if (hi > a) spans.push([a, hi]);
    for (const [s0, s1] of spans) {
      box(0x1c1e22, s0, s1, -HALF - 0.3, -HALF, BED - 0.2, CEIL);
      box(0x1c1e22, s0, s1, HALF, HALF + 0.3, BED - 0.2, CEIL);
      box(0x16181a, s0, s1, -HALF, HALF, CEIL, CEIL + 0.2, true);
      box(0x141414, s0, s1, -HALF, HALF, BED - 0.2, BED);
      for (const side of [-1, 1]) {
        const o = side * TRACK_OFFSET;
        for (const r of [-0.53, 0.53]) box(0x5a5c60, s0, s1, o + r - 0.035, o + r + 0.035, BED, RAIL);
        // A cable tray along the wall.
        box(0x2a2c30, s0, s1, side * (HALF - 0.25), side * (HALF - 0.02), -7.6, -7.45);
      }
      for (let s = s0 + 6; s < s1 - 2; s += 12) for (const side of [-1, 1]) lamp(s, side * (HALF - 0.08), -8.6);
    }
    // End walls past the last stations.
    box(0x2a2c30, lo - 0.3, lo, -HALF, HALF, BED, CEIL);
    box(0x2a2c30, hi, hi + 0.3, -HALF, HALF, BED, CEIL);
    return new THREE.Mesh(mb.build()!, city);
  }
}

/** Seconds a ride between two stops takes (runs and dwells), for the route picker. */
export function rideSeconds(line: SubwayLine3, from: number, to: number): number {
  const step = to > from ? 1 : -1;
  let t = 3;
  for (let i = from; i !== to; i += step) {
    t += runProfile(Math.abs(line.stops[i + step].s - line.stops[i].s)).T;
    if (i + step !== to) t += RIDE_DWELL;
  }
  return t;
}
