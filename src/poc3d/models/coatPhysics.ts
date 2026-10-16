import * as THREE from 'three';

/**
 * A coat skirt that hangs: chains of bones round the hips (scripts/coatBones.mjs puts them in the model: `coat_<chain>_<bone>`,
 * the skirt's vertices skinned to them), each simulated as a short verlet chain in the world, hung from the pelvis, pulled a
 * little toward where the pelvis alone would hold it, pushed out of the legs and the floor. Run it after the animation each frame
 * (`update`); it sets the chain bones' transforms and nothing else.
 *
 * Why: the trench's skirt was skinned to the pelvis and the thighs only, so it swung rigidly with a thigh, through the other leg
 * in a stride and through the floor in a crouch. This is the cheap version of cloth: three points a chain, ten chains, a few
 * capsules; no cloth-on-cloth, no arms. Its cost is a few hundred vector operations a frame for each coated figure.
 *
 * Assumptions, said once: the model is in its bind pose when this is made (rest places are read then), at scale 1 (lengths are
 * in world metres), and the floor is the model's own origin height.
 */

export interface CoatOptions {
  /** Pull toward the pelvis-rigid rest shape, a second, per bone from the top (a rate: higher is stiffer). */
  stiffness: readonly number[];
  /** Velocity kept each step (1 keeps all, lower is thicker air). */
  damping: number;
  /** Gravity (m/s²). */
  gravity: number;
  /** How far outside a leg's skin (metres) the cloth is kept: the coat's thickness over the trousers. */
  clearance: number;
  /** Pelvis speed (m/s) beyond which the chains aren't followed but put back at rest (a teleport, a cut). */
  teleport: number;
}

export const COAT: CoatOptions = { stiffness: [6, 3, 1.5], damping: 0.985, gravity: 9.8, clearance: 0.025, teleport: 12 };

/** A leg bone pair as a capsule, in world space each step. */
interface Capsule {
  a: THREE.Object3D;
  b: THREE.Object3D;
  /** Radius at the a end and at the b end (m): the limb's own, before the clearance. */
  ra: number;
  rb: number;
}

const STEP = 1 / 90;
const MAX_STEPS = 6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
// (axisDistance's own: it's called from inside loops that hold the others)
const _pa = new THREE.Vector3();
const _pab = new THREE.Vector3();
const _axis = new THREE.Vector3();

export class CoatPhysics {
  /** Chain bones, chain by chain, top to hem. */
  private readonly bones: THREE.Object3D[][] = [];
  private readonly pelvis: THREE.Object3D;
  private readonly model: THREE.Object3D;
  /** Rest places in the pelvis's own frame: the chain's top (at the hip line) and each bone's head. */
  private readonly top: THREE.Vector3[] = [];
  private readonly rest: THREE.Vector3[][] = [];
  /** Rest length of each link from the one above (the first from the chain's top). */
  private readonly length: number[][] = [];
  private readonly pelvisRestQ = new THREE.Quaternion();
  private readonly restDir: THREE.Vector3[][] = [];
  /** Particles: world places now and a step before, a chain's bone k at [k]. */
  private readonly pos: THREE.Vector3[][] = [];
  private readonly prev: THREE.Vector3[][] = [];
  private readonly capsules: Capsule[] = [];
  /** How far a particle may be from each capsule's axis (m): the coat's own distance at rest if that's less than the limb plus clearance. */
  private readonly keep: number[][][] = [];
  private lastPelvis = new THREE.Vector3();
  private fresh = true;
  private left = 0;
  options: CoatOptions = { ...COAT };

