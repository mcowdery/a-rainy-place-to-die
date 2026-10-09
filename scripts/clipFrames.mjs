// A video as frame sheets, so motion can be looked at: Claude reads stills, not video. Each sheet is a grid of
// frames in order, every frame stamped with its time in the clip.
//
//   node scripts/clipFrames.mjs [clip] [--from s] [--to s] [--fps n] [--cols n] [--rows n] [--width px]
//                               [--crop w:h:x:y] [--out dir]
//
//   With no clip, the newest video under the user's Videos folder (a screen recording: Win+Shift+R in the Snipping
//   Tool, Win+Alt+R in the Game Bar). 8 frames a second by default, fewer if the clip wouldn't fit in six sheets;
//   --from/--to (seconds) and a higher --fps look closely at one move. --crop is ffmpeg's (in the clip's pixels,
//   e.g. 960:540:480:270 for the middle of a 1920×1080 clip), for when the subject is small in the frame.
//   Sheets go to debug-shots/clips/<clip name>/ (git-ignored) unless --out says where.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';

const VIDEO = /\.(mp4|webm|mkv|mov|avi)$/i;
const FONT = 'C\\:/Windows/Fonts/consola.ttf';

const args = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else rest.push(args[i]);
}

function newestVideo(dir, depth = 3) {
  let best = null;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    let found = null;
    if (e.isDirectory() && depth > 0) found = newestVideo(p, depth - 1);
    else if (e.isFile() && VIDEO.test(e.name)) found = { path: p, time: statSync(p).mtimeMs };
    if (found && (!best || found.time > best.time)) best = found;
  }
  return best;
}

const clip = rest[0] ? resolve(rest[0]) : newestVideo(join(homedir(), 'Videos'))?.path;
if (!clip) {
  console.log('No clip given and no video found under ~/Videos.');
  process.exit(1);
}

// ffmpeg prints what it knows of a file to stderr when asked for no output.
const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', clip], { encoding: 'utf8' }).stderr;
const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
if (!dur) {
  console.log(`Can't read ${clip}:\n${probe}`);
  process.exit(1);
}
const length = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(probe);

const from = Number(opt.from ?? 0);
const to = Math.min(Number(opt.to ?? length), length);
const cols = Number(opt.cols ?? 4);
const rows = Number(opt.rows ?? 4);
const width = Number(opt.width ?? 480);
const perSheet = cols * rows;
const fps = Number(opt.fps ?? Math.min(8, (6 * perSheet) / Math.max(to - from, 0.1)));

const out = resolve(opt.out ?? join('debug-shots', 'clips', basename(clip, extname(clip)).replace(/[^\w.-]+/g, '_')));
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (/^sheet_\d+\.png$/.test(f)) rmSync(join(out, f));

const filters = [
  opt.crop && `crop=${opt.crop}`,
  `fps=${fps}`,
  `scale=${width}:-2`,
  // The stamp is the time in the clip, not since --from.
  `drawtext=fontfile='${FONT}':text='%{pts\\:hms\\:${from}}':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`,
  `tile=${cols}x${rows}`,
].filter(Boolean);
const run = spawnSync(
  ffmpeg,
  ['-hide_banner', '-loglevel', 'error', '-ss', String(from), '-t', String(to - from), '-i', clip, '-an', '-vf', filters.join(','), '-fps_mode', 'passthrough', join(out, 'sheet_%02d.png')],
  { encoding: 'utf8' },
);
if (run.status !== 0) {
  console.log(run.stderr);
  process.exit(1);
}

const sheets = readdirSync(out).filter((f) => /^sheet_\d+\.png$/.test(f)).sort();
console.log(`${clip}`);
console.log(`  ${length.toFixed(2)} s${size ? `, ${size[1]}×${size[2]}` : ''}; frames from ${from} to ${to.toFixed(2)} s at ${Number(fps.toFixed(2))} a second, ${cols}×${rows} a sheet`);
for (const s of sheets) console.log(`  ${join(out, s)}`);
