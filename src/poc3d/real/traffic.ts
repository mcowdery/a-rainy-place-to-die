import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rect } from '../../core/coords';
import { hash } from '../../core/hash';
import { along, SIDES, Signals, TURN, type BusLine, type Junction, type Route } from '../district/traffic';
import type { Prop } from './props';
import { addWheel } from '../models/vehicles';
import { addCar, carWheels } from './cars';
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
/** The ground's height (district/terrain.ts), set by the page: vehicles, their lamps and signals stand on it. */
let groundY: (x: number, z: number) => number = () => 0;
export function setTrafficGround(f: (x: number, z: number) => number): void {
  groundY = f;
}
/**
 * Traffic further than this from the camera waits where it is (not simulated, not drawn), so the cost stays with
 * the cars round you however big the city gets; it drives on when you come back.
 */
export const SIM = 900;
/** The spatial grid for finding the vehicle ahead (m a square). */
const BUCKET = 40;
/** Beyond this (m, along x plus along z), traffic decides its acceleration every third frame. */
const FAR_DECIDE = 380;
/** The sideways pull drivers take a turn at (m/s^2): turning speed = sqrt(pull * radius). */
const TURN_PULL = 2.6;

/** Someone who might step into the road: where they are and how they're moving (m/s). */
export interface Walker {
  readonly x: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** How far they reach sideways (m): a person 0.3 (the default), a car stopped across the lane more. */
  readonly r?: number;
}
const BUS_DWELL = 12;
const BUS_LEN = 10.5;
/** A bus's wheels: big steel wheels, standing just proud of the body's side over dark wells. */
const BUS_WHEELS: ReturnType<typeof carWheels> = {
  r: 0.48,
  tw: 0.3,
  rims: 'steel',
  spots: [-3.2, 3.6].flatMap((z) => ([-1, 1] as const).map((sd) => ({ x: sd * 1.12, y: 0.48, z, front: z > 0, sd }))),
};

type WheelLayout = ReturnType<typeof carWheels>;
type Model = { geo: THREE.BufferGeometry; half: number; brake: THREE.BufferGeometry; label: string; wheels: WheelLayout };

const LABELS = { sedan: 'Car', kei: 'Kei car', minivan: 'Minivan', taxi: 'Taxi' } as const;

