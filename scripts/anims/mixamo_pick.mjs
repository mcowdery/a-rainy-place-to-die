// Pulls chosen Mixamo clips out of the converted library into a small file the game takes.
//
//   node scripts/anims/mixamo_pick.mjs [--out assets/anims/mixamo_picked.glb] [--list] <clip or glob> ...
//   e.g. node scripts/anims/mixamo_pick.mjs "MX_Standing_Cover_Against_Object" "MX_Male_Jumping_Over_*"
//        node scripts/anims/mixamo_pick.mjs --list "*cover*"          (what a pattern would take, nothing written)
//
// The whole library (every Mixamo clip, assets/anims/review/mixamo_b*.glb, kept off git: Mixamo's terms don't let the
// raw files be passed on, and the game doesn't ship them) stays where it is; this writes the few clips wanted into one
// glb under assets/anims/ (which the city's library does take), each with the skeleton it was converted on. Run it
// again with a longer list as the choice grows: it rewrites the file from scratch. A clip is picked by name or by a
// `*` pattern (case-insensitive). The files each clip is in are the ones that share its skeleton: a pick from two
// skeletons makes two files (`_2`).
//
// After picking, put the clips' credits in assets/anims/CREDITS.md (Mixamo, Adobe; the clip's description as Mixamo
// calls it; the date downloaded) before the file is committed.
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REVIEW = join(ROOT, 'assets', 'anims', 'review');
const args = process.argv.slice(2);
const list = args.includes('--list');
const outAt = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'assets/anims/mixamo_picked.glb';
const patterns = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!patterns.length) {
  console.log('Usage: node scripts/anims/mixamo_pick.mjs [--out <file.glb>] [--list] <clip or pattern> ...');
  process.exit(1);
}
const res = patterns.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i'));
const io = new NodeIO();

const picked = new Map(); // glb file -> names
for (const f of readdirSync(REVIEW).filter((f) => /^mixamo(_b\d+|_aa|_fix)?(_\d+)?\.glb$/.test(f))) {
  const doc = await io.read(join(REVIEW, f));
  const names = doc.getRoot().listAnimations().map((a) => a.getName()).filter((n) => res.some((r) => r.test(n)));
  if (names.length) picked.set(f, names);
}
const all = [...picked.values()].flat();
console.log(`${all.length} clip${all.length === 1 ? '' : 's'} match${list ? ':' : ''}`);
if (list || !all.length) {
  for (const [f, names] of picked) console.log(`  ${f}: ${names.join(', ')}`);
  process.exit(0);
}

// One output file for each distinct skeleton among the source files (each source file is one skeleton already).
const skeletonOf = async (f) => {
  const root = (await io.read(join(REVIEW, f))).getRoot();
  return JSON.stringify(root.listNodes().map((n) => [n.getName(), n.getTranslation().map((v) => +v.toFixed(3))]));
};
const groups = [];
for (const f of picked.keys()) {
  const key = await skeletonOf(f);
  const g = groups.find((g) => g.key === key);
  if (g) g.files.push(f);
  else groups.push({ key, files: [f] });
}
for (const [i, g] of groups.entries()) {
  // Start from a copy of the first source file and drop every animation (and its accessors) that isn't wanted.
  const doc = await io.read(join(REVIEW, g.files[0]));
  const keep = new Set(g.files.flatMap((f) => picked.get(f)));
  for (const a of doc.getRoot().listAnimations()) if (!keep.has(a.getName())) a.dispose();
  // Clips from the group's other files: their tracks are re-pointed at this file's nodes (same skeleton by name).
  const node = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
  const buffer = doc.getRoot().listBuffers()[0];
  for (const f of g.files.slice(1)) {
    const src = await io.read(join(REVIEW, f));
    for (const a of src.getRoot().listAnimations()) {
      if (!keep.has(a.getName())) continue;
      const anim = doc.createAnimation(a.getName());
      for (const ch of a.listChannels()) {
        const s = ch.getSampler();
        const input = doc.createAccessor().setType(s.getInput().getType()).setArray(s.getInput().getArray().slice()).setBuffer(buffer);
        const output = doc.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setNormalized(s.getOutput().getNormalized()).setBuffer(buffer);
        const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s.getInterpolation());
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node.get(ch.getTargetNode().getName())).setTargetPath(ch.getTargetPath()).setSampler(sampler));
      }
    }
  }
  const out = resolve(ROOT, i ? outAt.replace(/\.glb$/, `_${i + 1}.glb`) : outAt);
  await doc.transform(prune()); // the accessors of the clips dropped
  await io.write(out, doc);
  console.log(`${out}: ${[...keep].length} clips, ${Math.round(statSync(out).size / 1024)} KB`);
}
console.log('Now credit them in assets/anims/CREDITS.md (Mixamo / Adobe, each clip as Mixamo names it, the date).');
