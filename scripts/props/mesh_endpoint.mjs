// One picture of an object -> a mesh of its shape (no colour), made by Hi3DGen on the Studio's RunPod
// endpoint (the worker is Trame/trame-mesh: MIT code and weights, nothing research-only in it; see
// .claude/rules/generated-art.md for why this one and what it doesn't do). The stronger sibling of
// scripts/props/image_to_3d.py, which runs on this machine and makes a rougher shape with the picture's
// colours on it. Tooling only: nothing it makes goes into the game without the user's approval.
//
//   node scripts/props/mesh_endpoint.mjs <picture> [--name tanuki] [--faces 200000] [--seed 0]
//                                        [--steps 50] [--guidance 3] [--detail-steps 6] [--detail-guidance 3]
//                                        [--cutout yes] [--engine hunyuan [--texture 2048] [--views 8]
//                                        [--view-size 768] [--octree 384] [--texture-seed n]]
//                                        [--engine pixal3d [--resolution 1024] [--fov 0.35]] [--job <id>]
//
//   `--engine pixal3d` sends the picture to the third mesh worker (Trame/trame-mesh-pixal3d: Pixal3D, MIT, shape
//   only like Hi3DGen's: no colour, no normal.png), whose mesh is made IN THE PICTURE'S OWN CAMERA, so the picture can be
//   laid back on it exactly: the answer's camera is written beside the .glb as camera.json (the field of view, where the
//   camera stands, a view matrix and the intrinsics for cutout.png's pixels, and where cutout.png's frame lies in the
//   picture that was sent), and report.json carries `camera_iou`: the mesh drawn through that camera against the
//   cut-out's outline (1 = the same). `--resolution` is the grid the surface is read off (1024, or 1536: slower and
//   larger), `--fov` the camera's field of view in radians (left out, the worker estimates one from the picture; a
//   picture taken from far off, or drawn flat, wants a small one such as 0.2). `--steps` and `--guidance` there are 12 and
//   7.5 (the coarse shape), `--detail-steps` and `--detail-guidance` 12 and 7.5. Its .glb is y up with the pictured side
//   towards +z like the others, but in the model's own units: the cut-out's frame is the unit square, so the object is
//   about 0.9 across, not a unit tall, and is not centred (move it and camera.json no longer fits it).
//
//   `--job <id>` takes up a job already sent (one this script gave up waiting for) instead of sending the picture again.
//
//   `--engine hunyuan` sends the picture to the other mesh worker instead (Trame/trame-mesh-hunyuan: Tencent's
//   Hunyuan3D 2.1), which makes a TEXTURED mesh: colour and metal/roughness maps inside the .glb (`--texture` their
//   side, 1024 / 2048 / 4096; `--faces` there is 60,000 unless told, 150,000 at most, and there is no normal.png; `--seed` is the shape's noise and,
//   unless `--texture-seed` gives the paint one of its own, the paint's too: the same picture and seed, another texture seed, is
//   the same shape painted again).
//   AN EXPERIMENT ONLY: its licence doesn't apply in the EU, the UK or South Korea and forbids using or showing what
//   the model MAKES there, so nothing from it goes into the game's assets: it stays in debug-shots/.
//
//   The picture has to be the project's own (the mesh is made from it). Its background is removed on the worker;
//   `--cutout yes` says it's already cut out by hand (a PNG whose transparency is the cut), and is sent as it is. Writes
//   debug-shots/image_to_3d/<name>/ (git-ignored): <name>.glb (y up, the side the picture shows towards +z,
//   about a unit tall), normal.png (the normal map the shape was made from), cutout.png (the picture as the
//   model saw it) and report.json. `node debug-shots/meshview.mjs <out.png> <the .glb>` photographs it.
//
//   It needs the endpoint's id and a RunPod key: RUNPOD_MESH_ENDPOINT_ID (RUNPOD_MESH_HUNYUAN_ENDPOINT_ID for
//   `--engine hunyuan`, RUNPOD_MESH_PIXAL3D_ENDPOINT_ID for `--engine pixal3d`) and RUNPOD_API_KEY, from the
//   environment or from the Studio's own trame-studio/.env (beside this repo; KREA_STUDIO_ENV says where if
//   it's elsewhere). A job costs GPU time on the user's RunPod account: seconds once a worker is up, and the
//   minutes it takes one to start from cold.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STUDIO_ENV = process.env.KREA_STUDIO_ENV ?? join(ROOT, '..', 'Trame', 'trame-studio', '.env');

const args = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else rest.push(args[i]);
}
const picture = rest[0];
if (!picture) {
  console.log('Usage: node scripts/props/mesh_endpoint.mjs <picture> [--name tanuki] [--faces 200000] [--seed 0]');
  process.exit(1);
}

