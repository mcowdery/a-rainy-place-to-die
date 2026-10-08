// Walks from real people, for the cast's animation library: one stride of each of a few trials of the Carnegie
// Mellon University Motion Capture Database (mocap.cs.cmu.edu: "This dataset of motions is free for all uses ...
// You may include this data in commercially-sold products, but you may not resell this data directly, even in
// converted form"; credited in CREDITS.md and assets/anims/CREDITS.md), made into loops that walk on the spot.
//
//   node scripts/anims/cmu.mjs
//
//   Fetches each subject's skeleton (.asf) and the trials below (.amc) into .cache/cmu/ (git-ignored) if they aren't
//   there (only these: the site asks not to be crawled) and writes assets/anims/cmu_<subject>.glb, a file a subject
//   since each has a skeleton of their own, in the shape the library's other files have (scripts/anims/build.mjs):
//   bones under the cast's names, at rest in the capture's own zero pose (arms out, legs a little apart), so
//   models/characterAnims.ts fits them as it does the rest.
//
//   Of a trial it keeps one stride, left heel to left heel, the one whose end is most like its start; turns it to
//   walk towards +z; takes out the travel, so the hips stay over the origin; and closes what's left of the gap
//   between its end and its start by spreading it over the stride. The fingers aren't captured and the wrists' and
//   toes' own joints are noisy (the site says so): the hand goes with the forearm's twist and the toes with the foot.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'cmu');
const OUT = join(ROOT, 'assets', 'anims');
const SITE = 'http://mocap.cs.cmu.edu/subjects';

/**
 * Trial, and what the clip is called (the database's own description of it is beside each in assets/anims/CREDITS.md).
 * Tried and left out, by what the script prints for each:
 * - 104_19 and 104_35 (a casual walk and a slow one): the foot that's down creeps 4.5 cm off the floor each step, a
 *   skeleton fitted a little wrong, and it shows as skating; 07_01 and 08_01 the same by 3 cm.
 * - 137_29 and 137_24 (a normal walk and a "graceful lady" one) weave from side to side of the floor, and 45_01,
 *   46_01 and 141_19 turn: no stride of theirs goes straight.
 * - 143_32's strides come out at half a second and 2 m/s, a walk only if the file is 60 frames a second where the
 *   site says 120.
 * - Of the runs: 16_35, 16_36, 16_45 and 16_46 hold no whole stride of either foot (the floor is crossed in a
 *   second); 35_20 and 35_23 are the same man as 35_17 a little faster (3.4 m/s), 09_02 to 09_10 the same as 09_01.
 */
const TRIALS = [
  ['105_29', 'Walk_Normal_105_Loop'],
  ['105_22', 'Walk_CasualQuick_105_Loop'],
  ['105_10', 'Walk_Slow_105_Loop'],
  ['12_01', 'Walk_12_Loop'],
  ['16_15', 'Walk_16_Loop'],
  ['35_01', 'Walk_35_Loop'],
  ['38_01', 'Walk_38_Loop'],
  ['69_01', 'Walk_69_Loop'],
  // Runs (the user, 2026-10-06, of the library's jog and sprint and of Mack's keyed run: "not a fan of the run
  // animations"): the database's 'run' and 'run/jog' trials, a stride of each as for the walks.
  ['09_01', 'Run_09_Loop'],
  ['16_55', 'Run_16_Loop'],
  ['35_17', 'Jog_35_Loop'],
  ['02_03', 'Jog_02_Loop'],
  // More runs, from subjects captured for it (127 "Action Adventure Obstacles, running, jumping, ducking, rolling";
  // 141 and 143 "General Subject Capture"), after the user played Run_09 in the city and had it taken out again.
  ['127_03', 'Run_127_Loop'],
  // (141's and 143's files are 60 frames a second, not the site's 120: a jump of 143's, read at 120, falls at four
  // times gravity. `take` prints what a take's fall makes of gravity for this.)
  ['141_01', 'Run_141_Loop', { fps: 60 }],
  ['143_01', 'Run_143_Loop', { fps: 60 }],
  // Whole takes, once through (`take`), on the spot as the loops are: into a run, out of one, and jumps (the user, 2026-10-06,
  // of the pack's jump and its start and stop of a run: "let's see if we can't find better animations to replace these").
  ['127_04', 'RunStart_127', { take: true }],
  ['143_03', 'RunStart_143', { take: true, fps: 60 }],
  // (A stop has no long standing in it: upright is how he ends.)
  ['127_05', 'RunStop_127', { take: true, upright: 'end' }],
  ['143_02', 'RunStop_143', { take: true, fps: 60, upright: 'end' }],
  ['16_57', 'RunStop_16', { take: true, upright: 'end' }],
  ['16_01', 'Jump_16', { take: true }],
  ['16_03', 'JumpHigh_16', { take: true }],
  ['16_05', 'JumpForward_16', { take: true }],
  ['118_01', 'Jump_118', { take: true }],
  ['13_39', 'Jump_13', { take: true, upright: 'start' }],
];

