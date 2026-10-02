import * as THREE from 'three';
import { addVehicle, addWheel, liveryAnchors, wheelLayout, type CarType } from '../poc3d/models/vehicles';
import { MeshBuilder } from '../poc3d/real/meshBuilder';
import { decalTexture, EYE } from './shooting';
import type { Car, Ground } from './vehicle';

/**
 * How a car looks on a venue or in the garage: one of the showroom's sports cars on the city material with
 * its wheels apart (they roll, steer, spin up and lock), its paint and livery (stripes from the body builder,
 * the door number and windscreen banner as text on canvases), the neon underglow lighting the ground under
 * it, posed on the ground (pitched and rolled by the slope and the load), its headlights, the invisible
 * volumes shots strike, and the marks hits leave on it.
 */

const wheelGeos = new Map<string, THREE.BufferGeometry>();
const wheelGeo = (type: CarType, sd: 1 | -1): THREE.BufferGeometry => {
  const key = `${type}${sd}`;
  let g = wheelGeos.get(key);
  if (!g) {
    const W = wheelLayout(type);
    const wb = new MeshBuilder(1 << 14);
    addWheel(wb, W.r, W.tw, sd, W.rims);
    g = wb.build()!;
    wheelGeos.set(key, g);
  }
  return g;
};

/** What a car looks like: its model, paint (and a two-tone's lower colour), livery and neon. */
export interface Look {
  readonly type: CarType;
  readonly paint: number;
  readonly paint2?: number | null;
  readonly livery?: { readonly stripes: number | null; readonly side: number | null; readonly number: number | null; readonly banner: string | null };
  readonly neon?: number | null;
}

export interface CarView {
  /** Placed and turned like the car; the body is its child (hidden for the bumper camera). */
  readonly obj: THREE.Group;
  readonly body: THREE.Mesh;
  /** The side windows (children of the body; their y lowers them into the doors: `rollWindows`). Left is the
   * car's left (+x), the passenger's side; right the driver's. */
  readonly windows: { readonly left: THREE.Mesh | null; readonly right: THREE.Mesh | null };
  readonly wheels: { m: THREE.Mesh; front: boolean; roll: number }[];
  /** Wheel radius (m), for turning them. */
  readonly r: number;
}

export function buildCar(look: Look, material: THREE.Material): CarView {
  const { type } = look;
  const mb = new MeshBuilder(1 << 17);
  const glass = { left: new MeshBuilder(1 << 12), right: new MeshBuilder(1 << 12) };
  addVehicle(mb, { x: 0, z: 0, fx: 0, fz: 1, type, paint: look.paint, paint2: look.paint2 ?? undefined, detail: 0.05, wheels: false, livery: look.livery ?? undefined, sideWindows: glass });
  const body = new THREE.Mesh(mb.build()!, material);
  const pane = (b: MeshBuilder): THREE.Mesh | null => {
    const g = b.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    body.add(m);
    return m;
  };
  const windows = { left: pane(glass.left), right: pane(glass.right) };
  const obj = new THREE.Group();
  obj.rotation.order = 'YXZ';
  obj.add(body);
  const W = wheelLayout(type);
  const wheels = W.spots.map((w) => {
    const m = new THREE.Mesh(wheelGeo(type, w.sd), material);
    m.position.set(w.x, w.y, w.z);
    m.rotation.order = 'YXZ';
    body.add(m);
    return { m, front: w.front, roll: 0 };
  });
  const lv = look.livery;
  if (lv) addLiveryText(body, type, lv.number, lv.banner);
  if (look.neon != null) addUnderglow(body, type, look.neon);
  return { obj, body, windows, wheels, r: W.r };
}

/** How far a side window drops fully down (m): into the door, out of sight. */
const WINDOW_DROP = 0.42;

/** Rolls the side windows: 0 up, 1 fully down (each eased by the caller). */
export function rollWindows(v: CarView, left: number, right: number): void {
  if (v.windows.left) {
    v.windows.left.position.y = -WINDOW_DROP * left;
    v.windows.left.visible = left < 0.98;
  }
  if (v.windows.right) {
    v.windows.right.position.y = -WINDOW_DROP * right;
    v.windows.right.visible = right < 0.98;
  }
}

