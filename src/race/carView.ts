import * as THREE from 'three';
import { addVehicle, addWheel, wheelLayout } from '../poc3d/models/vehicles';
import { MeshBuilder } from '../poc3d/real/meshBuilder';
import { decalTexture } from './shooting';
import type { Car, Ground } from './vehicle';

/**
 * How a coupe looks on a venue: the showroom's sports car on the city material with its wheels apart (they
 * roll, steer, spin up and lock), posed on the ground (pitched and rolled by the slope and the load), its
 * headlights, the invisible volumes shots strike, and the marks hits leave on it.
 */

const WL = wheelLayout('sports');
const wheelGeos = new Map<1 | -1, THREE.BufferGeometry>();
const wheelGeo = (sd: 1 | -1): THREE.BufferGeometry => {
  let g = wheelGeos.get(sd);
  if (!g) {
    const wb = new MeshBuilder(1 << 14);
    addWheel(wb, WL.r, WL.tw, sd, WL.rims);
    g = wb.build()!;
    wheelGeos.set(sd, g);
  }
  return g;
};

export interface CarView {
  /** Placed and turned like the car; the body is its child (hidden for the bumper camera). */
  readonly obj: THREE.Group;
  readonly body: THREE.Mesh;
  readonly wheels: { m: THREE.Mesh; front: boolean; roll: number }[];
}

export function buildCar(paint: number, material: THREE.Material): CarView {
  const mb = new MeshBuilder(1 << 17);
  addVehicle(mb, { x: 0, z: 0, fx: 0, fz: 1, type: 'sports', paint, detail: 0.05, wheels: false });
  const body = new THREE.Mesh(mb.build()!, material);
  const obj = new THREE.Group();
  obj.rotation.order = 'YXZ';
  obj.add(body);
  const wheels = WL.spots.map((w) => {
    const m = new THREE.Mesh(wheelGeo(w.sd), material);
    m.position.set(w.x, w.y, w.z);
    m.rotation.order = 'YXZ';
    body.add(m);
    return { m, front: w.front, roll: 0 };
  });
  return { obj, body, wheels };
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
    const rate = wh.front ? c.u / WL.r : c.handbrake ? 0 : (c.u / WL.r) * (1 + c.spin * 2.5) + c.spin * 25;
    wh.roll = (wh.roll + rate * dt) % (Math.PI * 2);
    wh.m.rotation.set(wh.roll, wh.front ? c.steer : 0, 0);
  }
}

/**
 * What shots strike: the lower body and the glasshouse above it (a hit there is through the glass), as
 * invisible boxes in the car's frame, tagged with `id` (and `glass`).
 */
export function hitVolumes(obj: THREE.Object3D, id: string): THREE.Mesh[] {
  const mat = new THREE.MeshBasicMaterial();
  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.8, 4.3), mat);
  lower.position.set(0, 0.6, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.34, 1.9), mat);
  glass.position.set(0, 1.08, -0.25);
  const boxes = [lower, glass];
  boxes.forEach((b, i) => {
    b.visible = false;
    b.userData = { id, glass: i === 1 };
    obj.add(b);
  });
  return boxes;
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