/** The cast's bone, the capture's bone whose joint it sits at, and (if not the same) the one whose turn it takes. */
const BONES = [
  ['pelvis', 'root'],
  ['spine_01', 'lowerback'],
  ['spine_02', 'upperback'],
  ['spine_03', 'thorax'],
  ['neck_01', 'lowerneck'],
  ['head', 'head'],
  ...['l', 'r'].flatMap((s) => [
    [`clavicle_${s}`, `${s}clavicle`],
    [`upperarm_${s}`, `${s}humerus`],
    [`lowerarm_${s}`, `${s}radius`],
    [`hand_${s}`, `${s}wrist`],
    [`thigh_${s}`, `${s}femur`],
    [`calf_${s}`, `${s}tibia`],
    [`foot_${s}`, `${s}foot`],
    [`ball_${s}`, `${s}toes`, `${s}foot`],
  ]),
];
const PARENT = { pelvis: 'Root', spine_01: 'pelvis', spine_02: 'spine_01', spine_03: 'spine_02', neck_01: 'spine_03', head: 'neck_01' };
for (const s of ['l', 'r']) Object.assign(PARENT, { [`clavicle_${s}`]: 'spine_03', [`upperarm_${s}`]: `clavicle_${s}`, [`lowerarm_${s}`]: `upperarm_${s}`, [`hand_${s}`]: `lowerarm_${s}`, [`thigh_${s}`]: 'pelvis', [`calf_${s}`]: `thigh_${s}`, [`foot_${s}`]: `calf_${s}`, [`ball_${s}`]: `foot_${s}` });

// (The captures' frames a second: the site says 120 for all; a trial that isn't says so, `fps` beside it.)
let FPS = 120;
const RATE = 30;
const RAD = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
/** Rotations about x, then y, then z (the files' order), in degrees. */
const euler = (x, y, z) => new THREE.Quaternion().setFromAxisAngle(Z, z * RAD).multiply(new THREE.Quaternion().setFromAxisAngle(Y, y * RAD)).multiply(new THREE.Quaternion().setFromAxisAngle(X, x * RAD));

