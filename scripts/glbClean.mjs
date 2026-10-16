// Takes the debris out of a .glb without touching anything else: specks (small pieces of a mesh sitting apart from
// the rest of it: a generated head's bake leaves bits of hair floating off the fringe) and triangles with no area.
// Only index buffers change; vertices, materials, skins and textures are left as they are.
//
//   node scripts/glbClean.mjs <in.glb> [out.glb] [--mesh name,name] [--specks 8] [--gap 0.004] [--dry]
//
//   --specks n   a piece of at most n distinct points is a speck if no point of it is within --gap (metres) of the
//                rest of its mesh (default 8 points, 4 mm). A piece is found with the points welded by position, since
//                glTF splits a mesh at every UV seam.
//   --mesh       only these meshes (by name); default all.
//   --dry        say what it would take out, write nothing.
// Out defaults to the input (overwritten). Find what to take out first with asset-check (its "floating" and "faces with
// no area" faults), and look at it there: a piece sitting just off on purpose (an epaulette, a belt's end) isn't debris.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const args = process.argv.slice(2);
const flag = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--dry'));
const [input, output = input] = files;
if (!input) {
  console.log('Usage: node scripts/glbClean.mjs <in.glb> [out.glb] [--mesh names] [--specks 8] [--gap 0.004] [--dry]');
  process.exit(1);
}
const maxPoints = Number(flag('specks', 8));
const gap = Number(flag('gap', 0.004));
const only = flag('mesh', null)?.split(',');
const dry = args.includes('--dry');

/** Distance from point q to the triangle a, b, c (vertex numbers into the flat positions p). */
function toTriangle(q, a, b, c, p) {
  const A = [p[a * 3], p[a * 3 + 1], p[a * 3 + 2]];
  const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub([p[b * 3], p[b * 3 + 1], p[b * 3 + 2]], A);
  const ac = sub([p[c * 3], p[c * 3 + 1], p[c * 3 + 2]], A);
  const ap = sub(q, A);
  // the closest point by region (Ericson, Real-Time Collision Detection 5.1.5)
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let s, t;
  if (d1 <= 0 && d2 <= 0) [s, t] = [0, 0];
  else {
    const bp = sub(ap, ab), d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = sub(ap, ac), d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) [s, t] = [1, 0];
    else if (d6 >= 0 && d5 <= d6) [s, t] = [0, 1];
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) [s, t] = [d1 / (d1 - d3), 0];
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) [s, t] = [0, d2 / (d2 - d6)];
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
      const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
      [s, t] = [1 - w, w];
    } else {
      const den = 1 / (va + vb + vc);
      [s, t] = [vb * den, vc * den];
    }
  }
  const x = [A[0] + ab[0] * s + ac[0] * t, A[1] + ab[1] * s + ac[1] * t, A[2] + ab[2] * s + ac[2] * t];
  return Math.hypot(q[0] - x[0], q[1] - x[1], q[2] - x[2]);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
let removedTris = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  if (only && !only.includes(mesh.getName())) continue;
  for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    if (!indices || !pos || prim.getMode() !== 4) continue;
    const idx = indices.getArray();
    const n = pos.getCount();
    const p = pos.getArray();
    // weld by position (to 0.01 mm): one id a point
    const key = new Map();
    const weld = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(p[i * 3] * 1e5)},${Math.round(p[i * 3 + 1] * 1e5)},${Math.round(p[i * 3 + 2] * 1e5)}`;
      if (!key.has(k)) key.set(k, key.size);
      weld[i] = key.get(k);
    }
    // pieces: union-find over the triangles' welded points
    const up = Int32Array.from({ length: key.size }, (_, i) => i);
    const find = (a) => {
      while (up[a] !== a) a = up[a] = up[up[a]];
      return a;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = find(weld[idx[t]]);
      for (const v of [idx[t + 1], idx[t + 2]]) {
        const b = find(weld[v]);
        if (a !== b) up[b] = a;
      }
    }
    const members = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(weld[i]);
      if (!members.has(r)) members.set(r, new Set());
      members.get(r).add(i);
    }
    // a small piece with no other surface of the mesh near it (to the triangles, not their corners: on a coarse mesh
    // a bit lying on the surface can be far from every vertex)
    const specks = new Set();
    for (const [r, set] of members) {
      const points = new Set([...set].map((i) => weld[i]));
      if (points.size > maxPoints) continue;
      let near = Infinity;
      for (const i of set) {
        const q = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
        for (let t = 0; t < idx.length && near > gap; t += 3) {
          if (find(weld[idx[t]]) === r) continue;
          const d = toTriangle(q, idx[t], idx[t + 1], idx[t + 2], p);
          if (d < near) near = d;
        }
      }
      if (near > gap) {
        specks.add(r);
        const c = [...set][0];
        console.log(`${mesh.getName()}: speck of ${points.size} points, ${(near * 1000).toFixed(1)} mm off, at ${[0, 1, 2].map((k) => p[c * 3 + k].toFixed(3)).join(', ')}`);
      }
    }
    const keep = [];
    let flat = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      if (specks.has(find(weld[a]))) continue;
      const u = [0, 1, 2].map((k) => p[b * 3 + k] - p[a * 3 + k]);
      const v = [0, 1, 2].map((k) => p[c * 3 + k] - p[a * 3 + k]);
      const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
      if (area < 1e-10) {
        flat++;
        continue;
      }
      keep.push(a, b, c);
    }
    if (flat) console.log(`${mesh.getName()}: ${flat} triangles with no area`);
    const gone = (idx.length - keep.length) / 3;
    removedTris += gone;
    if (gone && !dry) indices.setArray(new idx.constructor(keep));
  }
}
console.log(`${dry ? 'would take out' : 'took out'} ${removedTris} triangles${dry ? '' : `; wrote ${output}`}`);
if (!dry && removedTris) await io.write(output, doc);