/** The door roundels (a number in a white disc) and the windscreen banner, as canvas-textured quads. */
function addLiveryText(body: THREE.Object3D, type: CarType, num: number | null, banner: string | null): void {
  const A = liveryAnchors(type);
  if (num !== null) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f2ea';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111114';
    g.font = 'bold 76px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(num), 64, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const sd of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(A.door.r * 2, A.door.r * 2), mat);
      m.position.set(sd * A.door.x, A.door.y, A.door.z);
      m.rotation.y = (sd * Math.PI) / 2;
      body.add(m);
    }
  }
  if (banner !== null) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0c0c10';
    g.fillRect(0, 0, 1024, 96);
    g.fillStyle = '#f4f2ea';
    g.font = 'bold 64px Impact, "Arial Black", "Yu Gothic", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(banner, 512, 52, 980);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const B = A.banner;
    const geo = new THREE.BufferGeometry();
    const h = B.half;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([h, B.y0, B.z0, -h, B.y0, B.z0, -h, B.y1, B.z1, h, B.y1, B.z1], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    geo.computeVertexNormals();
    body.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
  }
}

let glowTex: THREE.CanvasTexture | null = null;
/** A soft rounded rectangle, bright in the middle and fading to the edges: the light a neon strip throws on the road. */
function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 128; x++) {
      // Distance outside a rounded core, normalised: 0 inside the car's footprint, 1 at the edge of the glow.
      const dx = Math.max(0, Math.abs(x - 63.5) / 64 - 0.45) / 0.55;
      const dy = Math.max(0, Math.abs(y - 127.5) / 128 - 0.62) / 0.38;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 2.2);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/**
 * Neon underglow: tubes under the sills and the ends glowing in the colour, and its light on the road, an
 * additive pool a little bigger than the car (it rides with the body, so it tilts with it).
 */
export function addUnderglow(body: THREE.Object3D, type: CarType, color: number): void {
  const W = wheelLayout(type);
  const zs = W.spots.map((s) => s.z);
  const mid = (Math.max(...zs) + Math.min(...zs)) / 2;
  const len = Math.max(...zs) - Math.min(...zs) + W.r * 2 + 0.9;
  const half = Math.max(...W.spots.map((s) => Math.abs(s.x))) + 0.05;
  const col = new THREE.Color(color);
  const tube = new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(3) });
  const g = new THREE.Group();
  for (const sd of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, len - W.r * 2 - 0.4), tube);
    m.position.set(sd * (half - 0.08), 0.13, mid);
    g.add(m);
  }
  for (const zz of [Math.min(...zs) - W.r - 0.1, Math.max(...zs) + W.r + 0.1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(half * 1.6, 0.03, 0.03), tube);
    m.position.set(0, 0.14, zz);
    g.add(m);
  }
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 2.2, len + 2.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 }),
  );
  pool.position.set(0, 0.035, mid);
  pool.renderOrder = 2;
  g.add(pool);
  g.name = 'underglow';
  body.add(g);
}

/** Two headlight beams, children of the car. */
export function addHeadlights(obj: THREE.Object3D): void {
  for (const s of [-0.62, 0.62]) {
    const l = new THREE.SpotLight(0xfff2dc, 140, 140, 0.3, 0.6, 1);
    l.position.set(s, 0.72, 2.1);
    l.target.position.set(s * 1.2, -0.1, 30);
    obj.add(l, l.target);
  }
}

/** The car on the ground: pitched and rolled by the slope under it and (times `lean`) by the load shifting. */
export function poseCar(v: CarView, c: Car, ground: Ground, lean = 1): void {
  const [nx, ny, nz] = ground.normal(c.x, c.z);
  const slopePitch = Math.atan2(nx * Math.sin(c.h) + nz * Math.cos(c.h), ny);
  const slopeRoll = Math.atan2(nx * Math.cos(c.h) - nz * Math.sin(c.h), ny);
  v.obj.position.set(c.x, c.y, c.z);
  v.obj.rotation.set(slopePitch - c.ax * 0.006 * lean, c.h, -slopeRoll + c.ay * 0.007 * lean);
}

