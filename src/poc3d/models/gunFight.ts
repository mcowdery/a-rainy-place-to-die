import * as THREE from 'three';
import { rayBlockedAt, type Obstacle } from './cover';
import type { GunCtx } from './gunmanBrain';

/**
 * What the gunmen's guns do to you and to the yard (models/gunmanBrain.ts is where they decide): their shots, tracers, grenades, and how long
 * you've been hiding. A shot is from a muzzle at your chest with a little spread, stopped by anything in its way that's taller than it
 * passes at (`rayBlockedAt`, the same heights your cover is made of: crouched behind a crate you're safe from a gunman at the other side of
 * it, and standing up to shoot, or peeking, you're not), and a grenade is lobbed to where you are and goes off after a fuse, hurting you
 * whatever you hide behind (less if something's between) and driving you out of cover. `Brawl` owns one (`guns`), and the page gives it the
 * obstacles and you (`player`).
 */

export const SHOT = {
  /** Damage of one hit (you have 100). */
  damage: 7,
  /** The aim's error (radians): a base, and more per metre of range. */
  spread: 0.06,
  perMetre: 0.005,
  /** How wide you are for a bullet (m). */
  radius: 0.38,
} as const;

export const GRENADE = {
  fuse: 1.7,
  radius: 3.6,
  damage: 42,
  /** What a wall or a crate between him and you takes off. */
  covered: 0.5,
  gravity: 9.8,
} as const;

/** You, as the gunmen see you. */
export interface PlayerInfo {
  readonly x: number;
  readonly z: number;
  /** Your height now (1.8 standing, about 1.1 crouched in low cover). */
  readonly height: number;
  /** In cover and not peeking out of it. */
  readonly hidden: boolean;
}

interface Tracer {
  readonly mesh: THREE.Mesh;
  life: number;
}
interface Flying {
  readonly mesh: THREE.Mesh;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  fuse: number;
  landed: boolean;
}
interface Blast {
  readonly mesh: THREE.Mesh;
  life: number;
}

