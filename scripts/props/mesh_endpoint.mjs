// One picture of an object -> a mesh of its shape (no colour), made by Hi3DGen on the Studio's RunPod
// endpoint (the worker is Trame/trame-mesh: MIT code and weights, nothing research-only in it; see
// .claude/rules/generated-art.md for why this one and what it doesn't do). The stronger sibling of
// scripts/props/image_to_3d.py, which runs on this machine and makes a rougher shape with the picture's
// colours on it. Tooling only: nothing it makes goes into the game without the user's approval.
//
//   node scripts/props/mesh_endpoint.mjs <picture> [--name tanuki] [--faces 200000] [--seed 0]
//                                        [--steps 50] [--guidance 3] [--detail-steps 6] [--detail-guidance 3]
//                                        [--cutout yes] [--keep-on yes] [--engine hunyuan [--texture 2048] [--views 8]
//                                        [--view-size 768] [--octree 384] [--texture-seed n]]
//                                        [--engine pixal3d [--resolution 1024] [--fov 0.35] [--view 180:back.png ...]] [--job <id>]
//                                        [--engine genia [--class tanuki] [--front model] [--override key=value ...]]
//
//   `--engine genia` sends the picture to the fourth mesh worker (Trame/trame-mesh-genia: Meta's GenIA, which keeps SAM
//   3D Objects frozen and fits what it generates to the picture as it generates), which makes a COLOURED mesh: a colour a
//   vertex inside the .glb, no texture map, no UVs, no normal.png.
//   NON-COMMERCIAL BY LICENCE, and the user chose it knowing that (2026-10-13): GenIA's code is CC BY-NC 4.0, it renders
//   with nvdiffrast (NVIDIA's licence: research or evaluation only) and its depth model's weights are CC BY-NC 4.0, so
//   nothing from it goes into anything that is sold: it stays in debug-shots/.
//   What it is good at: an ordinary object photographed in a real scene (it reads depth and a camera off the scene round
//   the object, so the WHOLE picture is sent, with a mask). What it is bad at: an object cut out and pasted on a flat
//   ground came out flattened front to back; people and faces come out badly; a picture that reads as a telephoto shot (a
//   tight crop) is out of its range. It says how it did: report.json has `fit` (the PSNR and SSIM of its own render
//   against the picture: 25 to 33 dB is a good fit, about 20 a failed one), `camera` (the camera it estimated, also
//   written as camera.json) and `warnings` (a fit under 23 dB; a field of view under 25 degrees; a picture sent cut out),
//   which are printed. `--class` is one word for what the object is ("object" unless told), `--seed` GenIA's own (42),
//   `--faces` there is 150,000 unless told and 0 leaves the mesh as made (380,000 to 950,000, reduced only as far as an
//   answer can carry), `--override key=value`, repeated, passes a setting of GenIA's own through
//   (`finetuning.num_iterations=200`). Its .glb is y up and its longest side about 1 like the others'; the pictured side
//   is towards +z by GenIA's own pose of the object (report.json's `facing`), and `--front model` leaves the object's
//   own front there instead (a turtle photographed from the side then faces +z, not its flank). Beside the .glb it
//   writes render_train.png (GenIA's render from the picture's view) and render_azpos / azneg / elpos / elneg.png (30
//   degrees to each side, above and below): the quickest way to see whether the fit held. A job is about five minutes
//   on an RTX 4090, on a 48GB card by choice (24GB only fits the smaller objects); a worker's first start also fetches
//   19GB of weights, so this script may give up waiting before the job is done: `--job <id>` takes it up again.
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
//   MORE THAN ONE VIEW (`--engine pixal3d`): `--view <azimuth>:<picture>`, repeated, adds a picture of the SAME figure from
//   another side (Pixal3D's multi-view mode: its own multi-view weights; the shape is conditioned on every view, so the
//   far side is seen, not invented: heels, the back of a hand). The main <picture> is the front (azimuth 0). Azimuth 90 =
//   the camera at the figure's LEFT (the right of the front picture), 180 = the back, 270 = its right; `--view
//   180:back.png`, or with an elevation in degrees `--view 90,10:left.png`. (Not `--views`, which is the Hunyuan
//   worker's count of texture views.) The views must be the same size in pixels, the same pose, the figure at the same
//   scale and on the same vertical axis in each (the worker cuts them all with ONE frame; it does not rescale one to fit
//   another): see Trame/trame-mesh-pixal3d/handler.py. `--fov` (radians) is then the camera of all of them. Each is
//   treated like the main picture (its background removed on the worker unless `--cutout yes`). The first multi-view job
//   on a worker reads 16.5GB of weights (a minute or three); camera.json and cutout.png are the FRONT view's, in the
//   shared frame, and the mesh is about 1.0 across (the frame 1.1: camera.json's `extent`).
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
//   A PAUSED ENDPOINT (max workers 0, which is how the Studio gives an unused endpoint's worker slot back) is lifted to one
//   worker first, the job is sent again, and when it is over the endpoint is paused again if nothing else is using it:
//   `--keep-on yes` leaves it on. That changes the endpoint's settings, so it needs a key with REST access:
//   RUNPOD_MANAGE_API_KEY (as in the Studio's .env), else RUNPOD_API_KEY. If every worker of the account is taken, it says so.
//
//   It needs the endpoint's id and a RunPod key: RUNPOD_MESH_ENDPOINT_ID (RUNPOD_MESH_HUNYUAN_ENDPOINT_ID for
//   `--engine hunyuan`, RUNPOD_MESH_PIXAL3D_ENDPOINT_ID for `--engine pixal3d`, RUNPOD_MESH_GENIA_ENDPOINT_ID for
//   `--engine genia`) and RUNPOD_API_KEY, from the
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
const extraViews = []; // `--view 180:back.png`, repeated: Pixal3D's other views
const overrides = []; // `--override key=value`, repeated: GenIA's own settings
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--view') extraViews.push(args[++i] ?? '');
  else if (args[i] === '--override') overrides.push(args[++i] ?? '');
  else if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
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
// The four mesh workers: Hi3DGen (shape only, usable in the game), Hunyuan3D 2.1 (textured, an experiment only),
// Pixal3D (shape only, in the picture's own camera) and GenIA (a colour a vertex; non-commercial by licence).
const ENGINES = { hi3dgen: ['RUNPOD_MESH_ENDPOINT_ID', 'trame-mesh'], hunyuan: ['RUNPOD_MESH_HUNYUAN_ENDPOINT_ID', 'trame-mesh-hunyuan'], pixal3d: ['RUNPOD_MESH_PIXAL3D_ENDPOINT_ID', 'trame-mesh-pixal3d'], genia: ['RUNPOD_MESH_GENIA_ENDPOINT_ID', 'trame-mesh-genia'] };
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
const prepared = (file) => {
  let bytes = readFileSync(file);
  if (opt.cutout !== 'yes' && /\.(png|webp)$/i.test(file)) {
    const flat = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'format=rgb24', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 256 * 2 ** 20 });
    if (flat.status === 0 && flat.stdout.length > 0) bytes = flat.stdout;
    else console.log(`  (couldn't drop the picture's transparency: sent as it is. ${String(flat.stderr).trim().slice(0, 200)})`);
  }
  return bytes;
};
const input = { image: prepared(picture).toString('base64') };
if (extraViews.length) {
  if (engine !== 'pixal3d') {
    console.log('--view is for --engine pixal3d (several pictures of one figure).');
    process.exit(1);
  }
  // The main picture is the front (its bytes are `image`, not sent twice); the others as `azimuth[,elevation]:file`.
  input.views = [{ azimuth_deg: 0, name: 'front' }];
  for (const spec of extraViews) {
    const m = /^(-?[\d.]+)(?:,(-?[\d.]+))?:(.+)$/.exec(spec);
    if (!m || !existsSync(m[3])) {
      console.log(`--view is <azimuth>[,<elevation>]:<picture> (180:back.png, 90,10:left.png), not "${spec}"${m && !existsSync(m[3]) ? ` (no file ${m[3]})` : ''}.`);
      process.exit(1);
    }
    input.views.push({ image_b64: prepared(m[3]).toString('base64'), azimuth_deg: Number(m[1]), elevation_deg: Number(m[2] ?? 0), name: basename(m[3], extname(m[3])).replace(/[^\w.-]+/g, '_') });
  }
}
// (Five of them are the Hunyuan worker's and the last two the Pixal3D worker's; each worker reads only its own.)
for (const [flag, field] of [['faces', 'faces'], ['seed', 'seed'], ['steps', 'steps'], ['guidance', 'guidance'], ['detail-steps', 'detail_steps'], ['detail-guidance', 'detail_guidance'], ['texture', 'texture'], ['views', 'views'], ['view-size', 'view_size'], ['octree', 'octree'], ['texture-seed', 'texture_seed'], ['resolution', 'resolution'], ['fov', 'fov']]) {
  if (opt[flag] !== undefined) input[field] = Number(opt[flag]);
}
// (GenIA's own: what the object is, which side is turned to +z, settings passed through. `--cutout yes` there says the
// picture's own transparency is the mask.)
if (engine === 'genia') {
  if (opt.class !== undefined) input.class = opt.class;
  if (opt.front !== undefined) input.front = opt.front;
  if (overrides.length) input.overrides = overrides;
  if (opt.cutout === 'yes') input.cutout = true;
} else if (overrides.length) {
  console.log('--override is for --engine genia (a setting of GenIA\'s own).');
  process.exit(1);
}

