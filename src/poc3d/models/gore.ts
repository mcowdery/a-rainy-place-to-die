import * as THREE from 'three';
import type { GoreLevel } from './melee';

/**
 * Blood for the fights (models/melee.ts), at the player's chosen level (`GoreLevel`: full, low or off; the
 * setting is `goreSetting()`):
 *
 * - full: a cut throws a spray of drops along the swing and out of the wound, and a cut to the neck, head or
 *   body spurts on in pulses for a moment; a punch to the face bloodies the nose; drops that reach the floor
 *   leave stains, stretched the way they flew; gashes stay on the body; a blade carries blood (the page calls
 *   `Katana.setBlood`); the dead bleed out into a spreading pool; close up, it spatters the screen.
 * - low: a few small, dark drops from cuts, no spurts, pools or spatter, little on the blade.
 * - off: no blood at all; every hit still shows a pale flash where it lands.
 *
 * Drops are one instanced mesh (stretched along their flight), stains another (flat, on the floor), so it all
 * costs two draws however much there is; both are ring buffers.
 */

const MAX_DROPS = 900;
const MAX_STAINS = 700;
const GRAVITY = 9.8;

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  r: number;
  alive: boolean;
}

interface Emitter {
  /** Where it bleeds from (the wound, stuck to a bone) and which way it spurts there. */
  readonly obj: THREE.Object3D;
  readonly local: THREE.Vector3;
  readonly dir: THREE.Vector3;
  t: number;
  readonly until: number;
  readonly rate: number;
}

interface Pool {
  readonly mesh: THREE.Mesh;
  readonly size: number;
  t: number;
}

/** Something knocked loose (a head, a piece of one): tumbling, bouncing and rolling to a stop, trailing blood
 * while it flies. */
interface Flying {
  readonly obj: THREE.Object3D;
  readonly v: THREE.Vector3;
  readonly spin: THREE.Vector3;
  readonly r: number;
  rest: number;
  readonly bleeds: boolean;
}

