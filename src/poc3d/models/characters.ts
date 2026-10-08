import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { edition } from '@edition';
import { faceDepth, isFaceless, shadowFace } from './faceShadow';

/**
 * The cast as modelled characters (the mob is real/people.ts). Each is a skinned glTF built in Blender
 * from MakeHuman (MPFB) by scripts/blender/ (definitions in scripts/blender/characters/*.json, output in
 * assets/characters/): a real body with the game_engine rig (Unreal mannequin bone names), facing +z,
 * feet at y 0, in an A-pose.
 *
 * Until they have authored animations, `Character.update` gives them a procedural idle over a relaxed base
 * pose (arms down from the A-pose, elbows soft): breathing, a slow weight shift, the head looking about; and,
 * with `walk` above 0, a walk (the thighs swung, the knees bent as each leg comes through, the arms against
 * the legs), for whoever moves the figure along (`strideLength` says how far a stride takes it).
 * Offsets are rotations about the figure's own axes, carried into each bone's parent space once from the
 * base pose, so they work whatever the rig's bone rolls are.
 *
 * A model built with expressions (build_character.py's `expressions`: morph targets, the rig has no bones in the
 * face) also blinks by itself, holds whatever `express` gives it (a smile, raised brows) and moves its mouth while
 * `talking` is set. One without them does none of that and nothing breaks.
 */

/** The built models by name, as this edition ships them (src/edition: the demo leaves some out). */
const FILES = edition.characters;

/** The characters that have been built (file names without .glb). */
export const CHARACTERS: readonly string[] = Object.keys(FILES).sort();

/** Models from elsewhere, loaded by name like the cast's (the MakeHuman test page's crowd, assets/humans/). */
const EXTRA = new Map<string, string>();
export function registerCharacters(files: Readonly<Record<string, string>>): void {
  for (const [name, url] of Object.entries(files)) EXTRA.set(name, url);
}

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
    const url = FILES[name] ?? EXTRA.get(name);
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
      if (isFaceless(name)) shadowFace(g.scene);
      return g.scene;
    });
    cache.set(name, p);
  }
  return p;
}

/** A fresh copy of a character's model with its own skeleton, in its rest pose (A-pose), for posing yourself. */
export async function loadCharacterModel(name: string): Promise<THREE.Object3D> {
  const src = await source(name);
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const copy = clone(src);
  faceDepth(copy);
  return copy;
}

/** Idle tuning: how much each motion moves (radians) and how fast (seconds a cycle). */
const IDLE = {
  breath: { period: 4.2, chest: 0.018, shoulders: 0.012 },
  sway: { period: 7.5, hips: 0.022 },
  look: { yaw: 0.16, pitch: 0.05 },
};
/** The walk: how far each thigh swings either way, the knee's bend standing on it and coming through, the arms'
 * swing and the elbow's bend, the hips' turn (radians). */
const GAIT = { thigh: 0.4, knee: 0.12, lift: 0.75, arm: 0.3, elbow: 0.3, hips: 0.07 };
/** The face: a blink every `every` seconds (between the two), shut over `close`, held, open again over `open`; the
 * mouth's shapes while talking, each for `syllable` seconds (between the two), `rest` of them a closed mouth. */
