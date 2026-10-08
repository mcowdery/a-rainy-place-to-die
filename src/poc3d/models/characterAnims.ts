import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Authored animations for the modelled characters, from a library (assets/anims/, cut by scripts/anims/build.mjs
 * from Quaternius's Universal Animation Library 1 and 2, CC0: CREDITS.md), fitted to each character's own skeleton
 * as it's asked for.
 *
 * The library's mannequin and a character share bone names (the Unreal mannequin's) but not proportions, bone
 * rolls or rest pose (the mannequin rests in a T-pose, a character in MakeHuman's A-pose), so a clip's local
 * rotations can't be copied across. `retarget` carries each bone's turn in the world instead: how far the
 * mannequin's bone has turned from its rest is how far the character's turns from the same pose. "The same pose"
 * is the character's rest with its arms, legs, hands and fingers swung to point the way the mannequin's do; the
 * trunk, neck, head and collar bones are taken as already matching (their difference is build, not pose), and the
 * feet are only turned about the vertical, so a foot stays as flat as its own shape has it. The root's and the
 * pelvis's travel is scaled by leg length, so a short figure takes short steps.
 *
 * What it doesn't do: plant the feet. A clip made for the mannequin's hips and shoulders, played on a broader or
 * narrower body, lets the feet slide a little and the hands miss each other by the difference.
 */

/** The library's files by name (ual1, ual2); nothing is fetched until a clip is wanted. */
const FILES = import.meta.glob('/assets/anims/*.glb', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface AnimInfo {
  readonly name: string;
  /** The file it's from (ual1, ual2). */
  readonly pack: string;
  readonly seconds: number;
  /** Made to repeat (the library's `_Loop` clips). */
  readonly loop: boolean;
  /** Its root bone travels (the library's `_RM` clips): it carries the figure off and back at each repeat. */
  readonly rootMotion: boolean;
}

/** A skeleton at rest: bones parent first, each with its parent's index and where it sits in the model's space. */
export interface Rig {
  readonly names: readonly string[];
  readonly parent: readonly number[];
  readonly restQ: readonly THREE.Quaternion[];
  readonly restP: readonly THREE.Vector3[];
}

/** Frames a second a fitted clip is sampled at (the library's own rate). */
const RATE = 30;

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
/** A finger bone's track, by its name. */
const FINGER = /^(thumb|index|middle|ring|pinky)_/;
/** The bone each limb bone points at; how its direction at rest differs between the two skeletons is pose. */
const AIM: Record<string, string> = {};
for (const s of ['l', 'r']) {
  AIM[`upperarm_${s}`] = `lowerarm_${s}`;
  AIM[`lowerarm_${s}`] = `hand_${s}`;
  AIM[`thigh_${s}`] = `calf_${s}`;
  AIM[`calf_${s}`] = `foot_${s}`;
  for (const f of FINGERS) {
    AIM[`${f}_01_${s}`] = `${f}_02_${s}`;
    AIM[`${f}_02_${s}`] = `${f}_03_${s}`;
  }
}

/** How far a hand at ease closes each finger's three joints past the model's rest, knuckle first (degrees). (A
 * MakeHuman hand's rest is already 15 to 20 at the knuckle and about 10 at the next joint; three times these made a hook.) */
const EASE: Record<string, readonly [number, number, number]> = { index: [8, 18, 8], middle: [9, 24, 10], ring: [12, 25, 10], pinky: [14, 26, 12] };
/** How much of each finger's spread from the middle finger a hand at ease keeps; and how far the thumb comes in to the
 * hand, the bone of it in the palm and then the thumb itself. */
const SPREAD = 0.3;
const THUMB_IN = [0.35, 0.7];

/**
 * A hand at ease, as a walking person's hangs: each finger bone's rotation in its parent's space. A model's rest
 * pose has the fingers straight and fanned out (it's made for skinning, not for looking at), which on a walking
 * figure reads as a hand held stiffly open. Here the fingers come together (most of their spread from the middle
 * finger taken out), each curls towards the palm, the little finger most, and the thumb comes in beside the hand.
 * Worked out from where the model's own finger joints are, so it needs no knowledge of the rig's bone rolls.
 */
export function relaxedHand(rig: Rig): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  const ix = new Map(rig.names.map((n, i) => [n, i]));
  const dir = (a: number, b: number): THREE.Vector3 => new THREE.Vector3().subVectors(rig.restP[b], rig.restP[a]).normalize();
  for (const s of ['l', 'r']) {
    const hand = ix.get(`hand_${s}`);
    const chain = (f: string): number[] => [1, 2, 3].map((n) => ix.get(`${f}_0${n}_${s}`) ?? -1);
    const middle = chain('middle');
    const first = chain('index');
    const little = chain('pinky');
    if (hand === undefined || middle[0] < 0 || middle[1] < 0 || first[0] < 0 || little[0] < 0) continue;
    // The hand's own directions: along it, across it (little finger to first), and out of its flat.
    const along = dir(hand, middle[0]);
    const flat = new THREE.Vector3().subVectors(rig.restP[first[0]], rig.restP[little[0]]).cross(along).normalize();
    const across = new THREE.Vector3().crossVectors(along, flat);
    // Which way round `across` the fingers close: the way the rest pose's own slight curl goes; a hand with dead
    // straight fingers is told by its thumb, which sits to the palm's side.
    let closing = 0;
    for (const f of Object.keys(EASE)) {
      const c = chain(f);
      if (c.includes(-1)) continue;
      closing += new THREE.Vector3().crossVectors(dir(c[0], c[1]), dir(c[1], c[2])).dot(across);
    }
    const thumb = chain('thumb');
    if (Math.abs(closing) < 0.02 && thumb[1] >= 0) closing = new THREE.Vector3().subVectors(rig.restP[thumb[1]], rig.restP[hand]).dot(flat);
    const axis = across.clone().multiplyScalar(closing < 0 ? -1 : 1);
    const straight = dir(middle[0], middle[1]);

    /** Sets a chain's bones from the world turn each is given on top of its rest, the one before it carried along. */
    const pose = (bones: number[], turns: THREE.Quaternion[]): void => {
      const total = new THREE.Quaternion();
      let parentWorld = rig.restQ[rig.parent[bones[0]]].clone();
      bones.forEach((b, k) => {
        if (b < 0) return;
        total.multiply(turns[k]);
        const world = total.clone().multiply(rig.restQ[b]);
        out.set(rig.names[b], parentWorld.clone().invert().multiply(world));
        parentWorld = world;
      });
    };
    for (const [f, angles] of Object.entries(EASE)) {
      const c = chain(f);
      if (c[0] < 0 || c[1] < 0) continue;
      const own = dir(c[0], c[1]);
      const together = new THREE.Quaternion().setFromUnitVectors(own, own.clone().lerp(straight, 1 - SPREAD).normalize());
      const curl = angles.map((a) => new THREE.Quaternion().setFromAxisAngle(axis, (a * Math.PI) / 180));
      pose(c, [together.multiply(curl[0]), curl[1], curl[2]]);
    }
    if (thumb[0] >= 0 && thumb[1] >= 0 && thumb[2] >= 0) {
      // The thumb's first bone is the one inside the palm; what's seen of it starts at the second. At rest it
      // stands well out from the hand. At ease the bone in the palm comes in a little, and the thumb itself lies
      // by the first finger: mostly along the hand, a little to the palm's side.
      const inPalm = dir(thumb[0], thumb[1]);
      const seen = dir(thumb[1], thumb[2]);
      const base = new THREE.Quaternion().setFromUnitVectors(inPalm, inPalm.clone().lerp(along, THUMB_IN[0]).normalize());
      const now = seen.clone().applyQuaternion(base);
      const beside = along.clone().addScaledVector(new THREE.Vector3().crossVectors(axis, along), 0.3).normalize();
      const lie = new THREE.Quaternion().setFromUnitVectors(now, now.clone().lerp(beside, THUMB_IN[1]).normalize());
      // (Its tip bends about its own joints' axis, which isn't the fingers'.)
      const bend = new THREE.Vector3().crossVectors(inPalm, seen);
      const tip = bend.lengthSq() > 1e-4 ? new THREE.Quaternion().setFromAxisAngle(bend.normalize(), (14 * Math.PI) / 180) : new THREE.Quaternion();
      // (`pose` wants each turn as made before the one above it: `lie` is made after `base`.)
      pose(thumb, [base, base.clone().invert().multiply(lie).multiply(base), tip]);
    }
  }
  return out;
}

/** A fitted clip with the hands at ease throughout, in place of whatever its fingers did. */
function atEase(clip: THREE.AnimationClip, rig: Rig): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => !FINGER.test(t.name));
  for (const [name, q] of relaxedHand(rig)) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, clip.duration], [...q.toArray(), ...q.toArray()]));
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  out.userData.pace = clip.userData.pace;
  return out;
}

