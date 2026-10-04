import * as THREE from 'three';

/**
 * Cutting a part off a skinned cast model (models/characters.ts) for the kill moves (models/killMoves.ts):
 *
 * - `cutPart` builds a plain mesh of what hangs off a bone (the head: every triangle whose vertices are mostly
 *   weighted to the bone or below it, the hair, brows and eyes with it), from the body as it's posed this
 *   instant, centred on itself, with the same materials: the piece that flies off.
 * - `collapse` folds that bone away on the body (scaled to nothing, so what it carries shrinks into the joint)
 *   and caps the wound with a stump on the bone above.
 *
 * Skinned bodies can't be cut through their mesh at run time; this is the usual trick.
 */

/** The bone and every bone below it, as indices into a skeleton. */
function boneSet(skel: THREE.Skeleton, root: THREE.Bone): Set<number> {
  const set = new Set<number>();
  root.traverse((o) => {
    const i = skel.bones.indexOf(o as THREE.Bone);
    if (i >= 0) set.add(i);
  });
  return set;
}

/** The piece hanging off `bone` (by name, so it finds the bone in each skinned mesh of `model`), as a mesh
 * group in world space, centred: its position is the piece's middle. */
export function cutPart(model: THREE.Object3D, boneName: string): THREE.Group {
  model.updateMatrixWorld(true);
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  const box = new THREE.Box3();
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const bone = m.skeleton.bones.find((b) => b.name === boneName);
    if (!bone) return;
    const set = boneSet(m.skeleton, bone);
    const geo = m.geometry;
    const pos = geo.attributes.position;
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const uv = geo.attributes.uv;
    // How much of each vertex goes with the part.
    const share = new Float32Array(pos.count);
    for (let v = 0; v < pos.count; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (set.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
      share[v] = w;
    }
    const index = geo.index;
    const tri = index ? index.count / 3 : pos.count / 3;
    const at = (i: number): number => (index ? index.getX(i) : i);
    const outPos: number[] = [];
    const outUv: number[] = [];
    const p = new THREE.Vector3();
    // Material groups kept: one output group per source group.
    const groups = geo.groups.length > 0 ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    const outGroups: { start: number; count: number; materialIndex: number }[] = [];
    for (const g of groups) {
      const start = outPos.length / 3;
      for (let t = g.start / 3; t < (g.start + g.count) / 3 && t < tri; t++) {
        const a = at(t * 3);
        const b = at(t * 3 + 1);
        const c = at(t * 3 + 2);
        if (share[a] < 0.5 || share[b] < 0.5 || share[c] < 0.5) continue;
        for (const v of [a, b, c]) {
          m.getVertexPosition(v, p);
          p.applyMatrix4(m.matrixWorld);
          outPos.push(p.x, p.y, p.z);
          box.expandByPoint(p);
          if (uv) outUv.push(uv.getX(v), uv.getY(v));
        }
      }
      const count = outPos.length / 3 - start;
      if (count > 0) outGroups.push({ start, count, materialIndex: g.materialIndex ?? 0 });
    }
    if (outPos.length === 0) return;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2));
    for (const g of outGroups) out.addGroup(g.start, g.count, g.materialIndex);
    out.computeVertexNormals();
    const mesh = new THREE.Mesh(out, m.material);
    mesh.castShadow = true;
    meshes.push(mesh);
  });
  const centre = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  for (const mesh of meshes) {
    mesh.geometry.translate(-centre.x, -centre.y, -centre.z);
    group.add(mesh);
  }
  // The cut face: a dark red cap under it, toward the neck.
  group.position.copy(centre);
  return group;
}

const stumpMat = new THREE.MeshStandardMaterial({ color: 0x4a0208, roughness: 0.35 });
const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.6 });

/** A wound's face: raw flesh round a pale bone, `r` across, facing +y. */
export function stumpMesh(r: number): THREE.Group {
  const g = new THREE.Group();
  const flesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, r * 0.5, 16), stumpMat);
  flesh.position.y = -r * 0.2;
  g.add(flesh);
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 0.6, 10), boneMat);
  bone.position.set(0, -r * 0.05, -r * 0.25);
  g.add(bone);
  return g;
}

/**
 * Folds `bone` away on the body (it and all it carries shrink into its joint) and caps the joint with a stump
 * facing along the bone, stuck to the bone above. Returns the stump.
 */
export function collapse(bone: THREE.Bone, r: number): THREE.Object3D {
  const parent = bone.parent as THREE.Bone;
  bone.updateWorldMatrix(true, false);
  const at = bone.getWorldPosition(new THREE.Vector3());
  const along = at.clone().sub(parent.getWorldPosition(new THREE.Vector3())).normalize();
  bone.scale.setScalar(0.001);
  const stump = stumpMesh(r);
  stump.position.copy(at);
  stump.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
  parent.attach(stump);
  return stump;
}
