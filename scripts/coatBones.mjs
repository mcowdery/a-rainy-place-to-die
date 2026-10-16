// Gives a character's coat skirt bones to hang from: a ring of chains round the hips, each of three bones down to the
// hem, and the skirt's vertices reweighted to them (models/coatPhysics.ts then moves the chain bones each frame).
//
//   node scripts/coatBones.mjs <in.glb> <out.glb> [--mesh mack.jacket] [--chains 10] [--bones 3]
//
// A skirt vertex is one that's below the pelvis and moved only by the pelvis, the lowest spine bone and the thighs (a
// sleeve's cuff hangs as low and isn't). It's blended by angle round the hips between the two nearest chains and by
// height between the two nearest bones of a chain (the pelvis counting as each chain's top), so up to four bones move it.
// The chain bones are named coat_<chain>_<bone> and parented down from the pelvis, their rest turn the world's, so a
// chain's bone is a point that can be put anywhere; their rest places are the mean of the skirt's vertices round that
// angle and height. Nothing else in the file changes. A file that already has coat bones is left as it is.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const args = process.argv.slice(2);
const flag = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const [input, output] = files;
if (!input || !output) {
  console.log('Usage: node scripts/coatBones.mjs <in.glb> <out.glb> [--mesh mack.jacket] [--chains 10] [--bones 3]');
  process.exit(1);
}
const meshNode = flag('mesh', 'mack.jacket');
const S = Number(flag('chains', 10));
const K = Number(flag('bones', 3));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const nodes = root.listNodes().filter((n) => n.getName() === meshNode && n.getMesh() && n.getSkin());
if (!nodes.length) throw new Error(`no skinned mesh node called ${meshNode}`);
const skin = nodes[0].getSkin();
if (nodes.some((n) => n.getSkin() !== skin)) throw new Error('the coat\'s pieces use different skins');
if (skin.listJoints().some((j) => j.getName().startsWith('coat_'))) {
  console.log('already has coat bones; left as it is');
  process.exit(0);
}
const joints = skin.listJoints();
const index = new Map(joints.map((j, i) => [j.getName(), i]));
const pelvis = joints.find((j) => j.getName() === 'pelvis');
const skirtBones = new Set(['pelvis', 'spine_01', 'thigh_l', 'thigh_r'].map((n) => index.get(n)));

// the skirt's vertices, in the model's space (the mesh nodes sit at the origin in these files; asserted)
const pieces = [];
for (const n of nodes) {
  const m = new THREE.Matrix4().fromArray(n.getWorldMatrix());
  if (!m.equals(new THREE.Matrix4())) throw new Error(`${n.getName()} isn't at the origin: not handled`);
  for (const prim of n.getMesh().listPrimitives()) pieces.push(prim);
}
const pw = new THREE.Matrix4().fromArray(pelvis.getWorldMatrix());
const hip = new THREE.Vector3().setFromMatrixPosition(pw);
const skirt = []; // { prim, i, p }
for (const prim of pieces) {
  const pos = prim.getAttribute('POSITION');
  const J = prim.getAttribute('JOINTS_0');
  const W = prim.getAttribute('WEIGHTS_0');
  for (let i = 0; i < pos.getCount(); i++) {
    const p = pos.getElement(i, []);
    if (p[1] >= hip.y) continue;
    const j = J.getElement(i, []);
    const w = W.getElement(i, []);
    let on = 0;
    for (let k = 0; k < 4; k++) if (skirtBones.has(j[k])) on += w[k];
    if (on >= 0.95) skirt.push({ prim, i, p: new THREE.Vector3(...p) });
  }
}
if (!skirt.length) throw new Error('no skirt vertices found');
const hem = Math.min(...skirt.map((v) => v.p.y));
const L = (hip.y - hem) / K;
console.log(`skirt: ${skirt.length} vertices from ${hip.y.toFixed(2)} m down to ${hem.toFixed(2)} m; ${S} chains of ${K} bones, ${L.toFixed(3)} m apart`);

const angleOf = (p) => Math.atan2(p.x - hip.x, p.z - hip.z); // 0 forward (+z), turning towards +x
const TAU = Math.PI * 2;
const norm = (a) => ((a % TAU) + TAU) % TAU;