/** A rig from bones in the model's space (`world` gives a bone's rest matrix there), `root` first. */
export function rigFrom(root: THREE.Object3D, world: (bone: THREE.Object3D) => THREE.Matrix4): Rig {
  const names: string[] = [];
  const parent: number[] = [];
  const restQ: THREE.Quaternion[] = [];
  const restP: THREE.Vector3[] = [];
  const scale = new THREE.Vector3();
  const walk = (o: THREE.Object3D, p: number): void => {
    const i = names.length;
    names.push(o.name);
    parent.push(p);
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    world(o).decompose(v, q, scale);
    restQ.push(q);
    restP.push(v);
    for (const c of o.children) walk(c, i);
  };
  walk(root, -1);
  return { names, parent, restQ, restP };
}

/** A character's skeleton at rest, from its bind pose (whatever pose the model is in now). */
export function characterRig(model: THREE.Object3D): Rig | null {
  let skeleton: THREE.Skeleton | null = null;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh && (!skeleton || m.skeleton.bones.length > skeleton.bones.length)) skeleton = m.skeleton;
  });
  const sk = skeleton as THREE.Skeleton | null;
  if (!sk) return null;
  const root = sk.bones.find((b) => !(b.parent as THREE.Bone | null)?.isBone);
  if (!root) return null;
  const rest = new Map<THREE.Object3D, THREE.Matrix4>();
  sk.bones.forEach((b, i) => rest.set(b, sk.boneInverses[i].clone().invert()));
  return rigFrom(root, (b) => rest.get(b) ?? b.matrixWorld);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** A hand's frame at rest: along the hand to the middle finger's knuckle, across it from the little finger's to the index's. */
