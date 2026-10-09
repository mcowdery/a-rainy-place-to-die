// Runs in a hundred manners, for the cast's animation library: one stride of each of a few styles of the 100STYLE
// dataset (Ian Mason, Sebastian Starke, Taku Komura; https://www.ianxmason.com/100style/: "This work is licensed
// under a Creative Commons Attribution 4.0 International License", credit asked as "The 100STYLE Dataset - Ian
// Mason"; credited in CREDITS.md and assets/anims/CREDITS.md), made into loops that run on the spot.
//
//   node scripts/anims/style100.mjs
//
//   Wants the dataset's zip of .bvh files at .cache/100style/100STYLE.zip (git-ignored; 1.4 GB, from
//   https://zenodo.org/records/8127870/files/100STYLE.zip) and unpacks from it only the files named below. Writes
//   assets/anims/review/style100.glb in the shape the library's other files have (scripts/anims/build.mjs): bones under the
//   cast's names, at rest in the capture's own zero pose, which is a T-pose facing +z, so models/characterAnims.ts
//   fits the clips as it does the rest.
//
//   Each file is over a minute of one man running about a floor in one manner. Of it this keeps one stride, left heel
//   to left heel: of the strides that go straight and aren't the slow ones, the one whose end is most like its start;
//   turned to run towards +z; the travel taken out, so the hips stay over the origin; and what's left of the gap
//   between its end and its start spread over the stride. The capture has no fingers: the hands go with the forearms.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', '100style');
const ZIP = join(CACHE, '100STYLE.zip');
// (Under review, not chosen: beside the library, in a folder the game doesn't take. Chosen, it moves up a folder.)
const OUT = join(ROOT, 'assets', 'anims', 'review');
/** Frames a second the clips are written at (the library's), and metres to the capture's unit (cm). */
const RATE = 30;
const CM = 0.01;
/** How far a stride may turn and still count as going straight (rad): he runs round a room, so few are dead straight;
 * what turn there is in the one kept is spread out with the rest of the gap between its end and its start. */
const TURN = 0.2;

/**
 * Style, gait (the dataset's: FW forwards walk, FR forwards run, ID idling) and what the clip is called. The styles
 * are the ones that might be Mack's (the user, 2026-10-06, of the Quaternius pack on him: "more of a 'hulk' type
 * character while Mack is more chill"): plain, hands in pockets, leaning back, loose in the shoulders, and a few
 * with more front to them to set against those; each walked, run and stood in. Rushed and Robot are from the first cut.
 */
const STYLES = ['Neutral', 'HandsInPockets', 'LeanBack', 'SwingShoulders', 'ArmsBySide', 'ArmsBehindBack', 'ArmsFolded', 'Strutting', 'Proud', 'Heavyset', 'Stiff', 'Depressed'];
const GAITS = { FW: 'Walk', FR: 'Run', ID: 'Idle' };
const CLIPS = [
  ...STYLES.flatMap((style) => Object.entries(GAITS).map(([gait, what]) => [style, gait, `${what}_${style}_Loop`])),
  ['Rushed', 'FR', 'Run_Rushed_Loop'],
  ['Robot', 'FR', 'Run_Robot_Loop'],
];

/** The capture's joints under the cast's names (Chest4 has no bone of the cast's: it keeps a name of its own, and
 * its turn reaches the neck and the arms through it). */
const NAMES = {
  Hips: 'pelvis', Chest: 'spine_01', Chest2: 'spine_02', Chest3: 'spine_03', Chest4: 'spine_03_upper', Neck: 'neck_01', Head: 'head',
  ...Object.fromEntries([['Left', 'l'], ['Right', 'r']].flatMap(([side, s]) => [
    [`${side}Collar`, `clavicle_${s}`], [`${side}Shoulder`, `upperarm_${s}`], [`${side}Elbow`, `lowerarm_${s}`], [`${side}Wrist`, `hand_${s}`],
    [`${side}Hip`, `thigh_${s}`], [`${side}Knee`, `calf_${s}`], [`${side}Ankle`, `foot_${s}`], [`${side}Toe`, `ball_${s}`],
  ])),
};

const AXES = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };

/** A file of the zip, unpacked the first time it's wanted (Windows' own tar reads a zip: by its full path, as build.mjs). */
function cached(member) {
  const file = join(CACHE, ...member.split('/'));
  if (!existsSync(file)) {
    if (!existsSync(ZIP)) throw new Error(`put the dataset's zip at ${ZIP} (see this script's header)`);
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', ZIP, '-C', CACHE, member]);
  }
  return readFileSync(file, 'latin1');
}

