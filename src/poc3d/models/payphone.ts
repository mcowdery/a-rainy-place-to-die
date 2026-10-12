import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The modelled public telephone (公衆電話), built in Blender (`scripts/blender/payphone.py`, which says what each node
 * is): `assets/props/payphone/payphone.glb` (the green card-and-coin phone on a post under a hood) and
 * `payphone_booth.glb` (a booth with the phone on its back wall and a hinged door). Every part you touch is its own
 * node with its origin at the point it moves about, so a phone you can use is this model with its parts driven:
 * `PayphoneRig` holds the rest poses and sets each part's travel from 0 to 1.
 *
 * A candidate until the user approves it in the model showroom (models-buildings.html, the street furniture row); the
 * code-built versions in `real/props.ts` (`payphone`) are what the city's street furniture would use, one merged mesh
 * a chunk. This one is for the phone you walk up to.
 */
const FILES = import.meta.glob('/assets/props/payphone/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const urlOf = (name: string): string | undefined => Object.entries(FILES).find(([p]) => p.endsWith(`/${name}.glb`))?.[1];

export type PayphoneKind = 'payphone' | 'payphone_booth' | 'payphone_red' | 'payphone_pink';
/** The twelve keys, in the model's node names. */
export const PAYPHONE_KEYS = ['key_1', 'key_2', 'key_3', 'key_4', 'key_5', 'key_6', 'key_7', 'key_8', 'key_9', 'key_star', 'key_0', 'key_hash'] as const;

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * The model by name: a copy of its own (own nodes, shared geometry and materials) to place; `env` lights its paint.
 * `low`: the middle distance's version (`<kind>_low.glb`: one object, a few hundred triangles, nothing that moves).
 */
export function loadPayphone(kind: PayphoneKind, env: THREE.Texture | null = null, low = false): Promise<THREE.Object3D> {
  const file = low ? `${kind}_low` : kind;
  let p = cache.get(file);
  if (!p) {
    const url = urlOf(file);
    if (!url) return Promise.reject(new Error(`no ${file}.glb in assets/props/payphone/`));
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (env) {
          mat.envMap = env;
          mat.envMapIntensity = 0.5;
        }
      });
      return g.scene;
    });
    cache.set(file, p);
  }
  return p.then((scene) => scene.clone(true));
}

/** How far a key goes in (m), how far the handset comes off its hooks, and the flap and door's swing. */
const KEY_TRAVEL = 0.008;
const HANDSET_OUT = new THREE.Vector3(-0.12, 0.06, 0.3);
const HANDSET_TURN = new THREE.Euler(THREE.MathUtils.degToRad(-25), THREE.MathUtils.degToRad(20), 0);
const FLAP_OPEN = THREE.MathUtils.degToRad(-35);
const DOOR_OPEN = THREE.MathUtils.degToRad(-100);
/** The dial's furthest turn (the 0, the last hole round to the finger stop). */
const DIAL_TURN = THREE.MathUtils.degToRad(300);

const part = (root: THREE.Object3D, name: string): THREE.Object3D | undefined => root.getObjectByName(name) ?? undefined;

/**
 * Drives a loaded phone's parts. Each setter takes 0 (at rest) to 1 (fully moved) and leaves the others alone.
 * The cord is a fixed mesh in the rest pose: a game that lifts the handset draws its own between the two anchors
 * (`cordBody`, the node `cord_anchor_body`, and `cordHandset`, `cord_anchor_handset`, which moves with the handset).
 */
export class PayphoneRig {
  readonly handset?: THREE.Object3D;
  readonly hook?: THREE.Object3D;
  readonly flap?: THREE.Object3D;
  readonly door?: THREE.Object3D;
  /** The stand phone's finger wheel (it has no keys or display). */
  readonly dial?: THREE.Object3D;
  readonly display?: THREE.Object3D;
  readonly cord?: THREE.Object3D;
  readonly cordBody?: THREE.Object3D;
  readonly cordHandset?: THREE.Object3D;
  /** Where a player stands to use it (a node a metre in front, in the model's own frame). */
  readonly usePoint?: THREE.Object3D;
  private readonly keys = new Map<string, THREE.Object3D>();
  private readonly rest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();

  constructor(readonly root: THREE.Object3D) {
    this.handset = part(root, 'handset');
    this.hook = part(root, 'hook_switch');
    this.flap = part(root, 'coin_return');
    this.door = part(root, 'door');
    this.dial = part(root, 'dial');
    this.display = part(root, 'display');
    this.cord = part(root, 'cord');
    this.cordBody = part(root, 'cord_anchor_body');
    this.cordHandset = part(root, 'cord_anchor_handset');
    this.usePoint = part(root, 'use_point');
    for (const k of PAYPHONE_KEYS) {
      const o = part(root, k);
      if (o) this.keys.set(k, o);
    }
    for (const o of [this.handset, this.hook, this.flap, this.door, this.dial, ...this.keys.values()]) if (o) this.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
  }

  /** The handset: 0 on its hooks, 1 held out in front (the hook switch pops up as it leaves). */
  setHandset(k: number): void {
    const r = this.handset && this.rest.get(this.handset);
    if (this.handset && r) {
      this.handset.position.copy(r.p).addScaledVector(HANDSET_OUT, k);
      this.handset.quaternion.copy(r.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(HANDSET_TURN.x * k, HANDSET_TURN.y * k, 0)));
    }
    const h = this.hook && this.rest.get(this.hook);
    if (this.hook && h) this.hook.position.copy(h.p).z += 0.006 * Math.min(1, k * 4);
  }

  /** A key pressed in (1) or let go (0). `name` is one of PAYPHONE_KEYS. */
  setKey(name: string, k: number): void {
    const o = this.keys.get(name);
    const r = o && this.rest.get(o);
    if (o && r) o.position.copy(r.p).z -= KEY_TRAVEL * k;
  }

  /** The stand phone's dial: 0 at rest, 1 wound round to the finger stop (the 0); a digit d winds it (d or 10) / 10 of the way. */
  setDial(k: number): void {
    const r = this.dial && this.rest.get(this.dial);
    // (It faces +z; winding it is clockwise as you look at it.)
    if (this.dial && r) this.dial.quaternion.copy(r.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -DIAL_TURN * k));
  }

  /** The coin return flap: 0 shut, 1 open. */
  setFlap(k: number): void {
    const r = this.flap && this.rest.get(this.flap);
    if (this.flap && r) this.flap.quaternion.copy(r.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), FLAP_OPEN * k));
  }

  /** The booth's door: 0 shut, 1 open (it swings about its left edge). */
  setDoor(k: number): void {
    const r = this.door && this.rest.get(this.door);
    if (this.door && r) this.door.quaternion.copy(r.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), DOOR_OPEN * k));
  }

  /** The display's glow, 0 (dark) to 1 (as made). */
  setDisplay(k: number): void {
    this.display?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      // (In the city the parts are on the city's one material, which isn't this phone's to change: real/payphoneField.ts.)
      if (m && 'emissiveIntensity' in m && !(o as THREE.Mesh).userData.cityMat) {
        // The material is shared by every copy: give this one its own the first time.
        if (!(o as THREE.Mesh).userData.ownMat) {
          (o as THREE.Mesh).material = m.clone();
          (o as THREE.Mesh).userData.ownMat = true;
        }
        ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = k;
      }
    });
  }
}
