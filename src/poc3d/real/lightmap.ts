import * as THREE from 'three';
import type { Rect } from '../../core/coords';

type C3 = readonly [number, number, number];

/**
 * A light baked into the street lightmap: a round pool (lamps, vending machines, sign glow) or, with
 * `band`, a glow spilling from a shopfront across the pavement.
 */
export interface Light {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  /** Linear colour, roughly 0-1. */
  readonly color: C3;
  readonly i: number;
  /** Shopfront spill: from the facade segment (x, z) + t * (dx, dz), t in [0, 1], out along (nx, nz) for depth m. */
  readonly band?: { readonly dx: number; readonly dz: number; readonly nx: number; readonly nz: number; readonly depth: number };
}

/** Lightmap resolution: pixels per metre. */
const RES = 1;

/**
 * One lightmap texture over the whole district at RES px/m. Each chunk paints its own cell (lights from
 * neighbouring cells included, so pools cross cell borders seamlessly) on a small canvas and uploads just
 * that region. The city material samples it for every surface near the street.
 */
export class Lightmap {
  readonly texture: THREE.DataTexture;
  readonly rect: Rect;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly pos = new THREE.Vector2();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    bounds: Rect,
    private readonly cell: number,
  ) {
    this.rect = bounds;
    const w = Math.ceil(bounds.w * RES);
    const h = Math.ceil(bounds.h * RES);
    this.texture = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
    renderer.initTexture(this.texture);
    this.canvas = document.createElement('canvas');
    this.canvas.width = cell * RES;
    this.canvas.height = cell * RES;
    this.g = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /** (x0, z0, 1 / width, 1 / depth) for the material's uLightRect. */
  get uniformRect(): THREE.Vector4 {
    return new THREE.Vector4(this.rect.x, this.rect.y, 1 / this.rect.w, 1 / this.rect.h);
  }

  /** Paints the cell whose NW corner is (x, z) from these lights and uploads it. */
  paint(x: number, z: number, lights: readonly Light[]): void {
    const g = this.g;
    const S = this.cell * RES;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'lighter';
    const rgba = (c: C3, a: number): string => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.max(0, Math.min(1, a))})`;
    for (const l of lights) {
      const px = (l.x - x) * RES;
      const pz = (l.z - z) * RES;
      if (l.band) {
        const b = l.band;
        const ex = px + b.dx * RES;
        const ez = pz + b.dz * RES;
        const ox = b.nx * b.depth * RES;
        const oz = b.nz * b.depth * RES;
        const grad = g.createLinearGradient(px, pz, px + ox, pz + oz);
        grad.addColorStop(0, rgba(l.color, l.i));
        grad.addColorStop(0.35, rgba(l.color, l.i * 0.45));
        grad.addColorStop(1, rgba(l.color, 0));
        g.fillStyle = grad;
        const x0 = Math.min(px, ex, px + ox, ex + ox);
        const z0 = Math.min(pz, ez, pz + oz, ez + oz);
        const x1 = Math.max(px, ex, px + ox, ex + ox);
        const z1 = Math.max(pz, ez, pz + oz, ez + oz);
        g.fillRect(x0, z0, x1 - x0, z1 - z0);
        continue;
      }
      const rr = l.r * RES;
      if (px < -rr || pz < -rr || px > S + rr || pz > S + rr) continue;
      const grad = g.createRadialGradient(px, pz, 0, px, pz, rr);
      grad.addColorStop(0, rgba(l.color, l.i));
      grad.addColorStop(0.25, rgba(l.color, l.i * 0.62));
      grad.addColorStop(0.6, rgba(l.color, l.i * 0.2));
      grad.addColorStop(1, rgba(l.color, 0));
      g.fillStyle = grad;
      g.fillRect(px - rr, pz - rr, rr * 2, rr * 2);
    }
    const data = g.getImageData(0, 0, S, S).data;
    const src = new THREE.DataTexture(new Uint8Array(data.buffer.slice(0)), S, S);
    this.pos.set(Math.round((x - this.rect.x) * RES), Math.round((z - this.rect.y) * RES));
    if (this.pos.x < 0 || this.pos.y < 0 || this.pos.x + S > this.texture.image.width || this.pos.y + S > this.texture.image.height) return;
    this.renderer.copyTextureToTexture(src, this.texture, null, this.pos);
  }
}