const FACE = { every: [2.2, 6.5], close: 0.07, hold: 0.045, open: 0.14, syllable: [0.085, 0.19], rest: 0.22, ease: 16 } as const;
const VOWELS = ['a', 'i', 'u', 'e', 'o'] as const;

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
  /** How much of a walk he's in: 0 standing, 1 walking (eased by whoever moves him). */
  walk = 0;
  /** Strides a second (a stride is a step with each foot), and where in the stride he is (radians). */
  cadence = 0.85;
  phase: number;
  /** How far one stride carries him at a full walk (m): move him `strideLength * cadence` a second and his feet
   * don't slide. */
  readonly strideLength: number;
  private readonly model: THREE.Object3D;
  private readonly legLength: number;
  /** An authored clip playing in place of the idle and the walk (`play`). */
  private mixer: THREE.AnimationMixer | null = null;
  private action: THREE.AnimationAction | null = null;
  /** The meshes with the face's morph targets (the skin, the lashes, the teeth), and each target's value now. */
  private readonly faces: THREE.Mesh[] = [];
  private readonly shown = new Map<string, number>();
  private held: Readonly<Record<string, number>> = {};
  /** Moving the mouth as if speaking (a model with expressions only). */
  talking = false;
  private blinkIn: number;
  private blinkAt = -1;
  private vowel = '';
  private vowelAmount = 0;
  private vowelFor = 0;
  private seed: number;

  private constructor(readonly name: string, model: THREE.Object3D, seed: number) {
    this.root.name = `character:${name}`;
    this.root.add(model);
    this.seed = (Math.floor(seed * 7919) % 233280) + 1;
    this.blinkIn = 0.5 + this.random() * 4;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.morphTargetDictionary || !m.morphTargetInfluences) return;
      this.faces.push(m);
      for (const key of Object.keys(m.morphTargetDictionary)) this.shown.set(key, 0);
    });
    this.t = seed * 37.1;
    this.phase = seed * 2.4;
    this.model = model;
    const byName = new Map<string, THREE.Bone>();
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });
    this.relax(byName);
    model.updateMatrixWorld(true);
    // Record the base pose and each animated bone's figure axes (the model's own frame, root untransformed).
    const inv = new THREE.Quaternion();
    for (const n of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r']) {
      const bone = byName.get(n);
      if (!bone) continue;
      bone.parent!.getWorldQuaternion(inv).invert();
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => a.applyQuaternion(inv)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      this.bones.set(n, { bone, base: bone.quaternion.clone(), axes });
    }
    // The leg from hip to ankle (a child's is short: more strides to the metre).
    const hip = byName.get('thigh_l');
    const ankle = byName.get('foot_l');
    this.legLength = hip && ankle ? hip.getWorldPosition(new THREE.Vector3()).distanceTo(ankle.getWorldPosition(new THREE.Vector3())) : 0.8;
    this.strideLength = 4 * this.legLength * Math.sin(GAIT.thigh);
  }

  /** Loads a character by name (a fresh copy with its own skeleton). */
  static async load(name: string, seed = 0): Promise<Character> {
    return new Character(name, await loadCharacterModel(name), seed);
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

  /**
   * Plays a clip from the animation library (models/characterAnims.ts, fitted to this skeleton) in place of the
   * procedural idle and walk, blending from whatever clip was playing over `fade` seconds; null goes back to them.
   * Returns the action, for whoever wants its speed, time or pause (null if there's no such clip). `openHands`
   * plays it without its fingers, the hands left loosely open as the model has them (the library's walks close them
   * into fists).
   */
  async play(clip: string | null, fade = 0.2, openHands = false): Promise<THREE.AnimationAction | null> {
    if (clip === null) {
      this.mixer?.stopAllAction();
      this.action = null;
      return null;
    }
    const { animLibrary } = await import('./characterAnims');
    const lib = await animLibrary();
    const fitted = lib.clipFor(this.name, this.model, clip, openHands);
    if (!fitted) return null;
    this.mixer ??= new THREE.AnimationMixer(this.model);
    const next = this.mixer.clipAction(fitted);
    if (next === this.action) return next;
    next.reset().play();
    if (this.action && fade > 0) next.crossFadeFrom(this.action, fade, false);
    else this.action?.stop();
    this.action = next;
    this.model.position.y = 0;
    return next;
  }

  /** The speed over the ground a library clip walks at on this figure (m/s; 0 if it stays put or there's no such clip). */
  async pace(clip: string): Promise<number> {
    const { animLibrary, clipPace } = await import('./characterAnims');
    const fitted = (await animLibrary()).clipFor(this.name, this.model, clip);
    return fitted ? clipPace(fitted) : 0;
  }

  /** Whether the model has a face that moves (it was built with expressions). */
  get hasFace(): boolean {
    return this.faces.length > 0;
  }

  /** The expression held from now on, eased into: the morph targets by name and how much of each (`{ smile: 1 }`,
   * `{ brow_sad: 0.8, smile: 0.2 }`); null or nothing for a face at rest. Blinking and talking go on over it. */
  express(mix: Readonly<Record<string, number>> | null): void {
    this.held = mix ?? {};
  }

  private random(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  /** The face for this frame: what's held, a blink when one is due, the mouth's shapes while talking. */
  private face(dt: number): void {
    if (this.faces.length === 0) return;
    // Blinking: shut fast, held a moment, open a little slower.
    let blink = 0;
    if (this.blinkAt < 0) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) this.blinkAt = 0;
    } else {
      this.blinkAt += dt;
      const t = this.blinkAt;
      if (t < FACE.close) blink = t / FACE.close;
      else if (t < FACE.close + FACE.hold) blink = 1;
      else if (t < FACE.close + FACE.hold + FACE.open) blink = 1 - (t - FACE.close - FACE.hold) / FACE.open;
      else {
        this.blinkAt = -1;
        // (Now and then two blinks close together.)
        this.blinkIn = this.random() < 0.15 ? 0.25 : FACE.every[0] + this.random() * (FACE.every[1] - FACE.every[0]);
      }
    }
    // Talking: a vowel's shape at a time, of different lengths and sizes, with the mouth shut between some.
    if (this.talking) {
      this.vowelFor -= dt;
      if (this.vowelFor <= 0) {
        this.vowelFor = FACE.syllable[0] + this.random() * (FACE.syllable[1] - FACE.syllable[0]);
        const rest = this.random() < FACE.rest;
        this.vowel = rest ? '' : VOWELS[Math.floor(this.random() * VOWELS.length)];
        this.vowelAmount = 0.45 + this.random() * 0.55;
      }
    } else this.vowel = '';
    const k = Math.min(1, dt * FACE.ease);
    for (const [key, now] of this.shown) {
      let want = this.held[key] ?? 0;
      if (key === this.vowel) want = Math.max(want, this.vowelAmount);
      let v = now + (want - now) * k;
      if (Math.abs(v) < 1e-4 && want === 0) v = 0;
      this.shown.set(key, v);
    }
    for (const m of this.faces) {
      const at = m.morphTargetDictionary!;
      const out = m.morphTargetInfluences!;
      for (const [key, v] of this.shown) {
        const i = at[key];
        if (i !== undefined) out[i] = key === 'blink' ? Math.max(v, blink) : v;
      }
    }
  }

  /** Advances the idle (or the clip that's playing) by dt seconds. */
  update(dt: number): void {
    this.t += dt;
    this.face(dt);
    if (this.mixer && this.action) {
      this.mixer.update(dt);
      return;
    }
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
    this.stride(dt);
  }

  /** The walk, over the idle: by `walk`, at `cadence`. (About the figure's x a hanging limb swings forward with a
   * negative angle.) */
  private stride(dt: number): void {
    const w = this.walk;
    if (w <= 0) {
      this.model.position.y = 0;
      return;
    }
    this.phase += dt * Math.PI * 2 * this.cadence;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    for (const [side, k] of [['l', 1], ['r', -1]] as const) {
      // The left thigh is forward at sin 1, the right at -1; each knee bends as its leg comes through.
      const thigh = -GAIT.thigh * s * k * w;
      const knee = (GAIT.knee + GAIT.lift * Math.max(0, c * k) ** 1.5) * w;
      this.turn(`thigh_${side}`, 0, thigh - GAIT.knee * 0.5 * w);
      this.turn(`calf_${side}`, 0, knee);
      // The foot stays near level: it takes back most of what the leg above it turned.
      this.turn(`foot_${side}`, 0, -(thigh + knee) * 0.6);
      // The arms swing against the legs, the elbow bending as the arm comes forward.
      const arm = GAIT.arm * s * k * w;
      this.turn(`upperarm_${side}`, 0, arm);
      this.turn(`lowerarm_${side}`, 0, -(GAIT.elbow * 0.5 + GAIT.elbow * Math.max(0, -s * k)) * w);
    }
    // The hips turn with the leading leg, the chest against them; a slight lean into the walk.
    this.turn('pelvis', 1, -GAIT.hips * s * w);
    this.turn('spine_02', 1, GAIT.hips * 1.6 * s * w);
    this.turn('spine_01', 0, 0.035 * w);
    // With the legs apart the hips are lower: the body comes down by what the legs' spread takes off their height.
    this.model.position.y = -this.legLength * (1 - Math.cos(GAIT.thigh * s * w)) - 0.012 * w;
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
