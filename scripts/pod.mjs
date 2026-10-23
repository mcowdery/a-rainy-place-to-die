// Drives the RunPod dev pod from this machine: start it, stop it, run a command on it, copy files to and from it.
//   node scripts/pod.mjs status             what the pod is doing (always exits 0 if the pod exists)
//   node scripts/pod.mjs running            exit code 0 if the pod is up and answering SSH, 1 if not (for scripts and agents)
//   node scripts/pod.mjs start              starts the pod, waits for SSH, runs podSetup.sh --boot, writes `Host rainy-pod`
//                                           into ~/.ssh/config (VS Code: Remote-SSH -> rainy-pod). The USER starts the pod: it bills.
//   node scripts/pod.mjs run [flags] -- <command...>
//                                           syncs this checkout to the pod, runs the command there from the repo root, and
//                                           pulls back the files it made under debug-shots/ (and any --out path); exit code is the command's
//       --no-sync      skip the sync (nothing changed since the last run)      --full   resend every file, not just the changed ones
//       --no-pull      leave the new files on the pod                          --out <dir>   also pull new files under <dir> (assets/humans, ...)
//   node scripts/pod.mjs sync [--full]      the sync alone
//   node scripts/pod.mjs play [stop] [--kasm]   the game in a GPU browser on the pod, streamed to a tab here as H.264 from the GPU's
//                                           video encoder (scripts/podStream.sh); --kasm is the older KasmVNC one (podPlay.sh)
//   node scripts/pod.mjs ssh [cmd]          a shell on the pod, or one command
//   node scripts/pod.mjs pull <remote-path> [local-dir]
//   node scripts/pod.mjs stop
//   node scripts/pod.mjs guard              stops a pod stuck on "Starting" for POD_STUCK_MIN (20) minutes or up past
//                                           POD_MAX_HOURS (12) + 30 min; status, run and the dashboard do the same check
// The sync copies tracked and untracked files that git doesn't ignore, uncommitted work included; nothing is committed or
// pushed. Only files that changed since the last sync of this checkout are sent, and files deleted here are deleted there.
// A checkout under .claude/worktrees/<name> gets its own folder on the pod (/workspace/wt/<name>, sharing the main
// checkout's node_modules there), so agents on different worktrees don't overwrite each other.
// The pod stops itself when idle (scripts/podIdleStop.sh); `stop` is for when you know you're done.
// The RunPod key comes from RUNPOD_API_KEY or the Trame studio's .env (where scripts/props/mesh_endpoint.mjs reads it).
// POD_NAME (default `rainy-place`, the pod's name starts with it), POD_KEY (default ~/.ssh/runpod_ed25519).
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync, openSync, readdirSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = process.env.POD_NAME ?? 'rainy-place';
const KEY = process.env.POD_KEY ?? join(homedir(), '.ssh', 'runpod_ed25519');
const MAIN = '/workspace/a-rainy-place-to-die';
// What a run pulls back: files this new, under these folders, that aren't source (a run must never overwrite code here).
const PULL_ROOTS = ['debug-shots'];
const SOURCE_NAMES = ['*.mjs', '*.js', '*.ts', '*.py', '*.sh', '*.html', '*.css', '*.md'];

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
class Exit extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (msg, code = 1) => { throw new Exit(code, msg); };
/** RunPod has no free GPU of the wanted kinds in the volume's datacenter: worth retrying in a while. */
class NoStock extends Exit { constructor(msg) { super(3, msg); } }

/** The main checkout, which is where Trame sits beside, even from a worktree. */
function mainRoot() {
  try { return dirname(resolve(root, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root }).toString().trim())); } catch { return root; }
}

