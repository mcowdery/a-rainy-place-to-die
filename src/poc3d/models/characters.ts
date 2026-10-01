import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * The cast as modelled characters (the mob is real/people.ts). Each is a skinned glTF built in Blender
 * from MakeHuman (MPFB) by scripts/blender/ (definitions in scripts/blender/characters/*.json, output in
 * assets/characters/): a real body with the game_engine rig (Unreal mannequin bone names), facing +z,
 * feet at y 0, in an A-pose.
 *
 * Until they have authored animations, `Character.update` gives them a procedural idle over a relaxed base
 * pose (arms down from the A-pose, elbows soft): breathing, a slow weight shift, the head looking about.
 * Offsets are rotations about the figure's own axes, carried into each bone's parent space once from the
 * base pose, so they work whatever the rig's bone rolls are.
 */

const FILES = import.meta.glob('../../../assets/characters/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The characters that have been built (file names without .glb). */
export const CHARACTERS: readonly string[] = Object.keys(FILES).map((k) => k.replace(/^.*\/(.+)\.glb$/, '$1')).sort();

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
let envMap: THREE.Texture | null = null;

/**
 * Soft image-based light for the characters only (skin, eyes and hair look flat and staring under a few
 * point lights alone). Set before loading; the city's own materials don't use it.
 */
export function setCharacterEnvironment(tex: THREE.Texture | null): void {
  envMap = tex;
}

function source(name: string): Promise<THREE.Group> {
  let p = cache.get(name);
  if (!p) {
    const url = Object.entries(FILES).find(([k]) => k.endsWith(`/${name}.glb`))?.[1];
    if (!url) return Promise.reject(new Error(`no character '${name}' in assets/characters/`));
    p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        // Skinned meshes move out of their bind-pose bounds; the character is small, so skip the cull.
        m.frustumCulled = false;
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          const s = mat as THREE.MeshStandardMaterial;
          // Thin cloth (the apron, collars) shadows itself in stripes from its own lit side; casting from the
          // back faces keeps the acne off what you see.
          s.shadowSide = THREE.BackSide;
          if (envMap) {
            s.envMap = envMap;
            s.envMapIntensity = 0.35;
          }
          // Hair, brows and lashes are alpha cards: both sides, cut out rather than sorted.
          if (s.alphaTest > 0 || s.transparent) {
            s.side = THREE.DoubleSide;
            s.transparent = false;
            s.alphaTest = Math.max(s.alphaTest, 0.4);
            s.alphaToCoverage = true;
          }
        }
      });
      return g.scene;
    });
    cache.set(name, p);
  }
  return p;
}

/** Idle tuning: how much each motion moves (radians) and how fast (seconds a cycle). */
const IDLE = {
  breath: { period: 4.2, chest: 0.018, shoulders: 0.012 },
  sway: { period: 7.5, hips: 0.022 },
  look: { yaw: 0.16, pitch: 0.05 },
};

interface Animated {
  readonly bone: THREE.Bone;
  readonly base: THREE.Quaternion;
  /** The figure's x (right), y (up) and z (forward) axes in the bone's parent space at the base pose. */
  readonly axes: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Character {
  readonly root = new THREE.Group();
  private readonly bones = new Map<string, Animated>();
  private t: number;

  private constructor(readonly name: string, model: THREE.Object3D, seed: number) {
    this.root.name = `character:${name}`;
    this.root.add(model);
    this.t = seed * 37.1;
    const byName = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    this.relax(byName);
    model.updateMatrixWorld(true);
    // Record the base pose and each animated bone's figure axes (the model's own frame, root untransformed).
    const inv = new THREE.Quaternion();
    for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r']) {
      const bone = byName.get(n);
      if (!bone) continue;
      bone.parent!.getWorldQuaternion(inv).invert();
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(inv)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      this.bones.set(n, { bone, base: bone.quaternion.clone(), axes });
    }
  }

