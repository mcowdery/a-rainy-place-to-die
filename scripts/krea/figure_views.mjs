// Another view of a figure from a picture of her, through the Studio's Qwen-Image-Edit 2511 (Apache 2.0; it edits or
// composes one to three pictures, which the prompt calls "Picture 1" ...). For the source pictures of a generated figure
// (scripts/props/mesh_endpoint.mjs, then scripts/blender/project_picture.py): her from the front with her face straight,
// from behind, from either side, a close-up of her head. Candidates for the user to choose from, in a folder of their
// own; nothing here goes into the world.
//   node scripts/krea/figure_views.mjs --ref <picture> [--ref <second>] --prompt "<text>" --out <folder>/<name>
//        [--n 4] [--size 2048x2048] [--steps 40] [--seed 7] [--model qwen-image-edit-2511]
// Writes <out>_v1.png ... and <out>_v1.json (the prompt, the seeds and the Studio's job) beside them. Reads the Studio's
// address and login from .env.krea like the rest of scripts/krea (npm run krea:login).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import ffmpeg from 'ffmpeg-static';
import { Studio } from './studio.mjs';

const args = process.argv.slice(2);
const opt = { ref: [] };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  if (key === 'ref') opt.ref.push(args[i + 1]);
  else opt[key] = args[i + 1];
}
if (opt.ref.length === 0 || !opt.prompt || !opt.out) {
  console.log('Usage: node scripts/krea/figure_views.mjs --ref <picture> --prompt "<text>" --out <folder>/<name> [--n 4] [--size 2048x2048] [--steps 40] [--seed n] [--model qwen-image-edit-2511]');
  process.exit(1);
}
const [width, height] = (opt.size ?? '2048x2048').split('x').map(Number);
const model = opt.model ?? 'qwen-image-edit-2511';
// (Qwen-Image 2.1, the model the user's own pictures came from, is under the Qwen Research License, non-commercial: the user has read that
// and accepts it for the figures' pictures, 2026-10-08. `--model qwen-image-2.1` uses it; the default stays the Apache 2.0 edit model.)
const studio = new Studio();
if (!(await studio.me())) throw new Error('Not logged in to Krea Studio. Run: npm run krea:login');
// (The edit model wants three colour channels: a picture with an alpha channel is flattened first.)
const rgb = (p) => {
  const tmp = path.join(os.tmpdir(), `figure_views_${process.pid}_${path.basename(p)}.png`);
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', p, '-pix_fmt', 'rgb24', tmp]);
  if (r.status !== 0) throw new Error(`Could not read ${p}: ${r.stderr}`);
  const data = fs.readFileSync(tmp).toString('base64');
  fs.unlinkSync(tmp);
  return data;
};
const references = opt.ref.map(rgb);
const req = {
  prompt: opt.prompt,
  width,
  height,
  steps: Number(opt.steps ?? 40),
  num_images: Number(opt.n ?? 4),
  model,
  references,
  ...(opt.seed !== undefined ? { seed: Number(opt.seed) } : {}),
};
console.log(`${model}, ${width}x${height}, ${req.num_images} pictures, ${opt.ref.length} reference${opt.ref.length > 1 ? 's' : ''}`);
const { jobId, items } = await studio.generate(req, { onStatus: (s) => process.stdout.write(`${s.toLowerCase()} `) });
fs.mkdirSync(path.dirname(opt.out), { recursive: true });
for (const [k, out] of items.entries()) {
  const file = `${opt.out}_v${k + 1}.png`;
  await studio.download(out.url, file);
  fs.writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify({ prompt: opt.prompt, references: opt.ref, model, size: [out.width ?? width, out.height ?? height], steps: req.steps, seed: out.seed ?? null, studioJob: jobId, generated: new Date().toISOString() }, null, 2));
  console.log(`\n${file}`);
}