export class Gore {
  level: GoreLevel;
  /** Blood the last hits put on a blade (0..1); the page passes it to the katana and it fades. */
  blade = 0;
  /** Where the eyes are: drops that fly at them land on the screen instead (drawn that close, they'd be
   * blobs filling the view). */
  readonly viewer = new THREE.Vector3(0, -1000, 0);
  private screenHits = 0;
  private readonly drops: Drop[] = [];
  private nextDrop = 0;
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly stainMesh: THREE.InstancedMesh;
  private nextStain = 0;
  private stainCount = 0;
  private readonly emitters: Emitter[] = [];
  private readonly pools: Pool[] = [];
  private readonly wounds: THREE.Object3D[] = [];
  private readonly flashes: { s: THREE.Sprite; t: number }[] = [];
  private readonly flying: Flying[] = [];
  private readonly sparkList: { s: THREE.Sprite; v: THREE.Vector3; t: number }[] = [];
  /** Loose pieces (heads, chunks) to clear with the rest. */
  private readonly loose: THREE.Object3D[] = [];
  private readonly chunkMat = new THREE.MeshStandardMaterial({ color: 0x5a0a0e, roughness: 0.4 });
  private readonly flashMat: THREE.SpriteMaterial;
  private readonly woundMat: THREE.MeshStandardMaterial;
  private readonly poolMat: THREE.MeshPhysicalMaterial;
  private readonly screen: ScreenBlood | null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly floorAt: (x: number, z: number) => number,
    level: GoreLevel,
    overlay: HTMLElement | null = null,
  ) {
    this.level = level;
    const blood = new THREE.MeshStandardMaterial({ color: 0x5c0208, roughness: 0.25, metalness: 0 });
    this.dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), blood, MAX_DROPS);
    this.dropMesh.count = 0;
    this.dropMesh.frustumCulled = false;
    this.dropMesh.name = 'gore:drops';
    const stain = new THREE.MeshStandardMaterial({ color: 0x3a0307, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.stainMesh = new THREE.InstancedMesh(stainGeometry(), stain, MAX_STAINS);
    this.stainMesh.count = 0;
    this.stainMesh.frustumCulled = false;
    this.stainMesh.receiveShadow = true;
    this.stainMesh.name = 'gore:stains';
    scene.add(this.dropMesh, this.stainMesh);
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, alive: false });
    this.flashMat = new THREE.SpriteMaterial({ map: flashTexture(), color: new THREE.Color(1.3, 1.25, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.woundMat = new THREE.MeshStandardMaterial({ color: 0x3a0004, roughness: 0.3 });
    this.poolMat = new THREE.MeshPhysicalMaterial({ color: 0x300004, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.screen = overlay ? new ScreenBlood(overlay) : null;
  }

  /**
   * A hit lands at `point` (world), the striking part moving along `dir`. `cut` for a blade; `strength` 0..1;
   * `bone` the bone it struck (wounds stick to it, spurts come from it); `viewer` where the eyes are (spatter
   * on the screen when they're close).
   */
  hit(point: THREE.Vector3, dir: THREE.Vector3, cut: boolean, strength: number, part: string, bone: THREE.Object3D | null, viewer: THREE.Vector3): void {
    this.flash(point, cut ? 0.07 : 0.1);
    if (this.level === 'off') return;
    const full = this.level === 'full';
    const d = dir.clone().normalize();
    // Square to the swing, sideways from the wound.
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize();
    if (cut) {
      const n = full ? Math.round(70 + 70 * strength) : 10;
      for (let i = 0; i < n; i++) {
        // Thrown along the swing (the blade carries it), fanned out, and kicked up a little.
        // Most drops small and slow, a few big and far.
        const big = Math.random() ** 3;
        const v = d.clone().multiplyScalar(1 + Math.random() * 2.5 * (full ? 1 : 0.5) + big * 2);
        v.addScaledVector(side, (Math.random() - 0.5) * 2.2).add(new THREE.Vector3(0, 0.4 + Math.random() * 1.4, 0));
        this.drop(point.clone().addScaledVector(d, (Math.random() - 0.5) * 0.1), v, full ? 0.0015 + 0.002 * Math.random() + 0.006 * big : 0.0015 + Math.random() * 0.002);
      }
      this.blade = Math.min(full ? 1 : 0.35, this.blade + (full ? 0.55 : 0.15));
      if (full && bone) {
        this.wound(point, d, bone, true);
        if (part === 'neck' || part === 'head' || part === 'torso') {
          // An artery: spurting in pulses, out of the wound and the way the cut went, for a while.
          const local = bone.worldToLocal(point.clone());
          const out = d.clone().addScaledVector(side, 0.5).add(new THREE.Vector3(0, part === 'neck' ? 0.8 : 0.3, 0)).normalize();
          const lq = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
          this.emitters.push({ obj: bone, local, dir: out.applyQuaternion(lq), t: 0, until: part === 'neck' ? 3.5 : 1.6, rate: part === 'neck' ? 140 : 70 });
        }
      }
      if (full && this.screen && point.distanceTo(viewer) < 1.4) this.screen.splat(0.6 + 0.4 * strength);
    } else if (part === 'head') {
      // A bloodied nose or a split lip.
      const n = full ? Math.round(6 + 12 * strength) : 2;
      for (let i = 0; i < n; i++) {
        const v = d.clone().multiplyScalar(1 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.5 + Math.random(), (Math.random() - 0.5) * 1.2));
        this.drop(point.clone(), v, 0.0025 + Math.random() * (full ? 0.005 : 0.002));
      }
      if (full && strength > 0.7 && this.screen && point.distanceTo(viewer) < 1.0) this.screen.splat(0.25);
    }
  }

  /** Blood thrown out from a point: `n` drops along `dir` (fanned by `spread`, 0 a line, 1 every way) at about
   * `speed` m/s; a burst (a head shot), a splash. Full gore only, a tenth of it on low. */
  burst(point: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number, spread: number, size = 0.006): void {
    if (this.level === 'off') return;
    const k = this.level === 'full' ? 1 : 0.1;
    const d = dir.clone().normalize();
    for (let i = 0; i < Math.round(n * k); i++) {
      const r = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spread);
      const v = d.clone().add(r).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9));
      this.drop(point.clone(), v, size * (0.3 + Math.random() * 1.2));
    }
  }

  /** Sparks where steel meets steel (any gore level): bright specks flung out and falling. */
  sparks(point: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.flashMat.clone());
      s.material.color.setRGB(3, 2.2, 0.9);
      s.position.copy(point);
      s.scale.setScalar(0.012 + Math.random() * 0.012);
      this.scene.add(s);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 4);
      this.sparkList.push({ s, v, t: 0.25 + Math.random() * 0.25 });
    }
    this.flash(point, 0.12);
  }

  /** Bits of a head blown apart (full gore only): dark lumps flung out, bouncing. */
  chunks(point: THREE.Vector3, dir: THREE.Vector3, n: number): void {
    if (this.level !== 'full') return;
    for (let i = 0; i < n; i++) {
      const s = 0.012 + Math.random() * 0.02;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), this.chunkMat);
      m.castShadow = true;
      m.position.copy(point);
      this.scene.add(m);
      const v = dir.clone().normalize().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3));
      this.throwPiece(m, v, new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(14), s, false);
    }
  }

  /** Something knocked loose flies: `obj` (in the scene, world placed) with a velocity and a spin (rad/s about
   * each axis), `r` its radius for the floor. */
  throwPiece(obj: THREE.Object3D, v: THREE.Vector3, spin: THREE.Vector3, r: number, bleeds = true): void {
    if (!obj.parent) this.scene.add(obj);
    this.flying.push({ obj, v: v.clone(), spin: spin.clone(), r, rest: 0, bleeds });
    this.loose.push(obj);
  }

  /** A spurt from a wound on `bone` at `point` (world), the way `dir` (world), for `secs`; full gore only. */
  spurt(bone: THREE.Object3D, point: THREE.Vector3, dir: THREE.Vector3, secs: number, rate: number): void {
    if (this.level !== 'full') return;
    const local = bone.worldToLocal(point.clone());
    const lq = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.emitters.push({ obj: bone, local, dir: dir.clone().normalize().applyQuaternion(lq), t: 0, until: secs, rate });
  }

  /** A splash on a wall at `point` facing out along `normal`, `size` across (and drops running down from it). */
  wallSplat(point: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    if (this.level === 'off') return;
    const k = this.level === 'full' ? 1 : 0.45;
    const nrm = normal.clone().normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    const put = (p: THREE.Vector3, w: number, l: number, turn: number): void => {
      const i = this.nextStain;
      this.nextStain = (this.nextStain + 1) % MAX_STAINS;
      this.stainCount = Math.min(MAX_STAINS, this.stainCount + 1);
      const qq = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn));
      this.stainMesh.setMatrixAt(i, new THREE.Matrix4().compose(p.clone().addScaledVector(nrm, 0.004 + i * 1e-6), qq, new THREE.Vector3(w, 1, l)));
    };
    put(point, size * 0.5 * k, size * 0.55 * k, Math.random() * 6);
    for (let i = 0; i < Math.round(12 * k); i++) {
      const off = new THREE.Vector3((Math.random() - 0.5) * size * 1.6, (Math.random() - 0.5) * size * 1.6, (Math.random() - 0.5) * size * 1.6);
      off.addScaledVector(nrm, -off.dot(nrm));
      const r = size * (0.03 + Math.random() * 0.08) * k;
      put(point.clone().add(off), r, r * (1 + Math.random()), Math.random() * 6);
    }
    // Runs down the wall.
    const down = new THREE.Vector3(0, -1, 0).addScaledVector(nrm, nrm.y).normalize();
    const along = new THREE.Vector3().crossVectors(nrm, down).normalize();
    for (let i = 0; i < (this.level === 'full' ? 4 : 1); i++) {
      const len = size * (0.4 + Math.random() * 0.9);
      const start = point.clone().addScaledVector(along, (Math.random() - 0.5) * size * 0.7);
      const qd = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(along, nrm, down.clone().negate()));
      const i2 = this.nextStain;
      this.nextStain = (this.nextStain + 1) % MAX_STAINS;
      this.stainCount = Math.min(MAX_STAINS, this.stainCount + 1);
      this.stainMesh.setMatrixAt(i2, new THREE.Matrix4().compose(start.addScaledVector(down, len / 2).addScaledVector(nrm, 0.005), qd, new THREE.Vector3(0.006 + Math.random() * 0.006, 1, len / 2)));
    }
    this.stainMesh.count = this.stainCount;
    this.stainMesh.instanceMatrix.needsUpdate = true;
  }

  /** The dead bleed out: a pool spreading from under them over the next twenty seconds. */
  bleedOut(at: THREE.Vector3, size = 0.8): void {
    if (this.level !== 'full') return;
    const mesh = new THREE.Mesh(poolGeometry(Math.random() * 100), this.poolMat);
    mesh.position.set(at.x, this.floorAt(at.x, at.z) + 0.003, at.z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(0.01);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.pools.push({ mesh, size, t: 0 });
  }

  /** Clears every drop, stain, wound and pool. */
  clear(): void {
    for (const d of this.drops) d.alive = false;
    this.dropMesh.count = 0;
    this.stainMesh.count = 0;
    this.stainCount = 0;
    this.nextStain = 0;
    this.emitters.length = 0;
    for (const p of this.pools) p.mesh.removeFromParent();
    this.pools.length = 0;
    for (const w of this.wounds) w.removeFromParent();
    this.wounds.length = 0;
    for (const o of this.loose) o.removeFromParent();
    this.loose.length = 0;
    this.flying.length = 0;
    this.blade = 0;
  }

  /** Wounds on a body being reset (the page calls it before it stands up again). */
  clearWounds(): void {
    for (const w of this.wounds) w.removeFromParent();
    this.wounds.length = 0;
    this.emitters.length = 0;
  }

  update(dt: number): void {
    // Spurts.
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt;
      if (e.t > e.until || this.level !== 'full') {
        this.emitters.splice(i, 1);
        continue;
      }
      // A heartbeat's pulses, weakening.
      const pulse = Math.max(0, Math.sin(e.t * Math.PI * 2 * 1.4)) ** 2 * (1 - e.t / e.until);
      const n = Math.floor(e.rate * pulse * dt + Math.random());
      const at = e.obj.localToWorld(e.local.clone());
      const dir = e.dir.clone().applyQuaternion(e.obj.getWorldQuaternion(new THREE.Quaternion()));
      for (let k = 0; k < n; k++) {
        const v = dir.clone().multiplyScalar(1.5 + 2.5 * pulse + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6));
        this.drop(at.clone(), v, 0.003 + Math.random() * 0.005);
      }
    }
    // Drops fly and fall; on the floor they leave a stain.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1);
    let count = 0;
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.v.y -= GRAVITY * dt;
      d.v.multiplyScalar(Math.exp(-0.6 * dt));
      d.p.addScaledVector(d.v, dt);
      if (d.p.distanceToSquared(this.viewer) < 0.5 * 0.5) {
        d.alive = false;
        this.screenHits += d.r;
        continue;
      }
      const floor = this.floorAt(d.p.x, d.p.z);
      if (d.p.y <= floor) {
        d.alive = false;
        this.stain(d.p.x, floor, d.p.z, d.r, d.v);
        continue;
      }
      const speed = d.v.length();
      q.setFromUnitVectors(z, d.v.clone().divideScalar(Math.max(1e-4, speed)));
      s.set(d.r, d.r, d.r * (1 + Math.min(3, speed * 0.25)));
      m.compose(d.p, q, s);
      this.dropMesh.setMatrixAt(count++, m);
    }
    this.dropMesh.count = count;
    this.dropMesh.instanceMatrix.needsUpdate = true;
    if (count > 0) this.dropMesh.instanceMatrix.addUpdateRange(0, count * 16);
    // Loose pieces: flying, then bouncing and rolling to rest on the floor.
    for (const f of this.flying) {
      if (f.rest > 1.5) continue;
      f.v.y -= GRAVITY * dt;
      f.obj.position.addScaledVector(f.v, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      const floor = this.floorAt(f.obj.position.x, f.obj.position.z) + f.r;
      if (f.obj.position.y < floor) {
        f.obj.position.y = floor;
        if (f.v.y < -1.2 && f.bleeds && this.level !== 'off') this.stain(f.obj.position.x, floor - f.r, f.obj.position.z, 0.02, f.v);
        f.v.y = Math.abs(f.v.y) * 0.3;
        f.v.x *= 0.6;
        f.v.z *= 0.6;
        f.spin.multiplyScalar(0.6);
        if (f.v.lengthSq() < 0.05) f.rest += dt;
      } else if (f.bleeds && this.level === 'full' && Math.random() < dt * 30) this.drop(f.obj.position.clone(), f.v.clone().multiplyScalar(0.3), 0.003 + Math.random() * 0.003);
    }
    // Pools spread, fast at first.
    for (const p of this.pools) {
      p.t += dt;
      const k = 1 - Math.exp(-p.t / 7);
      p.mesh.scale.setScalar(Math.max(0.01, p.size * k));
    }
    this.blade = Math.max(0, this.blade - dt * 0.01);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      f.s.material.opacity = Math.max(0, f.t / 0.09);
      if (f.t <= 0) {
        f.s.removeFromParent();
        this.flashes.splice(i, 1);
      }
    }
    if (this.screenHits > 0.02 && this.level === 'full') this.screen?.splat(Math.min(1, this.screenHits * 8));
    this.screenHits = 0;
    for (let i = this.sparkList.length - 1; i >= 0; i--) {
      const sp = this.sparkList[i];
      sp.t -= dt;
      sp.v.y -= GRAVITY * dt;
      sp.s.position.addScaledVector(sp.v, dt);
      if (sp.t <= 0) {
        sp.s.removeFromParent();
        this.sparkList.splice(i, 1);
      }
    }
    this.screen?.update(dt);
  }

  private drop(p: THREE.Vector3, v: THREE.Vector3, r: number): void {
    const d = this.drops[this.nextDrop];
    this.nextDrop = (this.nextDrop + 1) % MAX_DROPS;
    d.p.copy(p);
    d.v.copy(v);
    d.r = r;
    d.alive = true;
  }

  private stain(x: number, y: number, z: number, r: number, v: THREE.Vector3): void {
    const i = this.nextStain;
    this.nextStain = (this.nextStain + 1) % MAX_STAINS;
    this.stainCount = Math.min(MAX_STAINS, this.stainCount + 1);
    const flat = Math.hypot(v.x, v.z);
    // Stretched the way it flew, the faster the longer; a little random on the turn.
    const len = r * (2.2 + Math.min(5, flat * 1.1));
    const wide = r * (1.8 + 0.8 * Math.random());
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y + 0.002 + i * 1e-6, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(v.x, v.z) + (Math.random() - 0.5) * 0.3),
      new THREE.Vector3(wide, 1, len),
    );
    this.stainMesh.setMatrixAt(i, m);
    this.stainMesh.count = this.stainCount;
    this.stainMesh.instanceMatrix.needsUpdate = true;
  }

  /** A wound stuck to a bone: a gash along a cut's way, or a bruise-dark spot. */
  private wound(point: THREE.Vector3, dir: THREE.Vector3, bone: THREE.Object3D, cut: boolean): void {
    const g = new THREE.Group();
    const n = cut ? 5 : 1;
    for (let i = 0; i < n; i++) {
      const piece = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), this.woundMat);
      piece.scale.set(0.012, 0.01, 0.03);
      piece.position.set(0, 0, (i - (n - 1) / 2) * 0.035);
      g.add(piece);
    }
    g.position.copy(point);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    bone.attach(g);
    this.wounds.push(g);
  }

  private flash(at: THREE.Vector3, size: number): void {
    const s = new THREE.Sprite(this.flashMat.clone());
    s.position.copy(at);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.flashes.push({ s, t: 0.09 });
  }
}

