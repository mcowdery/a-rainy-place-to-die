// What every shot script and benchmark shares, so several agents (and checkouts) can run them at once:
//
//   const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
//
// is Vite's createServer with three things settled:
//   - the root is this checkout (the folder above scripts/), whatever the directory it's run from;
//   - nothing is watched and nothing hot-reloads (`hmr: false`, `watch: null`): a run is a snapshot of the files as
//     the page loads them, so another agent saving a file, or a change to vite.config.ts, can't reload or restart it
//     part way through;
//   - the run takes its place in the queue for the GPU (below).
//
// The GPU queue (one GTX 1070 Ti for everything): any number of ordinary runs go at once ('shared'), but a run that
// measures frame times or fills the GPU ('exclusive': the benchmarks, the *perf scripts, the music generator) waits
// for the others to finish and holds the rest back while it runs. `shotServer(config, { gpu: 'exclusive' })`, or for
// one run of any script `CITYPOP_GPU=exclusive node debug-shots/<script>.mjs ...` ('shared', 'off' likewise).
// A holder is a file `<pid>-<mode>.json` in the temp folder's citypop-gpu/, gone when its process is; nobody waits
// more than WAIT, after which the run goes ahead and says so. scripts/gpu_lock.py is the same queue for Python.
import { createServer } from 'vite';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = join(tmpdir(), 'citypop-gpu');
const WAIT = 15 * 60e3;
let held = false;

export async function shotServer(config = {}, { gpu } = {}) {
  await gpuQueue(gpu);
  return createServer({ root: ROOT, ...config, server: { hmr: false, watch: null, ...config.server } });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

/** Everyone else in the queue; a holder whose process has gone is cleared away. */
function holders() {
  let names = [];
  try {
    names = readdirSync(DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const m = /^(\d+)-(shared|exclusive)\.json$/.exec(name);
    if (!m || Number(m[1]) === process.pid) continue;
    const pid = Number(m[1]);
    if (!alive(pid)) {
      try {
        unlinkSync(join(DIR, name));
      } catch {}
      continue;
    }
    let info = {};
    try {
      info = JSON.parse(readFileSync(join(DIR, name), 'utf8'));
    } catch {}
    out.push({ pid, mode: m[2], since: info.since ?? 0, label: info.label ?? '?' });
  }
  return out;
}

/** Waits for this process's turn on the GPU and holds it until the process ends. */
export async function gpuQueue(mode, label = basename(process.argv[1] ?? 'node')) {
  mode = process.env.CITYPOP_GPU || mode || 'shared';
  if (held || (mode !== 'shared' && mode !== 'exclusive')) return;
  mkdirSync(DIR, { recursive: true });
  const file = join(DIR, `${process.pid}-${mode}.json`);
  const since = Date.now();
  const take = () => writeFileSync(file, JSON.stringify({ label, since, cwd: process.cwd() }));
  const drop = () => {
    try {
      unlinkSync(file);
    } catch {}
  };
  // A shared run waits for every exclusive one; an exclusive run for the shared ones and the exclusive ones before it.
  const ahead = (h) => (mode === 'shared' ? h.mode === 'exclusive' : h.mode === 'shared' || h.since < since || (h.since === since && h.pid < process.pid));
  // An exclusive run stands in the queue while it waits, which holds new shared runs back.
  if (mode === 'exclusive') take();
  process.on('exit', drop);
  const start = Date.now();
  let said = 0;
  for (;;) {
    const before = holders().filter(ahead);
    if (!before.length) {
      if (mode === 'exclusive') break;
      take();
      if (!holders().some(ahead)) break;
      drop();
    } else if (Date.now() - start > WAIT) {
      console.error(`GPU: still busy after ${WAIT / 60e3} minutes (${before.map((h) => h.label).join(', ')}); going ahead, so this run may be slow and its timings off`);
      take();
      break;
    } else if (Date.now() - said > 30e3) {
      console.error(`GPU: waiting for ${before.map((h) => `${h.label} (${h.mode}, pid ${h.pid})`).join(', ')}`);
      said = Date.now();
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  held = true;
}
