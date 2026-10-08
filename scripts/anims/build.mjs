// The cast's animation library, cut from Quaternius's Universal Animation Library 1 (the whole pack: its paid tier,
// bought by the user 2026-10-06) and 2 (the free Standard pack); both CC0 1.0 (each pack's License.txt;
// https://quaternius.com). Credited in CREDITS.md and assets/anims/CREDITS.md.
//
//   node scripts/anims/build.mjs
//
//   Fetches pack 2 into .cache/anims/ (git-ignored) if it isn't there; pack 1's zip can't be fetched (it's bought:
//   "Universal Animation Library[Source].zip" or "[Pro].zip" from quaternius.itch.io/universal-animation-library,
//   saved as .cache/anims/universal_animation_library_source.zip). Writes assets/anims/ual1.glb, ual1rm.glb and
//   ual2.glb: the packs' skeleton and clips only (no mannequin, no materials), the bones under the names the cast's
//   rig uses (the Unreal mannequin's), the finger-tip and toe-tip helper bones gone, only the root and the pelvis
//   keeping their movement, the rotations stored as 16-bit. models/characterAnims.ts fits a clip to a character's
//   own skeleton when it's played, so one library does for every build of body.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'anims');
const OUT = join(ROOT, 'assets', 'anims');

const PACKS = [
  {
    // Pack 1, all of it: its clips as made, without root motion (the root stays put).
    out: 'ual1.glb',
    zip: 'universal_animation_library_source.zip',
    url: null,
    dir: 'ual1_source',
    glb: 'ual1_source/Unreal-Godot/UAL1.glb',
  },
  {
    // The few of pack 1's clips that are wanted with their root travelling too, from the pack's root-motion file,
    // named `_RM` as the free pack named them.
    out: 'ual1rm.glb',
    zip: 'universal_animation_library_source.zip',
    url: null,
    dir: 'ual1_source',
    glb: 'ual1_source/Unreal-Godot/UAL1_RM.glb',
    only: ['Roll', 'Sword_Attack', 'Dodge_Left', 'Dodge_Right', 'ClimbLedge'],
    suffix: '_RM',
  },
  {
    out: 'ual2.glb',
    zip: 'universal_animation_library_2standard.zip',
    url: 'https://opengameart.org/sites/default/files/universal_animation_library_2standard.zip',
    glb: 'Universal Animation Library 2 [Standard]/Unreal-Godot/UAL2_Standard.glb',
  },
];

/** A pack's bone name as the cast's rig has it: pack 1 uses Blender's Rigify names, pack 2 the Unreal ones. */
function boneName(name) {
  if (name === 'root') return 'Root';
  if (name === 'Head') return 'head';
  if (!name.startsWith('DEF-')) return name;
  const m = /^DEF-(?:f_)?([a-z_]+?)(?:\.(\d+))?\.?([LR])?$/.exec(name);
  if (!m) return name;
  const [, part, n, side] = m;
  const s = side ? `_${side.toLowerCase()}` : '';
  const plain = { hips: 'pelvis', neck: 'neck_01', head: 'head', shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball' }[part];
  if (plain) return plain + s;
  if (part === 'spine') return `spine_${n.slice(-2)}`;
  return `${part}_${n}${s}`;
}

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const pack of PACKS) {
  const src = join(CACHE, pack.glb);
  if (!existsSync(src)) {
    const zip = join(CACHE, pack.zip);
    if (!existsSync(zip) && !pack.url) throw new Error(`${pack.out}: put the bought pack's zip at ${zip} (see this script's header)`);
    if (!existsSync(zip)) {
      console.log(`fetching ${pack.url}`);
      writeFileSync(zip, Buffer.from(await (await fetch(pack.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).arrayBuffer()));
    }
    // Windows' own tar unpacks a zip (by its full path: Git's tar, first on a Git Bash PATH, takes C: for a host).
    // (A zip with no folder of its own is unpacked into one: `dir`.)
    mkdirSync(join(CACHE, pack.dir ?? ''), { recursive: true });
    execFileSync(join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', join(CACHE, pack.dir ?? '')]);
  }
  const doc = await io.read(src);
  const root = doc.getRoot();

  // The skeleton and its clips only.
  const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
  for (const n of root.listNodes()) {
    if (n.getMesh()) n.setMesh(null);
    if (n.getSkin()) n.setSkin(null);
    if (joints.has(n)) n.setName(boneName(n.getName()));
  }
  for (const s of root.listSkins()) s.dispose();

  const clips = [];
  for (const anim of root.listAnimations()) {
    // The reference pose is the skeleton's own rest, not a clip; and of a file some of whose clips are wanted, the rest go.
    if (anim.getName() === 'A_TPose' || (pack.only && !pack.only.includes(anim.getName()))) {
      for (const c of anim.listChannels()) c.dispose();
      for (const s of anim.listSamplers()) s.dispose();
      anim.dispose();
      continue;
    }
    let seconds = 0;
    for (const c of anim.listChannels()) {
      const node = c.getTargetNode();
      const name = node?.getName() ?? '';
      const path = c.getTargetPath();
      const sampler = c.getSampler();
      const moves = name === 'Root' || name === 'pelvis';
      if (/_leaf_/.test(name) || path === 'scale' || (path === 'translation' && !moves)) {
        c.dispose();
        continue;
      }
      seconds = Math.max(seconds, sampler.getInput().getMax([0])[0]);
      if (path === 'rotation') {
        const from = sampler.getOutput().getArray();
        const to = new Int16Array(from.length);
        for (let i = 0; i < from.length; i++) to[i] = Math.round(Math.max(-1, Math.min(1, from[i])) * 32767);
        sampler.setOutput(doc.createAccessor().setType('VEC4').setArray(to).setNormalized(true).setBuffer(root.listBuffers()[0]));
      }
    }
    for (const s of anim.listSamplers()) if (!s.listParents().some((p) => p.propertyType === 'AnimationChannel')) s.dispose();
    if (pack.suffix) anim.setName(anim.getName() + pack.suffix);
    clips.push({ name: anim.getName(), seconds });
  }
  await doc.transform(dedup(), prune({ keepLeaves: true }));
  // The tip bones have nothing left on them, nor has the node the mannequin's mesh was on.
  for (const n of root.listNodes()) if (/_leaf_/.test(n.getName()) || n.getName() === 'Mannequin') n.dispose();

  await io.write(join(OUT, pack.out), doc);
  const kb = Math.round(statSync(join(OUT, pack.out)).size / 1024);
  console.log(`${pack.out}: ${clips.length} clips, ${kb} KB`);
  console.log(`  ${clips.map((c) => `${c.name} ${c.seconds.toFixed(2)}`).join(', ')}`);
}