const api = `${process.env.RUNPOD_API_BASE ?? 'https://api.runpod.ai/v2'}/${endpoint}`;
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

// RunPod's worker quota counts every endpoint's max workers, so an endpoint nobody is using may have been paused
// (max workers 0) to give its slot away; /run then answers 409. The settings are changed with the management API
// (RUNPOD_MANAGE_API_KEY in the Studio .env, else the job key), as the Studio does for its own endpoints.
const restBase = `${process.env.RUNPOD_REST_BASE ?? 'https://rest.runpod.io/v1'}/endpoints/${endpoint}`;
const manageKey = setting('RUNPOD_MANAGE_API_KEY') || key;
const setWorkers = async (workersMax) => {
  const res = await fetch(restBase, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${manageKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ workersMin: 0, workersMax }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const data = JSON.parse(text);
      const found = Array.isArray(data) ? data[0] : (data.error ?? data.message);
      if (found) detail = String(found);
    } catch {}
    throw new Error(`RunPod ${res.status}: ${detail}`);
  }
};
// (process.exit straight after a fetch can crash Node on Windows with a libuv assertion: a wrong exit code.)
const exitSoon = async (code) => {
  await new Promise((r) => setTimeout(r, 300));
  process.exit(code);
};
const isPaused = (err) => /paused|max_workers=0/i.test(err.message);
let liftedIt = false; // true when this run took the endpoint off max workers 0