function handFrame(rig: Rig, index: Map<string, number>, side: string, out: THREE.Quaternion): boolean {
  const hand = index.get(`hand_${side}`);
  const mid = index.get(`middle_01_${side}`);
  const fore = index.get(`index_01_${side}`);
  const little = index.get(`pinky_01_${side}`);
  if (hand === undefined || mid === undefined || fore === undefined || little === undefined) return false;
  const along = _a.subVectors(rig.restP[mid], rig.restP[hand]).normalize();
  const across = _b.subVectors(rig.restP[fore], rig.restP[little]);
  const up = _c.crossVectors(across, along).normalize();
  across.crossVectors(along, up);
  out.setFromRotationMatrix(_m.makeBasis(along, up, across));
  return true;
}

/**
 * For each of the character's bones, what turns the mannequin's world rotation into its own
 * (`world = mannequin's world * fit`), or null where the mannequin has no such bone.
 */
function fit(source: Rig, target: Rig): { from: number[]; fit: (THREE.Quaternion | null)[] } {
  const si = new Map(source.names.map((n, i) => [n, i]));
  const ti = new Map(target.names.map((n, i) => [n, i]));
  const from = target.names.map((n) => si.get(n) ?? -1);
  // The world turn that takes each bone from the character's rest to the mannequin's pose.
  const align = target.names.map(() => new THREE.Quaternion());
  const dir = (rig: Rig, a: number, b: number, out: THREE.Vector3): THREE.Vector3 => out.subVectors(rig.restP[b], rig.restP[a]);
  target.names.forEach((name, i) => {
    const s = from[i];
    if (s < 0) return;
    const side = name.slice(-1);
    const aim = AIM[name];
    if (aim && ti.has(aim) && si.has(aim)) {
      align[i].setFromUnitVectors(dir(target, i, ti.get(aim)!, _a).normalize(), dir(source, s, si.get(aim)!, _b).normalize());
    } else if (/^(foot|ball)_/.test(name)) {
      // Heading only: the foot from ankle to ball, seen from above.
      const foot = ti.get(`foot_${side}`);
      const ball = ti.get(`ball_${side}`);
      const sFoot = si.get(`foot_${side}`);
      const sBall = si.get(`ball_${side}`);
      if (foot === undefined || ball === undefined || sFoot === undefined || sBall === undefined) return;
      const t = dir(target, foot, ball, _a).setY(0).normalize();
      const u = dir(source, sFoot, sBall, _b).setY(0).normalize();
      align[i].setFromUnitVectors(t, u);
    } else if (/^hand_/.test(name)) {
      const t = new THREE.Quaternion();
      const u = new THREE.Quaternion();
      if (handFrame(target, ti, side, t) && handFrame(source, si, side, u)) align[i].copy(u).multiply(t.invert());
      // (A source with no fingers, a motion capture's: the hand goes with the forearm.)
      else align[i].copy(align[target.parent[i]]);
    } else if (/_03_[lr]$/.test(name)) {
      // A fingertip has nothing to point at: it goes with the joint before it.
      align[i].copy(align[target.parent[i]]);
    }
  });
  return {
    from,
    fit: target.names.map((_, i) => (from[i] < 0 ? null : source.restQ[from[i]].clone().invert().multiply(align[i]).multiply(target.restQ[i]))),
  };
}