/** A .bvh: its joints (parent first: name, parent, offset, channels, where its numbers start in a frame) and frames. */
function parseBvh(text) {
  const [head, motion] = text.split('MOTION');
  const joints = [];
  const stack = [];
  let pending = -1;
  let width = 0;
  for (const raw of head.split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === 'ROOT' || t[0] === 'JOINT') pending = joints.push({ name: t[1], parent: stack.length ? stack[stack.length - 1] : -1, offset: new THREE.Vector3(), channels: [], at: 0 }) - 1;
    // (An end site is a tip, not a joint: -2 stands for it on the stack.)
    else if (t[0] === 'End') pending = -2;
    else if (t[0] === '{') stack.push(pending);
    else if (t[0] === '}') stack.pop();
    else if (t[0] === 'OFFSET' && pending >= 0) joints[pending].offset.set(+t[1], +t[2], +t[3]);
    else if (t[0] === 'CHANNELS') {
      joints[pending].channels = t.slice(2);
      joints[pending].at = width;
      width += t.length - 2;
    }
  }
  const lines = motion.trim().split(/\r?\n/);
  const fps = Math.round(1 / Number(lines[1].split(':')[1]));
  const frames = lines.slice(2).map((l) => Float32Array.from(l.trim().split(/\s+/), Number));
  return { joints, frames, fps, width };
}

/** A frame's turn of each joint in its parent's frame, and the root's place (cm). */
function local(bvh, frame) {
  const rot = bvh.joints.map((j) => {
    const q = new THREE.Quaternion();
    j.channels.forEach((c, k) => {
      if (c.endsWith('rotation')) q.multiply(new THREE.Quaternion().setFromAxisAngle(AXES[c[0]], (frame[j.at + k] * Math.PI) / 180));
    });
    return q;
  });
  const root = bvh.joints[0];
  const at = new THREE.Vector3();
  root.channels.forEach((c, k) => {
    if (c.endsWith('position')) at[c[0].toLowerCase()] = frame[root.at + k];
  });
  return { rot, at };
}

/** Where each joint is in the world for a frame's turns (cm). */
function world(bvh, pose) {
  const q = [];
  const p = [];
  bvh.joints.forEach((j, i) => {
    if (j.parent < 0) {
      q.push(pose.rot[i].clone());
      p.push(pose.at.clone());
    } else {
      q.push(q[j.parent].clone().multiply(pose.rot[i]));
      p.push(j.offset.clone().applyQuaternion(q[j.parent]).add(p[j.parent]));
    }
  });
  return p;
}

const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