/** A car model at the origin pointing +z, with headlight glows added (the district's cars are parked). */
function carModel(type: 'sedan' | 'kei' | 'minivan' | 'taxi', paint: number | undefined, variant: number): Model {
  const mb = new MeshBuilder();
  addCar(mb, { x: 0, z: 0, fx: 0, fz: 1, variant, type, wheels: false, ...(paint === undefined ? {} : { paint }) });
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
  return { geo: mergeGeometries([body, lamps.build()!])!, half: (bb.max.z - bb.min.z) / 2, brake: brake.build()!, label: LABELS[type], wheels: carWheels(type) };
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
  // Dark wheel wells (the wheels turn, drawn apart: BUS_WHEELS), skirt and lower body, the stripe, pillars
  // between the windows, the roof and its gear.
  for (const w of BUS_WHEELS.spots) box(0x0a0a0b, w.sd * W - 0.02, w.sd * W + 0.006, 0, 1.08, w.z - 0.6, w.z + 0.6);
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
  // Its wheels (standing still, so plain meshes).
  for (const w of BUS_WHEELS.spots) {
    const mb = new MeshBuilder(4096);
    addWheel(mb, BUS_WHEELS.r, BUS_WHEELS.tw, w.sd, BUS_WHEELS.rims);
    const wheel = new THREE.Mesh(mb.build()!, city);
    wheel.position.set(w.x, w.y, w.z);
    g.add(wheel);
  }
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
  const geo = mb.build();
  if (geo) {
    const mesh = new THREE.Mesh(geo, city);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
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

/**
 * A vehicle as the player drives it (district/driving.ts): the driving code moves it (centre, heading, speed,
 * acceleration, curvature), the traffic system still draws it, lights it and treats it as an obstacle.
 */
export interface DrivenVehicle {
  readonly obj: THREE.Object3D;
  readonly half: number;
  readonly width: number;
  readonly bus: boolean;
  /** From the rear axle forward to the body's centre. */
  readonly axle: number;
  /** What it is, for the prompt ('Taxi', 'Bus'...). */
  readonly label: string;
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Speed along the heading (negative reversing), acceleration, path curvature (1/m, positive turning right). */
  v: number;
  acc: number;
  curv: number;
  /** Hide the body (the camera's on the bumper, looking out). */
  hideBody: boolean;
  /**
   * Your own car (district/ownCar.ts): drawn, posed and wheeled by its owner; the traffic system only keeps it
   * in the traffic (stopping behind it, honking, lighting) and never drives it.
   */
  readonly own?: boolean;
  /** Up on the expressway: out of the street's way (its traffic, walkers and headlights ignore it). */
  aloft?: boolean;
}

/** A taxi you've waved down: where along its route it will pull in, and whether it has stopped there. */
export interface Hail {
  readonly taxi: DrivenVehicle;
  readonly at: number;
  stopped: boolean;
}

interface Vehicle extends DrivenVehicle {
  readonly brake: THREE.Object3D;
  readonly route: Route;
  readonly driver: Driver;
  /** In traffic (driving its loop), driven by the player, or parked where the player left it. */
  mode: 'traffic' | 'driven' | 'parked';
  /** Distance along the route (while in traffic). */
  s: number;
  /** Buses: the stop being served (edge index) and how long they have stood there. */
  stopDone: number;
  dwell: number;
  /** The junction (route index) the vehicle has committed to crossing, or -1. */
  committed: number;
  pitch: number;
  roll: number;
  /** Seconds stopped for someone in the road, and until the horn can sound again. */
  waited: number;
  hornIn: number;
  /** Its wheels (drawn by `Wheels`) and how far they've turned (rad). */
  readonly wheels: WheelLayout;
  turned: number;
  /** Simulated this frame (within SIM of the camera, or not in traffic). */
  live: boolean;
}

/**
 * Every vehicle's wheels, apart from the bodies so they turn: they roll with the vehicle's speed and the front
 * ones steer with the curve it's on. One instanced mesh per rim style and side (four draw calls in all), each
 * wheel scaled from one model wheel to its vehicle's size.
 */
class Wheels {
  private static readonly R = 0.32;
  private static readonly TW = 0.22;
  private readonly meshes = new Map<string, { mesh: THREE.InstancedMesh; n: number }>();
  private readonly local = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor(group: THREE.Group, city: THREE.Material, max: number) {
    for (const rims of ['alloy', 'steel'] as const) {
      for (const sd of [1, -1] as const) {
        const mb = new MeshBuilder(4096);
        addWheel(mb, Wheels.R, Wheels.TW, sd, rims);
        const mesh = new THREE.InstancedMesh(mb.build()!, city, max);
        mesh.count = 0;
        // The instances move every frame and span the whole district: no bounds to cull by.
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(mesh);
        this.meshes.set(`${rims}${sd}`, { mesh, n: 0 });
      }
    }
  }

  begin(): void {
    for (const m of this.meshes.values()) m.n = 0;
  }

  /** v's four wheels, after its body is placed; steer (rad, positive left) turns the front ones. */
  add(v: Vehicle, steer: number): void {
    v.obj.updateMatrix();
    const W = v.wheels;
    for (const w of W.spots) {
      const m = this.meshes.get(`${W.rims}${w.sd}`)!;
      if (m.n >= m.mesh.instanceMatrix.count) continue;
      this.e.set(v.turned, w.front ? steer : 0, 0);
      this.q.setFromEuler(this.e);
      this.local.compose(this.p.set(w.x, w.y, w.z), this.q, this.sc.set(W.tw / Wheels.TW, W.r / Wheels.R, W.r / Wheels.R));
      this.local.premultiply(v.obj.matrix);
      m.mesh.setMatrixAt(m.n++, this.local);
    }
  }

  end(): void {
    for (const m of this.meshes.values()) {
      m.mesh.count = m.n;
      m.mesh.instanceMatrix.needsUpdate = true;
    }
  }
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
  /** The taxi pulling in for you (hail), if any. */
  hail: Hail | null = null;
  private readonly wheels: Wheels;
  private time = 0;
  private frame = 0;

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
    const add = (obj: THREE.Object3D, brakeGeo: THREE.BufferGeometry, route: Route, half: number, width: number, bus: boolean, driver: Driver, s: number, label: string, wheels: WheelLayout): void => {
      const brake = new THREE.Mesh(brakeGeo, brakeMat);
      brake.visible = false;
      obj.add(brake);
      obj.rotation.order = 'YXZ';
      this.group.add(obj);
      // The rear axle sits about a fifth of the length in from the back (a car's overhang; a bus's longer).
      const axle = bus ? half - 2.6 : half - 0.95;
      this.vehicles.push({ obj, brake, route, half, width, bus, driver, label, mode: 'traffic', s, v: driver.v0 * 0.6, acc: 0, curv: 0, hideBody: false, stopDone: -1, dwell: 0, committed: -1, pitch: 0, roll: 0, axle, waited: 0, hornIn: 0, x: 0, z: 0, dx: 0, dz: 1, wheels, turned: 0, live: true });
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
        add(obj, m.brake, route, m.half, 1.8, false, driver, (route.length * i) / n + r(2) * 8, m.label, m.wheels);
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
        add(obj, busBrakeGeo, route, BUS_LEN / 2, 2.5, true, { v0: 9.5, a: 0.9, b: 1.6, T: 1.6, s0: 3 }, (route.length * (i + 0.3)) / line.buses, 'Bus', BUS_WHEELS);
      }
    }
    for (const v of this.vehicles) {
      const p = this.pose(v);
      v.x = p.x;
      v.z = p.z;
      v.dx = p.dx;
      v.dz = p.dz;
    }
    this.wheels = new Wheels(this.group, city, this.vehicles.length * 4);
    const stops = busStops(buses, city);
    this.group.add(stops.mesh);
    this.colliders.push(...stops.colliders);
  }

  /**
   * How the weather has the drivers drive (main.ts from district/roadGrip.ts): their speed (1 dry; less in rain,
   * fog and snow), their gaps (longer), and the grip they trust for braking and corners.
   */
  conditions = { speed: 1, gap: 1, grip: 1 };
  /** The live vehicles by square of the spatial grid (rebuilt each frame). */
  private readonly grid = new Map<number, Vehicle[]>();

  private static key(x: number, z: number): number {
    return (Math.floor(x / BUCKET) + 2048) * 4096 + Math.floor(z / BUCKET) + 2048;
  }

  private bucket(): void {
    for (const list of this.grid.values()) list.length = 0;
    for (const v of this.vehicles) {
      if (!v.live) continue;
      const k = TrafficSystem.key(v.x, v.z);
      const list = this.grid.get(k);
      if (list) list.push(v);
      else this.grid.set(k, [v]);
    }
  }

  /** The live vehicles in the grid squares within `rings` squares of (x, z). */
  private *near(x: number, z: number, rings: number): Generator<Vehicle> {
    const bx = Math.floor(x / BUCKET);
    const bz = Math.floor(z / BUCKET);
    for (let i = -rings; i <= rings; i++) {
      for (let j = -rings; j <= rings; j++) {
        const list = this.grid.get((bx + i + 2048) * 4096 + bz + j + 2048);
        if (list) yield* list;
      }
    }
  }

  /** The time the signals run on (seconds). */
  get clock(): number {
    return this.time;
  }

  /** Horns sounded this frame (read and cleared by the caller, for the sound). */
  readonly honks: { x: number; z: number; bus: boolean }[] = [];

  /**
   * Where a vehicle is: its rear axle on the lane, the body pointing along the lane there (the rear wheels
   * don't slide, so that's the way it faces), the centre ahead of the axle. Round a turn the front swings
   * wide and the rear cuts in, as a car's does.
   */
  private pose(v: Vehicle): { x: number; z: number; dx: number; dz: number; k: number } {
    const r = along(v.route, v.s - v.axle);
    return { x: r.x + r.dx * v.axle, z: r.z + r.dz * v.axle, dx: r.dx, dz: r.dz, k: r.k };
  }

  /** people: whoever might step into the road (the walker; later, pedestrians), with their velocity. */
  update(dt: number, camera: THREE.Vector3, people: readonly Walker[] = []): void {
    this.time += dt;
    const V = this.vehicles;
    for (const v of V) v.live = v.mode !== 'traffic' || v === this.hail?.taxi || Math.hypot(v.x - camera.x, v.z - camera.z) < SIM;
    for (const v of V) {
      if (v.mode !== 'traffic' || !v.live) continue;
      const p = this.pose(v);
      v.x = p.x;
      v.z = p.z;
      v.dx = p.dx;
      v.dz = p.dz;
    }
    // In the way besides people: the cars the player is driving or has left, each as three points along it.
    const others: Walker[] = [...people];
    for (const o of V) {
      if (o.mode === 'traffic' || o.aloft) continue;
      for (const f of [-0.6, 0, 0.6]) others.push({ x: o.x + o.dx * o.half * f, z: o.z + o.dz * o.half * f, vx: o.dx * o.v, vz: o.dz * o.v, r: o.width / 2 + 0.2 });
    }
    this.bucket();
    // Driving decisions: every frame near the camera; beyond FAR_DECIDE (out where you can't tell), every third frame
    // in turn, each keeping its last acceleration between (the motion itself still integrates every frame).
    this.frame++;
    V.forEach((v, i) => {
      if (v.mode !== 'traffic' || !v.live) return;
      const far = Math.abs(v.x - camera.x) + Math.abs(v.z - camera.z) > FAR_DECIDE;
      if (far && (i + this.frame) % 3 !== 0) return;
      v.acc = this.accel(v, far ? dt * 3 : dt, others, camera);
    });
    this.wheels.begin();
    for (const v of V) {
      if (!v.live) {
        v.obj.visible = false;
        continue;
      }
      if (v.mode === 'traffic') {
        const L = v.route.length;
        v.v = Math.max(0, v.v + v.acc * dt);
        v.s = (v.s + v.v * dt) % L;
      } else if (v.mode === 'parked') {
        v.v = 0;
        v.acc = 0;
      }
      const near = v.mode === 'driven' || Math.hypot(v.x - camera.x, v.z - camera.z) < DRAW;
      v.obj.visible = near && !v.hideBody;
      if (!near || v.own) continue;
      const p = v.mode === 'traffic' ? this.pose(v) : { x: v.x, z: v.z, dx: v.dx, dz: v.dz, k: v.curv };
      v.obj.position.set(p.x, groundY(p.x, p.z), p.z);
      v.obj.rotation.y = Math.atan2(p.dx, p.dz);
      // Nose dips under braking, lifts pulling away (eased, like a suspension settling); up and down hills, the
      // body follows the road (nose up climbing).
      const target = THREE.MathUtils.clamp(-v.acc * 0.0045, -0.012, 0.022) * (v.bus ? 0.5 : 1);
      v.pitch += (target - v.pitch) * Math.min(1, dt * 6);
      const climb = groundY(p.x + p.dx * 1.5, p.z + p.dz * 1.5) - groundY(p.x - p.dx * 1.5, p.z - p.dz * 1.5);
      v.obj.rotation.x = v.pitch - Math.atan(climb / 3);
      // The body leans out of a turn with the sideways pull (v^2 * curvature; k > 0 turning right). In the
      // car's frame (+z forward, +x to its left) a positive roll tips the roof to the right: turning right, lean left.
      const lean = THREE.MathUtils.clamp(-v.v * v.v * p.k * 0.011, -0.035, 0.035) * (v.bus ? 0.6 : 1);
      v.roll += (lean - v.roll) * Math.min(1, dt * 5);
      v.obj.rotation.z = v.roll;
      v.brake.visible = v.acc < -0.6 || v.v < 0.4;
      // The wheels roll with the speed, and the front ones steer with the curve: tan(steer) = wheelbase * k
      // (k > 0 turning right, the car's right is -x; reversing, the curve runs the other way).
      v.turned = (v.turned + (v.v * dt) / v.wheels.r) % (Math.PI * 2);
      if (v.hideBody) continue;
      const k = v.mode === 'traffic' || v.v >= 0 ? p.k : -p.k;
      const base = v.wheels.spots[v.wheels.spots.length - 1].z - v.wheels.spots[0].z;
      this.wheels.add(v, -THREE.MathUtils.clamp(Math.atan(base * k), -0.62, 0.62));
    }
    this.wheels.end();
  }

  /** The vehicle's acceleration this frame: the most cautious of free driving and every obstacle. */
  private accel(v: Vehicle, dt: number, people: readonly Walker[], camera: THREE.Vector3): number {
    const c = this.conditions;
    const d = c.speed === 1 && c.gap === 1 && c.grip === 1 ? v.driver : { ...v.driver, v0: v.driver.v0 * c.speed, T: v.driver.T * c.gap, b: v.driver.b * c.grip, s0: v.driver.s0 * (0.5 + 0.5 * c.gap) };
    const pull = TURN_PULL * c.grip;
    const L = v.route.length;
    let v0 = d.v0;
    // Corners: slow in time to the speed the turn allows (a comfortable sideways pull at its tightest).
    for (const j of v.route.junctions) {
      if (!j.turn) continue;
      const half = (TURN.len * j.radius) / 2;
      if (ahead(j.s, v.s, L) < half) {
        // Coming out of it: speed up as the wheel unwinds (the pull the curvature here allows).
        v0 = Math.min(v0, Math.sqrt(pull / Math.max(Math.abs(along(v.route, v.s).k), 1e-3)));
        continue;
      }
      const dist = Math.max(0, ahead(v.s, j.s, L) - half - 1);
      if (dist < 60) v0 = Math.min(v0, Math.sqrt(pull * j.radius + 2 * d.b * 0.6 * dist));
    }
    let a = idm(d, v.v, v0, Infinity, 0);
    const obstacle = (gap: number, speed: number): void => {
      a = Math.min(a, idm(d, v.v, v0, gap, v.v - speed));
    };
    // Someone in the road ahead, or about to be: stop short of them.
    v.hornIn = Math.max(0, v.hornIn - dt);
    const hit = people.length && Math.hypot(v.x - camera.x, v.z - camera.z) < 320 ? this.personAhead(v, people) : null;
    if (hit) {
      const gap = hit.k - v.half;
      if (gap < 0.4) v.v = 0;
      const before = a;
      obstacle(Math.max(0.05, gap - 0.6), hit.speed);
      const hard = a < -4.5 && v.v > 3 && a < before;
      v.waited = v.v < 0.5 ? v.waited + dt : 0;
      // The horn: a hard stop, or someone just standing there.
      if (v.hornIn === 0 && (hard || v.waited > 2.5)) {
        this.honks.push({ x: v.x + v.dx * v.half, z: v.z + v.dz * v.half, bus: v.bus });
        v.hornIn = 5 + (hash(Math.floor(this.time), v.s | 0) % 40) / 10;
        v.waited = 0;
      }
    } else v.waited = 0;
    // The vehicle ahead in the lane, on any loop: in front, roughly the same heading, not off to the side.
    let lead: Vehicle | null = null;
    let leadGap = Infinity;
    for (const o of this.near(v.x + v.dx * 35, v.z + v.dz * 35, 2)) {
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
    // A hailed taxi pulls in at its spot and waits there.
    const h = this.hail;
    if (h && h.taxi === v) {
      const dist = ahead(v.s, h.at, L);
      if (dist < 1.5 && v.v < 0.5) {
        h.stopped = true;
        v.v = 0;
        obstacle(d.s0 * 0.2, 0);
      } else if (dist < L / 2) obstacle(dist + d.s0 - 0.5, 0);
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

  /**
   * How far along the lane (from the vehicle's centre) the nearest person in its way is, or Infinity: the lane
   * ahead of the front bumper, sampled every metre, against where each person is now and where they'll be by
   * the time the vehicle gets there (their current velocity, up to 2 s ahead). In the way: within the
   * vehicle's half width plus a margin of the lane's centre line.
   */
  private personAhead(v: Vehicle, people: readonly Walker[]): { k: number; speed: number } | null {
    const look = Math.min(48, (v.v * v.v) / (2 * 3) + v.half + 12);
    let best: { k: number; speed: number } | null = null;
    for (const p of people) {
      if ((p.x - v.x) ** 2 + (p.z - v.z) ** 2 > (look + 8) ** 2) continue;
      for (let k = v.half - 0.3; k <= look && k < (best?.k ?? Infinity); k += 1) {
        const q = along(v.route, v.s + k);
        const t = Math.min(2, Math.max(0, k - v.half) / Math.max(v.v, 1.5));
        for (const [x, z] of [[p.x, p.z], [p.x + p.vx * t, p.z + p.vz * t]] as const) {
          const ox = x - q.x;
          const oz = z - q.z;
          // Their speed along the lane: follow someone going our way, stop for anyone else.
          if (Math.abs(ox * q.dx + oz * q.dz) < 0.6 && Math.abs(ox * q.dz - oz * q.dx) < v.width / 2 + (p.r ?? 0.3) + 0.25) best = { k, speed: Math.max(0, p.vx * q.dx + p.vz * q.dz) };
        }
      }
    }
    return best;
  }

  /** Oncoming traffic on its way through junction j (moving, heading the other way, near the box). */
  private oncoming(v: Vehicle, j: Junction): boolean {
    for (const o of this.near(j.x, j.z, 1)) {
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
      .filter((v) => v.obj.visible && !v.aloft)
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

  /**
   * The vehicles out driving on the street within r of a point (stopped at a light too), nearest first (not your own
   * car, which has its own owner, nor any up on the deck): for their wipers and their tyre tracks in the snow. y is
   * the ground under them.
   */
  movingNear(p: THREE.Vector3, r: number): { key: object; x: number; z: number; y: number; dx: number; dz: number; half: number; width: number; bus: boolean }[] {
    const out: { key: object; x: number; z: number; y: number; dx: number; dz: number; half: number; width: number; bus: boolean; d: number }[] = [];
    for (const v of this.vehicles) {
      if (v.own || v.aloft || !v.obj.visible || v.mode === 'parked' || (v.mode === 'traffic' && !v.live)) continue;
      const d = (v.x - p.x) ** 2 + (v.z - p.z) ** 2;
      if (d > r * r) continue;
      out.push({ key: v, x: v.x, z: v.z, y: v.obj.position.y, dx: v.dx, dz: v.dz, half: v.half, width: v.width, bus: v.bus, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** The n vehicles nearest a point: position, velocity, acceleration, and whether it's a bus. */
  nearest(p: THREE.Vector3, n: number): { x: number; z: number; vx: number; vz: number; speed: number; acc: number; bus: boolean }[] {
    // (Your own car has its own engine sound.)
    return this.vehicles
      .filter((v) => !v.own)
      .map((v) => ({ v, d: (v.x - p.x) ** 2 + (v.z - p.z) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map(({ v }) => ({ x: v.x, z: v.z, vx: v.dx * v.v, vz: v.dz * v.v, speed: v.v, acc: v.acc, bus: v.bus }));
  }

  /** Whether a walker (or a driven car's piece) at (x, z) of radius r touches a vehicle (other than `except`). */
  blocked(x: number, z: number, r: number, except: DrivenVehicle | null = null): boolean {
    for (const v of this.vehicles) {
      if (v === except || v.aloft) continue;
      const ox = x - v.x;
      const oz = z - v.z;
      if (Math.abs(ox) > 7 || Math.abs(oz) > 7) continue;
      const a = ox * v.dx + oz * v.dz;
      const c = ox * v.dz - oz * v.dx;
      if (Math.abs(a) < v.half + r && Math.abs(c) < v.width / 2 + r) return true;
    }
    return false;
  }

  /**
   * A vehicle you could get into: stopped (or crawling: at a light, in a queue, or where you left it), its
   * nearest side within reach of p, and roughly in front of the view (fx, fz).
   */
  takeable(p: THREE.Vector3, fx: number, fz: number, reach = 2.2, any = false, ownOnly = false): DrivenVehicle | null {
    let best: Vehicle | null = null;
    let bestD = reach;
    for (const v of this.vehicles) {
      if (v.mode === 'driven' || (!any && Math.abs(v.v) > 1.2) || (ownOnly && !v.own)) continue;
      const ox = p.x - v.x;
      const oz = p.z - v.z;
      if (ox * ox + oz * oz > (v.half + reach + 1) ** 2) continue;
      // Distance from p to the vehicle's footprint.
      const a = Math.abs(ox * v.dx + oz * v.dz) - v.half;
      const c = Math.abs(ox * v.dz - oz * v.dx) - v.width / 2;
      const d = Math.hypot(Math.max(0, a), Math.max(0, c));
      const toward = -(ox * fx + oz * fz) / Math.max(Math.hypot(ox, oz), 1e-3);
      if (d < bestD && (any || toward > 0.2)) [best, bestD] = [v, d];
    }
    return best;
  }

  /**
   * Wave down a taxi from p (the kerb): the nearest cruising taxi coming toward you on its loop (behind the
   * point on its route nearest you, within 150 m, no nearer than it can stop comfortably) pulls in there.
   * Returns it, or null if none is near enough.
   */
  hailTaxi(p: THREE.Vector3): Hail | null {
    if (this.hail) return this.hail;
    let best: { v: Vehicle; at: number; d: number } | null = null;
    for (const v of this.vehicles) {
      if (v.mode !== 'traffic' || v.label !== 'Taxi') continue;
      // The point on its route nearest you (a coarse search, then fine).
      const L = v.route.length;
      let at = 0;
      let bd = Infinity;
      for (let s = 0; s < L; s += 4) {
        const q = along(v.route, s);
        const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (dd < bd) [at, bd] = [s, dd];
      }
      for (let s = at - 4; s <= at + 4; s += 0.5) {
        const q = along(v.route, s);
        const dd = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
        if (dd < bd) [at, bd] = [(s + L) % L, dd];
      }
      if (Math.sqrt(bd) > 14) continue;
      const toGo = ahead(v.s, at, L);
      const need = (v.v * v.v) / (2 * 2.5) + v.half + 4;
      if (toGo < need || toGo > 150) continue;
      if (!best || toGo < best.d) best = { v, at, d: toGo };
    }
    if (!best) return null;
    this.hail = { taxi: best.v, at: best.at, stopped: false };
    return this.hail;
  }

  /** The hailed taxi goes on its way (you got in, or walked off). */
  releaseHail(): void {
    this.hail = null;
  }

  /**
   * Your own car joins the traffic, parked: `obj` is its model (placed by its owner), half its length, width
   * its width.
   */
  addOwn(obj: THREE.Object3D, half: number, width: number, label: string, x: number, z: number, dx: number, dz: number): DrivenVehicle {
    const t = this.vehicles[0];
    const brake = new THREE.Object3D();
    const v: Vehicle = {
      obj, brake, route: t.route, half, width, bus: false, driver: t.driver, label, mode: 'parked', s: 0, v: 0, acc: 0, curv: 0, hideBody: false,
      stopDone: -1, dwell: 0, committed: -1, pitch: 0, roll: 0, axle: half - 0.95, waited: 0, hornIn: 0, x, z, dx, dz, wheels: t.wheels, turned: 0, own: true, live: true,
    };
    this.group.add(obj);
    this.vehicles.push(v);
    return v;
  }

  /** Take the wheel: the vehicle leaves its loop; the driving code moves it from now on. */
  take(d: DrivenVehicle): void {
    const v = d as Vehicle;
    v.mode = 'driven';
    v.committed = -1;
    v.curv = 0;
  }

  /** Get out: the vehicle stays where it is, parked (an obstacle; you can get back in). */
  leave(d: DrivenVehicle): void {
    const v = d as Vehicle;
    v.mode = 'parked';
    v.hideBody = false;
    v.v = 0;
    v.acc = 0;
    v.curv = 0;
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
            this.m.makeRotationY(Math.atan2(r[0] * face, r[2] * face)).setPosition(x, groundY(p.x, p.z) + 5.22, z);
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