/** A setting from the environment, or else from the Studio's .env (never printed). */
function setting(name) {
  if (process.env[name]) return process.env[name].trim();
  if (!existsSync(STUDIO_ENV)) return '';
  const line = readFileSync(STUDIO_ENV, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
}
// The three mesh workers: Hi3DGen (shape only, usable in the game), Hunyuan3D 2.1 (textured, an experiment only) and
// Pixal3D (shape only, in the picture's own camera).
const ENGINES = { hi3dgen: ['RUNPOD_MESH_ENDPOINT_ID', 'trame-mesh'], hunyuan: ['RUNPOD_MESH_HUNYUAN_ENDPOINT_ID', 'trame-mesh-hunyuan'], pixal3d: ['RUNPOD_MESH_PIXAL3D_ENDPOINT_ID', 'trame-mesh-pixal3d'] };
const engine = opt.engine ?? 'hi3dgen';
if (!ENGINES[engine]) {
  console.log(`--engine is ${Object.keys(ENGINES).join(' or ')}, not "${engine}".`);
  process.exit(1);
}
const [endpointSetting, workerFolder] = ENGINES[engine];
const key = setting('RUNPOD_API_KEY');
const endpoint = setting(endpointSetting);
if (!key || !endpoint) {
  console.log(`No ${!key ? 'RUNPOD_API_KEY' : endpointSetting} in the environment or in ${STUDIO_ENV}.`);
  console.log(`The endpoint is made from Trame/${workerFolder} (its Dockerfile says how); its id goes in the Studio .env as ${endpointSetting}.`);
  process.exit(1);
}

const name = (opt.name ?? basename(picture, extname(picture))).replace(/[^\w.-]+/g, '_');
const out = join(ROOT, 'debug-shots', 'image_to_3d', name);
// Unless it's said to be cut out already, the picture goes without its alpha channel, so the worker removes the
// background itself: a pasted or exported PNG often carries a trace of transparency that means nothing, and the
// first worker (v1) took any at all to mean "already cut out" and modelled the whole scene.
let bytes = readFileSync(picture);
if (opt.cutout !== 'yes' && /\.(png|webp)$/i.test(picture)) {
  const flat = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', picture, '-vf', 'format=rgb24', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 256 * 2 ** 20 });
  if (flat.status === 0 && flat.stdout.length > 0) bytes = flat.stdout;
  else console.log(`  (couldn't drop the picture's transparency: sent as it is. ${String(flat.stderr).trim().slice(0, 200)})`);
}
const input = { image: bytes.toString('base64') };
// (Five of them are the Hunyuan worker's and the last two the Pixal3D worker's; each worker reads only its own.)
for (const [flag, field] of [['faces', 'faces'], ['seed', 'seed'], ['steps', 'steps'], ['guidance', 'guidance'], ['detail-steps', 'detail_steps'], ['detail-guidance', 'detail_guidance'], ['texture', 'texture'], ['views', 'views'], ['view-size', 'view_size'], ['octree', 'octree'], ['texture-seed', 'texture_seed'], ['resolution', 'resolution'], ['fov', 'fov']]) {
  if (opt[flag] !== undefined) input[field] = Number(opt[flag]);
}

const api = `https://api.runpod.ai/v2/${endpoint}`;
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const call = async (path, init) => {
  const res = await fetch(api + path, { ...init, headers });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) throw new Error(`RunPod ${res.status}: ${data.error ?? text.slice(0, 300)}`);
  return data;
};

const started = Date.now();
// (`--job`: one already sent, which an earlier run of this gave up waiting for; the picture isn't sent again.)
const job = opt.job ? await call(`/status/${opt.job}`) : await call('/run', { method: 'POST', body: JSON.stringify({ input }) });
console.log(`job ${job.id}: ${job.status}`);
let status = job;
let last = job.status;
// Half an hour: a worker starting from cold pulls a 15 GB image first.
while (!['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status.status)) {
  if (Date.now() - started > 30 * 60e3) {
    console.log(`Still ${status.status} after half an hour: giving up waiting (the job ${job.id} is left running; cancel it in RunPod if it shouldn't be).`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 4000));
  try {
    status = await call(`/status/${job.id}`);
  } catch (err) {
    console.log(`  (${err.message}: asking again)`);
    continue;
  }
  if (status.status !== last) console.log(`  ${status.status} after ${Math.round((Date.now() - started) / 1000)} s`);
  last = status.status;
}
const result = status.output ?? {};
if (status.status !== 'COMPLETED' || result.error) {
  console.log(`The job ${status.status === 'COMPLETED' ? 'answered with an error' : status.status.toLowerCase()}: ${result.error ?? status.error ?? 'no reason given'}`);
  if (result.traceback) console.log(result.traceback);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}.glb`), Buffer.from(result.mesh, 'base64'));
if (result.normal) writeFileSync(join(out, 'normal.png'), Buffer.from(result.normal, 'base64'));
if (result.cutout) writeFileSync(join(out, 'cutout.png'), Buffer.from(result.cutout, 'base64'));
// (Pixal3D's: the camera the mesh was made in, for cutout.png's pixels. report.json keeps its `camera_iou`.)
if (result.camera) writeFileSync(join(out, 'camera.json'), JSON.stringify(result.camera, null, 2));
const { mesh, normal, cutout, camera, ...report } = result;
writeFileSync(join(out, 'report.json'), JSON.stringify({ picture: resolve(picture), engine, endpoint, job: job.id, waited: Math.round((Date.now() - started) / 1000), runpod: { delayTime: status.delayTime, executionTime: status.executionTime }, ...report }, null, 2));
console.log(`${join(out, `${name}.glb`)}`);
console.log(`  ${result.triangles.toLocaleString('en')} triangles (${result.triangles_generated.toLocaleString('en')} as generated), ${(Buffer.byteLength(result.mesh, 'base64') / 2 ** 20).toFixed(1)} MB`);
if (result.textured) console.log(`  textured: ${result.texture} px maps from ${result.views} views of ${result.view_size} px (an experiment only: see this script's header for the licence)`);
if (result.camera) console.log(`  camera.json: field of view ${result.camera.fov_degrees.toFixed(1)} degrees (${result.camera.fov_from}), the mesh's outline through it against the cut-out's ${result.camera_iou} (1 = the same)`);
for (const note of result.notes ?? []) console.log(`  note: ${note}`);
console.log(`  ${result.seconds?.all ?? '?'} s on the worker, GPU peak ${result.gpu_peak_gib} GiB; waited ${Math.round((Date.now() - started) / 1000)} s in all`);
