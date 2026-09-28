import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rect } from '../../core/coords';
import { hash } from '../../core/hash';
import { along, SIDES, Signals, type BusLine, type Junction, type Route } from '../district/traffic';
import type { Prop } from './props';
import { addCar } from './cars';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * Moving traffic. Cars, taxis and buses drive their loops with a car-following model (the Intelligent
 * Driver Model): each keeps a safe time gap to whatever is ahead in its lane, whichever loop that is on,
 * accelerating and braking smoothly, each with its own temperament (top speed, pull-away, braking, gap).
 * Virtual obstacles make them stop at red lights (and at amber when they can stop comfortably), slow for
 * corners, hold right turns for oncoming traffic, and pull in at bus stops. Brake lights come on when they
 * brake or stand; the body dips under braking and lifts pulling away. Vehicles are meshes (geometry shared
 * per model) placed each frame; only those within DRAW metres are drawn. Buses are lit inside at night and
 * carry their line on the front. Bus stops: a shelter and a pole sign on the kerb.
 */

const DRAW = 320;
const BUS_DWELL = 12;
const BUS_LEN = 10.5;

type Model = { geo: THREE.BufferGeometry; half: number; brake: THREE.BufferGeometry };

/** A car model at the origin pointing +z, with headlight glows added (the district's cars are parked). */
function carModel(type: 'sedan' | 'kei' | 'minivan' | 'taxi', paint: number | undefined, variant: number): Model {
  const mb = new MeshBuilder();
  addCar(mb, { x: 0, z: 0, fx: 0, fz: 1, variant, type, ...(paint === undefined ? {} : { paint }) });
  const body = mb.build()!;
  body.computeBoundingBox();
  const bb = body.boundingBox!;
  const lamps = new MeshBuilder();
  lamps.kind = KIND.emit;
  lamps.style = [EMIT.lamp, 0, 0, 0];
  lamps.color = [0.35, 0.33, 0.28];
  for (const s of [-1, 1]) lamps.box(s * (bb.max.x - 0.3), bb.max.z + 0.01, 0.62, 0.74, 0.3, 0.03, KIND.emit, true);
  lamps.color = [0.25, 0.01, 0.01];
  for (const s of [-1, 1]) lamps.box(s * (bb.max.x - 0.25), bb.min.z - 0.01, 0.8, 0.9, 0.28, 0.03, KIND.emit, true);
  // Brake lights: brighter lamps just behind the tail lights, shown while braking.
  const brake = new MeshBuilder();
  brake.kind = KIND.plain;
  brake.color = [1, 1, 1];
  for (const s of [-1, 1]) brake.box(s * (bb.max.x - 0.25), bb.min.z - 0.025, 0.79, 0.91, 0.3, 0.02, KIND.plain, true);
  return { geo: mergeGeometries([body, lamps.build()!])!, half: (bb.max.z - bb.min.z) / 2, brake: brake.build()! };
}