function legLength(rig: Rig): number {
  const i = (n: string): number => rig.names.indexOf(n);
  const [hip, knee, ankle] = [i('thigh_l'), i('calf_l'), i('foot_l')];
  if (hip < 0 || knee < 0 || ankle < 0) return 1;
  return rig.restP[hip].distanceTo(rig.restP[knee]) + rig.restP[knee].distanceTo(rig.restP[ankle]);
}

/**
 * A clip made on `source` (the mannequin), as a clip for `target` (a character): tracks by the character's bone
 * names, sampled at RATE. See the header for how.
 */
export function retarget(clip: THREE.AnimationClip, source: Rig, target: Rig): THREE.AnimationClip {
  const { from, fit: fits } = fit(source, target);
  const scale = legLength(target) / legLength(source);
  // (The library's keys are linear: a frame each, at RATE.)
  const tracks = new Map<string, THREE.Interpolant>(
    clip.tracks.map((t) => [t.name, t.name.endsWith('.quaternion') ? new THREE.QuaternionLinearInterpolant(t.times, t.values, 4) : new THREE.LinearInterpolant(t.times, t.values, t.getValueSize())]),
  );
  const sRoot = source.parent.indexOf(-1);
  const sPelvis = source.names.indexOf('pelvis');
  const tRoot = target.parent.indexOf(-1);
  const tPelvis = target.names.indexOf('pelvis');

  // The mannequin's rest in local terms, for the bones a clip leaves alone.
  const sLocalQ = source.restQ.map((q, i) => (source.parent[i] < 0 ? q.clone() : source.restQ[source.parent[i]].clone().invert().multiply(q)));
  const sLocalP = source.restP.map((p, i) => (source.parent[i] < 0 ? p.clone() : p.clone().sub(source.restP[source.parent[i]]).applyQuaternion(source.restQ[source.parent[i]].clone().invert())));
  const tLocalQ = target.restQ.map((q, i) => (target.parent[i] < 0 ? q.clone() : target.restQ[target.parent[i]].clone().invert().multiply(q)));

  const frames = Math.max(2, Math.round(clip.duration * RATE) + 1);
  const times = new Float32Array(frames);
  const quats = target.names.map((_, i) => (fits[i] ? new Float32Array(frames * 4) : null));
  const rootPos = new Float32Array(frames * 3);
  const pelvisPos = new Float32Array(frames * 3);

  const sQ = source.names.map(() => new THREE.Quaternion());
  const sP = source.names.map(() => new THREE.Vector3());
  const tQ = target.names.map(() => new THREE.Quaternion());
  const q = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const rootRestInv = source.restQ[sRoot].clone().invert();
  // Each foot's place ahead of the root and its height, frame by frame, for the pace the clip walks at.
  const sFeet = ['foot_l', 'foot_r'].map((n) => source.names.indexOf(n)).filter((i) => i >= 0);
  const ahead = sFeet.map(() => new Float32Array(frames));
  const height = sFeet.map(() => new Float32Array(frames));
  // The pelvis from the root, at rest, in the model's space.
  const sOff = sPelvis < 0 ? new THREE.Vector3() : source.restP[sPelvis].clone().sub(source.restP[sRoot]);
  const tOff = tPelvis < 0 ? new THREE.Vector3() : target.restP[tPelvis].clone().sub(target.restP[tRoot]);

  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / RATE);
    times[f] = f / RATE;
    // The mannequin's pose in the world at t.
    for (let i = 0; i < source.names.length; i++) {
      const name = source.names[i];
      const rot = tracks.get(`${name}.quaternion`);
      const pos = tracks.get(`${name}.position`);
      if (rot) q.fromArray(rot.evaluate(t) as unknown as number[]).normalize();
      else q.copy(sLocalQ[i]);
      if (pos) v.fromArray(pos.evaluate(t) as unknown as number[]);
      else v.copy(sLocalP[i]);
      const p = source.parent[i];
      if (p < 0) {
        sQ[i].copy(q);
        sP[i].copy(v);
      } else {
        sQ[i].multiplyQuaternions(sQ[p], q);
        sP[i].copy(v).applyQuaternion(sQ[p]).add(sP[p]);
      }
    }
    sFeet.forEach((i, k) => {
      ahead[k][f] = sP[i].z - sP[sRoot].z;
      height[k][f] = sP[i].y;
    });
    // The character's, bone by bone, parent first.
    for (let i = 0; i < target.names.length; i++) {
      const p = target.parent[i];
      const out = quats[i];
      if (!out) {
        if (p < 0) tQ[i].copy(target.restQ[i]);
        else tQ[i].multiplyQuaternions(tQ[p], tLocalQ[i]);
        continue;
      }
      tQ[i].multiplyQuaternions(sQ[from[i]], fits[i]!);
      if (p < 0) q.copy(tQ[i]);
      else q.copy(tQ[p]).invert().multiply(tQ[i]);
      // The same rotation has two signs: keep to the one nearer the frame before, so the blend between frames
      // doesn't go the long way round.
      if (f > 0 && out[(f - 1) * 4] * q.x + out[(f - 1) * 4 + 1] * q.y + out[(f - 1) * 4 + 2] * q.z + out[(f - 1) * 4 + 3] * q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      q.toArray(out, f * 4);
    }
    // The root's travel, scaled; then the pelvis from it: its own offset plus what the mannequin's has moved from
    // its rest, scaled, in the frame the root has turned to.
    v.copy(sP[sRoot]).sub(source.restP[sRoot]).multiplyScalar(scale).add(target.restP[tRoot]);
    v.toArray(rootPos, f * 3);
    if (sPelvis >= 0 && tPelvis >= 0) {
      turn.multiplyQuaternions(sQ[sRoot], rootRestInv);
      v.copy(sP[sPelvis]).sub(sP[sRoot]).applyQuaternion(q.copy(turn).invert()).sub(sOff).multiplyScalar(scale).add(tOff);
      // (Now in the model's space as if the root hadn't turned: into the root's own frame.)
      v.applyQuaternion(q.copy(target.restQ[tRoot]).invert());
      v.toArray(pelvisPos, f * 3);
    }
  }

  const out: THREE.KeyframeTrack[] = [];
  target.names.forEach((name, i) => {
    if (quats[i]) out.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quats[i]!));
  });
  if (quats[tRoot]) out.push(new THREE.VectorKeyframeTrack(`${target.names[tRoot]}.position`, times, rootPos));
  if (tPelvis >= 0 && quats[tPelvis]) out.push(new THREE.VectorKeyframeTrack('pelvis.position', times, pelvisPos));
  const fitted = new THREE.AnimationClip(clip.name, (frames - 1) / RATE, out);
  fitted.userData.pace = pace(ahead, height) * scale;
  return fitted;
}

