// Runs on the pod: streams the X display to a browser as GPU-encoded H.264 over a WebSocket, and feeds the browser's
// mouse and keyboard back into the display. The browser side is client.html (WebCodecs, so the decode is on the GPU too).
//
//   display :1 --ffmpeg x11grab--> h264_nvenc (the GPU's video encoder) --> Annex B on stdout --> split per frame
//        --> WebSocket binary messages [flags u8][access unit]   (flags bit 0 = a keyframe)
//   WebSocket text messages (JSON) --> input.py (XTest) --> the display
//
// Listens on 127.0.0.1 only: the way in is an SSH tunnel. The encoder runs only while a viewer is connected, so an
// unwatched game costs the GPU nothing extra, and the whole desktop is stopped after STREAM_NO_VIEWER_MIN minutes with
// nobody connected or STREAM_IDLE_MIN minutes with no input (the game keeps rendering, which would hold the pod awake).
//
// Env: STREAM_W / STREAM_H (the display's size), STREAM_FPS (60), STREAM_BITRATE (25M), STREAM_PORT (8450), DISPLAY (:1).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { WebSocketServer } = createRequire('/workspace/play-deps/package.json')('ws');
const env = process.env;
const W = Number(env.STREAM_W ?? 1920);
const H = Number(env.STREAM_H ?? 1080);
const FPS = Number(env.STREAM_FPS ?? 60);
const BITRATE = env.STREAM_BITRATE ?? '25M';
const PORT = Number(env.STREAM_PORT ?? 8450);
const DISPLAY = env.DISPLAY ?? ':1';
const NO_VIEWER_MIN = Number(env.STREAM_NO_VIEWER_MIN ?? 10);
const IDLE_MIN = Number(env.STREAM_IDLE_MIN ?? 30);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const clients = new Set();
let ffmpeg = null;
let input = null;
let stopTimer = null;
let lastInput = Date.now();
let lastViewer = Date.now();
const stats = { frames: 0, bytes: 0, dropped: 0 };

const START = Buffer.from([0, 0, 0, 1]);
const AUD = Buffer.from([0, 0, 0, 1, 0x09]);

/** Does this access unit contain an IDR slice (NAL type 5)? */
function isKey(au) {
  for (let i = 0; i + 3 < au.length; i++) {
    if (au[i] === 0 && au[i + 1] === 0 && (au[i + 2] === 1 || (au[i + 2] === 0 && au[i + 3] === 1))) {
      const at = au[i + 2] === 1 ? i + 3 : i + 4;
      if ((au[at] & 0x1f) === 5) return true;
      if ((au[at] & 0x1f) === 1) return false; // a non-IDR slice: no keyframe in this unit
    }
  }
  return false;
}

function send(au) {
  const key = isKey(au);
  const msg = Buffer.concat([Buffer.from([key ? 1 : 0]), au]);
  stats.frames++;
  stats.bytes += au.length;
  for (const ws of clients) {
    if (ws.needKey && !key) continue;
    if (ws.bufferedAmount > 1_500_000) { // this viewer can't keep up: skip frames until the next keyframe
      ws.needKey = true;
      stats.dropped++;
      continue;
    }
    if (key) ws.needKey = false;
    ws.send(msg, { binary: true });
  }
}

function startEncoder() {
  if (ffmpeg) return;
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'x11grab', '-framerate', String(FPS), '-video_size', `${W}x${H}`, '-draw_mouse', '1', '-thread_queue_size', '64', '-i', `${DISPLAY}.0+0,0`,
    '-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'ull', '-zerolatency', '1', '-rc', 'cbr',
    '-b:v', BITRATE, '-maxrate', BITRATE, '-bufsize', String(Math.round(parseInt(BITRATE) * 1e6 / FPS * 2)),
    '-g', String(Math.round(FPS / 2)), '-bf', '0', '-profile:v', 'high',
    // SPS and PPS ahead of every keyframe, and an access unit delimiter ahead of every frame, so a viewer can join on any keyframe
    // and this server can cut the byte stream into frames.
    '-bsf:v', 'dump_extra=freq=keyframe,h264_metadata=aud=insert',
    '-flush_packets', '1', '-f', 'h264', 'pipe:1',
  ];
  log('encoder: ffmpeg', args.join(' '));
  ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = Buffer.alloc(0);
  ffmpeg.stdout.on('data', (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    // each access unit starts with an AUD: emit everything before the last AUD, keep the rest until the next one shows
    let from = 0;
    for (;;) {
      const next = buf.indexOf(AUD, from + 1);
      if (next < 0) break;
      if (buf.indexOf(AUD, from) === from) send(buf.subarray(from, next));
      from = next;
    }
    buf = buf.subarray(from);
  });
  ffmpeg.on('exit', (code) => { log('encoder exited', code); ffmpeg = null; });
}

function stopEncoder() {
  if (ffmpeg) { ffmpeg.kill('SIGINT'); ffmpeg = null; }
}

function startInput() {
  if (input) return;
  input = spawn('python3', [join(here, 'input.py')], { stdio: ['pipe', 'inherit', 'inherit'], env: { ...env, DISPLAY } });
  input.on('exit', () => { input = null; });
}

const page = readFileSync(join(here, 'client.html'));
const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (host !== 'localhost' && host !== '127.0.0.1') return res.writeHead(403).end('forbidden');
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(readFileSync(join(here, 'client.html')));
  } else if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...stats, clients: clients.size, encoder: Boolean(ffmpeg) }));
  } else res.writeHead(404).end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536 });
wss.on('connection', (ws, req) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (host !== 'localhost' && host !== '127.0.0.1') return ws.close();
  ws.needKey = true;
  clients.add(ws);
  clearTimeout(stopTimer);
  lastViewer = lastInput = Date.now();
  startEncoder();
  startInput();
  ws.send(JSON.stringify({ type: 'hello', w: W, h: H, fps: FPS, bitrate: BITRATE }));
  log('viewer connected,', clients.size, 'now');
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.t === 'ping') return ws.send(JSON.stringify({ type: 'pong', ts: m.ts }));
    lastInput = Date.now();
    input?.stdin.write(JSON.stringify(m) + '\n');
  });
  ws.on('close', () => {
    clients.delete(ws);
    lastViewer = Date.now();
    log('viewer left,', clients.size, 'now');
    if (!clients.size) stopTimer = setTimeout(stopEncoder, 5000);
  });
});

// The game renders whether or not anyone watches: stop the whole desktop when it is not in use.
setInterval(() => {
  const idleViewers = !clients.size && Date.now() - lastViewer > NO_VIEWER_MIN * 60000;
  const idleInput = clients.size && Date.now() - lastInput > IDLE_MIN * 60000;
  if (!idleViewers && !idleInput) return;
  log('stopping the desktop:', idleViewers ? `no viewer for ${NO_VIEWER_MIN} min` : `no input for ${IDLE_MIN} min`);
  spawn('bash', [join(here, '..', 'podStream.sh'), 'stop'], { detached: true, stdio: 'ignore' }).unref();
}, 30000);

server.listen(PORT, '127.0.0.1', () => log(`stream server on 127.0.0.1:${PORT} (${W}x${H} @ ${FPS}, ${BITRATE}, display ${DISPLAY})`));
process.on('SIGTERM', () => { stopEncoder(); process.exit(0); });