/** A city bus at the origin pointing +z (10.5 m): cream and green, glass sides, lit inside, a destination board. */
function busModel(line: BusLine): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; signs: THREE.Group } {
  const mb = new MeshBuilder();
  const gb = new MeshBuilder();
  const H = BUS_LEN / 2;
  const W = 1.25;
  const box = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: number = KIND.plain): void => {
    mb.kind = kind;
    mb.color = lin(hex);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, x1 - x0, z1 - z0, kind, true);
  };
  const glow = (rgb: [number, number, number], ch: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [ch, 0, 0, 0];
    mb.color = rgb;
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, x1 - x0, z1 - z0, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const inner = (hex: number, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void => {
    mb.kind = KIND.emit;
    mb.style = [EMIT.lit, 0, 0, 0];
    mb.color = lin(hex);
    mb.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, x1 - x0, z1 - z0, KIND.emit, true);
    mb.style = [0, 0, 0, 0];
  };
  const CREAM = 0xf0ead8;
  const GREEN = 0x10a060;
  // Wheels, skirt and lower body, the stripe, pillars between the windows, the roof and its gear.
  for (const z of [-3.2, 3.6]) for (const s of [-1, 1]) box(0x1a1a1a, s * W - 0.2 * s - 0.15, s * W - 0.2 * s + 0.15, 0, 0.95, z - 0.48, z + 0.48);
  box(CREAM, -W, W, 0.3, 1.25, -H, H, KIND.gloss);
  box(GREEN, -W - 0.01, W + 0.01, 0.85, 1.1, -H, H, KIND.gloss);
  box(CREAM, -W, W, 2.55, 3.05, -H, H, KIND.gloss);
  box(GREEN, -W - 0.01, W + 0.01, 2.62, 2.72, -H, H, KIND.gloss);
  box(0xc8c8c4, -0.8, 0.8, 3.05, 3.35, -3.5, -0.5);
  for (const s of [-1, 1]) {
    for (let z = -H; z <= H; z += 1.5) box(CREAM, s * W - 0.05, s * W + 0.05, 1.25, 2.55, Math.max(-H, z - 0.08), Math.min(H, z + 0.08));
    gb.quad([s * W, 1.25, s > 0 ? H : -H], [0, 0, s > 0 ? -BUS_LEN : BUS_LEN], [0, 1.3, 0]);
  }
  // Doors on the kerb (left) side: front and middle, darker leaves with a black seal.
  for (const z of [H - 1.6, -0.6]) {
    box(0x9a9690, W - 0.02, W + 0.02, 0.35, 2.5, z - 0.6, z + 0.6);
    box(0x1a1a1a, W + 0.02, W + 0.03, 0.35, 2.5, z - 0.02, z + 0.02);
  }
  // Front: windscreen, destination board, headlights; rear: tail lights, the back window.
  box(CREAM, -W, W, 0.3, 1.25, H, H + 0.05, KIND.gloss);
  gb.quad([-W, 1.25, H + 0.03], [2 * W, 0, 0], [0, 1.3, 0]);
  box(0x141414, -W, W, 2.55, 2.95, H, H + 0.04);
  glow([1.5, 0.6, 0.1], EMIT.always, -0.9, 0.9, 2.6, 2.9, H + 0.04, H + 0.06);
  for (const s of [-1, 1]) glow([0.4, 0.38, 0.32], EMIT.lamp, s * 0.95 - 0.2, s * 0.95 + 0.2, 0.55, 0.75, H + 0.05, H + 0.07);
  box(CREAM, -W, W, 0.3, 3.05, -H - 0.05, -H);
  for (const s of [-1, 1]) glow([0.35, 0.02, 0.02], EMIT.always, s * 1.0 - 0.15, s * 1.0 + 0.15, 0.7, 1.2, -H - 0.07, -H - 0.05);
  // Inside: floor, seats, a lit ceiling (you see them through the glass at night).
  inner(0x5a5a5e, -W + 0.05, W - 0.05, 0.3, 0.4, -H + 0.1, H - 0.1);
  for (let z = -H + 0.6; z < H - 2.2; z += 0.9) for (const s of [-1, 1]) inner(0x3a5aa0, s * 0.95 - 0.3, s * 0.95 + 0.3, 0.4, 1.35, z, z + 0.5);
  inner(0xf0f0ec, -W + 0.05, W - 0.05, 2.45, 2.55, -H + 0.1, H - 0.1);
  glow([1.2, 1.2, 1.15], EMIT.lit, -0.25, 0.25, 2.43, 2.45, -H + 0.5, H - 0.5);
  // Destination board text and the side name.
  const signs = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#100800';
  g.fillRect(0, 0, 512, 80);
  g.fillStyle = '#ffb040';
  g.font = "bold 44px 'Yu Gothic', 'Meiryo', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(line.name, 256, 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.28), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) }));
  board.position.set(0, 2.75, H + 0.07);
  signs.add(board);
  return { body: mb.build()!, glass: gb.build()!, signs };
}

/** A parked bus (scenery: a terminal's bays), pointing +z, its destination on the board. */
export function parkedBus(destination: string, city: THREE.Material): THREE.Group {
  const m = busModel({ name: destination } as BusLine);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(m.body, city));
  const glass = new THREE.Mesh(m.glass, new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.25, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  glass.renderOrder = 3;
  g.add(glass, m.signs);
  return g;
}

