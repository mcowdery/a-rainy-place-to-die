// What's in a .glb, held against a budget: triangles, bones, textures and their sizes, the file's size and what the
// textures take on the GPU. With no arguments, the cast (assets/characters/*.glb) against the cast's budget
// (.claude/rules/cast.md: 30k triangles, textures 1024² at most but for one, the skin's, at 2048²).
//
//   node scripts/glbCheck.mjs [files or folders] [--tris n] [--tex px] [--big px]
//
//   Other files or folders are only reported, unless a budget is given: --tris the most triangles, --tex the largest
//   texture side, --big the side one texture (a skin) may have instead. Exits 1 if anything is over.
//   For everything else about a file: npx gltf-transform inspect <file>.
import { readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { inspect } from '@gltf-transform/functions';

const CAST = { dir: 'assets/characters', tris: 30000, tex: 1024, big: 2048 };

const args = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = Number(args[++i]);
  else rest.push(args[i]);
}
const budget = rest.length ? opt : { ...CAST, ...opt };
const files = (rest.length ? rest : [CAST.dir])
  .flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith('.glb')).map((f) => join(p, f)) : [p]))
  .sort();

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
let over = 0;

for (const file of files) {
  const doc = await io.read(resolve(file));
  const report = inspect(doc);
  const tris = report.meshes.properties.reduce((n, m) => n + m.glPrimitives * Math.max(m.instances, 1), 0);
  const bones = Math.max(0, ...doc.getRoot().listSkins().map((s) => s.listJoints().length));
  const textures = report.textures.properties.map((t) => ({ ...t, side: Math.max(...t.resolution.split('x').map(Number)) }));
  const gpu = textures.reduce((n, t) => n + (t.gpuSize ?? 0), 0);

  const faults = [];
  if (budget.tris && tris > budget.tris) faults.push(`${tris.toLocaleString('en')} triangles, over ${budget.tris.toLocaleString('en')}`);
  if (budget.tex) {
    const large = textures.filter((t) => t.side > budget.tex);
    const tooBig = large.filter((t) => t.side > (budget.big ?? budget.tex));
    for (const t of tooBig) faults.push(`texture ${t.name || t.slots.join('/')} is ${t.resolution}, over ${budget.big ?? budget.tex}²`);
    if (budget.big && large.length - tooBig.length > 1)
      faults.push(`${large.length - tooBig.length} textures over ${budget.tex}² (one allowed): ${large.filter((t) => !tooBig.includes(t)).map((t) => `${t.name || t.slots.join('/')} ${t.resolution}`).join(', ')}`);
  }
  over += faults.length;

  const sizes = [...new Set(textures.map((t) => t.side))].sort((a, b) => b - a).map((s) => `${textures.filter((t) => t.side === s).length}×${s}²`);
  console.log(
    `${faults.length ? 'OVER' : 'ok  '} ${basename(file).padEnd(26)} ${tris.toLocaleString('en').padStart(7)} tris  ${String(bones).padStart(3)} bones  ` +
      `${String(report.animations.properties.length).padStart(2)} anims  ${mb(statSync(file).size).padStart(8)}  textures ${sizes.join(' ') || 'none'} (${mb(gpu)} on the GPU)`,
  );
  for (const f of faults) console.log(`       ${f}`);
}
if (over) process.exit(1);