export class GunFight {
  obstacles: readonly Obstacle[] = [];
  player: () => PlayerInfo | null = () => null;
  /** A shot or a blast that matters to the page: what it was, and for the blast, how far from you and your direction away from it. */
  onHit: ((what: string, damage: number) => void) | null = null;
  onBlast: ((distance: number, awayX: number, awayZ: number) => void) | null = null;
  onSound: ((what: 'shot' | 'blast') => void) | null = null;
  /** How long you've been in cover out of the gunmen's sight (s). */
  hidden = 0;
  shotsAtYou = 0;
  hits = 0;
  grenades = 0;
  private readonly tracers: Tracer[] = [];
  private readonly flying: Flying[] = [];
  private readonly blasts: Blast[] = [];
  private readonly tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd48a, transparent: true, opacity: 0.9 });
  private readonly blastMat = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly grenadeMat = new THREE.MeshBasicMaterial({ color: 0x20281c });

  constructor(private readonly scene: THREE.Scene) {}

  /** What a gunman is told each frame. */
  ctx(taken: readonly { x: number; z: number }[], who: Pick<GunCtx, 'fire' | 'grenade'>): GunCtx | null {
    const p = this.player();
    if (!p) return null;
    return { obstacles: this.obstacles, player: { x: p.x, z: p.z, covered: p.hidden, hidden: this.hidden }, taken, fire: who.fire, grenade: who.grenade };
  }

  /** A shot from a muzzle at you: spread, stopped by cover, a hit if it passes within a body's width of you. */
  shot(from: { x: number; y: number; z: number }): void {
    const p = this.player();
    if (!p) return;
    this.shotsAtYou++;
    this.onSound?.('shot');
    const to = new THREE.Vector3(p.x, p.height * 0.72, p.z);
    const o = new THREE.Vector3(from.x, from.y, from.z);
    const d = to.clone().sub(o);
    const range = d.length();
    d.normalize();
    // Aim error: a point in a disc about where he meant it.
    const err = SHOT.spread + SHOT.perMetre * range;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * err;
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const up = new THREE.Vector3().crossVectors(d, side).normalize();
    d.addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    const stopped = rayBlockedAt(this.obstacles, o, d, range + 1);
    let end = range + 1;
    let hit = false;
    if (stopped !== null && stopped < range - 0.15) end = stopped;
    else {
      // Past the cover: how near it goes to you (your axis, from the floor to your height).
      const t = d.dot(to.clone().sub(o));
      const at = o.clone().addScaledVector(d, t);
      const dxz = Math.hypot(at.x - p.x, at.z - p.z);
      if (t > 0 && dxz < SHOT.radius && at.y > 0 && at.y < p.height) {
        hit = true;
        end = t;
      }
    }
    this.tracer(o, o.clone().addScaledVector(d, Math.min(end, 40)));
    if (hit) {
      this.hits++;
      this.onHit?.('shot by a gunman', SHOT.damage);
    }
  }

  private tracer(a: THREE.Vector3, b: THREE.Vector3): void {
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, len), this.tracerMat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.lookAt(b);
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.07 });
    // The flash at the muzzle.
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), this.tracerMat);
    flash.position.copy(a);
    this.scene.add(flash);
    this.tracers.push({ mesh: flash, life: 0.05 });
  }

  /** A grenade lobbed from `from` to land at `to` (a flight of about a second), going off after its fuse. */
  grenade(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void {
    this.grenades++;
    const T = 0.8 + Math.hypot(to.x - from.x, to.z - from.z) * 0.035;
    const pos = new THREE.Vector3(from.x, from.y, from.z);
    const vel = new THREE.Vector3((to.x - from.x) / T, (to.y + 0.12 - from.y) / T + 0.5 * GRENADE.gravity * T, (to.z - from.z) / T);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), this.grenadeMat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.flying.push({ mesh, pos, vel, fuse: GRENADE.fuse, landed: false });
  }

  /** The grenades in the air and going off, the tracers fading, and how long you've been hidden. */
  update(dt: number): void {
    const p = this.player();
    this.hidden = p?.hidden ? this.hidden + dt : 0;
    for (const t of this.tracers) t.life -= dt;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      if (this.tracers[i].life > 0) continue;
      this.scene.remove(this.tracers[i].mesh);
      this.tracers[i].mesh.geometry.dispose();
      this.tracers.splice(i, 1);
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const g = this.flying[i];
      g.fuse -= dt;
      if (!g.landed) {
        g.vel.y -= GRENADE.gravity * dt;
        g.pos.addScaledVector(g.vel, dt);
        if (g.pos.y <= 0.07) {
          g.pos.y = 0.07;
          g.landed = true;
        }
        g.mesh.position.copy(g.pos);
      }
      if (g.fuse <= 0) {
        this.explode(g.pos);
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose();
        this.flying.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.life -= dt;
      const k = 1 - Math.max(0, b.life) / 0.3;
      b.mesh.scale.setScalar(0.4 + k * GRENADE.radius * 0.9);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.blasts.splice(i, 1);
      }
    }
  }

  private explode(at: THREE.Vector3): void {
    this.onSound?.('blast');
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), this.blastMat.clone());
    mesh.position.copy(at);
    this.scene.add(mesh);
    this.blasts.push({ mesh, life: 0.3 });
    const p = this.player();
    if (!p) return;
    const dx = p.x - at.x;
    const dz = p.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d > GRENADE.radius) return;
    // What's between the blast and you takes some off (a crate, a wall).
    const o = new THREE.Vector3(at.x, 0.3, at.z);
    const to = new THREE.Vector3(p.x, p.height * 0.5, p.z).sub(o);
    const len = to.length();
    const cover = rayBlockedAt(this.obstacles, o, to.normalize(), len) !== null;
    const damage = Math.max(8, GRENADE.damage * (1 - d / GRENADE.radius)) * (cover ? GRENADE.covered : 1);
    this.onHit?.('a grenade', damage);
    this.onBlast?.(d, d > 1e-3 ? dx / d : 1, d > 1e-3 ? dz / d : 0);
  }

  /** Clears the grenades and tracers in the air (a fresh group). */
  clear(): void {
    for (const t of this.tracers) this.scene.remove(t.mesh);
    for (const g of this.flying) this.scene.remove(g.mesh);
    for (const b of this.blasts) this.scene.remove(b.mesh);
    this.tracers.length = this.flying.length = this.blasts.length = 0;
    this.hidden = 0;
  }
}