/** Bus stops: a shelter with a bench and a lit ad panel, and a pole with the round stop sign, on the kerb. */
function busStops(lines: readonly { line: BusLine; route: Route }[], city: THREE.Material): { mesh: THREE.Group; colliders: Rect[] } {
  const mb = new MeshBuilder();
  const group = new THREE.Group();
  const colliders: Rect[] = [];
  for (const { line, route } of lines) {
    route.edges.forEach((e) => {
      const name = line.stops[SIDES.indexOf(e.side)];
      const p = along(route, e.mid);
      const cx = p.x + e.kerb[0];
      const cz = p.z + e.kerb[1];
      // Stop frame: a runs along the kerb, o points away from the road (toward the buildings).
      const a = e.dir;
      const kl = Math.hypot(e.kerb[0], e.kerb[1]) || 1;
      const o: [number, number] = [e.kerb[0] / kl, e.kerb[1] / kl];
      const put = (hex: number | null, rgb: [number, number, number] | null, along0: number, along1: number, out0: number, out1: number, y0: number, y1: number, solid = false): void => {
        const pa = (along0 + along1) / 2;
        const po = (out0 + out1) / 2;
        const x = cx + a[0] * pa + o[0] * po;
        const z = cz + a[1] * pa + o[1] * po;
        const la = along1 - along0;
        const lo = out1 - out0;
        const w = Math.abs(a[0]) * la + Math.abs(o[0]) * lo;
        const d = Math.abs(a[1]) * la + Math.abs(o[1]) * lo;
        if (rgb) {
          mb.kind = KIND.emit;
          mb.style = [EMIT.always, 0, 0, 0];
          mb.color = rgb;
        } else {
          mb.kind = KIND.plain;
          mb.color = lin(hex!);
        }
        mb.box(x, z, y0, y1, w, d, mb.kind, y0 > 0.3);
        mb.style = [0, 0, 0, 0];
        if (solid) colliders.push({ x: x - w / 2, y: z - d / 2, w, h: d });
      };
      put(0x9aa0a6, null, -2, 2, 0.5, 0.62, 0, 2.4, true);
      put(0x9aa0a6, null, -2, -1.9, -0.6, 0.62, 0, 2.4, true);
      put(0x3a3c40, null, -2.1, 2.1, -0.8, 0.7, 2.4, 2.5);
      put(0x5a6a7a, null, -1.4, 1.4, 0.1, 0.5, 0.42, 0.5, true);
      put(null, [0.8, 0.82, 0.85], 0.8, 1.9, 0.44, 0.5, 0.7, 2.1);
      // The pole and its sign, just past the shelter's front end, at the kerb edge.
      const px = cx + a[0] * 3.0 - o[0] * 0.6;
      const pz = cz + a[1] * 3.0 - o[1] * 0.6;
      mb.kind = KIND.plain;
      mb.color = lin(0xb0b4b8);
      mb.cylinder(px, pz, 0, 2.6, 0.05, 8);
      colliders.push({ x: px - 0.15, y: pz - 0.15, w: 0.3, h: 0.3 });
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = '#10a060';
      g.beginPath();
      g.arc(128, 128, 124, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(128, 128, 96, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#10a060';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = "bold 40px 'Yu Gothic', 'Meiryo', sans-serif";
      g.fillText('バス', 128, 80);
      g.font = `bold ${name.length > 5 ? 30 : 38}px 'Yu Gothic', 'Meiryo', sans-serif`;
      g.fillText(name, 128, 136);
      g.font = "bold 20px 'Arial', sans-serif";
      g.fillText(line.en, 128, 184);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      for (const flip of [0, Math.PI]) {
        const sign = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.05, 1.05, 1.05) }));
        sign.position.set(px, 2.35, pz);
        sign.rotation.y = Math.atan2(a[0], a[1]) + flip;
        group.add(sign);
      }
    });
  }
  const mesh = new THREE.Mesh(mb.build()!, city);
  mesh.receiveShadow = true;
  group.add(mesh);
  return { mesh: group, colliders };
}

