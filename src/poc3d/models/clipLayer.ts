import * as THREE from 'three';
import type { AnimLibrary } from './characterAnims';

/** The rate the library's fitted clips are sampled at (models/characterAnims.ts `RATE`). */
const CLIP_RATE = 30;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

interface Track {
  readonly bone: THREE.Bone;
  readonly q: Float32Array | null;
  readonly p: Float32Array | null;
}

/**
 * Lays clips from the animation library over a model's bones, each by its weight, after whatever pose is there: a gunman's (models/thug.ts
 * with a brain, models/gunmanBrain.ts), whose bones are otherwise posed by code. The clips are fitted to this model's own skeleton the first
 * time each is asked for (`AnimLibrary.clipFor`, keyed by `key`: the model's name, so copies of it share the fit), as `FirstPersonRig.layClip` does
 * for Mack. Nothing happens until the library is in (`ready`).
 */
export class ClipLayer {
  private readonly bones = new Map<string, THREE.Bone>();
  private readonly tracks = new Map<THREE.AnimationClip, Track[]>();
  private readonly pelvis: THREE.Bone | null;
  private readonly pelvisRest = new THREE.Vector3();
  anims: AnimLibrary | null = null;

  constructor(
    private readonly model: THREE.Object3D,
    private readonly key: string,
  ) {
    model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
    });
    this.pelvis = this.bones.get('pelvis') ?? null;
    if (this.pelvis) this.pelvisRest.copy(this.pelvis.position);
  }

  get ready(): boolean {
    return this.anims !== null;
  }

  /** The pelvis back where it rests (a clip moves it): before laying a frame's clips. */
  reset(): void {
    if (this.pelvis) this.pelvis.position.copy(this.pelvisRest);
  }

  /** How long a clip is (s); 0 if the library hasn't it. */
  lengthOf(name: string): number {
    return this.anims?.clips.find((c) => c.name === name)?.seconds ?? 0;
  }

  /** The clip `name` at `time` seconds over the bones, by `weight` (0 to 1). False if the library hasn't it or isn't in yet. */
  lay(name: string, time: number, weight: number): boolean {
    if (!this.anims || weight <= 0.001) return false;
    const fitted = this.anims.clipFor(this.key, this.model, name);
    if (!fitted || fitted.tracks.length === 0) return false;
    let tracks = this.tracks.get(fitted);
    if (!tracks) {
      tracks = [];
      for (const tr of fitted.tracks) {
        const dot = tr.name.lastIndexOf('.');
        const bone = this.bones.get(tr.name.slice(0, dot));
        const prop = tr.name.slice(dot + 1);
        if (!bone) continue;
        if (prop === 'quaternion') tracks.push({ bone, q: tr.values as Float32Array, p: null });
        else if (prop === 'position' && bone === this.pelvis) tracks.push({ bone, q: null, p: tr.values as Float32Array });
      }
      this.tracks.set(fitted, tracks);
    }
    const frames = fitted.tracks[0].times.length;
    const at = THREE.MathUtils.clamp(time * CLIP_RATE, 0, frames - 1);
    const i = Math.min(frames - 2, Math.floor(at));
    const u = at - i;
    const w = Math.min(1, weight);
    for (const tr of tracks) {
      if (tr.q) tr.bone.quaternion.slerp(_q.fromArray(tr.q, i * 4).slerp(_q2.fromArray(tr.q, (i + 1) * 4), u), w);
      else if (tr.p) tr.bone.position.lerp(_a.fromArray(tr.p, i * 3).lerp(_b.fromArray(tr.p, (i + 1) * 3), u), w);
    }
    return true;
  }
}
