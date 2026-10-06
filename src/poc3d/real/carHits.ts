import * as THREE from 'three';
import { decalTexture } from '../../race/shooting';

/**
 * What a bullet does to a car, any car (yours, the ones that come after you, the traffic's): where a shot meets a
 * car it's cast against the car's own skin (not the coarse hit volumes, which only say a car was struck), and
 * leaves its mark there, a child of the car so it rides with it: a hole in the bodywork, or in glass a hole in a
 * web of cracks. What's glass is told from where on the body it is (the band of the glasshouse, between the waist
 * and the roof), or by the round meeting a side window's own pane. A side window takes `SHATTER` rounds and is gone (the pane hidden: race/carView.ts
 * `rollWindows` leaves a broken one out; `mend` puts everything back). The marks are seen from inside too, so a
 * round through your windscreen cracks it in front of you.
 */

export type Pane = 'front' | 'rear' | 'left' | 'right';

export interface CarHit {
  /** Where on the car's skin, and its outward normal (world). */
  readonly point: THREE.Vector3;
  readonly normal: THREE.Vector3;
  /** The same point in the car's own frame (z forward, x to its left). */
  readonly local: THREE.Vector3;
  /** Glass: which pane, how many rounds it has taken, and whether this one broke it out. */
  readonly pane: Pane | null;
  readonly count: number;
  readonly shattered: boolean;
}

/** Rounds a side window takes before it's gone, and the most marks a car keeps. */
const SHATTER = 2;
const MOST = 48;

