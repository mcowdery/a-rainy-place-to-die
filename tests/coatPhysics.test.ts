import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CoatPhysics } from '../src/poc3d/models/coatPhysics';
import { retarget, rigFrom } from '../src/poc3d/models/characterAnims';

/**
 * Mack's trench on his real skeleton (assets/characters/mack_gen_coat.glb: scripts/coatBones.mjs's skirt chains) in the real
 * clips, skinned on the CPU: how often the skirt is inside a leg, and how low it hangs, with the coat simulated and, for
 * comparison, as it was (mack_gen.glb: skinned to the thighs).
 */

const io = new NodeIO();

async function load(path: string, wanted: readonly string[] = []) {
  const doc = await io.readBinary(new Uint8Array(readFileSync(path)));
  const root = doc.getRoot();
  const objs = new Map<unknown, THREE.Object3D>();
  for (const n of root.listNodes()) {
    const o = new THREE.Object3D();
    o.name = n.getName();
    o.position.fromArray(n.getTranslation());
    o.quaternion.fromArray(n.getRotation());
    o.scale.fromArray(n.getScale());
    objs.set(n, o);
  }
  for (const n of root.listNodes()) for (const c of n.listChildren()) objs.get(n)!.add(objs.get(c)!);
  const scene = new THREE.Object3D();
  for (const n of root.listScenes()[0].listChildren()) scene.add(objs.get(n)!);
  scene.updateMatrixWorld(true);
  const clips = root
    .listAnimations()
    .filter((a) => wanted.includes(a.getName()))
    .map((a) => {
      const tracks = a.listChannels().map((ch) => {
        const s = ch.getSampler()!;
        const times = Array.from(s.getInput()!.getArray()!);
        const values = Array.from(s.getOutput()!.getArray()!);
        const path = ch.getTargetPath();
        const name = `${ch.getTargetNode()!.getName()}.${path === 'rotation' ? 'quaternion' : path === 'translation' ? 'position' : 'scale'}`;
        return path === 'rotation' ? new THREE.QuaternionKeyframeTrack(name, times, values) : new THREE.VectorKeyframeTrack(name, times, values);
      });
      return new THREE.AnimationClip(a.getName(), -1, tracks);
    });
  const joint = (name: string) => scene.getObjectByName(name)!;
  // the coat's skin: its skirt vertices (below the hips, weighted only to what moves a skirt), for skinning on the CPU
  const jacket = root.listNodes().find((n) => n.getName() === 'mack.jacket');
  const skin = jacket?.getSkin();
  const joints = skin ? skin.listJoints().map((j) => objs.get(j)!) : [];
  const ibm = skin ? skin.getInverseBindMatrices()!.getArray()! : new Float32Array();
  const hipY = joint('pelvis').getWorldPosition(new THREE.Vector3()).y;
  const verts: { p: THREE.Vector3; j: number[]; w: number[] }[] = [];
  for (const prim of jacket ? jacket.getMesh()!.listPrimitives() : []) {
    const pos = prim.getAttribute('POSITION')!;
    const J = prim.getAttribute('JOINTS_0')!;
    const W = prim.getAttribute('WEIGHTS_0')!;
    for (let i = 0; i < pos.getCount(); i++) {
      const p = new THREE.Vector3().fromArray(pos.getElement(i, [0, 0, 0]));
      if (p.y >= hipY) continue;
      const j = J.getElement(i, []);
      const w = W.getElement(i, []);
      const names = j.map((x) => joints[x].name);
      if (!names.every((n, k) => w[k] < 0.01 || /^(pelvis|spine_01|thigh_[lr]|coat_\d+_\d+)$/.test(n))) continue;
      verts.push({ p, j, w });
    }
  }
  const m = new THREE.Matrix4();
  const mi = new THREE.Matrix4();
  const skinned = (): THREE.Vector3[] => {
    scene.updateMatrixWorld(true);
    return verts.map(({ p, j, w }) => {
      const out = new THREE.Vector3();
      const v = new THREE.Vector3();
      for (let k = 0; k < 4; k++) {
        if (w[k] < 1e-4) continue;
        mi.fromArray(ibm, j[k] * 16);
        m.multiplyMatrices(joints[j[k]].matrixWorld, mi);
        out.add(v.copy(p).applyMatrix4(m).multiplyScalar(w[k]));
      }
      return out;
    });
  };
  return { scene, clips, joint, root: joint('root') ?? joint('Root'), skinned, count: verts.length };
}

const rig = (r: THREE.Object3D) => rigFrom(r, (b) => b.matrixWorld);

