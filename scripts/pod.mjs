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
//   node scripts/pod.mjs ssh [cmd]          a shell on the pod, or one command
//   node scripts/pod.mjs pull <remote-path> [local-dir]
//   node scripts/pod.mjs stop
// The sync copies tracked and untracked files that git doesn't ignore, uncommitted work included; nothing is committed or
// pushed. Only files that changed since the last sync of this checkout are sent, and files deleted here are deleted there.
// A checkout under .claude/worktrees/<name> gets its own folder on the pod (/workspace/wt/<name>, sharing the main
// checkout's node_modules there), so agents on different worktrees don't overwrite each other.
// The pod stops itself when idle (scripts/podIdleStop.sh); `stop` is for when you know you're done.
// The RunPod key comes from RUNPOD_API_KEY or the Trame studio's .env (where scripts/props/mesh_endpoint.mjs reads it).
// POD_NAME (default `rainy-place`, the pod's name starts with it), POD_KEY (default ~/.ssh/runpod_ed25519).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
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
    // A5000, $0.89 for the 4090. 'custom' takes them in this order; if RunPod refuses that, any that is in stock.
    gpuTypeIds: (process.env.POD_GPUS ?? 'NVIDIA RTX A5000,NVIDIA GeForce RTX 3090,NVIDIA L4,NVIDIA RTX 4000 Ada Generation,NVIDIA GeForce RTX 4090').split(','),
    gpuTypePriority: 'custom',
    dataCenterIds: [volume.dataCenterId], networkVolumeId: volume.id, volumeMountPath: '/workspace',
    containerDiskInGb: 30, ports: ['22/tcp'],
    env: { PUBLIC_KEY: pub, NVIDIA_DRIVER_CAPABILITIES: 'all' },
  };
  const pod = await api('pods', 'POST', spec).catch((e) => (/gpuTypePriority/i.test(e.message) ? api('pods', 'POST', { ...spec, gpuTypePriority: 'availability' }) : Promise.reject(e)));
  console.log(`Created ${pod.name} (${pod.machine?.gpuTypeId}, ${pod.costPerHr}/hr) in ${volume.dataCenterId}.`);
  return pod;
}
const sshArgs = (p) => ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', String(p.portMappings?.['22']), `root@${p.publicIp}`];
const sshOk = (p) => p.desiredStatus === 'RUNNING' && p.publicIp && p.portMappings?.['22'] && spawnSync('ssh', [...sshArgs(p), 'true'], { stdio: 'ignore' }).status === 0;
const ssh = (p, cmd) => spawnSync('ssh', [...sshArgs(p), ...(cmd ? [cmd] : [])], { stdio: 'inherit' }).status;
/** The pod, only if it is up and answering; otherwise says so and exits (the user starts it, never an agent). */
async function upPod() {
  const p = await findPod();
  if (!sshOk(p)) fail(`The pod is ${p.desiredStatus === 'RUNNING' ? 'starting, not answering SSH yet' : p.desiredStatus}. It bills while up, so the user starts it (node scripts/pod.mjs start); run this locally instead.`, 3);
  return p;
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
  const flags = { sync: true, pull: true, full: false, out: [] };
  let i = 0;
  for (; i < argv.length && argv[i] !== '--'; i++) {
    const a = argv[i];
    if (a === '--no-sync') flags.sync = false;
    else if (a === '--no-pull') flags.pull = false;
    else if (a === '--full') flags.full = true;
    else if (a === '--out') flags.out.push(argv[++i]);
    else fail(`unknown flag ${a}`);
  }
  const command = argv.slice(i + 1);
  if (!command.length) fail('usage: node scripts/pod.mjs run [--no-sync] [--no-pull] [--full] [--out <dir>] -- <command...>');
  for (const o of flags.out) if (!o || o.startsWith('/') || o.includes('..') || /^[a-z]:/i.test(o)) fail(`--out takes a folder inside the repo, got ${o}`);

  const p = await upPod();
  if (flags.sync) await syncTree(p, { full: flags.full });
  const dir = remoteDir();
  const marker = `/workspace/.podrun-${process.pid}-${Date.now()}`;
  const env = 'export PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright BLENDER=/workspace/blender/blender';
  const script = `cd ${q(dir)} && ${env} && touch -d '2 seconds ago' ${marker}; ${command.map(q).join(' ')}`;
  const status = spawnSync('ssh', [...sshArgs(p), `bash -c ${q(script)}`], { stdio: 'inherit' }).status ?? 1;

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

const [cmd, ...rest] = process.argv.slice(2);
// Exit by setting exitCode, never process.exit: on Windows that asserts in libuv while fetch is still closing.
async function main() {
if (cmd === 'status') {
  const p = await findPod();
  console.log(JSON.stringify({ id: p.id, name: p.name, status: p.desiredStatus, gpu: p.machine?.gpuTypeId, cost: p.costPerHr, ip: p.publicIp, ssh: p.portMappings?.['22'], folder: remoteDir() }));
} else if (cmd === 'running') {
  const p = await findPod().catch(() => null);
  return p && sshOk(p) ? 0 : 1;
} else if (cmd === 'start') {
  const p0 = await findPod().catch(() => null);
  let replaced = false;
  if (!p0) { await createPod(); replaced = true; }
  else if (p0.desiredStatus !== 'RUNNING') {
    try { await api(`pods/${p0.id}/start`, 'POST'); }
    catch (e) {
      if (!/not enough free GPUs|no longer any|not available/i.test(e.message)) throw e;
      console.log("The stopped pod can't restart (its machine has no free GPU): making a new one on the same volume.");
      await createPod(); replaced = true;
    }
  }
  const p = await waitReady();
  if (replaced) { // the old stopped pod only holds a wiped container disk and would keep billing for it
    for (const old of (await api('pods')).filter((x) => x.name?.startsWith(NAME) && x.id !== p.id && x.desiredStatus !== 'RUNNING')) {
      await api(`pods/${old.id}`, 'DELETE'); console.log(`Deleted the stopped pod ${old.name} (${old.id}).`);
    }
  }
  writeSshConfig(p);
  console.log(`Up: ${p.machine?.gpuTypeId ?? ''} at ${p.publicIp}:${p.portMappings['22']} ($${p.costPerHr}/hr). Setting up...`);
  const src = readFileSync(join(root, 'scripts', 'podSetup.sh'), 'utf8').replace(/\r\n/g, '\n');
  const r = spawnSync('ssh', [...sshArgs(p), 'bash -s -- --boot'], { input: src, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(r.status === 0 ? '\nReady. Run things on it with: node scripts/pod.mjs run -- <command>   (VS Code: Remote-SSH -> rainy-pod)' : `\npodSetup --boot exited ${r.status}`);
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
  console.log('usage: node scripts/pod.mjs status | running | start | run [flags] -- <command...> | sync | ssh [cmd] | pull <remote> [dir] | stop');
  return cmd ? 1 : 0;
}
return 0;
}
main().then((code) => { process.exitCode = code; }, (e) => { console.error(e instanceof Exit ? e.message : e); process.exitCode = e instanceof Exit ? e.code : 1; });
