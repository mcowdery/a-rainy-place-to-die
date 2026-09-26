import * as THREE from 'three';
import type { RailLine3 } from '../district/rail';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';
import { PLATFORM_Y, RAIL_Y, type StationNames } from './station';

/**
 * The Toto Line on the main thread: the viaduct (deck, parapets, track, piers, catenary) along the line,
 * skipping the stations (they build their own), and the trains: three-car stainless commuter sets with the
 * line's stripe, lit interiors you can see into, running a timetable in both directions and stopping at
 * every station. Trains keep right: at each station the near track (by the station building) runs toward
 * the other station. ride() puts the camera in a car for the trip between two stations.
 */

const DECK_TOP = 8.0;
const TRACK = 2.2;
const CAR = 18;
const GAP = 0.4;
const CARS = 3;
const TRAIN_HALF = (CARS * CAR + (CARS - 1) * GAP) / 2;
const V_MAX = 17;
const ACCEL = 1.0;
const DWELL = 16;
const LAYOVER = 12;

export interface RailStation {
  readonly id: string;
  readonly names: StationNames;
  /** Centre of the platforms along the line. */
  readonly z: number;
  /** +1 if the station building is east of the line, -1 west. */
  readonly side: number;
  /** Length along the line that the station builds itself (the viaduct skips it). */
  readonly z0: number;
  readonly z1: number;
}

/** The ground-level colliders of the viaduct's piers (the stations add their own). */
export function viaductPiers(line: RailLine3, stations: readonly RailStation[]): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let z = line.z0 + 12; z < line.z1; z += 24) {
    if (stations.some((s) => z > s.z0 - 2 && z < s.z1 + 2)) continue;
    out.push({ x: line.x - 0.8, y: z - 1.2, w: 1.6, h: 2.4 });
  }
  return out;
}

/** Distance covered after t seconds of a stop-to-stop run of length d, and the run's duration. */
function run(d: number): { T: number; at: (t: number) => number } {
  const tA = V_MAX / ACCEL;
  const dA = (V_MAX * V_MAX) / (2 * ACCEL);
  if (d <= 2 * dA) {
    const tp = Math.sqrt(d / ACCEL);
    return { T: 2 * tp, at: (t) => (t < tp ? 0.5 * ACCEL * t * t : d - 0.5 * ACCEL * (2 * tp - t) ** 2) };
  }
  const tC = (d - 2 * dA) / V_MAX;
  return {
    T: 2 * tA + tC,
    at: (t) => (t < tA ? 0.5 * ACCEL * t * t : t < tA + tC ? dA + V_MAX * (t - tA) : d - 0.5 * ACCEL * (2 * tA + tC - t) ** 2),
  };
}

type Leg = { kind: 'run'; from: number; to: number; T: number; at: (t: number) => number } | { kind: 'wait'; z: number; T: number; hidden?: boolean };

/** A direction's schedule: layover (hidden) at the start, runs between stops with dwells, hidden at the end. */
function schedule(stops: readonly number[]): { legs: Leg[]; period: number } {
  const legs: Leg[] = [{ kind: 'wait', z: stops[0], T: LAYOVER, hidden: true }];
  for (let i = 0; i + 1 < stops.length; i++) {
    const r = run(Math.abs(stops[i + 1] - stops[i]));
    legs.push({ kind: 'run', from: stops[i], to: stops[i + 1], T: r.T, at: r.at });
    if (i + 2 < stops.length) legs.push({ kind: 'wait', z: stops[i + 1], T: DWELL });
  }
  return { legs, period: legs.reduce((t, l) => t + l.T, 0) };
}

function where(legs: readonly Leg[], t: number): { z: number; hidden: boolean } {
  for (const l of legs) {
    if (t < l.T) {
      if (l.kind === 'wait') return { z: l.z, hidden: l.hidden === true };
      return { z: l.from + Math.sign(l.to - l.from) * l.at(t), hidden: false };
    }
    t -= l.T;
  }
  const last = legs[legs.length - 1];
  return { z: last.kind === 'run' ? last.to : last.z, hidden: true };
}

/** One car at the origin, along +z, rail top at y 0. cab: a driving end at +z with lamps of this colour. */
function buildCar(stripe: number, cab: [number, number, number] | null): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
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
  const STEEL = 0xb4b8bc;
  const H = CAR / 2;
  const W = 1.45;
  const FLOOR = 0.9;
  const SILL = 1.75;
  const HEAD = 2.95;
  const TOP = 3.45;
  const DOORS = [-6.9, -2.3, 2.3, 6.9];

  // Running gear and the floor.
  for (const z of [-6.5, 6.5]) box(0x1a1a1c, -1.1, 1.1, 0.05, 0.75, z - 1.25, z + 1.25);
  box(0x2a2a2c, -1.25, 1.25, 0.35, 0.75, -4.5, 4.5);
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
    box(0x1a1a1c, -1.2, 1.2, 0.05, 0.6, H - 0.1, H + 0.3);
  }
  return { body: mb.build()!, glass: gb.build()! };
}

