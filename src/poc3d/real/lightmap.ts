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
export const LIGHTMAP_RES = 1;
const RES = LIGHTMAP_RES;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Paints a cell's lightmap tile (S x S pixels, NW corner at world (x, z)) from these lights and returns the
 * RGBA pixels. Works on any 2D context, so the chunk worker does it on an OffscreenCanvas.
 */
export function paintLights(g: Ctx2D, x: number, z: number, S: number, lights: readonly Light[]): Uint8Array {
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
  return new Uint8Array(g.getImageData(0, 0, S, S).data.buffer);
}

/**
 * The street lightmap at RES px/m. Each chunk's tile (its cell, with neighbouring cells' lights included so pools
 * cross borders seamlessly) is painted by the chunk worker and uploaded here as just that region; the city
 * material samples it for every surface near the street.
 *
 * Two layouts. Over fixed `bounds` (the showroom): one texture covering them. Wrapping (`windowCells`, the city):
 * a fixed window of N x N cells that wraps round the world (a cell's tile goes in slot (mx mod N, my mod N), and
 * the texture repeats), so its size doesn't grow with the city. That holds while every loaded chunk lies within
 * half the window of the camera (world.ts unloads them well before), and a chunk's slot is cleared when it's
 * dropped; the material fades the lightmap out toward the window's edge (`fade`), where a slot could belong to
 * a cell a window away.
 */
export class Lightmap {
  readonly texture: THREE.DataTexture;
  readonly rect: Rect;
  /** Where the material fades the lightmap out (max-norm distance from the camera, m); [0, 0] for no fade. */
  readonly fade: readonly [number, number];
  private readonly pos = new THREE.Vector2();
  private readonly size: number;
  private readonly blank: Uint8Array;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    bounds: Rect,
    private readonly cell: number,
    private readonly windowCells = 0,
  ) {
    const wrap = windowCells > 0;
    this.size = windowCells * cell;
    this.rect = wrap ? { x: 0, y: 0, w: this.size, h: this.size } : bounds;
    this.fade = wrap ? [this.size / 2 - cell * 0.6, this.size / 2 - 16] : [0, 0];
    const w = Math.ceil(this.rect.w * RES);
    const h = Math.ceil(this.rect.h * RES);
    this.texture = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    if (wrap) this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.needsUpdate = true;
    this.blank = new Uint8Array(cell * RES * cell * RES * 4);
    renderer.initTexture(this.texture);
  }

  /** (x0, z0, 1 / width, 1 / depth) for the material's uLightRect. */
  get uniformRect(): THREE.Vector4 {
    return new THREE.Vector4(this.rect.x, this.rect.y, 1 / this.rect.w, 1 / this.rect.h);
  }

  /** Uploads a painted tile for the cell whose NW corner is (x, z). */
  upload(x: number, z: number, data: Uint8Array): void {
    const S = this.cell * RES;
    const src = new THREE.DataTexture(data, S, S);
    if (this.windowCells > 0) {
      const slot = (v: number): number => ((((Math.round(v / this.cell)) % this.windowCells) + this.windowCells) % this.windowCells) * S;
      this.pos.set(slot(x), slot(z));
    } else this.pos.set(Math.round((x - this.rect.x) * RES), Math.round((z - this.rect.y) * RES));
    if (this.pos.x < 0 || this.pos.y < 0 || this.pos.x + S > this.texture.image.width || this.pos.y + S > this.texture.image.height) return;
    this.renderer.copyTextureToTexture(src, this.texture, null, this.pos);
    src.dispose();
  }

  /** Clears the tile of the cell whose NW corner is (x, z) (its chunk was dropped). */
  clear(x: number, z: number): void {
    this.upload(x, z, this.blank);
  }
}