/** A driver's temperament (Intelligent Driver Model parameters). */
interface Driver {
  /** Desired speed (m/s), comfortable acceleration and braking (m/s²), time gap (s), standstill gap (m). */
  readonly v0: number;
  readonly a: number;
  readonly b: number;
  readonly T: number;
  readonly s0: number;
}

interface Vehicle {
  readonly obj: THREE.Object3D;
  readonly brake: THREE.Object3D;
  readonly route: Route;
  readonly half: number;
  readonly width: number;
  readonly bus: boolean;
  readonly driver: Driver;
  /** Distance along the route, speed, acceleration. */
  s: number;
  v: number;
  acc: number;
  /** Buses: the stop being served (edge index) and how long they have stood there. */
  stopDone: number;
  dwell: number;
  /** The junction (route index) the vehicle has committed to crossing, or -1. */
  committed: number;
  pitch: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
}

/** IDM acceleration toward an obstacle gap metres ahead closing at dv (own speed minus the obstacle's). */
function idm(d: Driver, v: number, v0: number, gap: number, dv: number): number {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (gap === Infinity) return d.a * free;
  const sStar = d.s0 + Math.max(0, v * d.T + (v * dv) / (2 * Math.sqrt(d.a * d.b)));
  return d.a * (free - Math.pow(sStar / Math.max(gap, 0.05), 2));
}

/** Distance from a to b going forward round a loop of length L, in [0, L). */
const ahead = (a: number, b: number, L: number): number => (((b - a) % L) + L) % L;

export class TrafficSystem {
  readonly group = new THREE.Group();
  readonly colliders: Rect[] = [];
  private readonly vehicles: Vehicle[] = [];
  private time = 0;