/** A three-car set on its own, rail top at y 0, pointing +z (for the showroom). */
export function trainModel(color: number, city: THREE.Material): THREE.Group {
  const glass = new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
  const cars = [buildCar(color, [1.4, 0.1, 0.08]), buildCar(color, null), buildCar(color, [1.6, 1.55, 1.3])];
  const g = new THREE.Group();
  cars.forEach((c, i) => {
    const car = new THREE.Group();
    const gl = new THREE.Mesh(c.glass, glass);
    gl.renderOrder = 3;
    car.add(new THREE.Mesh(c.body, city), gl);
    car.position.z = (i - 1) * (CAR + GAP);
    if (i === 0) car.rotation.y = Math.PI;
    g.add(car);
  });
  return g;
}

export class TrainSystem {
  readonly group = new THREE.Group();
  private readonly trains: { obj: THREE.Group; dir: number; x: number; legs: Leg[]; period: number; offset: number }[] = [];
  private readonly rideTrain: THREE.Group;
  private time = 0;
  private ride: { from: RailStation; to: RailStation; t: number; T: number; at: (t: number) => number; resolve: () => void; look: THREE.Vector3 } | null = null;

  constructor(
    private readonly line: RailLine3,
    private readonly stations: readonly RailStation[],
    city: THREE.Material,
  ) {
    this.group.add(this.buildViaduct(city));
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.18, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const lead = buildCar(line.color, [1.6, 1.55, 1.3]);
    const mid = buildCar(line.color, null);
    const tail = buildCar(line.color, [1.4, 0.1, 0.08]);
    const make = (): THREE.Group => {
      const g = new THREE.Group();
      [tail, mid, lead].forEach((c, i) => {
        const car = new THREE.Group();
        const body = new THREE.Mesh(c.body, city);
        body.castShadow = true;
        const gl = new THREE.Mesh(c.glass, glass);
        gl.renderOrder = 3;
        car.add(body, gl);
        car.position.z = (i - 1) * (CAR + GAP);
        if (i === 0) car.rotation.y = Math.PI;
        g.add(car);
      });
      g.position.y = RAIL_Y;
      return g;
    };
    // Two trains each way, half a period apart. Northbound (-z) keeps right on the east track.
    const byZ = [...stations].sort((a, b) => a.z - b.z);
    for (const dir of [-1, 1]) {
      const stops = [dir > 0 ? line.z0 + TRAIN_HALF : line.z1 - TRAIN_HALF, ...(dir > 0 ? byZ : [...byZ].reverse()).map((s) => s.z), dir > 0 ? line.z1 - TRAIN_HALF : line.z0 + TRAIN_HALF];
      const { legs, period } = schedule(stops);
      for (const k of [0, 0.5]) {
        const obj = make();
        obj.rotation.y = dir > 0 ? 0 : Math.PI;
        this.group.add(obj);
        this.trains.push({ obj, dir, x: line.x - dir * TRACK, legs, period, offset: period * k + (dir > 0 ? 7 : 0) });
      }
    }
    this.rideTrain = make();
    this.rideTrain.visible = false;
    this.group.add(this.rideTrain);
  }

  get riding(): boolean {
    return this.ride !== null;
  }

  /** HUD line while riding. */
  get status(): string | null {
    if (!this.ride) return null;
    const { to, t } = this.ride;
    const state = t < 0 ? 'doors closing' : t < this.ride.T ? 'next' : 'arriving at';
    return `東都線 ${this.line.nameEn} · ${to.names.jp} 行き  ·  ${state}: ${to.names.jp} ${to.names.en}  ·  [E] skip`;
  }

  /** Ride from one station to another with the camera in the middle car; resolves on arrival. */
  startRide(from: RailStation, to: RailStation, camera: THREE.Camera): Promise<void> {
    const r = run(Math.abs(to.z - from.z));
    return new Promise((resolve) => {
      // Look out of the far side, across the tracks, away from the departure station.
      this.ride = { from, to, t: -3, T: r.T, at: r.at, resolve, look: new THREE.Vector3(-from.side, 0, 0) };
      this.rideTrain.visible = true;
      this.place(camera);
    });
  }

