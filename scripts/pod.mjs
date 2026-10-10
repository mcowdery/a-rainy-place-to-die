// Drives the RunPod dev pod from this machine: start it, stop it, copy the working tree to it, open a shell on it.
//   node scripts/pod.mjs status
//   node scripts/pod.mjs start        starts the pod, waits for SSH, runs podSetup.sh --boot, writes `Host rainy-pod`
//                                     into ~/.ssh/config (VS Code: Remote-SSH -> rainy-pod, open /workspace/a-rainy-place-to-die)
//   node scripts/pod.mjs sync         copies this checkout (tracked and untracked files, not ignored ones) to the pod,
//                                     uncommitted work included; nothing is committed or pushed
//   node scripts/pod.mjs ssh [cmd]    a shell on the pod, or one command
//   node scripts/pod.mjs pull <remote-path> [local-dir]   copy a file or folder back (shots, outputs)
//   node scripts/pod.mjs stop
// The pod stops itself when idle (scripts/podIdleStop.sh); `stop` is for when you know you're done.
// The RunPod key comes from RUNPOD_API_KEY or the Trame studio's .env (the same place scripts/props/mesh_endpoint.mjs reads).
// POD_NAME (default `rainy-place`, the pod's name starts with it), POD_KEY (default ~/.ssh/runpod_ed25519).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = process.env.POD_NAME ?? 'rainy-place';
const KEY = process.env.POD_KEY ?? join(homedir(), '.ssh', 'runpod_ed25519');
const REMOTE = '/workspace/a-rainy-place-to-die';

function apiKey() {
  if (process.env.RUNPOD_API_KEY) return process.env.RUNPOD_API_KEY;
  const envFile = process.env.KREA_STUDIO_ENV ?? resolve(root, '../Trame/trame-studio/.env');
  const m = existsSync(envFile) && readFileSync(envFile, 'utf8').match(/^RUNPOD_API_KEY=(.*)$/m);
  if (!m) throw new Error(`No RUNPOD_API_KEY in the environment or in ${envFile}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}
const api = async (path, method = 'GET') => {
  const r = await fetch(`https://rest.runpod.io/v1/${path}`, { method, headers: { Authorization: `Bearer ${apiKey()}` } });
  const text = await r.text();
  if (!r.ok) throw new Error(`RunPod ${r.status} on ${method} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};
async function findPod() {
  const pods = (await api('pods')).filter((p) => p.name?.startsWith(NAME));
  if (!pods.length) throw new Error(`No pod named ${NAME}* on this account`);
  return pods[0];
}
const sshArgs = (p) => ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15', '-p', String(p.portMappings?.['22']), `root@${p.publicIp}`];
const ssh = (p, cmd) => spawnSync('ssh', [...sshArgs(p), ...(cmd ? [cmd] : [])], { stdio: 'inherit' }).status;

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
    if (p.desiredStatus === 'RUNNING' && p.publicIp && p.portMappings?.['22']) {
      const ok = spawnSync('ssh', [...sshArgs(p), 'true'], { stdio: 'ignore' }).status === 0;
      if (ok) return p;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error('The pod did not come up with SSH in about 7 minutes');
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'status') {
  const p = await findPod();
  console.log(JSON.stringify({ id: p.id, name: p.name, status: p.desiredStatus, gpu: p.machine?.gpuTypeId, cost: p.costPerHr, ip: p.publicIp, ssh: p.portMappings?.['22'] }));
} else if (cmd === 'start') {
  const p0 = await findPod();
  if (p0.desiredStatus !== 'RUNNING') await api(`pods/${p0.id}/start`, 'POST');
  const p = await waitReady();
  writeSshConfig(p);
  console.log(`Up: ${p.machine?.gpuTypeId ?? ''} at ${p.publicIp}:${p.portMappings['22']} ($${p.costPerHr}/hr). Setting up...`);
  const script = join(root, 'scripts', 'podSetup.sh');
  const src = readFileSync(script, 'utf8').replace(/\r\n/g, '\n');
  const r = spawnSync('ssh', [...sshArgs(p), 'bash -s -- --boot'], { input: src, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log(r.status === 0 ? '\nReady. VS Code: Remote-SSH: Connect to Host... -> rainy-pod' : `\npodSetup --boot exited ${r.status}`);
} else if (cmd === 'stop') {
  const p = await findPod();
  await api(`pods/${p.id}/stop`, 'POST');
  console.log(`Stopping ${p.name} (${p.id}).`);
} else if (cmd === 'sync') {
  const p = await findPod();
  const list = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 1 << 28 });
  const listFile = join(tmpdir(), `podsync-${process.pid}.txt`);
  writeFileSync(listFile, list);
  console.log(`Copying ${list.toString('utf8').split('\0').filter(Boolean).length} files to ${REMOTE} ...`);
  const tar = spawn('tar', ['--null', '-T', listFile, '-cf', '-'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const remote = spawn('ssh', [...sshArgs(p), `mkdir -p ${REMOTE} && tar -xf - --no-same-owner -C ${REMOTE} && sed -i 's/\\r$//' ${REMOTE}/scripts/*.sh`], { stdio: ['pipe', 'inherit', 'inherit'] });
  tar.stdout.pipe(remote.stdin);
  await new Promise((res, rej) => remote.on('exit', (c) => (c === 0 ? res() : rej(new Error(`remote tar exited ${c}`)))));
  console.log('Done. (Files deleted here are not deleted there; `npm install` there if package.json changed.)');
} else if (cmd === 'ssh') {
  process.exit(ssh(await findPod(), rest.join(' ')) ?? 1);
} else if (cmd === 'pull') {
  const p = await findPod();
  const dest = resolve(rest[1] ?? '.');
  mkdirSync(dest, { recursive: true });
  const r = spawnSync('scp', ['-r', '-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-P', String(p.portMappings['22']), `root@${p.publicIp}:${rest[0]}`, dest], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
} else {
  console.log('usage: node scripts/pod.mjs status | start | sync | ssh [cmd] | pull <remote> [dir] | stop');
  process.exit(cmd ? 1 : 0);
}
