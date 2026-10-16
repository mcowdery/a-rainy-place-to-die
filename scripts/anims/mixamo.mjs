// Mixamo clips for the cast's animation library, for review: the .fbx files the user downloaded (Mixamo Downloader,
// juanjo4martinez, or by hand) cut to the library's shape in one file.
//
//   1. Unzip a pack's files into a folder of its own and run Blender over each folder:
//        "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/anims/mixamo_export.py -- <folder> <out.json>
//      (scripts/anims/mixamo_export.py: the motion of the bones the library uses, in a frame that faces +z.)
//   2. node scripts/anims/mixamo.mjs <out.json>[:prefix] ...      e.g.  .cache/mixamo-src/mixamo.json .cache/mixamo-src/mixamo_aa.json
//      writes assets/anims/review/mixamo.glb, a folder the library's glob doesn't take (so in no build, and nothing
//      to credit until a clip is chosen: then it moves up a folder and its entry goes into assets/anims/CREDITS.md).
//
// Mixamo (Adobe): free to use in games, commercial or not, the raw files not to be passed on, no machine learning on
// them (its FAQ, 2022; the current terms weren't read). Hence in `review/`, and no clip committed before the user
// has said which they use.
//
// What it makes of a clip: the bones under the cast's names, at rest in Mixamo's T-pose (the rest of every file is the
// same skeleton, checked), each clip's turns as in scripts/anims/cmu.mjs, the pelvis where it is, with the clip's way
// over the floor taken out (spread evenly, so a roll stays a roll but stays on the spot; the distance is printed).
// The fingers are carried (fifteen a hand: the cast's thumb_01_l.. as Mixamo's LeftHandThumb1..).
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'assets', 'anims', 'review');

const ORDER = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'];
const PARENT = { pelvis: 'Root', spine_01: 'pelvis', spine_02: 'spine_01', spine_03: 'spine_02', neck_01: 'spine_03', head: 'neck_01' };
for (const s of ['l', 'r']) {
  ORDER.push(`clavicle_${s}`, `upperarm_${s}`, `lowerarm_${s}`, `hand_${s}`, `thigh_${s}`, `calf_${s}`, `foot_${s}`, `ball_${s}`);
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    for (const k of [1, 2, 3]) {
      ORDER.push(`${f}_0${k}_${s}`);
      PARENT[`${f}_0${k}_${s}`] = k === 1 ? `hand_${s}` : `${f}_0${k - 1}_${s}`;
    }
  }
  Object.assign(PARENT, { [`clavicle_${s}`]: 'spine_03', [`upperarm_${s}`]: `clavicle_${s}`, [`lowerarm_${s}`]: `upperarm_${s}`, [`hand_${s}`]: `lowerarm_${s}`, [`thigh_${s}`]: 'pelvis', [`calf_${s}`]: `thigh_${s}`, [`foot_${s}`]: `calf_${s}`, [`ball_${s}`]: `foot_${s}` });
}

const clipName = (file, prefix) => `MX_${prefix}${file.replace(/\s*\((\d+)\)/g, '_$1').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

const sources = process.argv.slice(2);
if (!sources.length) {
  console.log('Usage: node scripts/anims/mixamo.mjs <clips.json>[:prefix] ...');
  process.exit(1);
}
// Clips come on one of a few skeletons (Mixamo's own, and the one of a pack's character, a few cm different in the
// stance): a file is written for each, since a clip is fitted from the rest of the file it's in.
const near = (a, b) => ORDER.every((k) => new THREE.Vector3(...a.rest[k]).distanceTo(new THREE.Vector3(...b.rest[k])) < 0.01);

async function write(group, file) {
  const rest = group[0].rest;
  // Every file should have the one skeleton at rest: a clip whose rest differs would be fitted wrongly.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const nodes = new Map([['Root', doc.createNode('Root')]]);
  scene.addChild(nodes.get('Root'));
  for (const bone of ORDER) {
    const node = doc.createNode(bone);
    const parent = PARENT[bone];
    const p = parent === 'Root' ? new THREE.Vector3(0, rest.pelvis[1], 0) : new THREE.Vector3(...rest[bone]).sub(new THREE.Vector3(...rest[parent]));
    node.setTranslation(p.toArray());
    nodes.get(parent).addChild(node);
    nodes.set(bone, node);
  }

  const report = [];
  for (const c of group) {
    const n = c.turns.pelvis.length;
    const rate = c.fps;
    const anim = doc.createAnimation(c.name);
    const times = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: n }, (_, i) => i / rate)).setBuffer(buffer);
    const add = (node, path, output) => {
      const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    };
    // The way over the floor taken out, spread evenly from the first frame to the last.
    const dx = c.hips[n - 1][0] - c.hips[0][0];
    const dz = c.hips[n - 1][2] - c.hips[0][2];
    const hips = c.hips.map((p, i) => [p[0] - c.hips[0][0] - (dx * i) / Math.max(1, n - 1), p[1], p[2] - c.hips[0][2] - (dz * i) / Math.max(1, n - 1)]);
    add(nodes.get('pelvis'), 'translation', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(hips.flat())).setBuffer(buffer));
    const world = Object.fromEntries(ORDER.map((b) => [b, c.turns[b].map((q) => new THREE.Quaternion(...q))]));
    for (const bone of ORDER) {
      const parent = PARENT[bone];
      const out = new Int16Array(n * 4);
      let last = null;
      for (let i = 0; i < n; i++) {
        const q = parent === 'Root' ? world[bone][i].clone() : world[parent][i].clone().invert().multiply(world[bone][i]);
        if (last && last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        last = q;
        q.toArray().forEach((v, k) => (out[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, v)) * 32767)));
      }
      add(nodes.get(bone), 'rotation', doc.createAccessor().setType('VEC4').setArray(out).setNormalized(true).setBuffer(buffer));
    }
    report.push(`  ${c.name}: ${(n / rate).toFixed(2)} s, ${Math.hypot(dx, dz).toFixed(2)} m on, hips ${Math.min(...hips.map((p) => p[1])).toFixed(2)}-${Math.max(...hips.map((p) => p[1])).toFixed(2)} m`);
  }

  await new NodeIO().write(file, doc);
  console.log(`${file}: ${group.length} clips, ${Math.round(statSync(file).size / 1024)} KB\n${report.join('\n')}`);
}

mkdirSync(OUT, { recursive: true });
// One file (or two, for a second skeleton) for each source json, named after it: mixamo_b03.json -> mixamo_b03.glb.
for (const src of sources) {
  const [file, prefix = ''] = src.split(/:(?=[^\/]*$)/);
  const data = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'));
  const groups = [];
  for (const [name, clip] of Object.entries(data)) {
    const c = { name: clipName(name, prefix), ...clip };
    const g = groups.find((g) => near(g[0], c));
    if (g) g.push(c);
    else groups.push([c]);
  }
  const stem = file.replace(/^.*[\/]/, '').replace(/\.json$/, '');
  for (const [i, g] of groups.entries()) await write(g, join(OUT, `${stem}${i ? `_${i + 1}` : ''}.glb`));
}