/** A bullet hole in glass: a small dark hole, a pale crushed ring round it, long cracks running out and a few across. */
function crackTexture(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.translate(N / 2, N / 2);
  g.lineCap = 'round';
  const spokes = 11 + Math.floor(Math.random() * 5);
  const ends: [number, number][] = [];
  for (let i = 0; i < spokes; i++) {
    const a = ((i + Math.random() * 0.7) / spokes) * Math.PI * 2;
    const len = 46 + Math.random() * 72;
    g.strokeStyle = `rgba(238,244,247,${0.75 + Math.random() * 0.25})`;
    g.lineWidth = 1.6 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7);
    // (A crack wanders a little on its way out.)
    let x = 0;
    let y = 0;
    for (let s = 1; s <= 4; s++) {
      const b = a + (Math.random() - 0.5) * 0.22;
      x = Math.cos(b) * (len * s) / 4;
      y = Math.sin(b) * (len * s) / 4;
      g.lineTo(x, y);
    }
    g.stroke();
    ends.push([a, len]);
  }
  // Cracks across, from one spoke to the next, at a few distances out.
  g.lineWidth = 1.3;
  for (let i = 0; i < spokes; i++) {
    const [a0, l0] = ends[i];
    const [a1, l1] = ends[(i + 1) % spokes];
    for (const k of [0.25, 0.5, 0.78]) {
      if (Math.random() < 0.35) continue;
      const r = Math.min(l0, l1) * (k + (Math.random() - 0.5) * 0.12);
      g.strokeStyle = `rgba(232,240,244,${0.5 + Math.random() * 0.35})`;
      g.beginPath();
      g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      g.lineTo(Math.cos(a1) * r * 0.97, Math.sin(a1) * r * 0.97);
      g.stroke();
    }
  }
  const ring = g.createRadialGradient(0, 0, 3, 0, 0, 20);
  ring.addColorStop(0, 'rgba(240,246,248,0.95)');
  ring.addColorStop(0.5, 'rgba(232,240,244,0.5)');
  ring.addColorStop(1, 'rgba(232,240,244,0)');
  g.fillStyle = ring;
  g.beginPath();
  g.arc(0, 0, 20, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(6,7,8,0.95)';
  g.beginPath();
  g.arc(0, 0, 4.5, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface State {
  marks: THREE.Mesh[];
  panes: Record<Pane, number>;
}

const Z = new THREE.Vector3(0, 0, 1);

export class CarHits {
  private readonly ray = new THREE.Raycaster();
  private readonly cars = new WeakMap<THREE.Object3D, State>();
  /** A car's own skin, where it's known apart from what else rides in it (a driver, a cabin): else the whole car is tried. */
  private readonly skins = new WeakMap<THREE.Object3D, THREE.Mesh>();
  private readonly geo = new THREE.PlaneGeometry(1, 1);
  private hole: THREE.MeshStandardMaterial | null = null;
  private cracks: THREE.MeshStandardMaterial[] = [];

  /** Says which mesh is a car's body (your car, a chase car): its side windows are that mesh's `userData.windows`, if it has them. */
  skin(car: THREE.Object3D, body: THREE.Mesh, windows?: { left: THREE.Mesh | null; right: THREE.Mesh | null }): void {
    this.skins.set(car, body);
    body.userData.windows = windows;
  }

  /** A shot from `origin` along `dir` that has met `car`: its mark on the car's skin, or null if it passes the skin by. */
  strike(car: THREE.Object3D, origin: THREE.Vector3, dir: THREE.Vector3): CarHit | null {
    car.updateWorldMatrix(true, true);
    const skin = this.skins.get(car);
    this.ray.set(origin, dir);
    this.ray.far = 400;
    // (A car whose skin is known: that, and its side windows' panes, which are meshes of their own.)
    const panes = skin?.userData.windows as { left: THREE.Mesh | null; right: THREE.Mesh | null } | undefined;
    const targets: THREE.Object3D[] = skin ? [skin, ...[panes?.left, panes?.right].filter((p): p is THREE.Mesh => !!p)] : [car];
    const met = this.ray.intersectObjects(targets, !skin).find((h) => {
      const o = h.object as THREE.Mesh;
      if (!o.isMesh || (o as unknown as THREE.SkinnedMesh).isSkinnedMesh || o.userData.mark || o.userData.part) return false;
      for (let p: THREE.Object3D | null = o; p && p !== car.parent; p = p.parent) if (!p.visible) return false;
      const m = o.material as THREE.Material;
      return !!h.face && !(m.transparent && m.blending === THREE.AdditiveBlending);
    });
    if (!met?.face) return null;
    const mesh = met.object as THREE.Mesh;
    const normal = met.face.normal.clone().transformDirection(mesh.matrixWorld);
    if (normal.dot(dir) > 0) normal.negate();
    const local = car.worldToLocal(met.point.clone());
    const n = normal.clone().transformDirection(car.matrixWorld.clone().invert());
    // Glass: a window's own pane, or the body in the band of the glasshouse (above the waist, below the roof: the
    // screens are raked too far back to tell by which way they face).
    const body = skin ?? mesh;
    body.geometry.boundingBox ?? body.geometry.computeBoundingBox();
    const box = body.geometry.boundingBox!;
    const onBody = body.worldToLocal(met.point.clone());
    const up = (onBody.y - box.min.y) / Math.max(0.1, box.max.y - box.min.y);
    const own: Pane | null = mesh === panes?.left ? 'left' : mesh === panes?.right ? 'right' : null;
    const glass = !!own || (up > 0.67 && up < 0.94);
    const pane: Pane | null = own ?? (!glass ? null : Math.abs(n.x) > Math.abs(n.z) ? (n.x > 0 ? 'left' : 'right') : n.z > 0 ? 'front' : 'rear');
    let st = this.cars.get(car);
    if (!st) this.cars.set(car, (st = { marks: [], panes: { front: 0, rear: 0, left: 0, right: 0 } }));
    const count = pane ? ++st.panes[pane] : 0;
    const windows = body.userData.windows as { left: THREE.Mesh | null; right: THREE.Mesh | null } | undefined;
    const side = pane === 'left' || pane === 'right' ? windows?.[pane] : null;
    const shattered = !!side && count === SHATTER;
    if (shattered) side!.userData.broken = true;
    // (A window that's gone takes no more marks: the round goes through the opening.)
    if (!(side && count > SHATTER)) {
      const m = new THREE.Mesh(this.geo, pane ? this.crack() : this.holeMat());
      m.userData.mark = true;
      m.userData.pane = pane;
      m.quaternion.setFromUnitVectors(Z, n);
      m.rotateZ(Math.random() * Math.PI * 2);
      m.position.copy(local).addScaledVector(n, 0.008);
      m.scale.setScalar(pane ? 0.42 + Math.random() * 0.2 : 0.09);
      m.renderOrder = 3;
      car.add(m);
      st.marks.push(m);
      if (st.marks.length > MOST) car.remove(st.marks.shift()!);
    }
    // (A pane that's broken out takes its cracks with it.)
    if (shattered) {
      for (const k of st.marks) if (k.userData.pane === pane) car.remove(k);
      st.marks = st.marks.filter((k) => k.userData.pane !== pane);
    }
    return { point: met.point.clone(), normal, local, pane, count, shattered };
  }

  /** As new: the marks off, the windows back. */
  mend(car: THREE.Object3D): void {
    const st = this.cars.get(car);
    for (const m of st?.marks ?? []) car.remove(m);
    this.cars.delete(car);
    const w = this.skins.get(car)?.userData.windows as { left: THREE.Mesh | null; right: THREE.Mesh | null } | undefined;
    for (const p of [w?.left, w?.right]) if (p) p.userData.broken = false;
  }

  private holeMat(): THREE.MeshStandardMaterial {
    this.hole ??= new THREE.MeshStandardMaterial({ map: decalTexture('hole'), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4 });
    return this.hole;
  }

  /** One of a few webs of cracks (seen from both sides: from the driver's seat too). */
  private crack(): THREE.MeshStandardMaterial {
    if (this.cracks.length < 4) this.cracks.push(new THREE.MeshStandardMaterial({ map: crackTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.25 }));
    return this.cracks[Math.floor(Math.random() * this.cracks.length)];
  }
}
