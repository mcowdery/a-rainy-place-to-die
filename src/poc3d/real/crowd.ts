import * as THREE from 'three';
import { FIGURE_ATTRS, FIGURE_STRIDE, TEMPLATE_COUNT, templateGeometry } from './people';

interface Batch {
  readonly mesh: THREE.Mesh;
  readonly geo: THREE.InstancedBufferGeometry;
  readonly attrs: THREE.InstancedBufferAttribute[];
  cap: number;
}

/**
 * The streets' crowds, drawn instanced: one draw per template (body, hair, coat; and the umbrellas) for every
 * figure in range, each figure a few numbers (people.ts `packFigures`) that the material poses and animates.
 * Chunks hand over their figures as they're built and drop them when they go; `show` says which chunks'
 * people are drawn (in range and not hidden behind others); the instance buffers are rebuilt only when that
 * changes.
 */
export class Crowd {
  readonly group = new THREE.Group();
  /** People carry their umbrellas (while it rains). */
  umbrellas = false;
  private readonly chunks = new Map<number, Float32Array>();
  private shown = new Set<number>();
  private readonly batches = new Map<number, Batch>();
  private dirty = false;
  private umbrellasShown = false;

  constructor(private readonly material: THREE.Material) {
    this.group.name = 'crowd';
    this.group.matrixAutoUpdate = false;
  }

  /** A chunk's figures (FIGURE_STRIDE floats each), or null when it's dropped. */
  set(key: number, figures: Float32Array | null): void {
    if (figures && figures.length > 0) this.chunks.set(key, figures);
    else if (!this.chunks.delete(key)) return;
    if (this.shown.has(key)) this.dirty = true;
  }

  /** The chunks whose people are drawn this frame. */
  show(keys: ReadonlySet<number>): void {
    if (keys.size === this.shown.size && [...keys].every((k) => this.shown.has(k))) return;
    this.shown = new Set(keys);
    this.dirty = true;
  }

  /** Rebuilds the instance buffers if what's shown changed. */
  update(): void {
    if (this.umbrellas !== this.umbrellasShown) {
      this.umbrellasShown = this.umbrellas;
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    // Count each template's figures, then fill.
    const counts = new Map<number, number>();
    // (A figure's umbrella is its body's umbrella template: people.ts umbrellaIndex.)
    const umbrella = (f: Float32Array, k: number): number => TEMPLATE_COUNT + f[k + 5];
    for (const key of this.shown) {
      const f = this.chunks.get(key);
      if (!f) continue;
      for (let k = 0; k < f.length; k += FIGURE_STRIDE) {
        counts.set(f[k], (counts.get(f[k]) ?? 0) + 1);
        if (this.umbrellas && f[k + 19] > 0) counts.set(umbrella(f, k), (counts.get(umbrella(f, k)) ?? 0) + 1);
      }
    }
    for (const [t, b] of this.batches) if (!counts.has(t)) b.mesh.visible = false;
    const fill = new Map<number, number>();
    for (const [t, n] of counts) {
      const b = this.batch(t, n);
      b.mesh.visible = true;
      b.geo.instanceCount = n;
      fill.set(t, 0);
    }
    for (const key of this.shown) {
      const f = this.chunks.get(key);
      if (!f) continue;
      for (let k = 0; k < f.length; k += FIGURE_STRIDE) {
        this.write(f[k], f, k, fill);
        if (this.umbrellas && f[k + 19] > 0) this.write(umbrella(f, k), f, k, fill);
      }
    }
    for (const [t, n] of counts) {
      for (const a of this.batches.get(t)!.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  private write(t: number, f: Float32Array, k: number, fill: Map<number, number>): void {
    const b = this.batches.get(t)!;
    const i = fill.get(t)!;
    fill.set(t, i + 1);
    FIGURE_ATTRS.forEach((spec, j) => {
      const arr = b.attrs[j].array as Float32Array;
      const m = spec.at.length;
      for (let c = 0; c < m; c++) arr[i * m + c] = f[k + spec.at[c]];
    });
  }

  /** The template's batch, with room for n figures. */
  private batch(t: number, n: number): Batch {
    let b = this.batches.get(t);
    if (b && b.cap >= n) return b;
    const cap = Math.max(16, Math.ceil(n * 1.5));
    if (!b) {
      const base = templateGeometry(t);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const [name, attr] of Object.entries(base.attributes)) geo.setAttribute(name, attr);
      const mesh = new THREE.Mesh(geo, this.material);
      // The figures are everywhere in range (the vertex shader places them): never culled as one box.
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      b = { mesh, geo, attrs: [], cap: 0 };
      this.batches.set(t, b);
    }
    const attrs = FIGURE_ATTRS.map((spec) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * spec.at.length), spec.at.length);
      a.setUsage(THREE.DynamicDrawUsage);
      b!.geo.setAttribute(spec.name, a);
      return a;
    });
    b.attrs.splice(0, b.attrs.length, ...attrs);
    b.cap = cap;
    return b;
  }
}