function apiKey() {
  if (process.env.RUNPOD_API_KEY) return process.env.RUNPOD_API_KEY;
  const envFile = process.env.KREA_STUDIO_ENV ?? resolve(mainRoot(), '../Trame/trame-studio/.env');
  const m = existsSync(envFile) && readFileSync(envFile, 'utf8').match(/^RUNPOD_API_KEY=(.*)$/m);
  if (!m) throw new Error(`No RUNPOD_API_KEY in the environment or in ${envFile}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
const api = async (path, method = 'GET', body) => {
  const r = await fetch(`https://rest.runpod.io/v1/${path}`, { method, headers: { Authorization: `Bearer ${apiKey()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`RunPod ${r.status} on ${method} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
async function findPod() {
  const pods = (await api('pods')).filter((p) => p.name?.startsWith(NAME));
  if (!pods.length) throw new Error(`No pod named ${NAME}* on this account`);
  return pods.find((p) => p.desiredStatus === 'RUNNING') ?? pods[0];
}

// A stopped pod is tied to its host machine: if another customer has taken that GPU it can't restart ("not enough free
// GPUs"). Nothing is lost then, since only /workspace matters and that is the volume: make a new pod on the same volume.
const VOLUME_NAME = process.env.POD_VOLUME ?? 'rainy-place-dev-il1';
async function createPod() {
  const volume = (await api('networkvolumes')).find((v) => v.name === VOLUME_NAME);
  if (!volume) throw new Error(`No network volume named ${VOLUME_NAME}`);
  const pub = readFileSync(`${KEY}.pub`, 'utf8').trim();
  const spec = {
    name: `${NAME}-dev`,
    imageName: 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
    cloudType: 'SECURE', computeType: 'GPU', gpuCount: 1,
    // Graphics-capable cards only (the A100 and H100 classes lack graphics), cheapest first: about $0.27 an hour for the
    // A5000, $0.89 for the 4090, $0.99 the RTX 6000 Ada, $1.09 the L40S (US-IL-1 carries only these four; the 3090, L4 and
    // 4000 Ada are never offered there). 'custom' takes them in this order; if RunPod refuses that, any that is in stock.
    gpuTypeIds: (process.env.POD_GPUS ?? 'NVIDIA RTX A5000,NVIDIA GeForce RTX 4090,NVIDIA RTX 6000 Ada Generation,NVIDIA L40S').split(','),
    gpuTypePriority: 'custom',
    dataCenterIds: [volume.dataCenterId], networkVolumeId: volume.id, volumeMountPath: '/workspace',
    containerDiskInGb: 30, ports: ['22/tcp'],
    env: { PUBLIC_KEY: pub, NVIDIA_DRIVER_CAPABILITIES: 'all' },
  };
  const pod = await api('pods', 'POST', spec)
    .catch((e) => (/gpuTypePriority/i.test(e.message) ? api('pods', 'POST', { ...spec, gpuTypePriority: 'availability' }) : Promise.reject(e)))
    .catch((e) => (/no instances currently available/i.test(e.message)
      ? Promise.reject(new NoStock(`RunPod has no free GPU in ${volume.dataCenterId} right now (${spec.gpuTypeIds.map((g) => g.replace('NVIDIA ', '')).join(', ')}). Try again in a few minutes, or run this locally.`))
      : Promise.reject(e)));
  console.log(`Created ${pod.name} (${pod.machine?.gpuTypeId}, ${pod.costPerHr}/hr) in ${volume.dataCenterId}.`);
  return pod;
}
const sshArgs = (p) => ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', String(p.portMappings?.['22']), `root@${p.publicIp}`];
const ready = (p) => sshOk(p) && spawnSync('ssh', [...sshArgs(p), 'test -f /tmp/pod-boot-done'], { stdio: 'ignore' }).status === 0; // the boot step ran
const sshOk = (p) => p.desiredStatus === 'RUNNING' && p.publicIp && p.portMappings?.['22'] && spawnSync('ssh', [...sshArgs(p), 'true'], { stdio: 'ignore' }).status === 0;
const ssh = (p, cmd) => spawnSync('ssh', [...sshArgs(p), ...(cmd ? [cmd] : [])], { stdio: 'inherit' }).status;
// ---- starting it -------------------------------------------------------------------------------------------------
// One start at a time, whoever asks: the user, or an agent whose `run` found the pod stopped. A lock file holds it.
const SYNC_DIR = join(homedir(), '.pod-sync');
const LOCK = join(SYNC_DIR, 'start.lock');
const lockAge = () => (existsSync(LOCK) ? Date.now() - statSync(LOCK).mtimeMs : Infinity);
const START_STATE = join(SYNC_DIR, 'start-state.json');
/** How long a start keeps trying while RunPod has no free GPU (minutes; the lock is kept fresh meanwhile). */
const RETRY_MIN = Number(process.env.POD_RETRY_MIN ?? 30);
const RETRY_EVERY_S = 45;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Starts the stopped pod, or makes a new one on the volume if its machine has no free GPU. True when a new pod was made. */
async function tryAcquire() {
  const p0 = await findPod().catch(() => null);
  if (!p0) { await createPod(); return true; }
  if (p0.desiredStatus === 'RUNNING') return false;
  try { await api(`pods/${p0.id}/start`, 'POST'); return false; }
  catch (e) {
    if (!/not enough free GPUs|no longer any|not available/i.test(e.message)) throw e;
    console.log("The stopped pod can't restart (its machine has no free GPU): making a new one on the same volume.");
    await createPod(); return true;
  }
}
/** tryAcquire, retried every RETRY_EVERY_S seconds for up to RETRY_MIN minutes while RunPod has no free GPU. The dashboard shows the wait (start-state.json). */
async function acquirePod() {
  const t0 = Date.now();
  for (let n = 1; ; n++) {
    try { return await tryAcquire(); }
    catch (e) {
      if (!(e instanceof NoStock) || Date.now() - t0 >= RETRY_MIN * 60_000) throw e;
      if (n === 1) console.log(`${e.message}\nWaiting up to ${RETRY_MIN} minutes for one (POD_RETRY_MIN)...`);
      writeFileSync(START_STATE, JSON.stringify({ since: t0, tries: n, until: t0 + RETRY_MIN * 60_000 }));
      writeFileSync(LOCK, String(process.pid)); // keep the lock fresh: this start is alive
      await logStock().catch(() => {});
      await sleep(RETRY_EVERY_S * 1000);
      if (n % 7 === 0) console.log(`still no free GPU after ${Math.round((Date.now() - t0) / 60_000)} minutes`);
    }
  }
}
/** Starts (or makes) the pod, boots it, returns it. Throws if another start is already under way. */
async function startPod() {
  mkdirSync(SYNC_DIR, { recursive: true });
  if (lockAge() < 15 * 60_000) throw new Error('A start is already under way (started less than 15 minutes ago).');
  writeFileSync(LOCK, String(process.pid));
  try {

    const replaced = await acquirePod();
    let p;
    // A pod that never comes up (stuck on "Starting": no host, no address) has no watchdog, since the watchdog runs
    // inside it, and was left behind for 31 h on Oct 16-17. Give it up: delete one made just now, stop a restarted one.
    try { p = await waitReady(); }
    catch (e) { await giveUp(replaced ? 'delete' : 'stop', 'it did not come up with SSH'); throw e; }
    if (replaced) { // the old stopped pod only holds a wiped container disk and would keep billing for it
      for (const old of (await api('pods')).filter((x) => x.name?.startsWith(NAME) && x.id !== p.id && x.desiredStatus !== 'RUNNING')) {
        await api(`pods/${old.id}`, 'DELETE'); console.log(`Deleted the stopped pod ${old.name} (${old.id}).`);
      }
    }
    writeSshConfig(p);
    console.log(`Up: ${p.machine?.gpuTypeId ?? ''} at ${p.publicIp}:${p.portMappings['22']} (${p.costPerHr}/hr). Setting up...`);
    const src = readFileSync(join(root, 'scripts', 'podSetup.sh'), 'utf8').replace(/\r\n/g, '\n');
    let r; // a fresh pod's sshd sometimes drops the first long session (ssh exits 255): try again
  for (let attempt = 0; attempt < 3; attempt++) {
    r = spawnSync('ssh', [...sshArgs(p), 'bash -s -- --boot'], { input: src, stdio: ['pipe', 'inherit', 'inherit'] });
    if (r.status !== 255) break;
    console.log('SSH dropped during the boot step: retrying...');
    await new Promise((res) => setTimeout(res, 15_000));
  }
    console.log(r.status === 0 ? '\nReady. Run things on it with: node scripts/pod.mjs run -- <command>   (VS Code: Remote-SSH -> rainy-pod)' : `\npodSetup --boot exited ${r.status}`);
    if (r.status !== 0 && !ensureWatchdog(p)) { // a boot step that died before the watchdog started left the pod unguarded
      await giveUp('stop', `the boot step failed (exit ${r.status}) and the idle-stop watchdog isn't running`);
      fail('The pod was stopped: its boot step failed and nothing would have stopped it. Start it again.');
    }
    await pushIdle(p);
  } finally { try { unlinkSync(LOCK); } catch {} try { unlinkSync(START_STATE); } catch {} }
}

// ---- guards from this machine: the watchdog runs inside the pod, so it can't help a pod that never booted -----------
/** Timestamped lines in ~/.pod-sync/guard.log for every pod this machine stopped or deleted (start.log has no times). */
function guardLog(msg) {
  try { mkdirSync(SYNC_DIR, { recursive: true }); appendFileSync(join(SYNC_DIR, 'guard.log'), `${new Date().toISOString()} ${msg}\n`); } catch {}
}
/** Stops (or deletes) the running pod after a failed start, saying why. Never throws. */
async function giveUp(action, reason) {
  try {
    const p = (await api('pods')).find((x) => x.name?.startsWith(NAME) && x.desiredStatus === 'RUNNING');
    if (!p) return;
    if (action === 'delete') await api(`pods/${p.id}`, 'DELETE'); else await api(`pods/${p.id}/stop`, 'POST');
    console.log(`${action === 'delete' ? 'Deleted' : 'Stopped'} ${p.name} (${p.id}): ${reason}.`);
    guardLog(`${action} ${p.id} (${p.costPerHr}/hr): ${reason}`);
  } catch (e) { console.log(`Could not ${action} the pod (${e.message}): stop it in RunPod's console, it bills while up.`); }
}
/** Is the idle-stop watchdog running on the pod? If not, starts it on its own. True when it runs. */
function ensureWatchdog(p) {
  const check = () => spawnSync('ssh', [...sshArgs(p), 'pgrep -f podIdleStop.sh >/dev/null'], { stdio: 'ignore', timeout: 30_000 }).status === 0;
  if (check()) return true;
  const w = `${MAIN}/scripts/podIdleStop.sh`;
  spawnSync('ssh', [...sshArgs(p), `[ -f ${w} ] && sed -i 's/\\r$//' ${w} && setsid nohup bash ${w} </dev/null >/dev/null 2>&1 & sleep 2`], { stdio: 'ignore', timeout: 30_000 });
  const ok = check();
  console.log(ok ? 'Started the idle-stop watchdog on its own.' : 'The idle-stop watchdog is not running and could not be started.');
  return ok;
}
/** How long the pod has been up (ms since its last start), or null. */
function upFor(p) {
  const since = Date.parse(String(p?.lastStartedAt ?? '').replace(' ', 'T').replace(' +0000 UTC', 'Z'));
  return Number.isFinite(since) ? Date.now() - since : null;
}
/** The 12 h cap again, from here (0 = off), with half an hour's grace for the watchdog's own; and how long "Starting" may last. */
const MAX_HOURS = Number(process.env.POD_MAX_HOURS ?? 12);
const STUCK_MIN = Number(process.env.POD_STUCK_MIN ?? 20);
/**
 * Stops a pod the watchdog inside it can't be trusted with: one stuck on "Starting" (no host, no address) for STUCK_MIN
 * minutes, or one up past the cap. Leaves a start that is under way alone (it gives up its own pod). Returns why, or null.
 * Called by `status`, the dashboard's `status --json`, every agent `run`, and `guard` (for a scheduled task).
 */
async function enforceLimits(p) {
  if (p?.desiredStatus !== 'RUNNING' || lockAge() < 15 * 60_000) return null;
  const up = upFor(p);
  if (up === null) return null;
  let why = null;
  if (!(p.publicIp && p.portMappings?.['22']) && STUCK_MIN > 0 && up > STUCK_MIN * 60_000) why = `stuck starting for ${span(up)} (no host or address)`;
  else if (MAX_HOURS > 0 && up > (MAX_HOURS + 0.5) * 3600_000) why = `up ${span(up)}, past the ${MAX_HOURS} h cap, so its watchdog isn't working`;
  if (!why) return null;
  await api(`pods/${p.id}/stop`, 'POST');
  guardLog(`stop ${p.id} (${p.costPerHr}/hr, about ${money((up / 3600000) * p.costPerHr)} this run): ${why}`);
  console.error(`Stopped ${p.name} (${p.id}): ${why}.`);
  return why;
}
// Each `run` writes a small file here while it works, so `status --json` (and the dashboard) can say what is on the pod.
const RUNS = join(SYNC_DIR, 'runs');
function listRuns() {
  if (!existsSync(RUNS)) return [];
  const out = [];
  for (const f of readdirSync(RUNS)) {
    let r; try { r = JSON.parse(readFileSync(join(RUNS, f), 'utf8')); } catch { continue; }
    let alive = true; try { process.kill(r.pid, 0); } catch { alive = false; }
    if (alive) out.push(r); else { try { unlinkSync(join(RUNS, f)); } catch {} }
  }
  return out;
}
/** Does an agent's `run` start a stopped pod by itself? Yes unless POD_AUTOSTART=0 or the file ~/.pod-sync/autostart-off exists. */
const autostart = () => process.env.POD_AUTOSTART !== '0' && !existsSync(join(SYNC_DIR, 'autostart-off'));
/** The pod, once it is up, booted and answering. Stopped: it is started (autostart) and the caller waits if it asked to (`wait`), else gets exit code 3 and runs locally meanwhile. */
async function upPod({ wait = false } = {}) {
  let p = await findPod();
  if (await enforceLimits(p).catch(() => null)) p = await findPod();
  if (ready(p)) return p;
  const starting = lockAge() < 15 * 60_000 || p.desiredStatus === 'RUNNING';
  if (!starting && !autostart()) fail('The pod is stopped and autostart is off (it bills while up): the user starts it with node scripts/pod.mjs start. Run this locally instead.', 3);
  if (wait) { // block until it is up: start it here, or wait for the start someone else began
    if (!starting) { console.log('The pod is stopped: starting it (about 2-4 minutes)...'); return await startPod(); }
    // someone else's start may be waiting for a GPU (acquirePod), so wait as long as it is allowed to, while its lock stays fresh
    for (let i = 0; i < (RETRY_MIN + 15) * 6; i++) {
      await sleep(10_000); p = await findPod().catch(() => p);
      if (ready(p)) return p;
      if (lockAge() >= 15 * 60_000 && p.desiredStatus !== 'RUNNING') fail('The start that was under way gave up (no free GPU?): see ~/.pod-sync/start.log. Run this locally.', 3);
    }
    fail(`The pod did not become ready in ${RETRY_MIN + 15} minutes.`, 3);
  }
  if (!starting) { // start it in the background and let this run go local; the next one finds it up
    const out = join(SYNC_DIR, 'start.log');
    mkdirSync(SYNC_DIR, { recursive: true });
    spawn(process.execPath, [fileURLToPath(import.meta.url), 'start'], { detached: true, stdio: ['ignore', openSync(out, 'a'), openSync(out, 'a')], windowsHide: true }).unref();
  }
  fail(`The pod is ${starting ? 'starting' : 'stopped: starting it now'} (about 2-4 minutes, log: ~/.pod-sync/start.log). Run this locally meanwhile, or retry with run --wait.`, 3);
}

/** Where this checkout lives on the pod: the main one, or a folder of its own for a worktree. */
function remoteDir() {
  const m = root.replace(/\\/g, '/').match(/\.claude\/worktrees\/([^/]+)/);
  return m ? `/workspace/wt/${m[1]}` : MAIN;
}

function writeSshConfig(p) {
  const file = join(homedir(), '.ssh', 'config');
  const block = `# rainy-pod: written by scripts/pod.mjs start\nHost rainy-pod\n  HostName ${p.publicIp}\n  Port ${p.portMappings['22']}\n  User root\n  IdentityFile ${KEY.replace(/\\/g, '/')}\n  StrictHostKeyChecking accept-new\n`;
  mkdirSync(dirname(file), { recursive: true });
  const old = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const stripped = old.replace(/# rainy-pod: written by[^\n]*\nHost rainy-pod\n(?:[ \t]+[^\n]*\n)*/g, '');
  writeFileSync(file, stripped + (stripped && !stripped.endsWith('\n\n') ? '\n' : '') + block);
}

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    const p = await findPod();
    if (sshOk(p)) return p;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error('The pod did not come up with SSH in about 7 minutes');
}

const pipeTo = (from, to) => new Promise((res, rej) => {
  from.stdout.pipe(to.stdin);
  to.on('exit', (c) => (c === 0 ? res() : rej(new Error(`${to.spawnargs[0]} exited ${c}`))));
});

/** Copies what changed in this checkout since the last sync (all of it with `full`) and removes what was deleted. */
async function syncTree(p, { full = false } = {}) {
  const dir = remoteDir();
  const names = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 1 << 28 }).toString('utf8').split('\0').filter(Boolean);
  const cacheDir = join(homedir(), '.pod-sync');
  const cacheFile = join(cacheDir, createHash('sha1').update(`${root}>${dir}`).digest('hex').slice(0, 12) + '.json');
  let old = {};
  if (!full && existsSync(cacheFile)) { try { old = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { old = {}; } }
  const now = {}, send = [];
  for (const n of names) {
    let s; try { s = statSync(join(root, n)); } catch { continue; }
    const sig = `${s.size}:${Math.floor(s.mtimeMs)}`;
    now[n] = sig;
    if (old[n] !== sig) send.push(n);
  }
  const gone = Object.keys(old).filter((n) => !(n in now));

  // The folder, and for a worktree its node_modules (the main checkout's: its dependencies are the same unless package.json differs).
  const prep = `mkdir -p ${q(dir)}` + (dir === MAIN ? '' : ` && { [ -e ${q(dir)}/node_modules ] || ln -s ${MAIN}/node_modules ${q(dir)}/node_modules; }`);
  if (ssh(p, prep) !== 0) throw new Error('could not prepare the folder on the pod');

  if (send.length) {
    const listFile = join(tmpdir(), `podsync-${process.pid}.txt`);
    writeFileSync(listFile, send.join('\0') + '\0');
    const tar = spawn('tar', ['--null', '-T', listFile, '-cf', '-'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
    const remote = spawn('ssh', [...sshArgs(p), `tar -xf - --no-same-owner -C ${q(dir)} && cd ${q(dir)} && sed -i 's/\\r$//' scripts/*.sh`], { stdio: ['pipe', 'inherit', 'inherit'] });
    await pipeTo(tar, remote);
  }
  if (gone.length) {
    spawnSync('ssh', [...sshArgs(p), `cd ${q(dir)} && xargs -0 rm -f --`], { input: gone.join('\0') + '\0', stdio: ['pipe', 'inherit', 'inherit'] });
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile + '.tmp', JSON.stringify(now));
  renameSync(cacheFile + '.tmp', cacheFile);
  console.log(`sync -> ${dir}: ${send.length} sent, ${gone.length} removed, ${names.length - send.length} unchanged`);
}

/** Runs a command on the pod from this checkout's folder there, then pulls back the files it wrote. */
async function runOnPod(argv) {
  const flags = { sync: true, pull: true, full: false, wait: false, out: [] };
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const a = argv[i];
    if (a === '--no-sync') flags.sync = false;
    else if (a === '--no-pull') flags.pull = false;
    else if (a === '--full') flags.full = true;
    else if (a === '--wait') flags.wait = true;
    else if (a === '--out') flags.out.push(argv[++i]);
    else fail(`unknown flag ${a}`);
  }
  const command = argv.slice(i + 1);
  if (!command.length) fail('usage: node scripts/pod.mjs run [--wait] [--no-sync] [--no-pull] [--full] [--out <dir>] -- <command...>');
  for (const o of flags.out) if (!o || o.startsWith('/') || o.includes('..') || /^[a-z]:/i.test(o)) fail(`--out takes a folder inside the repo, got ${o}`);

  const p = await upPod({ wait: flags.wait });
  if (flags.sync) await syncTree(p, { full: flags.full });
  const dir = remoteDir();
  const marker = `/workspace/.podrun-${process.pid}-${Date.now()}`;
  const env = 'export PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright BLENDER=/workspace/blender/blender';
  const script = `cd ${q(dir)} && ${env} && touch -d '2 seconds ago' ${marker}; ${command.map(q).join(' ')}`;
  mkdirSync(RUNS, { recursive: true });
  const runFile = join(RUNS, `${process.pid}.json`);
  // The session id is how the dashboard says which agent this is: Claude Code gives its Bash tool CLAUDE_CODE_SESSION_ID.
  writeFileSync(runFile, JSON.stringify({ pid: process.pid, checkout: root, command: command.join(' ').slice(0, 300), title: runTitle(command), session: process.env.CLAUDE_CODE_SESSION_ID, started: Date.now() }));
  let status;
  try { status = spawnSync('ssh', [...sshArgs(p), `bash -c ${q(script)}`], { stdio: 'inherit' }).status ?? 1; }
  finally { try { unlinkSync(runFile); } catch {} }

  if (flags.pull) {
    const roots = [...PULL_ROOTS, ...flags.out];
    const skip = SOURCE_NAMES.map((n) => `! -name ${q(n)}`).join(' ');
    const list = `${marker}.list`;
    const find = `cd ${q(dir)} && find ${roots.map(q).join(' ')} -type f -newer ${marker} ${skip} -print0 2>/dev/null > ${list}; [ -s ${list} ] && tar --null -T ${list} -cf -; rm -f ${marker} ${list}`;
    const remote = spawn('ssh', [...sshArgs(p), `bash -c ${q(find)}`], { stdio: ['ignore', 'pipe', 'inherit'] });
    const local = spawn('tar', ['-xvf', '-', '-C', root], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = ''; // the file list: bsdtar writes it to stderr, GNU tar to stdout
    for (const out of [local.stdout, local.stderr]) out.on('data', (d) => { log += d; });
    remote.stdout.pipe(local.stdin);
    await new Promise((res) => local.on('exit', res));
    const files = log.split(/\r?\n/).map((l) => l.replace(/^x /, '').trim()).filter((l) => l && !/^tar:/.test(l));
    console.log(files.length ? `pulled ${files.length} file(s), e.g. ${files.slice(0, 3).join(', ')}` : 'nothing new to pull back');
  }
  return status;
}

/** What a run is doing, in a few words: the script it runs, without `env`, VAR=value words and the interpreter. */
function runTitle(argv) {
  const words = argv.filter((w, i) => !(i === 0 && w === 'env') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
  if (['node', 'python', 'python3', 'bash', 'sh', 'npx', 'tsx'].includes(words[0])) {
    const target = words.slice(1).find((w) => !w.startsWith('-'));
    if (target) return target;
  }
  return words.slice(0, 3).join(' ') || argv.join(' ');
}
// ---- how long it may sit idle before it stops itself (the Resources tab's buttons set it) --------------------------------
const IDLE_FILE = join(SYNC_DIR, 'idle-min');
const IDLE_DEFAULT = 45;
/** Minutes of idleness before the pod stops itself; 0 = never (the 12-hour cap still applies). */
function idleMin() {
  const n = existsSync(IDLE_FILE) ? Number(readFileSync(IDLE_FILE, 'utf8').trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : IDLE_DEFAULT;
}
const idleText = (n) => (n === 0 ? 'never (only the 12 h cap)' : n >= 60 && n % 60 === 0 ? `${n / 60} h` : `${n} min`);
/** Hands the setting to the pod's watchdog, which re-reads /workspace/.idle-min every minute. */
async function pushIdle(p) {
  const file = '/workspace/.idle-min';
  const cmd = existsSync(IDLE_FILE) ? `echo ${idleMin()} > ${file}` : `rm -f ${file}`;
  if (p && sshOk(p)) spawnSync('ssh', [...sshArgs(p), cmd], { stdio: 'ignore', timeout: 20000 });
}
/** `idle [minutes | 2h | never | default]`: show or set it. Takes effect on a running pod at once, else at its next start. */
async function idleCommand(args) {
  mkdirSync(SYNC_DIR, { recursive: true });
  const a = (args[0] ?? '').toLowerCase();
  if (a) {
    if (a === 'default') { try { unlinkSync(IDLE_FILE); } catch {} }
    else {
      const m = a === 'never' ? 0 : /^\d+(\.\d+)?(h|m|min)?$/.test(a) ? parseFloat(a) * (a.endsWith('h') ? 60 : 1) : NaN;
      if (!Number.isFinite(m)) fail('usage: node scripts/pod.mjs idle [minutes | 2h | never | default]');
      writeFileSync(IDLE_FILE, String(Math.round(m)));
    }
    const p = await findPod().catch(() => null);
    if (p?.desiredStatus === 'RUNNING') await pushIdle(p);
  }
  console.log(`idle stop: ${idleText(idleMin())}${existsSync(IDLE_FILE) ? '' : ' (the default)'}`);
}

// ---- GPU stock: what RunPod has free, per datacenter, logged so the history says where the pod should live -----------
const STOCK_LOG = join(SYNC_DIR, 'stock.jsonl');
const STOCK_EVERY_MIN = 10;
const GRAPHICS = /RTX|L40|L4$|A40/; // cards with graphics (the A100 and H100 classes lack it)
const gpuName = (id) => id.replace(/^NVIDIA /, '').replace(/^GeForce /, '');
async function stockNow() {
  const r = await fetch('https://api.runpod.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey()}` }, body: JSON.stringify({ query: '{ dataCenters { id storageSupport gpuAvailability { gpuTypeId stockStatus } } }' }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (!j.data) throw new Error(`RunPod stock query failed: ${JSON.stringify(j.errors ?? j).slice(0, 200)}`);
  const dcs = {};
  for (const d of j.data.dataCenters) {
    const g = {};
    for (const x of d.gpuAvailability) if (x.stockStatus && x.stockStatus !== 'None' && GRAPHICS.test(x.gpuTypeId) && !/MIG/.test(x.gpuTypeId)) g[gpuName(x.gpuTypeId)] = x.stockStatus;
    if (Object.keys(g).length || d.id === 'US-IL-1') dcs[d.id] = { s: d.storageSupport ? 1 : 0, g };
  }
  return { t: new Date().toISOString(), dcs };
}
/** One sample onto the log, unless the last is under STOCK_EVERY_MIN old (so every caller may call it). */
async function logStock({ force = false } = {}) {
  mkdirSync(SYNC_DIR, { recursive: true });
  if (!force && existsSync(STOCK_LOG) && Date.now() - statSync(STOCK_LOG).mtimeMs < STOCK_EVERY_MIN * 60_000) return null;
  const sample = await stockNow();
  appendFileSync(STOCK_LOG, JSON.stringify(sample) + '\n');
  return sample;
}
/** `stock`: now, and the history: for each datacenter that can hold a volume, how often it had a graphics card free. `stock watch` keeps logging. */
async function stockCommand(args) {
  if (args[0] === 'watch') {
    console.log(`logging RunPod stock every ${STOCK_EVERY_MIN} minutes to ${STOCK_LOG} (Ctrl+C stops)`);
    for (;;) { try { await logStock({ force: true }); } catch (e) { console.error(e.message); } await sleep(STOCK_EVERY_MIN * 60_000); }
  }
  const now = await logStock({ force: true });
  const show = (d) => Object.entries(d.g).map(([k, v]) => `${k} (${v})`).join(', ') || 'nothing';
  console.log('Free graphics-capable GPUs now (volume-capable datacenters first):');
  for (const [id, d] of Object.entries(now.dcs).sort((a, b) => b[1].s - a[1].s || a[0].localeCompare(b[0]))) console.log(`  ${id}${d.s ? '' : ' (no volumes)'}: ${show(d)}`);
  const rows = readFileSync(STOCK_LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (rows.length < 2) { console.log('\nHistory: too few samples yet. They are logged while the dashboard is open, on every failed start, and by "stock watch".'); return; }
  const hours = (Date.parse(rows.at(-1).t) - Date.parse(rows[0].t)) / 3600000;
  console.log(`\nHistory: ${rows.length} samples over ${hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`} (share of samples with a card free; volume-capable datacenters only):`);
  const ids = new Set(); for (const r of rows) for (const [id, d] of Object.entries(r.dcs)) if (d.s) ids.add(id);
  const wanted = new Set(['RTX A5000', 'RTX 4090', 'RTX 6000 Ada Generation', 'L40S']);
  const out = [...ids].map((id) => {
    const any = rows.filter((r) => Object.keys(r.dcs[id]?.g ?? {}).length).length;
    const cur = rows.filter((r) => Object.keys(r.dcs[id]?.g ?? {}).some((g) => wanted.has(g))).length;
    return { id, any: any / rows.length, cur: cur / rows.length };
  }).sort((a, b) => b.any - a.any);
  for (const o of out.slice(0, 12)) console.log(`  ${o.id.padEnd(9)} any ${String(Math.round(o.any * 100)).padStart(3)}%   the pod's four cards ${String(Math.round(o.cur * 100)).padStart(3)}%`);
}

const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);
const span = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
/**
 * What `status --json` prints, the shape agent-notify's Resources tab reads: { state, title, fields: [{label, value}],
 * actions: [ids that make sense now], note? }. Only the RunPod API is asked (about a second), plus one short SSH
 * check that the boot step finished when the pod is up.
 */
async function dashboardStatus() {
  const title = 'GPU pod';
  const auto = autostart();
  const autoAction = auto ? 'autostart-off' : 'autostart-on';
  const runs = listRuns();
  const lock = lockAge() < 15 * 60_000;
  await logStock().catch(() => {}); // a sample for the history, at most one in ten minutes
  const idle = idleMin();
  let p = null;
  try { p = await findPod(); } catch (e) { if (!/No pod named/.test(e.message)) return { state: 'error', title, fields: [], actions: ['start'], note: e.message.slice(0, 200) }; }
  const fields = [];
  if (p?.machine?.gpuTypeId) fields.push({ label: 'GPU', value: p.machine.gpuTypeId.replace('NVIDIA ', '') });
  fields.push({ label: 'Idle stop', value: idleText(idle) });
  fields.push({ label: 'Agents start it', value: auto ? 'yes: a heavy run starts a stopped pod' : 'no: only you start it' });
  const idleActions = ['idle-45', 'idle-120', 'idle-360'];
  const waiting = lock && existsSync(START_STATE) ? (() => { try { return JSON.parse(readFileSync(START_STATE, 'utf8')); } catch { return null; } })() : null;
  const waitNote = waiting ? `Waiting for a free GPU in US-IL-1 (${Math.round((Date.now() - waiting.since) / 60000)} min so far, gives up after ${RETRY_MIN}).` : null;
  if (!p) return { state: lock ? 'starting' : 'stopped', title, fields, actions: lock ? idleActions : ['start', autoAction, ...idleActions], note: waitNote ?? 'No pod yet: Start makes one on the volume.' };
  const guarded = await enforceLimits(p).catch(() => null);
  if (guarded) return { state: 'stopped', title, fields, actions: ['start', autoAction, ...idleActions], note: `Stopped it from here: ${guarded}. See ~/.pod-sync/guard.log.` };
  if (p.desiredStatus === 'RUNNING') {
    const up = upFor(p);
    fields.unshift({ label: 'Cost', value: `${money(p.costPerHr)}/hr${up !== null ? `, about ${money((up / 3600000) * p.costPerHr)} this run` : ''}` });
    if (up !== null) fields.push({ label: 'Up for', value: span(up) });
    // Who is using it: one row per `run` in flight, tied to the agent session that started it (the Resources tab draws these).
    const activity = runs.map((r) => ({ session: r.session, title: r.title ?? r.command, detail: r.command, since: r.started, where: basename(r.checkout) }));
    const ready = spawnSync('ssh', [...sshArgs(p), 'test -f /tmp/pod-boot-done'], { stdio: 'ignore', timeout: 12000 }).status === 0;
    return { state: ready ? 'running' : 'starting', title, fields, activity, actions: ready ? ['stop', autoAction, ...idleActions] : [], note: ready ? (idle === 0 ? 'Stops itself only at the 12 h cap.' : `Stops itself after ${idleText(idle)} idle.`) : 'Booting: installing its libraries (about a minute).' };
  }
  fields.unshift({ label: 'Cost', value: lock ? 'starting' : 'nothing while stopped (only the 100 GB volume)' });
  return { state: lock ? 'starting' : 'stopped', title, fields, actions: lock ? idleActions : ['start', autoAction, ...idleActions], note: lock ? (waitNote ?? 'Starting (2-4 minutes, up to 11 if its host must be replaced).') : undefined };
}

/**
 * `play`: the game in a GPU browser on the pod, streamed to a tab on this machine (scripts/podPlay.sh sets up the
 * desktop). Starts the pod if it's stopped, syncs this checkout so the pod serves what you have here, then holds an
 * SSH tunnel open (Ctrl+C closes it; the desktop keeps running on the pod until `play stop` or the idle stop).
 */
async function playCommand(args) {
  const p = await upPod({ wait: true });
  const kasm = args.includes('--kasm');
  const repo = '/workspace/a-rainy-place-to-die';
  if (args[0] === 'stop') {
    spawnSync('ssh', [...sshArgs(p), `bash ${repo}/scripts/podStream.sh stop; bash ${repo}/scripts/podPlay.sh stop`], { stdio: 'inherit' });
    return 0;
  }
  if (!args.includes('--no-sync')) await syncTree(p);
  // The default is the H.264 stream (scripts/podStream.sh: the GPU's video encoder); --kasm is the older KasmVNC one (podPlay.sh).
  const script = kasm ? 'podPlay.sh' : 'podStream.sh';
  const port = kasm ? (process.env.PLAY_PORT ?? '8444') : (process.env.STREAM_PORT ?? '8450');
  const geometry = process.env.PLAY_GEOMETRY ?? (kasm ? '' : '2160x904');
  console.log(`Starting the ${kasm ? 'KasmVNC' : 'H.264'} desktop on the pod${geometry ? ` at ${geometry}` : ''}...`);
  // Detached, with its output in a file: the desktop's background processes would otherwise hold this SSH session open for good.
  const start = `cd ${repo} && sed -i 's/\\r$//' scripts/*.sh scripts/stream/input.py; ${geometry ? `PLAY_GEOMETRY=${geometry} ` : ''}setsid nohup bash scripts/${script} > /tmp/podstream.log 2>&1 < /dev/null &`;
  if (spawnSync('ssh', [...sshArgs(p), start], { stdio: 'inherit' }).status !== 0) return 1;
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    ready = spawnSync('ssh', [...sshArgs(p), "grep -q '^Ready:' /tmp/podstream.log"], { stdio: 'ignore' }).status === 0;
  }
  if (!ready) { spawnSync('ssh', [...sshArgs(p), 'tail -15 /tmp/podstream.log'], { stdio: 'inherit' }); console.error('The desktop did not report ready.'); return 1; }
  const url = `http://localhost:${port}/`;
  console.log(`\nThe game is at ${url}  (a tunnel to the pod, so only this machine can reach it). The game takes about a minute to load.`);
  console.log(kasm ? 'In the page: toolbar -> "Game Cursor Mode" for mouse-look, Fullscreen for the whole screen.' : 'In the page: click to capture the mouse (Esc gives it back), F for fullscreen.');
  console.log('Ctrl+C here closes the tunnel; "node scripts/pod.mjs play stop" stops the desktop (it also stops itself after 10 minutes with no viewer or 30 with no input).\n');
  if (!args.includes('--no-open')) spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref();
  const tunnel = spawnSync('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-i', KEY, '-p', String(p.portMappings['22']), '-L', `${port}:127.0.0.1:${port}`, `root@${p.publicIp}`], { stdio: 'inherit' });
  return tunnel.status ?? 0;
}

const [cmd, ...rest] = process.argv.slice(2);
// Exit by setting exitCode, never process.exit: on Windows that asserts in libuv while fetch is still closing.
async function main() {
if (cmd === 'status' && rest.includes('--json')) {
  console.log(JSON.stringify(await dashboardStatus()));
} else if (cmd === 'autostart') {
  mkdirSync(SYNC_DIR, { recursive: true });
  const off = join(SYNC_DIR, 'autostart-off');
  if (rest[0] === 'on') { try { unlinkSync(off); } catch {} } else if (rest[0] === 'off') writeFileSync(off, 'agents do not start the pod while this file exists');
  console.log(`autostart for agents: ${autostart() ? 'on' : 'off'}`);
} else if (cmd === 'idle') {
  await idleCommand(rest);
} else if (cmd === 'stock') {
  await stockCommand(rest);
} else if (cmd === 'guard') { // for a scheduled task: stops a pod stuck starting or past the cap, else says nothing is wrong
  const p = await findPod().catch(() => null);
  const why = p && (await enforceLimits(p));
  if (!why) console.log(p?.desiredStatus === 'RUNNING' ? `${p.name} is up (${span(upFor(p) ?? 0)}), within its limits.` : 'No pod is up.');
} else if (cmd === 'status') {
  let p = await findPod();
  if (await enforceLimits(p).catch(() => null)) p = await findPod();
  console.log(JSON.stringify({ id: p.id, name: p.name, status: p.desiredStatus, gpu: p.machine?.gpuTypeId, cost: p.costPerHr, ip: p.publicIp, ssh: p.portMappings?.['22'], folder: remoteDir() }));
} else if (cmd === 'running') {
  const p = await findPod().catch(() => null);
  return p && ready(p) ? 0 : 1;
} else if (cmd === 'start') {
  await startPod();
} else if (cmd === 'play') {
  return await playCommand(rest);
} else if (cmd === 'stop') {
  const p = await findPod();
  await api(`pods/${p.id}/stop`, 'POST');
  console.log(`Stopping ${p.name} (${p.id}).`);
} else if (cmd === 'sync') {
  await syncTree(await upPod(), { full: rest.includes('--full') });
} else if (cmd === 'run') {
  return await runOnPod(rest);
} else if (cmd === 'ssh') {
  return ssh(await upPod(), rest.join(' ')) ?? 1;
} else if (cmd === 'pull') {
  const p = await upPod();
  const dest = resolve(rest[1] ?? '.');
  mkdirSync(dest, { recursive: true });
  const r = spawnSync('scp', ['-r', '-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-P', String(p.portMappings['22']), `root@${p.publicIp}:${rest[0]}`, dest], { stdio: 'inherit' });
  return r.status ?? 1;
} else {
  console.log('usage: node scripts/pod.mjs status | running | start | run [flags] -- <command...> | sync | ssh [cmd] | pull <remote> [dir] | stop | guard | idle [minutes|2h|never|default] | stock [watch] | autostart [on|off] | play');
  return cmd ? 1 : 0;
}
return 0;
}
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof Exit ? e.message : e); process.exitCode = e instanceof Exit ? e.code : 1; });
