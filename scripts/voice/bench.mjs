// The voice bench: a page for trying Mack's voice by hand. Type a line, pick the voice and the engine, set the pauses,
// pace, pitch and feeling, generate, listen, keep the takes you like.
//   node scripts/voice/bench.mjs          starts it on the GPU pod (starting the pod if need be) and opens http://localhost:8460/
//   node scripts/voice/bench.mjs pull     brings the takes and the voices you made back to debug-shots/voice/bench/
//   node scripts/voice/bench.mjs stop     stops the bench on the pod (the pod stops itself when idle)
// The models (Fish Audio S2 Pro, Chatterbox, Chatterbox-Turbo, and Qwen3-TTS to design a voice from a description) run
// on the pod: bench_server.py behind the page, bench_engine.py holding each model. The first start after the pod has
// been stopped reinstalls them (5-10 minutes; the page shows each engine's progress); Fish's weights stay on the volume.
// Ctrl+C closes the tunnel and leaves the bench running. Fish Audio S2 Pro's licence is non-commercial use only.
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const POD = join(root, 'scripts', 'pod.mjs');
const KEY = join(homedir(), '.ssh', 'runpod_ed25519');
const PORT = process.env.BENCH_PORT ?? '8460';
const REPO = '/workspace/a-rainy-place-to-die';
const LOG = '/workspace/voice-logs/bench.log';
const pod = (args, opts = {}) => spawnSync(process.execPath, [POD, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, ...opts });
const status = () => JSON.parse(pod(['status'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).stdout.trim().split('\n').pop());

const cmd = process.argv[2];
if (cmd === 'pull') {
  process.exitCode = pod(['pull', `${REPO}/debug-shots/voice/bench`, join(root, 'debug-shots', 'voice')]).status ?? 1;
} else if (cmd === 'stop') {
  // by the server's own pid: its workers stop with it
  process.exitCode = pod(['ssh', `kill $(cat /tmp/voice-bench.pid 2>/dev/null) 2>/dev/null; sleep 1; echo stopped`]).status ?? 1;
} else {
  // Fish's weights (11 GB) on the volume, kept across stops, which leaves the pod's own disk room for Turbo and the voice designer (bench_env.sh).
  const start = `mkdir -p /workspace/voice-logs && cd ${REPO} && sed -i 's/\\r$//' scripts/voice/*.sh && `
    + `if curl -s -m 3 -o /dev/null http://127.0.0.1:${PORT}/api/state; then echo 'Ready: already running'; else `
    + `(dpkg -s portaudio19-dev >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq ffmpeg portaudio19-dev libsox-dev >/dev/null)); `
    + `VOICE_CACHE=${process.env.VOICE_CACHE ?? '/workspace/voice-cache'} setsid nohup python3 scripts/voice/bench_server.py ${PORT} > ${LOG} 2>&1 < /dev/null & `
    + `for i in $(seq 1 30); do grep -q '^Ready:' ${LOG} && break; sleep 1; done; grep '^Ready:' ${LOG} || tail -5 ${LOG}; fi`;
  if (pod(['run', '--wait', '--no-pull', '--', 'bash', '-lc', start]).status !== 0) { console.error('The bench did not start.'); process.exit(1); }
  const p = status();
  const url = `http://localhost:${PORT}/`;
  console.log(`\nThe voice bench is at ${url}  (a tunnel to the pod, so only this machine can reach it).`);
  console.log('The dots at the top of the page show each engine loading. Ctrl+C here closes the tunnel; the bench keeps running.');
  console.log('The pod stops itself after 45 minutes with nothing generating: run this again to carry on (your takes and voices are kept).\n');
  if (!process.argv.includes('--no-open')) spawn(process.platform === 'win32' ? 'cmd' : 'xdg-open', process.platform === 'win32' ? ['/c', 'start', '', url] : [url], { stdio: 'ignore', detached: true }).unref();
  const tunnel = spawnSync('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'StrictHostKeyChecking=accept-new', '-i', KEY, '-p', String(p.ssh), '-L', `${PORT}:127.0.0.1:${PORT}`, `root@${p.ip}`], { stdio: 'inherit' });
  process.exitCode = tunnel.status ?? 0;
}