async function cached(name) {
  const file = join(CACHE, name);
  if (!existsSync(file)) {
    const url = `${SITE}/${name.split(/[_.]/)[0]}/${name}`;
    console.log(`fetching ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 1000));
  }
  return readFileSync(file, 'latin1');
}

/** A skeleton file: the scale to metres, each bone's direction, length, axes and what it turns about, and who hangs from whom. */
function parseAsf(text) {
  const bones = new Map();
  const parent = new Map();
  let section = '';
  let bone = null;
  let scale = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith(':')) {
      section = line.split(/\s+/)[0];
      continue;
    }
    const w = line.split(/\s+/);
    if (section === ':units' && w[0] === 'length') scale = (1 / Number(w[1])) * 0.0254;
    else if (section === ':bonedata') {
      if (w[0] === 'begin') bone = { dof: [] };
      else if (w[0] === 'end') bones.set(bone.name, bone);
      else if (w[0] === 'name') bone.name = w[1];
      else if (w[0] === 'direction') bone.dir = new THREE.Vector3(Number(w[1]), Number(w[2]), Number(w[3])).normalize();
      else if (w[0] === 'length') bone.length = Number(w[1]);
      else if (w[0] === 'axis') bone.axis = euler(Number(w[1]), Number(w[2]), Number(w[3]));
      else if (w[0] === 'dof') bone.dof = w.slice(1);
    } else if (section === ':hierarchy' && w[0] !== 'begin' && w[0] !== 'end') {
      for (const child of w.slice(1)) parent.set(child, w[0]);
    }
  }
  // Parents before children.
  const order = [];
  const add = (name) => {
    if (order.includes(name) || name === 'root') return;
    add(parent.get(name));
    order.push(name);
  };
  for (const name of bones.keys()) add(name);
  for (const b of bones.values()) {
    b.offset = b.dir.clone().multiplyScalar(b.length * scale);
    b.axisInv = b.axis.clone().invert();
  }
  return { bones, parent, order, scale };
}

/** A motion file: for each frame, each bone's numbers. */
function parseAmc(text) {
  const frames = [];
  let frame = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(':')) continue;
    if (/^\d+$/.test(line)) {
      frame = new Map();
      frames.push(frame);
    } else if (frame) {
      const w = line.split(/\s+/);
      frame.set(w[0], w.slice(1).map(Number));
    }
  }
  return frames;
}

/** A frame's pose: every bone's turn from the zero pose, and where its joint is (m), in the capture's space. */
function pose(asf, frame) {
  const rot = new Map();
  const at = new Map();
  if (frame) {
    const r = frame.get('root');
    rot.set('root', euler(r[3], r[4], r[5]));
    at.set('root', new THREE.Vector3(r[0], r[1], r[2]).multiplyScalar(asf.scale));
  } else {
    rot.set('root', new THREE.Quaternion());
    at.set('root', new THREE.Vector3());
  }
  const end = new Map([['root', at.get('root')]]);
  for (const name of asf.order) {
    const b = asf.bones.get(name);
    const p = asf.parent.get(name);
    const v = frame?.get(name) ?? [];
    const a = { rx: 0, ry: 0, rz: 0 };
    b.dof.forEach((d, i) => (a[d] = v[i] ?? 0));
    const q = rot.get(p).clone().multiply(b.axis).multiply(euler(a.rx, a.ry, a.rz)).multiply(b.axisInv);
    rot.set(name, q);
    at.set(name, end.get(p));
    end.set(name, end.get(p).clone().add(b.offset.clone().applyQuaternion(q)));
  }
  return { rot, at };
}

const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));
/** The middle of some rotations that are near each other. */
function mean(quats) {
  const sum = new THREE.Vector4();
  for (const q of quats) sum.addScaledVector(new THREE.Vector4(q.x, q.y, q.z, q.w), quats[0].dot(q) < 0 ? -1 : 1);
  sum.normalize();
  return new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w);
}
/** The capture's bones whose zero isn't how the subject holds them standing: the trunk, the neck and head, the collar bones. */
const TRUNK = ['root', 'lowerback', 'upperback', 'thorax', 'lowerneck', 'head', 'lclavicle', 'rclavicle'];
/** Those of them whose lean is taken from the subject standing. */
const LEANS = ['root', 'lowerback', 'upperback', 'thorax'];

/** One stride of a trial, as a loop on the spot: times, each of BONES' turns, the hips' place, and what was found. */
function stride(asf, frames) {
  const poses = frames.map((f) => pose(asf, f));
  const n = poses.length;
  const hip = poses.map((p) => p.at.get('root'));
  // Which way he's going, over half a second; and how far the left ankle is ahead of the right that way.
  const half = FPS / 4;
  const lead = new Float32Array(n);
  const heading = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = hip[Math.min(n - 1, i + half)].clone().sub(hip[Math.max(0, i - half)]).setY(0);
    heading[i] = Math.atan2(v.x, v.z);
    lead[i] = poses[i].at.get('lfoot').clone().sub(poses[i].at.get('rfoot')).setY(0).dot(v.normalize());
  }
  // Heel strikes: where that foot is furthest ahead. The left's; and the right's for a trial too short to hold two
  // of the left's (a run across the floor is over in a little more than a second).
  const w = FPS / 5;
  const strikesOf = (side) => {
    const found = [];
    for (let i = w; i < n - w; i++) {
      let top = side * lead[i] > 0.1;
      for (let k = i - w; top && k <= i + w; k++) if (side * lead[k] > side * lead[i]) top = false;
      if (top && (found.length === 0 || i - found[found.length - 1] > w)) found.push(i);
    }
    return found;
  };
  let strikes = strikesOf(1);
  if (strikes.length < 2) strikes = strikesOf(-1);
  const names = [...new Set(BONES.map(([, at, turn]) => turn ?? at))];
  const gap = (a, b) => names.reduce((s, name) => s + angle(poses[a].rot.get(name), poses[b].rot.get(name)), 0) + Math.abs(hip[a].y - hip[b].y) * 20;
  let best = null;
  for (let k = 0; k + 1 < strikes.length; k++) {
    const a = strikes[k];
    const seconds = (strikes[k + 1] - a) / FPS;
    let turned = Math.abs(heading[strikes[k + 1]] - heading[a]);
    if (turned > Math.PI) turned = 2 * Math.PI - turned;
    const speed = hip[strikes[k + 1]].clone().sub(hip[a]).setY(0).length() / seconds;
    // (A running stride is a little over half a second; a walk's is never under one.)
    if (seconds < 0.5 || seconds > 2.4 || turned > 0.14 || speed < 0.3) continue;
    // The end that's most like the start, within a few frames of the strike.
    for (let b = strikes[k + 1] - 8; b <= Math.min(n - 1, strikes[k + 1] + 8); b++) {
      // (Strides at either end of a trial are the ones he's starting or stopping in.)
      const cost = gap(a, b) + (k === 0 || k + 2 === strikes.length ? 0.5 : 0);
      if (!best || cost < best.cost) best = { a, b, cost, speed };
    }
  }
  if (!best) return null;
  const { a, b } = best;
  const seconds = (b - a) / FPS;
  const count = Math.round(seconds * RATE) + 1;
  // Turned to walk towards +z, the travel taken out, the gap between end and start spread over the stride.
  const travel = hip[b].clone().sub(hip[a]);
  const face = new THREE.Quaternion().setFromAxisAngle(Y, -Math.atan2(travel.x, travel.z));
  const closing = new Map(names.map((name) => [name, poses[a].rot.get(name).clone().multiply(poses[b].rot.get(name).clone().invert())]));
  const one = new THREE.Quaternion();
  const sample = (name, i, u) => {
    const f = Math.min(b, a + u * (b - a));
    const lo = Math.floor(f);
    const hi = Math.min(b, lo + 1);
    const q = poses[lo].rot.get(name).clone().slerp(poses[hi].rot.get(name), f - lo);
    return face.clone().multiply(one.clone().slerp(closing.get(name), u)).multiply(q);
  };
  // The zero pose is the skeleton with every joint at 0, which isn't how anyone stands: the spine's and the neck's
  // joints sit some degrees off it in an upright body, and a turn counted from zero puts the head down on a figure
  // whose own rest is already upright. So the trunk's turns are counted from the middle of the stride itself (walking
  // straight, a body faces the way it's going and is level, on the whole), but for how far the spine leans, which is
  // taken from the subject standing still where the trial has that, so a walk keeps the lean it has over standing.
  // (Not the head's or the neck's: standing, people look about. 105 waits with her head turned 50 degrees.)
  const still = [];
  let run = [];
  for (let i = 0; i < n; i++) {
    const moved = hip[Math.min(n - 1, i + half)].clone().sub(hip[Math.max(0, i - half)]).setY(0).length() / ((2 * half) / FPS);
    // (Still, and not turning on the spot either: a trial that goes there and back pivots at the far end.)
    const turning = angle(poses[Math.min(n - 1, i + half)].rot.get('root'), poses[Math.max(0, i - half)].rot.get('root')) / ((2 * half) / FPS);
    if (moved < 0.06 && turning < 0.12) run.push(i);
    else {
      if (run.length > still.length) still.splice(0, still.length, ...run);
      run = [];
    }
  }
  if (run.length > still.length) still.splice(0, still.length, ...run);
  const standing = still.length >= FPS * 0.3;
  /** How far forward a turn leans what was upright. */
  const lean = (q) => {
    const up = Y.clone().applyQuaternion(q);
    return Math.atan2(up.z, up.y);
  };
  const stood = new Map();
  if (standing) {
    const ahead = Z.clone().applyQuaternion(mean(still.map((i) => poses[i].rot.get('root'))));
    const square = new THREE.Quaternion().setFromAxisAngle(Y, -Math.atan2(ahead.x, ahead.z));
    for (const name of LEANS) stood.set(name, lean(square.clone().multiply(mean(still.map((i) => poses[i].rot.get(name))))));
  }
  const turns = new Map(names.map((name) => [name, []]));
  const hips = [];
  // Each frame's ankles and balls of the feet, for where the floor is under whichever foot is down.
  const feet = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1);
    for (const name of names) turns.get(name).push(sample(name, i, u));
    const f = a + u * (b - a);
    const lo = Math.floor(f);
    const p = hip[lo].clone().lerp(hip[Math.min(b, lo + 1)], f - lo).sub(hip[a]).addScaledVector(travel, -u).applyQuaternion(face);
    p.y += hip[a].y;
    hips.push(p);
    feet.push(['l', 'r'].map((s) => ({ ankle: poses[lo].at.get(`${s}foot`).y, ball: poses[lo].at.get(`${s}toes`).y })));
  }
  // A foot that's down doesn't rise, but a skeleton fitted a little wrong has it creep up as the leg goes back under
  // the body, which shows as someone skating just off the ground. `lift` is how far the lower foot gets off the floor
  // (the lower of its ankle and the ball of it, each from its own lowest): a measure of the trial, not corrected for
  // (bringing the hips down by it puts the other foot through the floor as it swings past).
  const floor = Math.min(...feet.flat().map((f) => f.ankle));
  const ballFloor = Math.min(...feet.flat().map((f) => f.ball));
  const off = feet.map((pair) => Math.min(...pair.map((f) => Math.min(f.ankle - floor, f.ball - ballFloor))));
  for (const name of TRUNK) {
    const list = turns.get(name);
    const middle = mean(list);
    if (stood.has(name)) middle.premultiply(new THREE.Quaternion().setFromAxisAngle(X, stood.get(name) - lean(middle)));
    middle.invert();
    for (const q of list) q.multiply(middle);
  }
  // The middle of the hips' sway is over the origin.
  const mid = hips.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / count);
  for (const p of hips) {
    p.x -= mid.x;
    p.z -= mid.z;
  }
  return { count, seconds, turns, hips, floor, lift: Math.max(...off), speed: travel.clone().setY(0).length() / seconds, gap: best.cost, from: a / FPS, strides: strikes.length - 1, standing };
}

/**
 * A whole take, or the part of it between `from` and `to` seconds, once through: turned so he faces +z (the way he
 * goes, if he goes anywhere; else the way he stands), and on the spot (his way over the floor taken out, smoothed
 * over half a second, so the hips' sway is left), as the loops are: whoever plays it moves him. Says when he's
 * going over the floor, for where a start starts and a stop stops. Upright is how
 * he stands where the take has him standing still longest (a jump starts and ends so; a stop ends so); a take with no
 * standing in it is upright on the whole. Says when both feet are off the floor (a jump's time in the air) and what
 * the hips' fall there makes of gravity, which tells a take that isn't at the frames a second it's taken for.
 */
function take(asf, frames, from = 0, to = Infinity, upright = null) {
  const all = frames.map((f) => pose(asf, f));
  const a = Math.max(0, Math.round(from * FPS));
  const b = Math.min(all.length - 1, Math.round(to * FPS));
  const hip = all.map((p) => p.at.get('root'));
  const half = FPS / 4;
  const still = [];
  let run = [];
  for (let i = a; i <= b; i++) {
    const lo = Math.max(a, i - half);
    const hi = Math.min(b, i + half);
    const moved = hip[hi].clone().sub(hip[lo]).length() / ((hi - lo) / FPS);
    const turning = angle(all[hi].rot.get('root'), all[lo].rot.get('root')) / ((hi - lo) / FPS);
    if (moved < 0.08 && turning < 0.15) run.push(i);
    else {
      if (run.length > still.length) still.splice(0, still.length, ...run);
      run = [];
    }
  }
  if (run.length > still.length) still.splice(0, still.length, ...run);
  // (Told where he's upright, where the take hasn't a long enough standing of its own: its first moments, or its last.)
  if (still.length < FPS * 0.25 && upright) {
    const n = Math.round(FPS * 0.15);
    still.splice(0, still.length, ...Array.from({ length: n }, (_, k) => (upright === 'end' ? b - k : a + k)));
  }
  const standing = still.length >= FPS * 0.15;
  const travel = hip[b].clone().sub(hip[a]).setY(0);
  const ahead = travel.length() > 0.6 ? travel : Z.clone().applyQuaternion(mean((standing ? still : [a]).map((i) => all[i].rot.get('root')))).setY(0);
  const face = new THREE.Quaternion().setFromAxisAngle(Y, -Math.atan2(ahead.x, ahead.z));
  const names = [...new Set(BONES.map(([, at, turn]) => turn ?? at))];
  const seconds = (b - a) / FPS;
  const count = Math.round(seconds * RATE) + 1;
  const turns = new Map(names.map((name) => [name, []]));
  const hips = [];
  const low = [];
  for (let i = 0; i < count; i++) {
    const f = Math.min(b, a + (i / RATE) * FPS);
    const lo = Math.floor(f);
    const hi = Math.min(b, lo + 1);
    for (const name of names) turns.get(name).push(face.clone().multiply(all[lo].rot.get(name).clone().slerp(all[hi].rot.get(name), f - lo)));
    const p = hip[lo].clone().lerp(hip[hi], f - lo).sub(hip[a]).applyQuaternion(face);
    p.y += hip[a].y;
    hips.push(p);
    low.push(Math.min(all[lo].at.get('lfoot').y, all[lo].at.get('rfoot').y));
  }
  // When he's going over the floor (faster than 0.6 m/s), and then his way taken out.
  const going = hips.map((p, i) => (i === 0 ? 0 : Math.hypot(p.x - hips[i - 1].x, p.z - hips[i - 1].z) * RATE) > 0.6);
  const moving = going.includes(true) ? [going.indexOf(true) / RATE, going.lastIndexOf(true) / RATE] : null;
  const w = Math.round(RATE / 4);
  const way = hips.map((_, i) => {
    const lo = Math.max(0, i - w);
    const hi = Math.min(count - 1, i + w);
    let x = 0;
    let z = 0;
    for (let k = lo; k <= hi; k++) {
      x += hips[k].x;
      z += hips[k].z;
    }
    return [x / (hi - lo + 1), z / (hi - lo + 1)];
  });
  hips.forEach((p, i) => {
    p.x -= way[i][0];
    p.z -= way[i][1];
  });
  for (const name of TRUNK) {
    const list = turns.get(name);
    const upright = (standing ? mean(still.map((i) => face.clone().multiply(all[i].rot.get(name)))) : mean(list)).invert();
    for (const q of list) q.multiply(upright);
  }
  const floor = Math.min(...low);
  // In the air: the lower ankle well off the floor. (The first such stretch of a tenth of a second or more.)
  let air = null;
  for (let i = 0, up = -1; i < count && !air; i++) {
    if (low[i] - floor > 0.1) up = up < 0 ? i : up;
    else if (up >= 0) {
      if (i - up >= 3) air = [up / RATE, i / RATE];
      up = -1;
    }
  }
  // What the hips' fall makes of gravity: the middle of their second differences while he's in the air.
  let gravity = null;
  if (air) {
    const [u, d] = [Math.round(air[0] * RATE) + 1, Math.round(air[1] * RATE) - 1];
    const acc = [];
    for (let i = u + 1; i < d - 1; i++) acc.push(-(hips[i + 1].y - 2 * hips[i].y + hips[i - 1].y) * RATE * RATE);
    acc.sort((x, y) => x - y);
    if (acc.length) gravity = acc[acc.length >> 1];
  }
  return { count, seconds, turns, hips, floor, air, gravity, moving, travel: travel.length(), standing, rise: Math.max(...hips.map((p) => p.y)) - hips[0].y };
}

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
const io = new NodeIO();
const subjects = new Map();
for (const [trial, name, how = {}] of TRIALS) {
  const subject = trial.split('_')[0];
  if (!subjects.has(subject)) subjects.set(subject, []);
  subjects.get(subject).push({ trial, name, how });
}

for (const [subject, trials] of subjects) {
  const asf = parseAsf(await cached(`${subject}.asf`));
  const zero = pose(asf, null);
  // Standing, the root is above the floor by the ankle's height, a straight leg, and what the hip joint sits below
  // the root by (the zero pose has the legs apart, so its own height is less).
  const leg = ['lfemur', 'ltibia'].reduce((s, b) => s + asf.bones.get(b).length * asf.scale, 0);
  const ankle = -asf.bones.get('lfoot').offset.y - Math.min(0, asf.bones.get('ltoes').offset.y);
  const standing = leg + ankle - asf.bones.get('lhipjoint').offset.y;

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const nodes = new Map([['Root', doc.createNode('Root')]]);
  scene.addChild(nodes.get('Root'));
  for (const [name, at] of BONES) {
    const node = doc.createNode(name);
    const parent = PARENT[name];
    const from = parent === 'Root' ? new THREE.Vector3() : zero.at.get(BONES.find(([b]) => b === parent)[1]);
    const p = name === 'pelvis' ? new THREE.Vector3(0, standing, 0) : zero.at.get(at).clone().sub(from);
    node.setTranslation(p.toArray());
    nodes.get(parent).addChild(node);
    nodes.set(name, node);
  }

  const report = [];
  for (const { trial, name, how } of trials) {
    FPS = how.fps ?? 120;
    const frames = parseAmc(await cached(`${trial}.amc`));
    const s = how.take ? take(asf, frames, how.from, how.to, how.upright) : stride(asf, frames);
    if (!s) {
      console.log(`${trial}: no steady stride found`);
      continue;
    }
    const anim = doc.createAnimation(name);
    const times = doc.createAccessor().setType('SCALAR').setArray(Float32Array.from({ length: s.count }, (_, i) => i / RATE)).setBuffer(buffer);
    const add = (node, path, output) => {
      const sampler = doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler));
    };
    // The floor is where the lower ankle gets to, less the ankle's own height.
    const sink = s.floor - ankle;
    add(nodes.get('pelvis'), 'translation', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(s.hips.flatMap((p) => [p.x, p.y - sink, p.z]))).setBuffer(buffer));
    for (const [bone, at, turn] of BONES) {
      const world = s.turns.get(turn ?? at);
      const parent = PARENT[bone];
      const up = parent === 'Root' ? null : s.turns.get(BONES.find(([b]) => b === parent)[2] ?? BONES.find(([b]) => b === parent)[1]);
      const out = new Int16Array(s.count * 4);
      let last = null;
      for (let i = 0; i < s.count; i++) {
        const q = up ? up[i].clone().invert().multiply(world[i]) : world[i].clone();
        if (last && last.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        last = q;
        q.toArray().forEach((v, k) => (out[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, v)) * 32767)));
      }
      add(nodes.get(bone), 'rotation', doc.createAccessor().setType('VEC4').setArray(out).setNormalized(true).setBuffer(buffer));
    }
    if (how.take) {
      report.push(`  ${name}: ${trial}, the take's ${s.seconds.toFixed(2)} s, ${s.travel.toFixed(2)} m on${s.moving ? ` (going from ${s.moving[0].toFixed(2)} to ${s.moving[1].toFixed(2)} s)` : ''}, hips up to ${(s.rise * 100).toFixed(0)} cm above where they start${s.air ? `, in the air ${s.air[0].toFixed(2)} to ${s.air[1].toFixed(2)} s (gravity by its fall: ${s.gravity === null ? '?' : s.gravity.toFixed(1)} m/s2)` : ''}, upright from ${s.standing ? 'where he stands' : 'the take as a whole'}`);
      continue;
    }
    report.push(`  ${name}: ${trial}, the stride from ${s.from.toFixed(2)} s of ${s.strides}, ${s.seconds.toFixed(2)} s at ${s.speed.toFixed(2)} m/s, end to start ${s.gap.toFixed(2)}, floor ${(sink * 100).toFixed(1)} cm, the foot that's down up to ${(s.lift * 100).toFixed(1)} cm off it, lean from ${s.standing ? 'standing' : "the stride's middle"}`);
  }
  const file = `cmu_${subject}.glb`;
  await io.write(join(OUT, file), doc);
  console.log(`${file}: ${Math.round(statSync(join(OUT, file)).size / 1024)} KB, hips ${standing.toFixed(2)} m standing\n${report.join('\n')}`);
}