  constructor(
    cars: readonly { route: Route; spacing: number }[],
    buses: readonly { line: BusLine; route: Route }[],
    city: THREE.Material,
    private readonly signals: Signals,
  ) {
    const models: Model[] = [];
    const PAINTS = [0xe8e8e4, 0x1a1a1c, 0x8a8e94, 0x2a3a5a, 0x7a1a1a, 0xc8c0b0];
    for (let i = 0; i < 6; i++) models.push(carModel('sedan', PAINTS[i], 900 + i));
    models.push(carModel('kei', undefined, 911), carModel('kei', undefined, 912), carModel('minivan', 0xe8e8e4, 913), carModel('minivan', 0x2a2a2e, 914));
    const taxis = [carModel('taxi', undefined, 921), carModel('taxi', undefined, 922), carModel('taxi', undefined, 923)];
    const brakeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.12, 0.06) });
    let k = 0;
    const add = (obj: THREE.Object3D, brakeGeo: THREE.BufferGeometry, route: Route, half: number, width: number, bus: boolean, driver: Driver, s: number): void => {
      const brake = new THREE.Mesh(brakeGeo, brakeMat);
      brake.visible = false;
      obj.add(brake);
      obj.rotation.order = 'YXZ';
      this.group.add(obj);
      this.vehicles.push({ obj, brake, route, half, width, bus, driver, s, v: driver.v0 * 0.6, acc: 0, stopDone: -1, dwell: 0, committed: -1, pitch: 0, x: 0, z: 0, dx: 0, dz: 1 });
    };
    for (const { route, spacing } of cars) {
      const n = Math.max(2, Math.floor(route.length / spacing));
      for (let i = 0; i < n; i++) {
        const h = hash(k++, 0x7a1);
        const taxi = h % 10 < 3;
        const m = taxi ? taxis[h % taxis.length] : models[(h >>> 4) % models.length];
        const obj = new THREE.Mesh(m.geo, city);
        obj.castShadow = true;
        // Temperaments: taxis a little brisker; everyone a little different.
        const r = (b: number): number => ((h >>> b) % 1000) / 1000;
        const driver: Driver = { v0: (taxi ? 12.5 : 11) + r(8) * 3, a: 1.4 + r(12) * 1.2 + (taxi ? 0.4 : 0), b: 2.2 + r(16) * 1.2, T: 1.1 + r(20) * 0.6, s0: 2.2 + r(4) * 0.8 };
        add(obj, m.brake, route, m.half, 1.8, false, driver, (route.length * i) / n + r(2) * 8);
      }
    }
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const busBrake = new MeshBuilder();
    busBrake.kind = KIND.plain;
    busBrake.color = [1, 1, 1];
    for (const sd of [-1, 1]) busBrake.box(sd * 0.75, -BUS_LEN / 2 - 0.08, 0.9, 1.1, 0.35, 0.02, KIND.plain, true);
    const busBrakeGeo = busBrake.build()!;
    for (const { line, route } of buses) {
      const model = busModel(line);
      for (let i = 0; i < line.buses; i++) {
        const obj = new THREE.Group();
        const body = new THREE.Mesh(model.body, city);
        body.castShadow = true;
        const gl = new THREE.Mesh(model.glass, glass);
        gl.renderOrder = 3;
        obj.add(body, gl, model.signs.clone());
        add(obj, busBrakeGeo, route, BUS_LEN / 2, 2.5, true, { v0: 9.5, a: 0.9, b: 1.6, T: 1.6, s0: 3 }, (route.length * (i + 0.3)) / line.buses);
      }
    }
    const stops = busStops(buses, city);
    this.group.add(stops.mesh);
    this.colliders.push(...stops.colliders);
  }

  /** The time the signals run on (seconds). */
  get clock(): number {
    return this.time;
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    const V = this.vehicles;
    for (const v of V) {
      const p = along(v.route, v.s);
      v.x = p.x;
      v.z = p.z;
      v.dx = p.dx;
      v.dz = p.dz;
    }
    for (const v of V) v.acc = this.accel(v, dt);
    for (const v of V) {
      const L = v.route.length;
      v.v = Math.max(0, v.v + v.acc * dt);
      v.s = (v.s + v.v * dt) % L;
      const near = Math.hypot(v.x - camera.x, v.z - camera.z) < DRAW;
      v.obj.visible = near;
      if (!near) continue;
      const p = along(v.route, v.s);
      v.obj.position.set(p.x, 0, p.z);
      v.obj.rotation.y = Math.atan2(p.dx, p.dz);
      // Nose dips under braking, lifts pulling away (eased, like a suspension settling).
      const target = THREE.MathUtils.clamp(-v.acc * 0.0045, -0.012, 0.022) * (v.bus ? 0.5 : 1);
      v.pitch += (target - v.pitch) * Math.min(1, dt * 6);
      v.obj.rotation.x = v.pitch;
      v.brake.visible = v.acc < -0.6 || v.v < 0.4;
    }
  }

  /** The vehicle's acceleration this frame: the most cautious of free driving and every obstacle. */
  private accel(v: Vehicle, dt: number): number {
    const d = v.driver;
    const L = v.route.length;
    let v0 = d.v0;
    // Corners: slow to a turning speed in time.
    for (const j of v.route.junctions) {
      if (!j.turn) continue;
      const dist = ahead(v.s, j.s, L);
      if (dist < 60) v0 = Math.min(v0, Math.sqrt((j.turn === 'left' ? 4.5 : 5.5) ** 2 + 2 * d.b * 0.6 * Math.max(0, dist - 3)));
    }
    let a = idm(d, v.v, v0, Infinity, 0);
    const obstacle = (gap: number, speed: number): void => {
      a = Math.min(a, idm(d, v.v, v0, gap, v.v - speed));
    };
    // The vehicle ahead in the lane, on any loop: in front, roughly the same heading, not off to the side.
    let lead: Vehicle | null = null;
    let leadGap = Infinity;
    for (const o of this.vehicles) {
      if (o === v) continue;
      const rx = o.x - v.x;
      const rz = o.z - v.z;
      const fwd = rx * v.dx + rz * v.dz;
      if (fwd <= 0 || fwd > 70) continue;
      if (Math.abs(rx * v.dz - rz * v.dx) > (v.width + o.width) / 2 + 0.3) continue;
      if (o.dx * v.dx + o.dz * v.dz < 0.35) continue;
      const gap = fwd - v.half - o.half;
      if (gap < leadGap) [lead, leadGap] = [o, gap];
    }
    if (lead) obstacle(leadGap, lead.v * (lead.dx * v.dx + lead.dz * v.dz));
    // Signals.
    const js = v.route.junctions;
    let next = -1;
    let nextStop = Infinity;
    js.forEach((j, i) => {
      const dist = ahead(v.s, j.stop, L);
      if (dist < nextStop && dist < 90) [next, nextStop] = [i, dist];
    });
    if (v.committed >= 0 && ahead(v.s, js[v.committed].s + js[v.committed].cross / 2 + 3, L) > L / 2) v.committed = -1;
    if (next >= 0 && next !== v.committed) {
      const j = js[next];
      const light = this.signals.state(j.gx, j.gy, j.ns, this.time);
      const canStop = nextStop > (v.v * v.v) / (2 * d.b) + 0.5;
      let hold = light === 'red' ? nextStop > (v.v * v.v) / (2 * 8) : light === 'amber' ? canStop : false;
      // Don't block the box: hold at the line if the queue beyond hasn't room for us.
      if (!hold && lead && !j.turn && lead.v < 3 && leadGap - nextStop < j.cross + 2 * v.half + 3 && nextStop < 30) hold = true;
      // Right turns cross the oncoming lane: wait while oncoming traffic is coming through.
      if (!hold && j.turn === 'right' && this.oncoming(v, j)) hold = true;
      // Front bumper at the stop line (the line is a point to halt at: add back the standstill gap).
      if (hold) obstacle(nextStop - v.half + d.s0 - 0.3, 0);
      else if (nextStop < 1.5) v.committed = next;
    }
    // Committed right-turners still yield in the junction to oncoming traffic.
    if (v.committed >= 0) {
      const j = js[v.committed];
      const toCentre = ahead(v.s, j.s - 1.5, L);
      if (j.turn === 'right' && toCentre < 12 && this.oncoming(v, j)) obstacle(toCentre, 0);
    }
    // Buses pull in at each edge's stop and wait there.
    if (v.bus) {
      v.route.edges.forEach((e, i) => {
        if (i === v.stopDone) return;
        const dist = ahead(v.s, e.mid, L);
        if (dist > 80) return;
        // The stop is a point to halt at, not a car to keep a gap from: add back the standstill gap.
        if (dist < 1.5 && v.v < 0.5) {
          v.dwell += dt;
          if (v.dwell > BUS_DWELL) {
            v.stopDone = i;
            v.dwell = 0;
          }
          obstacle(d.s0 * 0.2, 0);
        } else obstacle(dist + d.s0 - 0.5, 0);
      });
    }
    return THREE.MathUtils.clamp(a, -9, d.a * 1.2);
  }

  /** Oncoming traffic on its way through junction j (moving, heading the other way, near the box). */
  private oncoming(v: Vehicle, j: Junction): boolean {
    for (const o of this.vehicles) {
      if (o === v || o.v < 1) continue;
      if (o.dx * v.dx + o.dz * v.dz > -0.8) continue;
      const rx = j.x - o.x;
      const rz = j.z - o.z;
      const toward = rx * o.dx + rz * o.dz;
      if (toward < -4 || toward > 40) continue;
      if (Math.abs(rx * o.dz - rz * o.dx) > 10) continue;
      return true;
    }
    return false;
  }

  /**
   * Writes the vehicles nearest the camera into the city shader's headlight list: (x, z, dx, dz), front
   * direction normalised. Visible vehicles only (the others are far away anyway).
   */
  fillLights(camera: THREE.Vector3, out: THREE.Vector4[]): number {
    const near = this.vehicles
      .filter((v) => v.obj.visible)
      .map((v) => ({ v, d: (v.x - camera.x) ** 2 + (v.z - camera.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, out.length);
    near.forEach(({ v }, i) => {
      // The light list takes the car's centre; buses are longer, so move their origin forward.
      const k = v.bus ? v.half - 2.4 : 0;
      out[i].set(v.x + v.dx * k, v.z + v.dz * k, v.dx, v.dz);
    });
    return near.length;
  }

  /** The n vehicles nearest a point: position, velocity, acceleration, and whether it's a bus. */
  nearest(p: THREE.Vector3, n: number): { x: number; z: number; vx: number; vz: number; speed: number; acc: number; bus: boolean }[] {
    return this.vehicles
      .map((v) => ({ v, d: (v.x - p.x) ** 2 + (v.z - p.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map(({ v }) => ({ x: v.x, z: v.z, vx: v.dx * v.v, vz: v.dz * v.v, speed: v.v, acc: v.acc, bus: v.bus }));
  }

  /** Whether a walker at (x, z) of radius r touches a vehicle. */
  blocked(x: number, z: number, r: number): boolean {
    for (const v of this.vehicles) {
      const ox = x - v.x;
      const oz = z - v.z;
      if (Math.abs(ox) > 7 || Math.abs(oz) > 7) continue;
      const a = ox * v.dx + oz * v.dz;
      const c = ox * v.dz - oz * v.dx;
      if (Math.abs(a) < v.half + r && Math.abs(c) < v.width / 2 + r) return true;
    }
    return false;
  }

  get count(): number {
    return this.vehicles.length;
  }

  /** Diagnostics: the smallest bumper gap between any two vehicles in the same lane (negative = overlap). */
  minGap(): number {
    let m = Infinity;
    for (const v of this.vehicles) {
      for (const o of this.vehicles) {
        if (o === v || o.dx * v.dx + o.dz * v.dz < 0.35) continue;
        const rx = o.x - v.x;
        const rz = o.z - v.z;
        const fwd = rx * v.dx + rz * v.dz;
        if (fwd <= 0 || Math.abs(rx * v.dz - rz * v.dx) > 1.5) continue;
        m = Math.min(m, fwd - v.half - o.half);
      }
    }
    return m;
  }
}

/**
 * The lit lamps on the signal poles near the camera, following the junctions' signals: one lens of three
 * (green, amber, red) on each face of each head, drawn as instanced emissive quads over the dark lenses
 * baked into the chunk meshes (props.ts signal()).
 */
export class SignalLamps {
  readonly mesh: THREE.InstancedMesh;
  private heads: { gx: number; gy: number; ns: boolean; base: number }[] = [];
  private last = new THREE.Vector3(1e9, 0, 0);
  private static readonly MAX = 900;
  private readonly m = new THREE.Matrix4();
  private readonly col = new THREE.Color();

  constructor(
    private readonly signals: Signals,
    private readonly near: (x: number, z: number, r: number) => readonly Prop[],
  ) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3, 0.32), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), SignalLamps.MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SignalLamps.MAX * 3), 3);
  }

  update(camera: THREE.Vector3, time: number): void {
    if (camera.distanceToSquared(this.last) > 400) {
      this.last.copy(camera);
      this.heads = [];
      let n = 0;
      for (const p of this.near(camera.x, camera.z, 220)) {
        if (n + 6 > SignalLamps.MAX) break;
        const arm = Math.max(1.5, p.arm ?? 3);
        const nv = [p.nx, 0, p.nz];
        const r = [p.nz, 0, -p.nx];
        const base = n;
        // The same lens positions as props.ts signal(): 3 lamps along the arm, on both faces.
        for (const face of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const a = arm - 1.1 + i * 0.37 + (face < 0 ? 0.15 : 0.15);
            const du = face < 0 ? -0.265 : 0.015;
            const x = p.x + r[0] * du + nv[0] * a;
            const z = p.z + r[2] * du + nv[2] * a;
            this.m.makeRotationY(Math.atan2(r[0] * face, r[2] * face)).setPosition(x, 5.22, z);
            this.mesh.setMatrixAt(n++, this.m);
          }
        }
        this.heads.push({ gx: Math.round(p.x / 128), gy: Math.round(p.z / 128), ns: Math.abs(p.nx) > 0.5, base });
      }
      this.mesh.count = n;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    const LIT: [number, number, number][] = [[0.2, 2.2, 1.4], [2.6, 1.5, 0.1], [3.0, 0.15, 0.08]];
    for (const h of this.heads) {
      const st = this.signals.state(h.gx, h.gy, h.ns, time);
      const on = st === 'green' ? 0 : st === 'amber' ? 1 : 2;
      for (let k = 0; k < 6; k++) {
        const i = k % 3;
        if (i === on) this.col.setRGB(...LIT[i]);
        else this.col.setRGB(0.02, 0.02, 0.02);
        this.mesh.setColorAt(h.base + k, this.col);
      }
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