  private constructor(model: THREE.Object3D, bones: THREE.Object3D[][], pelvis: THREE.Object3D) {
    this.model = model;
    this.pelvis = pelvis;
    model.updateMatrixWorld(true);
    pelvis.getWorldQuaternion(this.pelvisRestQ);
    const toLocal = new THREE.Matrix4().copy(pelvis.matrixWorld).invert();
    for (const chain of bones) {
      this.bones.push(chain);
      const rest = chain.map((b) => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal));
      this.rest.push(rest);
      // the chain's top: straight up from the first bone to the hip line
      const hipY = pelvis.getWorldPosition(new THREE.Vector3()).y;
      const first = chain[0].getWorldPosition(new THREE.Vector3());
      this.top.push(new THREE.Vector3(first.x, hipY, first.z).applyMatrix4(toLocal));
      const pts = [this.top[this.top.length - 1], ...rest];
      this.length.push(rest.map((_, k) => pts[k + 1].distanceTo(pts[k])));
      // each bone's rest direction down the chain (the last bone's the link above it continued)
      this.restDir.push(rest.map((p, k) => (k + 1 < rest.length ? _a.subVectors(rest[k + 1], p) : _a.subVectors(p, pts[k])).clone().normalize()));
      this.pos.push(rest.map((p) => p.clone().applyMatrix4(pelvis.matrixWorld)));
      this.prev.push(rest.map((p) => p.clone().applyMatrix4(pelvis.matrixWorld)));
    }
    for (const [a, b, ra, rb] of [['thigh_l', 'calf_l', 0.095, 0.075], ['calf_l', 'foot_l', 0.075, 0.06], ['thigh_r', 'calf_r', 0.095, 0.075], ['calf_r', 'foot_r', 0.075, 0.06]] as const) {
      const oa = model.getObjectByName(a);
      const ob = model.getObjectByName(b);
      if (oa && ob) this.capsules.push({ a: oa, b: ob, ra, rb });
    }
    // at rest nothing may be pushed: a particle's allowed distance is the smaller of limb-plus-clearance and where it already is
    for (const chain of this.pos) {
      this.keep.push(chain.map((p) => this.capsules.map((c) => Math.min(this.radiusAt(c, p, true), this.distanceTo(c, p) * 0.97))));
    }
    this.lastPelvis.copy(pelvis.getWorldPosition(new THREE.Vector3()));
  }

  /** The coat for a model, or null if it has no coat bones. */
  static of(model: THREE.Object3D): CoatPhysics | null {
    const found = new Map<number, Map<number, THREE.Object3D>>();
    model.traverse((o) => {
      const m = /^coat_(\d+)_(\d+)$/.exec(o.name);
      if (!m) return;
      const s = Number(m[1]);
      if (!found.has(s)) found.set(s, new Map());
      found.get(s)!.set(Number(m[2]), o);
    });
    const pelvis = model.getObjectByName('pelvis');
    if (!found.size || !pelvis) return null;
    const chains = [...found.keys()].sort((x, y) => x - y).map((s) => {
      const bones = found.get(s)!;
      return [...bones.keys()].sort((x, y) => x - y).map((k) => bones.get(k)!);
    });
    return new CoatPhysics(model, chains, pelvis);
  }

  /** Distance from a point to a capsule's axis (a segment), and where along it (0 to 1). */
  private axisDistance(c: Capsule, p: THREE.Vector3, out: THREE.Vector3 = _axis): { d: number; t: number } {
    const a = _pa.setFromMatrixPosition(c.a.matrixWorld);
    const ab = _pab.setFromMatrixPosition(c.b.matrixWorld).sub(a);
    const t = THREE.MathUtils.clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / Math.max(ab.lengthSq(), 1e-9), 0, 1);
    out.copy(a).addScaledVector(ab, t);
    return { d: p.distanceTo(out), t };
  }

  private distanceTo(c: Capsule, p: THREE.Vector3): number {
    return this.axisDistance(c, p).d;
  }

  private radiusAt(c: Capsule, p: THREE.Vector3, withClearance: boolean): number {
    const { t } = this.axisDistance(c, p);
    return THREE.MathUtils.lerp(c.ra, c.rb, t) + (withClearance ? this.options.clearance : 0);
  }

  /** Puts every particle back where the pelvis alone would hold it (a start, or a jump the body made). */
  reset(): void {
    this.pelvis.updateMatrixWorld(true);
    for (let s = 0; s < this.pos.length; s++) {
      for (let k = 0; k < this.pos[s].length; k++) {
        this.pos[s][k].copy(this.rest[s][k]).applyMatrix4(this.pelvis.matrixWorld);
        this.prev[s][k].copy(this.pos[s][k]);
      }
    }
    this.fresh = false;
    this.pelvis.getWorldPosition(this.lastPelvis);
  }

  /** Where the chain `s`'s bone `k` (0 the top) would be if the pelvis held the coat rigid, world. */
  private held(s: number, k: number, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(k === 0 ? this.top[s] : this.rest[s][k - 1]).applyMatrix4(this.pelvis.matrixWorld);
  }

  /** Advances the coat by dt seconds, after the figure has been posed for this frame. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.model.updateMatrixWorld(true);
    const now = this.pelvis.getWorldPosition(_a);
    if (this.fresh || now.distanceTo(this.lastPelvis) / dt > this.options.teleport) this.reset();
    this.lastPelvis.copy(now);
    this.left = Math.min(this.left + dt, STEP * MAX_STEPS);
    while (this.left >= STEP) {
      this.step(STEP);
      this.left -= STEP;
    }
    this.apply();
  }

  private step(dt: number): void {
    const o = this.options;
    const floor = this.model.getWorldPosition(_b).y + 0.045; // (the hem swings below its bone head as the chain tilts)
    for (let s = 0; s < this.pos.length; s++) {
      const chain = this.pos[s];
      for (let k = 0; k < chain.length; k++) {
        const p = chain[k];
        const v = _c.subVectors(p, this.prev[s][k]).multiplyScalar(o.damping);
        this.prev[s][k].copy(p);
        p.add(v);
        p.y -= o.gravity * dt * dt;
        // toward where the pelvis alone would hold it
        const rate = 1 - Math.exp(-(o.stiffness[k] ?? o.stiffness[o.stiffness.length - 1]) * dt);
        p.lerp(this.held(s, k + 1, _a), rate);
      }
      for (let it = 0; it < 3; it++) {
        // links: each point stays its rest distance from the one above, the top one from the pelvis's hold
        for (let k = 0; k < chain.length; k++) {
          const above = k === 0 ? this.held(s, 0, _a) : _a.copy(chain[k - 1]);
          const d = _b.subVectors(chain[k], above);
          const len = d.length();
          if (len < 1e-9) continue;
          const want = this.length[s][k];
          if (k === 0) chain[k].copy(above).addScaledVector(d, want / len);
          else {
            const move = (len - want) / len;
            chain[k].addScaledVector(d, -0.5 * move);
            chain[k - 1].addScaledVector(d, 0.5 * move);
          }
        }
        // the legs and the floor
        for (let k = 0; k < chain.length; k++) {
          this.collide(s, k, chain[k]);
          if (chain[k].y < floor) chain[k].y = floor;
        }
      }
    }
  }

  private collide(s: number, k: number, p: THREE.Vector3): void {
    this.capsules.forEach((c, i) => {
      const axis = _c;
      const { d } = this.axisDistance(c, p, axis);
      const r = Math.min(this.radiusAt(c, p, true), this.keep[s][k][i] ?? Infinity);
      if (d < r) {
        const out = _b.subVectors(p, axis);
        if (out.lengthSq() < 1e-10) out.set(0, 0, 1);
        p.copy(axis).addScaledVector(out.normalize(), r);
      }
    });
  }

  /** Sets the chain bones from the particles. */
  private apply(): void {
    // how far the pelvis has turned from its bind pose: every chain bone's rest turn (the world's) follows it
    this.pelvis.getWorldQuaternion(_q).multiply(_q2.copy(this.pelvisRestQ).invert());
    const turn = _q.clone();
    for (let s = 0; s < this.bones.length; s++) {
      const chain = this.bones[s];
      for (let k = 0; k < chain.length; k++) {
        const bone = chain[k];
        // the direction the chain runs at this bone now, against where a rigid pelvis would have it
        const next = this.pos[s][k + 1] ?? null;
        const here = this.pos[s][k];
        const dir = (next ? _a.subVectors(next, here) : _a.subVectors(here, k === 0 ? this.held(s, 0, _b) : this.pos[s][k - 1])).normalize();
        const rigid = _c.copy(this.restDir[s][k]).applyQuaternion(turn);
        const swing = _q2.setFromUnitVectors(rigid, dir);
        const world = swing.multiply(turn);
        // world place and turn to the bone's parent's frame
        const parent = bone.parent!;
        parent.updateMatrixWorld(false);
        _m.compose(here, world, ONE);
        _m2.copy(parent.matrixWorld).invert().multiply(_m).decompose(bone.position, bone.quaternion, bone.scale);
        bone.updateMatrixWorld(false);
      }
    }
  }
}