  /** Loads a character by name (a fresh copy with its own skeleton). */
  static async load(name: string, seed = 0): Promise<Character> {
    const src = await source(name);
    const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
    return new Character(name, clone(src), seed);
  }

  /** From the A-pose to standing at rest: upper arms down by the sides, forearms a little forward. */
  private relax(bones: Map<string, THREE.Bone>): void {
    for (const s of ['l', 'r'] as const) {
      const upper = bones.get(`upperarm_${s}`);
      const lower = bones.get(`lowerarm_${s}`);
      const hand = bones.get(`hand_${s}`);
      if (!upper || !lower || !hand) continue;
      upper.parent!.updateWorldMatrix(true, true);
      const a = upper.getWorldPosition(new THREE.Vector3());
      const b = lower.getWorldPosition(new THREE.Vector3());
      const out = Math.sign(b.x - a.x) || (s === 'l' ? 1 : -1);
      aim(upper, b.sub(a).normalize(), new THREE.Vector3(out * 0.13, -1, 0.02).normalize());
      upper.updateWorldMatrix(false, true);
      const c = lower.getWorldPosition(new THREE.Vector3());
      const d = hand.getWorldPosition(new THREE.Vector3());
      aim(lower, d.sub(c).normalize(), new THREE.Vector3(out * 0.05, -1, 0.22).normalize());
    }
  }

  /** Turns a bone about the figure's axis (0 x, 1 y, 2 z) by `angle`, on top of what's set this frame. */
  private turn(name: string, axis: 0 | 1 | 2, angle: number): void {
    const a = this.bones.get(name);
    if (!a || angle === 0) return;
    a.bone.quaternion.premultiply(_q.setFromAxisAngle(a.axes[axis], angle));
  }

  /** Advances the idle by dt seconds. */
  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    for (const a of this.bones.values()) a.bone.quaternion.copy(a.base);
    const breath = Math.sin((t / IDLE.breath.period) * Math.PI * 2);
    const sway = Math.sin((t / IDLE.sway.period) * Math.PI * 2);
    // Breathing: the chest rises and opens, the shoulders lift with it.
    this.turn('spine_03', 0, -IDLE.breath.chest * breath);
    this.turn('clavicle_l', 2, IDLE.breath.shoulders * breath);
    this.turn('clavicle_r', 2, -IDLE.breath.shoulders * breath);
    // The weight shifts from foot to foot: the hips tilt, the spine leans back to keep the head over them.
    this.turn('pelvis', 2, IDLE.sway.hips * sway);
    this.turn('spine_01', 2, -IDLE.sway.hips * 0.7 * sway);
    this.turn('spine_03', 2, -IDLE.sway.hips * 0.3 * sway);
    // Arms hang: they swing a touch with the sway and the breath.
    this.turn('upperarm_l', 0, 0.015 * breath + 0.01 * sway);
    this.turn('upperarm_r', 0, 0.015 * breath - 0.01 * sway);
    // Looking about: slow, overlapping waves, mostly the head with a little of the neck.
    const yaw = IDLE.look.yaw * (0.6 * Math.sin(t * 0.31) + 0.4 * Math.sin(t * 0.83 + 1.3));
    const pitch = IDLE.look.pitch * Math.sin(t * 0.47 + 0.6);
    this.turn('neck_01', 1, yaw * 0.35);
    this.turn('head', 1, yaw * 0.65);
    this.turn('head', 0, pitch);
  }
}

/** Rotates a bone so the direction `from` (world) points along `to` (world), keeping its parent. */
function aim(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3): void {
  const parent = bone.parent!.getWorldQuaternion(_q2);
  _q.setFromUnitVectors(_v.copy(from), _w.copy(to));
  // world' = q * world  =>  local' = parent^-1 * q * parent * local.
  const p = parent.clone();
  bone.quaternion.premultiply(p.clone().invert().multiply(_q).multiply(p));
}