/** Per frame of a clip: the share of skirt vertices inside a leg (by the leg's own radius), and the lowest one's height. */
function walk(fig: Awaited<ReturnType<typeof load>>, clip: THREE.AnimationClip, advance: (dt: number) => void) {
  const mixer = new THREE.AnimationMixer(fig.root);
  mixer.clipAction(clip).play();
  const caps = [['thigh_l', 'calf_l', 0.135, 0.105], ['calf_l', 'foot_l', 0.092, 0.08], ['thigh_r', 'calf_r', 0.135, 0.105], ['calf_r', 'foot_r', 0.092, 0.08]] as const;
  let worstInside = 0;
  let sumInside = 0;
  let lowest = Infinity;
  let frames = 0;
  const dt = 1 / 30;
  // two passes: the first warms the coat up (it starts at rest); the second is measured
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < clip.duration; t += dt) {
      mixer.setTime(t);
      fig.scene.updateMatrixWorld(true);
      advance(dt);
      if (pass === 0) continue;
      const pts = fig.skinned();
      let inside = 0;
      for (const p of pts) {
        for (const [a, b, ra, rb] of caps) {
          const A = fig.joint(a).getWorldPosition(new THREE.Vector3());
          const B = fig.joint(b).getWorldPosition(new THREE.Vector3());
          const ab = B.clone().sub(A);
          const u = THREE.MathUtils.clamp(p.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1);
          const d = p.distanceTo(A.addScaledVector(ab, u));
          // inside the leg: closer to its axis than its own radius
          if (d < (ra + (rb - ra) * u)) {
            inside++;
            break;
          }
        }
        lowest = Math.min(lowest, p.y);
      }
      worstInside = Math.max(worstInside, inside / pts.length);
      sumInside += inside / pts.length;
      frames++;
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(fig.root);
  return { worstInside, meanInside: sumInside / frames, lowest };
}

/** The same share with the figure standing in its bind pose: what's inside a leg just by lying on it. */
function atRest(fig: Awaited<ReturnType<typeof load>>): number {
  const caps = [['thigh_l', 'calf_l', 0.135, 0.105], ['calf_l', 'foot_l', 0.092, 0.08], ['thigh_r', 'calf_r', 0.135, 0.105], ['calf_r', 'foot_r', 0.092, 0.08]] as const;
  fig.scene.updateMatrixWorld(true);
  const pts = fig.skinned();
  let inside = 0;
  for (const p of pts) {
    for (const [a, b, ra, rb] of caps) {
      const A = fig.joint(a).getWorldPosition(new THREE.Vector3());
      const B = fig.joint(b).getWorldPosition(new THREE.Vector3());
      const ab = B.clone().sub(A);
      const u = THREE.MathUtils.clamp(p.clone().sub(A).dot(ab) / ab.lengthSq(), 0, 1);
      if (p.distanceTo(A.addScaledVector(ab, u)) < ra + (rb - ra) * u) {
        inside++;
        break;
      }
    }
  }
  return inside / pts.length;
}

describe('the coat on Mack', () => {
  it('has chain bones and keeps the skirt out of his legs in a walk, where the thigh-skinned one went through', async () => {
    const names = ['Walk_Loop', 'Jog_Fwd_Loop', 'Crouch_Idle_Loop'];
    const lib = await load('assets/anims/ual1.glb', names);
    const old = await load('assets/characters/mack_gen.glb');
    const coat = await load('assets/characters/mack_gen_coat.glb');
    expect(coat.count).toBeGreaterThan(300);
    const sim = CoatPhysics.of(coat.scene)!;
    if (process.env.COAT_CLEARANCE) sim.options.clearance = Number(process.env.COAT_CLEARANCE);
    expect(sim).not.toBeNull();
    const rows: string[] = [`at rest (standing): ${(atRest(old) * 100).toFixed(1)}% inside a leg by the same measure`];
    for (const name of names) {
      const clip = lib.clips.find((c) => c.name === name)!;
      const before = walk(old, retarget(clip, rig(lib.root), rig(old.root)), () => {});
      const after = walk(coat, retarget(clip, rig(lib.root), rig(coat.root)), (dt) => sim.update(dt));
      rows.push(`${name}: skirt inside a leg, mean ${(before.meanInside * 100).toFixed(1)}% → ${(after.meanInside * 100).toFixed(1)}%, worst ${(before.worstInside * 100).toFixed(1)}% → ${(after.worstInside * 100).toFixed(1)}%; lowest ${before.lowest.toFixed(3)} → ${after.lowest.toFixed(3)} m`);
      expect(after.worstInside, name).toBeLessThanOrEqual(before.worstInside);
      expect(after.lowest, `${name} stays above the floor`).toBeGreaterThan(-0.01);
    }
    if (process.env.COAT_REPORT) throw new Error('\n' + rows.join('\n'));
  }, 120_000);
});
