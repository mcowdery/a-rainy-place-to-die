import * as THREE from 'three';

/**
 * Geometry as plain typed arrays, so a Web Worker can build it and hand it to the main thread without
 * copying (the arrays are transferred). The bounding sphere is computed on the building side too, so the
 * main thread does nothing per vertex.
 */
export interface RawGeometry {
  readonly attrs: Record<string, { readonly array: Float32Array; readonly size: number }>;
  readonly index: Uint32Array;
  /** Bounding sphere: centre x, y, z and radius. */
  readonly sphere: readonly [number, number, number, number];
}

/** Bounding sphere of a position array (box centre, max distance). */
export function sphereOf(p: Float32Array): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx, dy = p[i + 1] - cy, dz = p[i + 2] - cz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return [cx, cy, cz, Math.sqrt(r2)];
}

/** Bytes the GPU has to receive for this geometry. */
export function rawBytes(r: RawGeometry | null | undefined): number {
  if (!r) return 0;
  let n = r.index.byteLength;
  for (const a of Object.values(r.attrs)) n += a.array.byteLength;
  return n;
}

export const rawTriangles = (r: RawGeometry | null): number => (r ? r.index.length / 3 : 0);

/** The buffers to list in postMessage's transfer list. */
export function rawTransfer(rs: readonly (RawGeometry | null)[]): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const r of rs) {
    if (!r) continue;
    for (const a of Object.values(r.attrs)) out.push(a.array.buffer as ArrayBuffer);
    out.push(r.index.buffer as ArrayBuffer);
  }
  return out;
}

export function toGeometry(r: RawGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(r.attrs)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.size));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(r.sphere[0], r.sphere[1], r.sphere[2]), r.sphere[3]);
  return g;
}
