// Does every Mixamo .fbx have its clip in assets/anims/review/mixamo*.glb, and is any clip in there twice?
//
//   node scripts/anims/mixamo_check.mjs [--fix] [folder of .fbx, default .cache/mixamo]
//
// Prints the .fbx files with no clip (to convert again: put them in a folder of their own and run
// scripts/anims/mixamo_export.py and mixamo.mjs as that file's header says) and the clip names found in more than one
// file. `--fix` drops the later copy of a clip that's in two files (a batch boundary that moved: the same clip twice) and
// renames the second of two clips of one name inside a file (`_alt`: two Mixamo clips whose names differ only in spacing).
// Names are made from the file's name as scripts/anims/mixamo.mjs makes them.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fix = process.argv.includes('--fix');
const folder = resolve(ROOT, process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? '.cache/mixamo');
const REVIEW = join(ROOT, 'assets', 'anims', 'review');
const clipName = (file) => `MX_${file.replace(/\s*\((\d+)\)/g, '_$1').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;

const io = new NodeIO();
const files = readdirSync(REVIEW).filter((f) => /^mixamo_b\d+(_\d+)?\.glb$/.test(f) || f === 'mixamo_fix.glb').sort();
if (fix) {
  const seen = new Set();
  for (const f of files) {
    const doc = await io.read(join(REVIEW, f));
    let changed = 0;
    const here = new Set();
    for (const a of doc.getRoot().listAnimations()) {
      const n = a.getName();
      if (seen.has(n)) { a.dispose(); changed++; continue; }
      if (here.has(n)) { a.setName(`${n}_alt`); changed++; continue; }
      here.add(n);
    }
    here.forEach((n) => seen.add(n));
    if (changed) {
      await doc.transform(prune());
      await io.write(join(REVIEW, f), doc);
      console.log(`fixed ${f}: ${changed} change${changed > 1 ? 's' : ''}`);
    }
  }
}
const have = new Map();
for (const f of files) {
  for (const a of (await io.read(join(REVIEW, f))).getRoot().listAnimations()) have.set(a.getName(), [...(have.get(a.getName()) ?? []), f]);
}
const fbx = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.fbx')).map((f) => f.slice(0, -4));
const missing = fbx.filter((f) => !have.has(clipName(f)));
const twice = [...have].filter(([, files]) => files.length > 1);
const clash = Object.entries(fbx.reduce((m, f) => ((m[clipName(f)] = [...(m[clipName(f)] ?? []), f]), m), {})).filter(([, v]) => v.length > 1);
console.log(`${fbx.length} .fbx files, ${have.size} clips in the glbs`);
console.log(`missing (${missing.length}):`, missing.join(' | ') || 'none');
console.log(`in more than one glb (${twice.length}):`, twice.map(([n, f]) => `${n} [${f.join(', ')}]`).slice(0, 10).join(' | ') || 'none');
if (clash.length) console.log(`two files, one clip name (${clash.length}):`, clash.map(([n, v]) => `${n} <- ${v.join(' / ')}`).slice(0, 10).join(' | '));
if (!existsSync(folder)) process.exit(1);