/** POST /run; a paused endpoint is lifted to one worker first and the job sent again. */
async function sendJob() {
  const run = () => call('/run', { method: 'POST', body: JSON.stringify({ input }) });
  try {
    return await run();
  } catch (err) {
    if (!isPaused(err)) throw err;
  }
  console.log('The endpoint is paused (max workers 0): lifting it to 1. Its first job waits for a new worker to start.');
  try {
    await setWorkers(1);
  } catch (err) {
    console.log(/workers quota/i.test(err.message)
      ? 'Every worker of the RunPod account is in use (the quota counts every endpoint\'s max workers). Set Max workers to 0 on an endpoint nobody is using, then run this again.'
      : `Couldn't lift the pause: ${err.message}. Set Max workers to 1 on endpoint ${endpoint} in RunPod (the management API needs RUNPOD_MANAGE_API_KEY, a key with REST access).`);
    await exitSoon(1);
  }
  liftedIt = true;
  // RunPod can take a moment to accept jobs again.
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isPaused(err) || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

/** Puts a paused endpoint back to paused once the job is over, unless something else is still using it (or `--keep-on yes`). */
async function pauseAgain() {
  if (!liftedIt || opt['keep-on'] === 'yes') return;
  try {
    const health = await call('/health');
    const busy = (health.jobs?.inQueue ?? 0) + (health.jobs?.inProgress ?? 0);
    if (busy > 0) {
      console.log(`  (left the endpoint on: ${busy} other job(s) are still using it)`);
      return;
    }
    await setWorkers(0);
    console.log('  endpoint paused again, as it was found (--keep-on yes leaves it on)');
  } catch (err) {
    console.log(`  (couldn't pause the endpoint again: ${err.message}; it is on, max workers 1)`);
  }
}

if (!opt.job && JSON.stringify({ input }).length > 9.5 * 2 ** 20) {
  console.log('The pictures together are over RunPod\'s 10 MB limit for a job: send smaller ones (the worker works at 1024 px at most).');
  process.exit(1);
}
const started = Date.now();
// (`--job`: one already sent, which an earlier run of this gave up waiting for; the picture isn't sent again.)
const job = opt.job ? await call(`/status/${opt.job}`) : await sendJob();
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
await pauseAgain();
const result = status.output ?? {};
if (status.status !== 'COMPLETED' || result.error) {
  console.log(`The job ${status.status === 'COMPLETED' ? 'answered with an error' : status.status.toLowerCase()}: ${result.error ?? status.error ?? 'no reason given'}`);
  if (result.traceback) console.log(result.traceback);
  if (result.log) console.log(`The last of the worker's log:\n${result.log}`); // (GenIA's own last lines)
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}.glb`), Buffer.from(result.mesh, 'base64'));
if (result.normal) writeFileSync(join(out, 'normal.png'), Buffer.from(result.normal, 'base64'));
if (result.cutout) writeFileSync(join(out, 'cutout.png'), Buffer.from(result.cutout, 'base64'));
// (Pixal3D's: the camera the mesh was made in, for cutout.png's pixels. report.json keeps its `camera_iou`.)
if (result.camera) writeFileSync(join(out, 'camera.json'), JSON.stringify(result.camera, null, 2));
// (GenIA's: its own renders of what it fitted, from the picture's view and 30 degrees off it.)
for (const [view, png] of Object.entries(result.renders ?? {})) writeFileSync(join(out, `render_${view}.png`), Buffer.from(png, 'base64'));
const { mesh, normal, cutout, camera, renders, ...report } = result;
writeFileSync(join(out, 'report.json'), JSON.stringify({ picture: resolve(picture), engine, endpoint, job: job.id, waited: Math.round((Date.now() - started) / 1000), runpod: { delayTime: status.delayTime, executionTime: status.executionTime }, ...report }, null, 2));
console.log(`${join(out, `${name}.glb`)}`);
console.log(`  ${result.triangles.toLocaleString('en')} triangles (${result.triangles_generated.toLocaleString('en')} as generated), ${(Buffer.byteLength(result.mesh, 'base64') / 2 ** 20).toFixed(1)} MB`);
if (result.textured) console.log(`  textured: ${result.texture} px maps from ${result.views} views of ${result.view_size} px (an experiment only: see this script's header for the licence)`);
if (result.camera && result.camera_iou !== undefined) console.log(`  camera.json: field of view ${result.camera.fov_degrees.toFixed(1)} degrees (${result.camera.fov_from}), the mesh's outline through it against the cut-out's ${result.camera_iou} (1 = the same)`);
if (engine === 'genia') {
  console.log(`  a colour a vertex, no texture (non-commercial by licence: see this script's header); ${result.facing?.from === 'pose' ? `turned ${result.facing.yaw_degrees} degrees so the pictured side faces +z` : 'the object\'s own front faces +z'}`);
  console.log(`  fit: PSNR ${result.fit?.psnr ?? '?'} dB, SSIM ${result.fit?.ssim ?? '?'} (25 to 33 dB is a good fit, about 20 a failed one)`);
  if (result.camera?.fov_degrees !== undefined) console.log(`  camera.json: field of view ${result.camera.fov_degrees.toFixed(1)} degrees (GenIA's estimate), fx ${result.camera.fx.toFixed(1)} fy ${result.camera.fy.toFixed(1)} at ${result.camera.width} x ${result.camera.height}`);
  console.log(`  renders: ${Object.keys(result.renders ?? {}).map((view) => `render_${view}.png`).join(', ') || 'none'}`);
  for (const warning of result.warnings ?? []) console.log(`  WARNING: ${warning}`);
}
if (result.views_used) console.log(`  ${result.views_used.length} views: ${result.views_used.map((v) => `${v.name} ${v.azimuth_deg}\u00b0`).join(', ')}; the front's frame in the picture sent: ${result.camera?.source_box?.map((v) => Math.round(v)).join(',')}`);
for (const note of result.notes ?? []) console.log(`  note: ${note}`);
console.log(`  ${result.seconds?.all ?? '?'} s on the worker, GPU peak ${result.gpu_peak_gib} GiB; waited ${Math.round((Date.now() - started) / 1000)} s in all`);