/** One stride of a take, between the dataset's own cuts, as a loop on the spot. */
function stride(bvh, from, to) {
  const FPS = bvh.fps;
  const index = (name) => bvh.joints.findIndex((j) => j.name === name);
  const [lf, rf] = [index('LeftAnkle'), index('RightAnkle')];
  const poses = [];
  const hip = [];
  const feet = [];
  for (let i = from; i < Math.min(to, bvh.frames.length); i++) {
    const pose = local(bvh, bvh.frames[i]);
    const at = world(bvh, pose);
    poses.push(pose);
    hip.push(pose.at.clone());
    feet.push([at[lf], at[rf]]);
  }
  const n = poses.length;
  // Which way he's going, over half a second; and how far the left ankle is ahead of the right that way.
  const half = Math.round(FPS / 4);
  const lead = new Float32Array(n);
  const heading = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = hip[Math.min(n - 1, i + half)].clone().sub(hip[Math.max(0, i - half)]).setY(0);
    heading[i] = Math.atan2(v.x, v.z);
    lead[i] = feet[i][0].clone().sub(feet[i][1]).setY(0).dot(v.normalize());
  }
  // Left heel strikes: where the left foot is furthest ahead.
  const strikes = [];
  const w = Math.round(FPS / 5);
  for (let i = w; i < n - w; i++) {
    let top = lead[i] > 10;
    for (let k = i - w; top && k <= i + w; k++) if (lead[k] > lead[i]) top = false;
    if (top && (strikes.length === 0 || i - strikes[strikes.length - 1] > w)) strikes.push(i);
  }
  const gap = (a, b) => poses[a].rot.reduce((s, q, j) => s + angle(q, poses[b].rot[j]), 0) + Math.abs(hip[a].y - hip[b].y) * CM * 20;
  // The strides that go straight, and how fast each goes.
  const straight = [];
  for (let k = 0; k + 1 < strikes.length; k++) {
    const [a, b] = [strikes[k], strikes[k + 1]];
    const seconds = (b - a) / FPS;
    let turned = Math.abs(heading[b] - heading[a]);
    if (turned > Math.PI) turned = 2 * Math.PI - turned;
    const speed = (hip[b].clone().sub(hip[a]).setY(0).length() * CM) / seconds;
    if (seconds >= 0.4 && seconds <= 2.4 && turned < TURN && speed > 0.3) straight.push({ a, b, speed });
  }
  if (straight.length === 0) return null;
  // (Not the slow ones: he's then coming out of a turn or going into one.)
  const middle = [...straight].sort((x, y) => x.speed - y.speed)[straight.length >> 1].speed;
  let best = null;
  for (const s of straight) {
    if (s.speed < middle) continue;
    for (let b = s.b - 4; b <= Math.min(n - 1, s.b + 4); b++) {
      const cost = gap(s.a, b);
      if (!best || cost < best.cost) best = { a: s.a, b, cost };
    }
  }
  const { a, b } = best;
  const seconds = (b - a) / FPS;
  const count = Math.round(seconds * RATE) + 1;
  const travel = hip[b].clone().sub(hip[a]);
  const face = new THREE.Quaternion().setFromAxisAngle(AXES.Y, -Math.atan2(travel.x, travel.z));
  const closing = poses[a].rot.map((q, j) => q.clone().multiply(poses[b].rot[j].clone().invert()));
  const one = new THREE.Quaternion();
  const turns = bvh.joints.map(() => []);
  const hips = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const f = a + u * (b - a);
    const lo = Math.floor(f);
    const hi = Math.min(b, lo + 1);
    bvh.joints.forEach((_, j) => {
      const q = one.clone().slerp(closing[j], u).multiply(poses[lo].rot[j].clone().slerp(poses[hi].rot[j], f - lo));
      turns[j].push(j === 0 ? face.clone().multiply(q) : q);
    });
    // The hips over the origin: where they are less how far the stride has carried them, turned to face +z.
    const at = hip[lo].clone().lerp(hip[hi], f - lo).sub(hip[a]).addScaledVector(travel, -u).applyQuaternion(face);
    hips.push(new THREE.Vector3(at.x * CM, (at.y + hip[a].y) * CM, at.z * CM));
  }
  return { count, seconds, turns, hips, speed: (travel.clone().setY(0).length() * CM) / seconds, gap: best.cost, from: (from + a) / FPS, strides: straight.length };
}

/**
 * A stretch of standing about, as a loop: of the stretches four to seven seconds long between the dataset's cuts,
 * the one whose end is most like its start; turned to face +z as he stands on the whole; over the origin; the gap
 * between its end and its start spread over it.
 */
function idle(bvh, from, to) {
  const FPS = bvh.fps;
  const poses = [];
  for (let i = from; i < Math.min(to, bvh.frames.length); i++) poses.push(local(bvh, bvh.frames[i]));
  const n = poses.length;
  const gap = (a, b) => poses[a].rot.reduce((s, q, j) => s + angle(q, poses[b].rot[j]), 0) + poses[a].at.distanceTo(poses[b].at) * CM * 20;
  let best = null;
  for (let a = 0; a + 4 * FPS < n; a += FPS / 2) {
    for (let b = a + 4 * FPS; b <= Math.min(n - 1, a + 7 * FPS); b += FPS / 4) {
      const cost = gap(a, b);
      if (!best || cost < best.cost) best = { a, b, cost };
    }
  }
  if (!best) return null;
  const { a, b } = best;
  const seconds = (b - a) / FPS;
  const count = Math.round(seconds * RATE) + 1;
  // The way he faces: the hips' own forward, on the whole.
  const ahead = new THREE.Vector3();
  for (let i = a; i <= b; i += 10) ahead.add(AXES.Z.clone().applyQuaternion(poses[i].rot[0]).setY(0).normalize());
  const face = new THREE.Quaternion().setFromAxisAngle(AXES.Y, -Math.atan2(ahead.x, ahead.z));
  const middle = new THREE.Vector3();
  for (let i = a; i <= b; i++) middle.add(poses[i].at);
  middle.multiplyScalar(1 / (b - a + 1));
  const drift = poses[b].at.clone().sub(poses[a].at);
  const closing = poses[a].rot.map((q, j) => q.clone().multiply(poses[b].rot[j].clone().invert()));
  const one = new THREE.Quaternion();
  const turns = bvh.joints.map(() => []);
  const hips = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    const f = a + u * (b - a);
    const lo = Math.floor(f);
    const hi = Math.min(b, lo + 1);
    bvh.joints.forEach((_, j) => {
      const q = one.clone().slerp(closing[j], u).multiply(poses[lo].rot[j].clone().slerp(poses[hi].rot[j], f - lo));
      turns[j].push(j === 0 ? face.clone().multiply(q) : q);
    });
    const at = poses[lo].at.clone().lerp(poses[hi].at, f - lo).addScaledVector(drift, -u).sub(new THREE.Vector3(middle.x - drift.x / 2, 0, middle.z - drift.z / 2)).applyQuaternion(face);
    hips.push(new THREE.Vector3(at.x * CM, at.y * CM, at.z * CM));
  }
  return { count, seconds, turns, hips, speed: 0, gap: best.cost, from: (from + a) / FPS, strides: 0 };
}