/**
 * The speed over the ground a clip's legs walk at (m/s), 0 if they don't: a foot that's down goes back under the
 * body at the body's own speed, so it's the middle of the speeds the feet go back at while they're at their lowest.
 */
function pace(ahead: readonly Float32Array[], height: readonly Float32Array[]): number {
  const back: number[] = [];
  let frames = 0;
  ahead.forEach((z, k) => {
    const y = height[k];
    const floor = Math.min(...y) + 0.015;
    for (let f = 1; f < z.length; f++) {
      if (y[f] > floor || y[f - 1] > floor) continue;
      frames++;
      if (z[f] < z[f - 1]) back.push((z[f - 1] - z[f]) * RATE);
    }
  });
  // (Standing, a foot that's down stays where it is: most of its frames going back, and not slowly, is a walk.)
  if (frames < 4 || back.length < frames * 0.7) return 0;
  back.sort((a, b) => a - b);
  const mid = back[back.length >> 1];
  return mid > 0.15 ? mid : 0;
}

/** The speed to move a figure at so its feet don't slide under a fitted clip (m/s at the clip's own rate); 0 for one that stays put. */
export function clipPace(clip: THREE.AnimationClip): number {
  return typeof clip.userData.pace === 'number' ? clip.userData.pace : 0;
}

