import * as THREE from 'three';
import { loadPayphone, PayphoneRig, type PayphoneKind } from '../models/payphone';
import { EMIT, KIND, MeshBuilder } from './meshBuilder';

/**
 * The city's payphones, drawn (docs/street-furniture-plan.md): every one can be used, and a chunk's one merged mesh
 * can't lift one phone's handset, so they aren't in the chunks. The model knows where they stand (`Prop` kind
 * 'payphone', real/phoneSites.ts); this draws the ones near you with a few instanced meshes, as the traffic signals'
 * lamps are drawn: the Blender model within NEAR of you, its low version to MID (booths, which are 2.4 m of lit glass,
 * out to FAR), nothing beyond. A dozen draw calls however many phones the city has.
 *
 * The models are converted when the page loads to the city's material (`cityPhone`: one geometry a model on its
 * `KIND`s, colours from the model's own materials), so a phone takes the street's lamp light, the rain and the fog
 * like the vending machine beside it; only a booth's panes keep a see-through material of their own.
 *
 * The phone you stand at is **engaged**: its instance is left out and the same model, as separate parts on the same
 * material, stands in its place (`PayphoneRig`: the handset, the keys or the dial, the flap, a booth's door), so
 * district/payphone.ts can move them. One at a time.
 */
export const PHONE_KINDS: readonly PayphoneKind[] = ['payphone', 'payphone_booth', 'payphone_red', 'payphone_pink'];

/** A phone standing in the city: where, the way it faces (out from the wall behind it), and which (PHONE_KINDS). */
export interface PhoneSpot {
  readonly x: number;
  readonly z: number;
  readonly nx: number;
  readonly nz: number;
  readonly variant: number;
}

const NEAR = 30;
const MID = 150;
const FAR = 300;
/** The camera moves this far before the phones round it are counted again. */
const RESCAN = 4;
/** You engage the phone you come this near (its parts become movable), and let it go this far off. */
const ENGAGE = 3.6;
const RELEASE = 5.2;
const NEAR_MAX = 16;
const LOW_MAX = 192;

/** A model's faces on the city material: the brush for one of its materials; false for its glass. */
function brush(mb: MeshBuilder, m: THREE.MeshStandardMaterial): boolean {
  if (m.transparent || m.opacity < 0.99) return false;
  mb.style = [0, 0, 0, 0];
  const glow = (m.emissive.r + m.emissive.g + m.emissive.b) * m.emissiveIntensity;
  if (glow > 0.05) {
    // What lights itself (the display, the strip under the hood, the sign): always on, no brighter than a vending machine's band.
    const k = Math.min(1, m.emissiveIntensity) * 0.8;
    mb.kind = KIND.emit;
    mb.style = [EMIT.always, 0, 0, 0];
    mb.color = [m.emissive.r * k, m.emissive.g * k, m.emissive.b * k];
    return true;
  }
  mb.kind = m.metalness > 0.6 ? KIND.chrome : m.name === 'shell' ? KIND.gloss : KIND.plain;
  mb.color = [m.color.r, m.color.g, m.color.b];
  return true;
}

const meshesOf = (node: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  node.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

/** A mesh's triangles into a builder (and its glass into `glass`: positions and normals, three a corner), moved by `m`. */
function addMesh(mb: MeshBuilder, glass: number[], mesh: THREE.Mesh, m: THREE.Matrix4): void {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const idx = g.getIndex();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const solid = brush(mb, mesh.material as THREE.MeshStandardMaterial);
  const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const N = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = idx ? idx.getX(i + c) : i + c;
      P[c].fromBufferAttribute(pos, v).applyMatrix4(m);
      N[c].fromBufferAttribute(nor, v).applyMatrix3(nm).normalize();
    }
    if (solid) mb.tri(P[0].toArray(), P[1].toArray(), P[2].toArray(), N[0].toArray(), N[1].toArray(), N[2].toArray());
    else for (let c = 0; c < 3; c++) glass.push(P[c].x, P[c].y, P[c].z, N[c].x, N[c].y, N[c].z);
  }
}