mkdirSync(OUT, { recursive: true });
// The dataset's own list of where each take's good frames start and stop.
const cuts = new Map();
const [header, ...rows] = cached('100STYLE/Frame_Cuts.csv').trim().split(/\r?\n/).map((l) => l.split(','));
for (const row of rows) cuts.set(row[0], Object.fromEntries(header.map((h, i) => [h, Number(row[i])])));

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');
const rootNode = doc.createNode('Root');
scene.addChild(rootNode);
let nodes = null;
let skeleton = null;
const report = [];
for (const [style, gait, name] of CLIPS) {
  const bvh = parseBvh(cached(`100STYLE/${style}/${style}_${gait}.bvh`));
  if (!nodes) {
    // The skeleton, once: every take is the same man's. Standing, his hips are a straight leg and the foot's height up.
    skeleton = bvh.joints.map((j) => `${j.name} ${j.offset.toArray().map((v) => v.toFixed(2))}`).join('|');
    const leg = ['LeftKnee', 'LeftAnkle', 'LeftToe'].reduce((s, n) => s - bvh.joints.find((j) => j.name === n).offset.y, 0);
    nodes = bvh.joints.map((j) => doc.createNode(NAMES[j.name] ?? j.name));
    bvh.joints.forEach((j, i) => {
      nodes[i].setTranslation(j.parent < 0 ? [0, leg * CM, 0] : j.offset.clone().multiplyScalar(CM).toArray());
      (j.parent < 0 ? rootNode : nodes[j.parent]).addChild(nodes[i]);
    });
  } else if (bvh.joints.map((j) => `${j.name} ${j.offset.toArray().map((v) => v.toFixed(2))}`).join('|') !== skeleton) {
    console.log(`${style}_${gait}: a skeleton of its own, left out`);
    continue;
  }
  const cut = cuts.get(style);
  const [first, last] = [cut?.[`${gait}_START`] || 0, cut?.[`${gait}_STOP`] || bvh.frames.length];
  const s = gait === 'ID' ? idle(bvh, first, last) : stride(bvh, first, last);
  if (!s) {
    console.log(`${style}_${gait}: no straight stride found`);
    continue;
  }
  const anim = doc.createAnimation(name);
  const times = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: s.count }, (_, i) => i / RATE)).setBuffer(buffer);
  const add = (node, path, output) => {
    const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
  };
  add(nodes[0], 'translation', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(s.hips.flatMap((p) => p.toArray()))).setBuffer(buffer));
  s.turns.forEach((track, j) => {
    const out = new Int16Array(s.count * 4);
    let last = null;
    track.forEach((q, i) => {
      if (last && last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      last = q;
      q.toArray().forEach((v, k) => (out[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, v)) * 32767)));
    });
    add(nodes[j], 'rotation', doc.createAccessor().setType('VEC4').setArray(out).setNormalized(true).setBuffer(buffer));
  });
  if (gait === 'ID') {
    report.push(`  ${name}: ${style}_${gait}, ${s.seconds.toFixed(2)} s from ${s.from.toFixed(2)} s, end to start ${s.gap.toFixed(2)}`);
    continue;
  }
  report.push(`  ${name}: ${style}_${gait}, the stride from ${s.from.toFixed(2)} s of ${s.strides} that go straight, ${s.seconds.toFixed(2)} s at ${s.speed.toFixed(2)} m/s, end to start ${s.gap.toFixed(2)}`);
}
await new NodeIO().write(join(OUT, 'style100.glb'), doc);
console.log(`style100.glb: ${Math.round(statSync(join(OUT, 'style100.glb')).size / 1024)} KB`);
console.log(report.join('\n'));