// each chain bone's rest place: the mean of the vertices round its angle (within a chain's width) and height (within one step)
const place = [];
for (let s = 0; s < S; s++) {
  const a = (s * TAU) / S;
  place.push([]);
  for (let k = 1; k <= K; k++) {
    const y = hip.y - k * L;
    const near = skirt.filter((v) => Math.abs(((norm(angleOf(v.p)) - a + Math.PI) % TAU) - Math.PI) < TAU / S && Math.abs(v.p.y - y) < L * 0.6);
    const c = new THREE.Vector3();
    if (near.length) near.forEach((v) => c.add(v.p)), c.divideScalar(near.length);
    else {
      // nothing there (the coat's open at the front): on the ring the neighbours make, at this height
      const r = Math.sqrt(skirt.reduce((m, v) => m + (v.p.x - hip.x) ** 2 + (v.p.z - hip.z) ** 2, 0) / skirt.length);
      c.set(hip.x + Math.sin(a) * r, y, hip.z + Math.cos(a) * r);
    }
    c.y = y;
    place[s].push(c);
  }
}

// the new joints: world rest turn the identity, parented down from the pelvis
const made = []; // made[s][k - 1] = node
const ibms = [];
for (let s = 0; s < S; s++) {
  made.push([]);
  let parent = pelvis;
  for (let k = 1; k <= K; k++) {
    const node = doc.createNode(`coat_${s}_${k}`);
    const pm = new THREE.Matrix4().fromArray(parent.getWorldMatrix());
    const local = pm.clone().invert().multiply(new THREE.Matrix4().makeTranslation(place[s][k - 1].x, place[s][k - 1].y, place[s][k - 1].z));
    const t = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    local.decompose(t, q, sc);
    node.setTranslation(t.toArray()).setRotation(q.toArray()).setScale(sc.toArray());
    parent.addChild(node);
    skin.addJoint(node);
    ibms.push(new THREE.Matrix4().makeTranslation(-place[s][k - 1].x, -place[s][k - 1].y, -place[s][k - 1].z));
    made[s].push(node);
    parent = node;
  }
}
const allJoints = skin.listJoints();
const jointIndex = (node) => allJoints.indexOf(node);

// the inverse bind matrices, the old ones then the new
const ibmAcc = skin.getInverseBindMatrices();
const old = ibmAcc.getArray();
const out = new Float32Array(old.length + ibms.length * 16);
out.set(old);
ibms.forEach((m, i) => out.set(m.elements, old.length + i * 16));
ibmAcc.setArray(out);

// the weights: blended by angle between two chains and by height between two bones (the pelvis the top one)
let reweighted = 0;
const touched = new Set();
for (const v of skirt) {
  const f = (norm(angleOf(v.p)) / TAU) * S;
  const a = Math.floor(f) % S;
  const b = (a + 1) % S;
  const u = f - Math.floor(f);
  const h = Math.min(Math.max((hip.y - v.p.y) / L, 0), K); // 0 at the hips, K at the hem
  const k0 = Math.min(Math.floor(h), K - 1 + (h >= K ? 1 : 0));
  const t = h >= K ? 0 : h - k0;
  const bone = (s, k) => (k === 0 ? pelvis : made[s][k - 1]);
  const picks = new Map();
  const add = (node, w) => w > 1e-4 && picks.set(jointIndex(node), (picks.get(jointIndex(node)) ?? 0) + w);
  for (const [s, ws] of [[a, 1 - u], [b, u]]) {
    add(bone(s, k0), ws * (1 - t));
    if (t > 0) add(bone(s, k0 + 1), ws * t);
  }
  const top = [...picks].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = top.reduce((m, [, w]) => m + w, 0);
  const j = [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  top.forEach(([ji, wi], n) => ((j[n] = ji), (w[n] = wi / sum)));
  v.prim.getAttribute('JOINTS_0').setElement(v.i, j);
  v.prim.getAttribute('WEIGHTS_0').setElement(v.i, w);
  touched.add(v.prim);
  reweighted++;
}
console.log(`reweighted ${reweighted} vertices; ${S * K} bones added`);
await io.write(output, doc);
console.log('wrote', output);