/** The library, loaded: the mannequin's rig and every clip as it was made. */
export class AnimLibrary {
  clips: readonly AnimInfo[] = [];
  private readonly source = new Map<string, { rig: Rig; clip: THREE.AnimationClip }>();
  private readonly fitted = new Map<string, THREE.AnimationClip>();

  constructor(packs: readonly { pack: string; scene: THREE.Object3D; animations: readonly THREE.AnimationClip[] }[]) {
    for (const p of packs) this.add(p.pack, p.scene, p.animations);
  }

  /** Adds a file's clips (a clip of a name already there is replaced, and anything fitted from the old one forgotten). */
  add(pack: string, scene: THREE.Object3D, animations: readonly THREE.AnimationClip[]): void {
    let root: THREE.Object3D | null = null;
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!root && o.name === 'Root') root = o;
    });
    if (!root) return;
    const rig = rigFrom(root, (b) => b.matrixWorld);
    const clips = this.clips.filter((c) => !animations.some((a) => a.name === c.name));
    for (const clip of animations) {
      this.source.set(clip.name, { rig, clip });
      for (const id of [...this.fitted.keys()]) if (id.split(':')[1] === clip.name) this.fitted.delete(id);
      clips.push({ name: clip.name, pack, seconds: clip.duration, loop: /_Loop$/.test(clip.name), rootMotion: /_RM$/.test(clip.name) });
    }
    this.clips = clips.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Adds the clips of a .glb that isn't one of the library's own (a take under review, served from debug-shots/). */
  async addFile(url: string): Promise<void> {
    const g = await new GLTFLoader().loadAsync(url);
    this.add(/([^/]+)\.glb$/.exec(url)?.[1] ?? 'extra', g.scene, g.animations);
  }

  /**
   * The clip fitted to a character's skeleton; `key` names the skeleton (the character's name), so copies share it.
   * `openHands` plays it with the hands at ease (`relaxedHand`) whatever its own fingers do: the library's walks and
   * its idle are made with the fists closed. A clip with no fingers of its own (a motion capture's) has them at ease
   * either way.
   */
  clipFor(key: string, model: THREE.Object3D, name: string, openHands = false): THREE.AnimationClip | null {
    const id = `${key}:${name}`;
    let clip = this.fitted.get(id) ?? null;
    if (!clip) {
      const src = this.source.get(name);
      const rig = characterRig(model);
      if (!src || !rig) return null;
      clip = retarget(src.clip, src.rig, rig);
      if (!clip.tracks.some((t) => FINGER.test(t.name))) clip = atEase(clip, rig);
      this.fitted.set(id, clip);
    }
    if (!openHands) return clip;
    let open = this.fitted.get(`${id}:open`) ?? null;
    if (!open) {
      const rig = characterRig(model);
      if (!rig) return clip;
      open = atEase(clip, rig);
      this.fitted.set(`${id}:open`, open);
    }
    return open;
  }
}

let library: Promise<AnimLibrary> | null = null;

/** The library, fetched the first time it's asked for (about 2.4 MB). */
export function animLibrary(): Promise<AnimLibrary> {
  if (!library) {
    const loader = new GLTFLoader();
    library = Promise.all(
      Object.entries(FILES)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(async ([path, url]) => {
          // A file that can't be had is left out, not the whole library with it. (A dev server lists these files
          // when it first reads this module, and with hot reloading off it doesn't list them again when one is
          // added, moved or removed: a file gone since then comes back as the page's own HTML. It happened: a file
          // moved out of the folder left a running server's city without any of Mack's moves, 2026-10-06.)
          try {
            const g = await loader.loadAsync(url);
            return { pack: /([^/]+)\.glb$/.exec(path)![1], scene: g.scene, animations: g.animations };
          } catch (err) {
            console.warn(`The animation library: ${path} couldn't be loaded and is left out (${String(err).slice(0, 80)})`);
            return null;
          }
        }),
    ).then((packs) => new AnimLibrary(packs.filter((p) => p !== null)));
  }
  return library;
}
