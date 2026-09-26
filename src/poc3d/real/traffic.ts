import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rect } from '../../core/coords';
import { hash } from '../../core/hash';
import { along, SIDES, type BusLine, type Route } from '../district/traffic';
import { addCar } from './cars';
import { EMIT, KIND, lin, MeshBuilder } from './meshBuilder';

/**
 * Moving traffic: cars and taxis round their loops at a steady speed, spaced so they never meet in a lane,
 * and city buses round theirs, pulling in at each stop for a while. Vehicles are meshes (one per vehicle,
 * geometry shared per model) placed each frame; only those within DRAW metres are drawn. Buses are lit
 * inside at night and carry their line on the front. Bus stops: a shelter and a pole sign on the kerb.
 */

const DRAW = 320;
const CAR_SPEED = 10;
const BUS_SPEED = 7.5;
const BUS_DWELL = 12;
const BUS_EASE = 18;
const BUS_LEN = 10.5;

type Model = { geo: THREE.BufferGeometry; half: number };

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
  return { geo: mergeGeometries([body, lamps.build()!])!, half: (bb.max.z - bb.min.z) / 2 };
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

interface Vehicle {
  readonly obj: THREE.Object3D;
  readonly route: Route;
  readonly half: number;
  /** Distance along the route at time 0 (cars), or the bus's timetable offset. */
  readonly s0: number;
  readonly speed: number;
  readonly bus: boolean;
  x: number;
  z: number;
  dx: number;
  dz: number;
}

export class TrafficSystem {
  readonly group = new THREE.Group();
  readonly colliders: Rect[] = [];
  private readonly vehicles: Vehicle[] = [];
  private time = 0;

  constructor(cars: readonly { route: Route; spacing: number }[], buses: readonly { line: BusLine; route: Route }[], city: THREE.Material) {
    const models: Model[] = [];
    const PAINTS = [0xe8e8e4, 0x1a1a1c, 0x8a8e94, 0x2a3a5a, 0x7a1a1a, 0xc8c0b0];
    for (let i = 0; i < 6; i++) models.push(carModel('sedan', PAINTS[i], 900 + i));
    models.push(carModel('kei', undefined, 911), carModel('kei', undefined, 912), carModel('minivan', 0xe8e8e4, 913), carModel('minivan', 0x2a2a2e, 914));
    const taxis = [carModel('taxi', undefined, 921), carModel('taxi', undefined, 922), carModel('taxi', undefined, 923)];
    let k = 0;
    for (const { route, spacing } of cars) {
      const n = Math.max(2, Math.floor(route.length / spacing));
      for (let i = 0; i < n; i++) {
        const h = hash(k++, 0x7a1);
        const m = h % 10 < 3 ? taxis[h % taxis.length] : models[(h >>> 4) % models.length];
        const obj = new THREE.Mesh(m.geo, city);
        obj.castShadow = true;
        this.group.add(obj);
        this.vehicles.push({ obj, route, half: m.half, s0: (route.length * i) / n + ((h >>> 8) % 100) / 10, speed: CAR_SPEED * (0.9 + ((h >>> 12) % 20) / 100), bus: false, x: 0, z: 0, dx: 0, dz: 1 });
      }
    }
    const glass = new THREE.MeshStandardMaterial({ color: 0x9ab4bc, transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    for (const { line, route } of buses) {
      const model = busModel(line);
      for (let i = 0; i < line.buses; i++) {
        const obj = new THREE.Group();
        const body = new THREE.Mesh(model.body, city);
        body.castShadow = true;
        const gl = new THREE.Mesh(model.glass, glass);
        gl.renderOrder = 3;
        obj.add(body, gl, model.signs.clone());
        this.group.add(obj);
        this.vehicles.push({ obj, route, half: BUS_LEN / 2, s0: (this.busPeriod(route) * i) / line.buses, speed: BUS_SPEED, bus: true, x: 0, z: 0, dx: 0, dz: 1 });
      }
    }
    const stops = busStops(buses, city);
    this.group.add(stops.mesh);
    this.colliders.push(...stops.colliders);
  }

  /** A bus's loop: four legs, each a run to the next stop then a dwell there. */
  private busPeriod(route: Route): number {
    return route.length / BUS_SPEED + 4 * (BUS_DWELL + BUS_EASE / BUS_SPEED);
  }

  private busDistance(route: Route, t: number): number {
    const period = this.busPeriod(route);
    t = ((t % period) + period) % period;
    // Legs start at the first stop (edge 0's middle); each is a run with a slow-down and pull-away, then a dwell.
    const stopsAt = route.edges.map((e) => e.mid);
    for (let i = 0; i < 4; i++) {
      const from = stopsAt[i];
      const to = i < 3 ? stopsAt[i + 1] : stopsAt[0] + route.length;
      const d = to - from;
      const T = d / BUS_SPEED + BUS_EASE / BUS_SPEED;
      if (t < BUS_DWELL) return from;
      t -= BUS_DWELL;
      if (t < T) {
        // Smoothstep over the run: pulls away and pulls in gently.
        const u = t / T;
        return from + d * u * u * (3 - 2 * u);
      }
      t -= T;
    }
    return stopsAt[0];
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.time += dt;
    for (const v of this.vehicles) {
      const s = v.bus ? this.busDistance(v.route, this.time + v.s0) : v.s0 + this.time * v.speed;
      const p = along(v.route, s);
      v.x = p.x;
      v.z = p.z;
      v.dx = p.dx;
      v.dz = p.dz;
      const near = Math.hypot(p.x - camera.x, p.z - camera.z) < DRAW;
      v.obj.visible = near;
      if (!near) continue;
      v.obj.position.set(p.x, 0, p.z);
      v.obj.rotation.y = Math.atan2(p.dx, p.dz);
    }
  }

  /** Whether a walker at (x, z) of radius r touches a vehicle. */
  blocked(x: number, z: number, r: number): boolean {
    for (const v of this.vehicles) {
      const ox = x - v.x;
      const oz = z - v.z;
      if (Math.abs(ox) > 7 || Math.abs(oz) > 7) continue;
      const a = ox * v.dx + oz * v.dz;
      const c = ox * v.dz - oz * v.dx;
      if (Math.abs(a) < v.half + r && Math.abs(c) < (v.bus ? 1.3 : 0.9) + r) return true;
    }
    return false;
  }

  get count(): number {
    return this.vehicles.length;
  }
}