function glassGeometry(data: readonly number[]): THREE.BufferGeometry | null {
  if (!data.length) return null;
  const n = data.length / 6;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos.set(data.slice(i * 6, i * 6 + 3), i * 3);
    nor.set(data.slice(i * 6 + 3, i * 6 + 6), i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** A payphone model as the city draws it. */
export interface CityPhone {
  /** All of it at rest but the glass, one geometry on the city material; and the glass, if it has any. */
  readonly body: THREE.BufferGeometry;
  readonly glass: THREE.BufferGeometry | null;
  /** The same model as its parts (the node names of scripts/blender/payphone.py), each on the city material: for a PayphoneRig. */
  readonly parts: () => THREE.Group;
}

/** The see-through panes of a booth (the city's own glass is a car's: near-black, and read as a solid panel). */
export function phoneGlassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xa8c2c4, transparent: true, opacity: 0.24, roughness: 0.12, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
}

/** Converts a loaded model (models/payphone.ts) to the city material. */
export function cityPhone(scene: THREE.Object3D, city: THREE.Material, glassMat: THREE.Material): CityPhone {
  scene.updateMatrixWorld(true);
  const root = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const whole = new MeshBuilder(4096);
  const wholeGlass: number[] = [];
  const nodes: { node: THREE.Object3D; body: THREE.BufferGeometry | null; glass: THREE.BufferGeometry | null }[] = [];
  for (const node of scene.children) {
    const own = new MeshBuilder(1024);
    const ownGlass: number[] = [];
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    for (const mesh of meshesOf(node)) {
      addMesh(whole, wholeGlass, mesh, new THREE.Matrix4().multiplyMatrices(root, mesh.matrixWorld));
      addMesh(own, ownGlass, mesh, new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    }
    nodes.push({ node, body: own.build(), glass: glassGeometry(ownGlass) });
  }
  return {
    body: whole.build()!,
    glass: glassGeometry(wholeGlass),
    parts: () => {
      const g = new THREE.Group();
      for (const { node, body, glass } of nodes) {
        const o = new THREE.Group();
        o.name = node.name;
        o.position.copy(node.position);
        o.quaternion.copy(node.quaternion);
        o.scale.copy(node.scale);
        if (body) {
          const m = new THREE.Mesh(body, city);
          m.receiveShadow = true;
          // (PayphoneRig leaves the city's one material alone.)
          m.userData.cityMat = true;
          o.add(m);
        }
        if (glass) {
          const m = new THREE.Mesh(glass, glassMat);
          m.renderOrder = 3;
          m.userData.cityMat = true;
          o.add(m);
        }
        // Its empties (where the cord enters the handset).
        for (const c of node.children) {
          if (meshesOf(c).length) continue;
          const e = new THREE.Object3D();
          e.name = c.name;
          e.position.copy(c.position);
          o.add(e);
        }
        g.add(o);
      }
      return g;
    },
  };
}

export class PayphoneField {
  readonly group = new THREE.Group();
  private readonly near: THREE.InstancedMesh[] = [];
  private readonly nearGlass: (THREE.InstancedMesh | null)[] = [];
  private readonly low: THREE.InstancedMesh[] = [];
  private readonly lowGlass: (THREE.InstancedMesh | null)[] = [];
  private readonly rigs: { root: THREE.Group; rig: PayphoneRig }[] = [];
  private readonly last = new THREE.Vector3(Infinity, 0, Infinity);
  private spots: PhoneSpot[] = [];
  private readonly m = new THREE.Matrix4();
  /** The phone you're standing at: its parts move (district/payphone.ts). */
  engaged: { readonly spot: PhoneSpot; readonly kind: PayphoneKind; readonly rig: PayphoneRig; readonly root: THREE.Group } | null = null;

  private constructor(
    models: readonly { full: CityPhone; low: CityPhone }[],
    city: THREE.Material,
    glassMat: THREE.Material,
    /** The ground's height under a phone (the land, and the pavement on it). */
    private readonly floorY: (x: number, z: number) => number,
    /** The phones within r of a point (District.propsNear, the payphones of it). */
    private readonly spotsNear: (x: number, z: number, r: number) => PhoneSpot[],
  ) {
    const inst = (g: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, order = 0): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(g, mat, n);
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.receiveShadow = true;
      im.renderOrder = order;
      im.name = name;
      this.group.add(im);
      return im;
    };
    models.forEach((k, i) => {
      const name = PHONE_KINDS[i];
      this.near.push(inst(k.full.body, city, NEAR_MAX, `${name}:near`));
      this.nearGlass.push(k.full.glass ? inst(k.full.glass, glassMat, NEAR_MAX, `${name}:near glass`, 3) : null);
      this.low.push(inst(k.low.body, city, LOW_MAX, `${name}:low`));
      this.lowGlass.push(k.low.glass ? inst(k.low.glass, glassMat, LOW_MAX, `${name}:low glass`, 3) : null);
      const root = k.full.parts();
      root.visible = false;
      this.group.add(root);
      this.rigs.push({ root, rig: new PayphoneRig(root) });
    });
  }

  /** Loads the four phones and their low versions and converts them. */
  static async load(city: THREE.Material, floorY: (x: number, z: number) => number, spotsNear: (x: number, z: number, r: number) => PhoneSpot[]): Promise<PayphoneField> {
    const glassMat = phoneGlassMaterial();
    const models = await Promise.all(
      PHONE_KINDS.map(async (kind) => {
        const [full, low] = await Promise.all([loadPayphone(kind), loadPayphone(kind, null, true)]);
        return { full: cityPhone(full, city, glassMat), low: cityPhone(low, city, glassMat) };
      }),
    );
    return new PayphoneField(models, city, glassMat, floorY, spotsNear);
  }

  private place(s: PhoneSpot): THREE.Matrix4 {
    return this.m.makeRotationY(Math.atan2(s.nx, s.nz)).setPosition(s.x, this.floorY(s.x, s.z), s.z);
  }

  /** Every phone near the camera, for looking them over (`?debug=1`'s `__phones`). */
  list(): readonly PhoneSpot[] {
    return this.spots;
  }

  /** Per frame: which phones are drawn and how, and which one you're at. `force`: count them again now. */
  update(camera: THREE.Vector3, force = false): void {
    let dirty = force;
    if (force || Math.hypot(camera.x - this.last.x, camera.z - this.last.z) > RESCAN) {
      this.last.copy(camera);
      this.spots = this.spotsNear(camera.x, camera.z, FAR);
      dirty = true;
    }
    // The phone you're at: the nearest within reach (the one you're already at counts until you've walked right off).
    const at = this.engaged?.spot;
    let best: PhoneSpot | null = null;
    let bd = Infinity;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - camera.x, s.z - camera.z);
      const held = at !== undefined && s.x === at.x && s.z === at.z;
      if (d < (held ? RELEASE : ENGAGE) && d < bd) [best, bd] = [s, d];
    }
    if (best && at && best.x === at.x && best.z === at.z) {
      // (A recount gives the same phone as a new object.)
      if (best !== at) this.engaged = { ...this.engaged!, spot: best };
    } else {
      if (this.engaged) this.engaged.root.visible = false;
      this.engaged = null;
      if (best) {
        const r = this.rigs[best.variant % this.rigs.length];
        r.root.matrixAutoUpdate = false;
        r.root.matrix.copy(this.place(best));
        r.root.matrixWorldNeedsUpdate = true;
        r.root.visible = true;
        this.engaged = { spot: best, kind: PHONE_KINDS[best.variant % PHONE_KINDS.length], rig: r.rig, root: r.root };
      }
      dirty = true;
    }
    if (!dirty) return;
    const count = this.near.map(() => [0, 0]);
    for (const s of this.spots) {
      if (s === this.engaged?.spot) continue;
      const v = s.variant % this.near.length;
      const d = Math.hypot(s.x - camera.x, s.z - camera.z);
      const booth = v === 1;
      if (d < NEAR && count[v][0] < NEAR_MAX) {
        const m = this.place(s);
        this.near[v].setMatrixAt(count[v][0], m);
        this.nearGlass[v]?.setMatrixAt(count[v][0], m);
        count[v][0]++;
      } else if ((d < MID || booth) && count[v][1] < LOW_MAX) {
        const m = this.place(s);
        this.low[v].setMatrixAt(count[v][1], m);
        this.lowGlass[v]?.setMatrixAt(count[v][1], m);
        count[v][1]++;
      }
    }
    count.forEach(([n, l], v) => {
      for (const [im, c] of [[this.near[v], n], [this.nearGlass[v], n], [this.low[v], l], [this.lowGlass[v], l]] as const) {
        if (!im) continue;
        im.count = c;
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
}