  skip(): void {
    if (this.ride) this.ride.t = Math.max(this.ride.t, this.ride.T);
  }

  /** The ride's view direction at the start (for the controls). */
  get rideYaw(): number {
    return this.ride ? (this.ride.look.x < 0 ? 90 : -90) : 0;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const rideDir = this.ride ? Math.sign(this.ride.to.z - this.ride.from.z) : 0;
    for (const tr of this.trains) {
      const p = where(tr.legs, (this.time + tr.offset) % tr.period);
      tr.obj.position.x = tr.x;
      tr.obj.position.z = p.z;
      tr.obj.visible = !p.hidden && !(this.ride && tr.dir === rideDir);
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

  private place(camera: THREE.Camera): void {
    const r = this.ride!;
    const dir = Math.sign(r.to.z - r.from.z);
    const d = r.t <= 0 ? 0 : r.t >= r.T ? Math.abs(r.to.z - r.from.z) : r.at(r.t);
    const z = r.from.z + dir * d;
    const x = this.line.x - dir * TRACK;
    this.rideTrain.position.set(x, RAIL_Y, z);
    this.rideTrain.rotation.y = dir > 0 ? 0 : Math.PI;
    // Standing in the middle car by the near doors, looking across the car and out of the far windows.
    camera.position.set(x - r.look.x * 0.7, PLATFORM_Y + 1.6, z + dir * 1.2);
  }

  private buildViaduct(city: THREE.Material): THREE.Mesh {
    const mb = new MeshBuilder();
    mb.flags = 0;
    mb.style = [0, 0, 0, 0];
    const L = this.line;
    const box = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
      mb.kind = KIND.plain;
      mb.color = lin(hex);
      mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, x1 - x0, z1 - z0, KIND.plain, y0 > 0.3);
    };
    // Spans of the line outside the stations.
    const cuts = [...this.stations].sort((a, b) => a.z0 - b.z0);
    const spans: [number, number][] = [];
    let z = L.z0;
    for (const s of cuts) {
      if (s.z0 > z) spans.push([z, s.z0]);
      z = Math.max(z, s.z1);
    }
    if (z < L.z1) spans.push([z, L.z1]);
    for (const [a, b] of spans) {
      box(0x8a8a86, L.x - 5, L.x + 5, 6.8, DECK_TOP, a, b);
      for (const s of [-1, 1]) box(0x9a9894, L.x + s * 5 - (s > 0 ? 0.3 : 0), L.x + s * 5 + (s > 0 ? 0 : 0.3), DECK_TOP, DECK_TOP + 1.2, a, b);
      for (const s of [-1, 1]) {
        const tx = L.x + s * TRACK;
        box(0x3a3a3c, tx - 1.3, tx + 1.3, DECK_TOP, DECK_TOP + 0.08, a, b);
        for (const r of [-0.53, 0.53]) box(0xb0b0b4, tx + r - 0.035, tx + r + 0.035, DECK_TOP + 0.08, RAIL_Y, a, b);
        for (let q = a + 0.3; q < b; q += 0.6) box(0x5a5a58, tx - 1.1, tx + 1.1, DECK_TOP + 0.08, DECK_TOP + 0.12, q, q + 0.24);
      }
    }
    // Piers (with caps) and catenary masts, wires over both tracks.
    for (const p of viaductPiers(L, this.stations)) {
      box(0x9a9894, p.x, p.x + p.w, 0, 6.2, p.y, p.y + p.h);
      box(0x9a9894, L.x - 4.5, L.x + 4.5, 6.2, 6.8, p.y - 0.2, p.y + p.h + 0.2);
    }
    for (let q = L.z0 + 24; q < L.z1; q += 48) {
      const inStation = this.stations.some((s) => q > s.z0 && q < s.z1);
      const top = inStation ? 12.3 : 13.8;
      for (const s of [-1, 1]) box(0x6a6e72, L.x + s * 5.3 - 0.12, L.x + s * 5.3 + 0.12, inStation ? 12.3 : DECK_TOP, top, q - 0.12, q + 0.12);
      if (!inStation) box(0x6a6e72, L.x - 5.4, L.x + 5.4, top - 0.2, top, q - 0.08, q + 0.08);
    }
    mb.kind = KIND.plain;
    mb.color = lin(0x2a2a2a);
    for (const s of [-1, 1]) mb.beam([L.x + s * TRACK, 12.2, L.z0], [L.x + s * TRACK, 12.2, L.z1], 0.03);
    const mesh = new THREE.Mesh(mb.build()!, city);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}
