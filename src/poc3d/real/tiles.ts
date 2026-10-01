import * as THREE from 'three';

/**
 * Cuts a merged, indexed geometry into square tiles by where each triangle's centre falls, so a city-wide
 * mesh (the expressway, a viaduct) is culled a tile at a time instead of always drawn whole. Every attribute
 * is carried over; each tile keeps only the vertices it uses and has its own bounding sphere.
 */
export function splitByTile(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry[] {
  const index = geo.index;
  const pos = geo.attributes.position;
  const triCount = (index ? index.count : pos.count) / 3;
  const vert = (t: number, k: number): number => (index ? index.getX(t * 3 + k) : t * 3 + k);
  const groups = new Map<string, number[]>();
  for (let t = 0; t < triCount; t++) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 3; k++) {
      x += pos.getX(vert(t, k));
      z += pos.getZ(vert(t, k));
    }
    const key = `${Math.floor(x / 3 / tile)},${Math.floor(z / 3 / tile)}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(t);
  }
  const out: THREE.BufferGeometry[] = [];
  const names = Object.keys(geo.attributes);
  for (const tris of groups.values()) {
    const remap = new Map<number, number>();
    const idx = new Uint32Array(tris.length * 3);
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const v = vert(t, k);
        let n = remap.get(v);
        if (n === undefined) remap.set(v, (n = remap.size));
        idx[i * 3 + k] = n;
      }
    });
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const a = geo.attributes[name] as THREE.BufferAttribute;
      const size = a.itemSize;
      const src = a.array as ArrayLike<number>;
      const Ctor = (a.array as Float32Array).constructor as new (n: number) => Float32Array;
      const arr = new Ctor(remap.size * size);
      for (const [from, to] of remap) for (let c = 0; c < size; c++) arr[to * size + c] = src[from * size + c];
      g.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}