/** The fronts steer, all roll with the road, the rears spin up with wheelspin and stop dead under the handbrake. */
export function turnWheels(v: CarView, c: Car, dt: number): void {
  for (const wh of v.wheels) {
    const rate = wh.front ? c.u / v.r : c.handbrake ? 0 : (c.u / v.r) * (1 + c.spin * 2.5) + c.spin * 25;
    wh.roll = (wh.roll + rate * dt) % (Math.PI * 2);
    wh.m.rotation.set(wh.roll, wh.front ? c.steer : 0, 0);
  }
}

/** The part of a car a shot struck: its body, its glass, a tyre, or someone's head (the driver's, or a gunman's). */
export type Part = 'body' | 'glass' | 'tyre' | 'head';

/**
 * What shots strike, as invisible volumes in the car's frame tagged with `id`, their `part` and (heads) `who`:
 * the lower body, the glasshouse above it, the four tyres (standing just proud of the body's sides, so a shot at
 * a wheel finds the tyre), and the heads inside: the driver's on the right, and a gunman's on the left if the car
 * carries one. Shooting.castBodies lets a round through the glass reach a head behind it.
 */
export function hitVolumes(obj: THREE.Object3D, id: string, gunman = false, type: CarType = 'sports'): THREE.Mesh[] {
  const mat = new THREE.MeshBasicMaterial();
  const vols: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, part: Part, who?: 'driver' | 'gunman'): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.visible = false;
    m.userData = { id, part, who };
    obj.add(m);
    vols.push(m);
  };
  add(new THREE.BoxGeometry(1.78, 0.8, 4.3), 0, 0.6, 0, 'body');
  add(new THREE.BoxGeometry(1.34, 0.34, 1.9), 0, 1.08, -0.25, 'glass');
  const WL = wheelLayout(type);
  const tyre = new THREE.BoxGeometry(0.44, WL.r * 2.05, WL.r * 2.05);
  for (const w of WL.spots) add(tyre, Math.sign(w.x) * 0.73, WL.r, w.z, 'tyre');
  // Heads sit inside the glasshouse (below its roof), reached only through a window.
  const head = new THREE.SphereGeometry(0.13, 12, 8);
  add(head, EYE.x, EYE.y, EYE.z - 0.04, 'head', 'driver');
  if (gunman) add(head, -EYE.x, EYE.y, EYE.z - 0.04, 'head', 'gunman');
  return vols;
}

/** Marks shots leave on a car: bullet holes and paint splats, stuck to it where they struck (the oldest go first). */
export class CarMarks {
  private readonly marks: THREE.Mesh[] = [];
  private static geo = new THREE.PlaneGeometry(1, 1);
  private static hole: THREE.MeshStandardMaterial | null = null;
  private static paints = new Map<number, THREE.MeshStandardMaterial>();

  constructor(private readonly obj: THREE.Object3D) {}

  add(point: THREE.Vector3, normal: THREE.Vector3, kind: 'bullet' | 'paint', color?: THREE.Color): void {
    const local = this.obj.worldToLocal(point.clone());
    const q = this.obj.getWorldQuaternion(new THREE.Quaternion()).invert();
    const n = normal.clone().applyQuaternion(q).normalize();
    const m = new THREE.Mesh(CarMarks.geo, kind === 'paint' ? CarMarks.paint(color!) : CarMarks.holeMat());
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.position.copy(local).addScaledVector(n, 0.012);
    m.scale.setScalar(kind === 'paint' ? 0.28 + Math.random() * 0.14 : 0.1);
    this.obj.add(m);
    this.marks.push(m);
    if (this.marks.length > 60) this.obj.remove(this.marks.shift()!);
  }

  clear(): void {
    for (const m of this.marks) this.obj.remove(m);
    this.marks.length = 0;
  }

  private static holeMat(): THREE.MeshStandardMaterial {
    CarMarks.hole ??= new THREE.MeshStandardMaterial({ map: decalTexture('hole'), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 });
    return CarMarks.hole;
  }

  private static paint(c: THREE.Color): THREE.MeshStandardMaterial {
    const key = c.getHex();
    let m = CarMarks.paints.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: decalTexture('splat'), color: c, transparent: true, depthWrite: false, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -4 });
      CarMarks.paints.set(key, m);
    }
    return m;
  }
}
