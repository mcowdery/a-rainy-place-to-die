import type * as THREE from 'three';
import { WRECKED, type Parts, type Section } from '../poc3d/district/crash';
import type { CarView } from './carView';

/**
 * Crash damage shown on a car (district/crash.ts parts): each part's damage crumples its end or side of the
 * body in (the nose and the boot pushed in and buckled, a side stoved in), unevenly, and scrapes the paint
 * there to dark metal in patches; a flat tyre drops its corner of the car and a damaged one wobbles as it
 * turns. Used by your car in the city and in the garage.
 */
export class Dents {
  private readonly pos: Float32Array;
  private readonly col: Float32Array | null;
  /** The lamps over the lenses (carView.ts), as built: they crumple with the body under them. */
  private readonly lamps: { geo: THREE.BufferGeometry; pos: Float32Array }[];
  private readonly minZ: number;
  private readonly maxZ: number;
  private readonly maxX: number;

  constructor(private readonly view: CarView) {
    const geo = view.body.geometry;
    this.pos = Float32Array.from(geo.attributes.position.array as ArrayLike<number>);
    this.col = geo.attributes.color ? Float32Array.from(geo.attributes.color.array as ArrayLike<number>) : null;
    this.lamps = Object.values(view.lamps).filter((m): m is THREE.Mesh => !!m).map((m) => ({ geo: m.geometry, pos: Float32Array.from(m.geometry.attributes.position.array as ArrayLike<number>) }));
    let minZ = Infinity;
    let maxZ = -Infinity;
    let maxX = 0;
    for (let i = 0; i < this.pos.length; i += 3) {
      maxX = Math.max(maxX, Math.abs(this.pos[i]));
      minZ = Math.min(minZ, this.pos[i + 2]);
      maxZ = Math.max(maxZ, this.pos[i + 2]);
    }
    this.minZ = minZ;
    this.maxZ = maxZ;
    this.maxX = maxX;
  }

  /** Reshape the body for these parts (from the car as built, so it can be undone by a repair). */
  apply(P: Parts): void {
    const geo = this.view.body.geometry;
    this.reshape(P, geo, this.pos, this.col);
    for (const l of this.lamps) this.reshape(P, l.geo, l.pos, null);
  }

  private reshape(P: Parts, geo: THREE.BufferGeometry, O: Float32Array, C: Float32Array | null): void {
    const pos = geo.attributes.position.array as Float32Array;
    const col = C ? (geo.attributes.color?.array as Float32Array | undefined) : undefined;
    const { minZ, maxZ, maxX } = this;
    const sm = (v: number): number => {
      const c = Math.max(0, Math.min(1, v));
      return c * c * (3 - 2 * c);
    };
    const f = P.front / WRECKED;
    const r = P.rear / WRECKED;
    const l = P.left / WRECKED;
    const rt = P.right / WRECKED;
    for (let i = 0; i < O.length; i += 3) {
      const X = O[i];
      const Y = O[i + 1];
      const Z = O[i + 2];
      // Noise from the position (so vertices that meet stay together), in dents about 30 cm across.
      const n = Math.abs(Math.sin(Math.floor(X * 3.3) * 12.9898 + Math.floor(Y * 3.3) * 78.233 + Math.floor(Z * 3.3) * 37.719) * 43758.5453) % 1;
      const fine = Math.abs(Math.sin(X * 41.3 + Y * 17.1 + Z * 29.7) * 9731.17) % 1;
      const wf = sm((Z - (maxZ - 1.1)) / 1.1) * f;
      const wr = sm((minZ + 1.0 - Z) / 1.0) * r;
      const wl = sm((X - (maxX - 0.4)) / 0.4) * l;
      const wR = sm((-X - (maxX - 0.4)) / 0.4) * rt;
      const jag = 0.55 + 0.9 * n;
      pos[i] = X - wl * 0.2 * jag + wR * 0.2 * jag + (wf + wr) * (n - 0.5) * 0.08;
      pos[i + 1] = Y - (wf + wr) * 0.12 * n * sm(Y / 0.9) + (wf + wr) * 0.04 * (fine - 0.5);
      pos[i + 2] = Z - wf * 0.5 * jag + wr * 0.4 * jag + (wl + wR) * (n - 0.5) * 0.06;
      if (col && C) {
        // Scrapes: dark bare metal in patches where it's damaged.
        const a = Math.min(0.9, Math.max(wf, wr, wl, wR) * (n > 0.5 ? 1.6 : 0.25) * (0.6 + 0.4 * fine));
        col[i] = C[i] + (0.06 - C[i]) * a;
        col[i + 1] = C[i + 1] + (0.06 - C[i + 1]) * a;
        col[i + 2] = C[i + 2] + (0.065 - C[i + 2]) * a;
      }
    }
    geo.attributes.position.needsUpdate = true;
    if (col) geo.attributes.color.needsUpdate = true;
  }

  /**
   * The tyres, after the car is posed each frame: a flat one drops its corner of the car (the whole car tilts
   * that way), a damaged one wobbles as it turns.
   */
  tyres(P: Parts, obj: THREE.Object3D = this.view.obj): void {
    let pitch = 0;
    let roll = 0;
    for (const w of this.view.wheels) {
      const key = `${w.front ? 'f' : 'r'}${w.m.position.x > 0 ? 'l' : 'r'}` as Section;
      const d = P[key] / WRECKED;
      if (d > 0.3) w.m.rotation.z = Math.sin(w.roll) * 0.07 * d;
      const sag = d >= 1 ? 0.09 : Math.max(0, d - 0.6) * 0.05;
      pitch += (w.front ? 1 : -1) * sag;
      roll += (w.m.position.x > 0 ? -1 : 1) * sag;
    }
    obj.rotation.x += pitch / 2.6;
    obj.rotation.z += roll / 1.5;
    obj.position.y -= Math.max(Math.abs(pitch), Math.abs(roll)) * 0.4;
  }
}