/** A splash's shape: a ragged disc, flat on the floor (xz). */
function stainGeometry(): THREE.BufferGeometry {
  const pts: number[] = [0, 0, 0];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.25 * Math.sin(a * 5 + 1.3) + 0.15 * Math.sin(a * 3);
    pts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  const idx: number[] = [];
  for (let i = 1; i <= N; i++) idx.push(0, i + 1, i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A pool: an irregular blob, flat (xz), about 1 across. */
function poolGeometry(seed: number): THREE.BufferGeometry {
  const pts: number[] = [0, 0, 0];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.5 * (1 + 0.18 * Math.sin(a * 3 + seed) + 0.1 * Math.sin(a * 7 + seed * 2) + 0.06 * Math.sin(a * 13));
    pts.push(Math.cos(a) * r * 1.3, 0, Math.sin(a) * r);
  }
  const idx: number[] = [];
  for (let i = 1; i <= N; i++) idx.push(0, i + 1, i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,240,220,0.5)');
  grad.addColorStop(1, 'rgba(255,220,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Blood on the screen: blots and runs that fade over a few seconds. */
export class ScreenBlood {
  private readonly canvas: HTMLCanvasElement;
  private alpha = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', opacity: '0', zIndex: '5' });
    parent.appendChild(this.canvas);
  }

  splat(amount: number): void {
    const c = this.canvas;
    if (c.width !== innerWidth || c.height !== innerHeight) {
      c.width = innerWidth;
      c.height = innerHeight;
    }
    const g = c.getContext('2d')!;
    // Fresh blood over what's there, fading what was.
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${0.5})`;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    const W = c.width;
    const H = c.height;
    const k = W / 1600;
    // A few spatters, each a cluster: a blot made of overlapping soft lobes, a spray of fine specks thrown out
    // one way from it, and maybe a run down. Mostly off to the sides and low.
    const n = Math.round(2 + 4 * amount);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = W * (0.5 + side * (0.22 + Math.random() * 0.3));
      const y = H * (0.3 + Math.random() * 0.65);
      const R = (12 + Math.random() * 38 * amount) * k;
      const shade = (a: number): string => `rgba(${70 + Math.random() * 40},0,${4 + Math.random() * 6},${a})`;
      for (let l = 0; l < 6; l++) {
        const lx = x + (Math.random() - 0.5) * R;
        const ly = y + (Math.random() - 0.5) * R;
        const lr = R * (0.35 + Math.random() * 0.5);
        const grad = g.createRadialGradient(lx, ly, 0, lx, ly, lr);
        grad.addColorStop(0, shade(0.85));
        grad.addColorStop(0.75, shade(0.7));
        grad.addColorStop(1, shade(0));
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(lx, ly, lr, lr * (0.6 + Math.random() * 0.4), Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
      const a = Math.random() * Math.PI * 2;
      g.fillStyle = shade(0.8);
      for (let s = 0; s < 18; s++) {
        const d = R * (0.8 + Math.random() * 2.6);
        const sa = a + (Math.random() - 0.5) * 1.1;
        g.beginPath();
        g.arc(x + Math.cos(sa) * d, y + Math.sin(sa) * d, (0.8 + Math.random() * 3) * k, 0, Math.PI * 2);
        g.fill();
      }
      if (Math.random() < 0.6) {
        const len = R * (1.5 + Math.random() * 3);
        const grad = g.createLinearGradient(x, y, x, y + len);
        grad.addColorStop(0, shade(0.8));
        grad.addColorStop(1, shade(0));
        g.fillStyle = grad;
        g.fillRect(x - 2.2 * k, y, 4.4 * k, len);
      }
    }
    this.alpha = 1;
  }

  update(dt: number): void {
    if (this.alpha <= 0) return;
    this.alpha = Math.max(0, this.alpha - dt / 3.5);
    this.canvas.style.opacity = String(Math.min(1, this.alpha * 1.4));
  }
}
