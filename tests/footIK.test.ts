import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { retarget, rigFrom } from '../src/poc3d/models/characterAnims';

/**
 * Library clips fitted to Mack (the real files): the feet's height against his rest, and with `footIK` the planted
 * feet held still without the swing jumping. Measured at the ankle joints, as the clip moves them.
 */

const io = new NodeIO();
/** A file's node tree as Object3Ds at rest, and the clips asked for (read with glTF-Transform: no loader, no textures). */
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
  return { scene, clips, joint, root: joint('root') ?? joint('Root') };
}

const rig = (r: THREE.Object3D) => rigFrom(r, (b) => b.matrixWorld);
type Figure = Awaited<ReturnType<typeof load>>;

/** The ankles' paths through a clip played on a figure, 90 steps. */
function ankles(fig: Figure, clip: THREE.AnimationClip): THREE.Vector3[][] {
  const mixer = new THREE.AnimationMixer(fig.root);
  mixer.clipAction(clip).play();
  const paths: THREE.Vector3[][] = [[], []];
  for (let i = 0; i <= 90; i++) {
    mixer.setTime((clip.duration * i) / 90);
    fig.scene.updateMatrixWorld(true);
    ['foot_l', 'foot_r'].forEach((f, k) => paths[k].push(fig.joint(f).getWorldPosition(new THREE.Vector3())));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(fig.root);
  return paths;
}

/** Each planted step's slide against the ground's common motion (m), and the worst one-frame jump off an ankle's path (m). */
function measure(paths: THREE.Vector3[][], dt: number) {
  const low = Math.min(...paths.flat().map((p) => p.y));
  const down = paths.map((ps) => ps.map((p) => p.y < low + 0.025));
  const vs: THREE.Vector3[] = [];
  paths.forEach((ps, k) => {
    for (let i = 0; i + 1 < ps.length; i++) if (down[k][i] && down[k][i + 1]) vs.push(ps[i + 1].clone().sub(ps[i]).setY(0).divideScalar(dt));
  });
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
  const ground = new THREE.Vector3(median(vs.map((v) => v.x)), 0, median(vs.map((v) => v.z)));
  const steps: number[] = [];
  let jump = 0;
  paths.forEach((ps, k) => {
    let run = 0;
    for (let i = 0; i + 1 < ps.length; i++) {
      if (down[k][i] && down[k][i + 1]) run += ps[i + 1].clone().sub(ps[i]).setY(0).addScaledVector(ground, -dt).length();
      else if (run) steps.push(run), (run = 0);
      if (i > 0) jump = Math.max(jump, ps[i + 1].clone().addScaledVector(ps[i], -2).add(ps[i - 1]).length());
    }
    if (run) steps.push(run);
  });
  return { steps, jump };
}

describe('library clips on Mack', () => {
  it('keep his feet at their rest height standing, and hold them still walking with footIK', async () => {
    const mack = await load('assets/characters/mack_gen.glb');
    const lib = await load('assets/anims/ual1.glb', ['Punch_Jab', 'Pistol_Idle_Loop', 'Walk_Loop']);
    const cmu = await load('assets/anims/cmu_35.glb', ['Walk_35_Loop']);
    const dst = rig(mack.root);
    const restY = ['foot_l', 'foot_r'].map((f) => mack.joint(f).getWorldPosition(new THREE.Vector3()).y);
    const fit = (from: Figure, name: string, footIK = false) => retarget(from.clips.find((c) => c.name === name)!, rig(from.root), dst, { footIK });

    // standing: the lower ankle within 5 mm of where it rests (it sank 1 to 3 cm before the planting)
    for (const name of ['Punch_Jab', 'Pistol_Idle_Loop']) {
      const paths = ankles(mack, fit(lib, name));
      const lowest = Math.min(...paths[0].map((p, i) => Math.min(p.y - restY[0], paths[1][i].y - restY[1])));
      expect(Math.abs(lowest), name).toBeLessThan(0.005);
    }
    // walking: with footIK, no planted step slides more than 2 cm, and the swing jumps no more than 2.5 cm a frame
    for (const [from, name] of [[cmu, 'Walk_35_Loop'], [lib, 'Walk_Loop']] as const) {
      const clip = fit(from, name, true);
      const plain = measure(ankles(mack, fit(from, name)), clip.duration / 90);
      const held = measure(ankles(mack, clip), clip.duration / 90);
      expect(Math.max(...held.steps), name).toBeLessThan(0.02);
      expect(Math.max(...held.steps), name).toBeLessThan(Math.max(...plain.steps));
      expect(held.jump, name).toBeLessThan(0.025);
    }
  }, 60_000);
});
