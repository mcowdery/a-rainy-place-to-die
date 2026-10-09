// A sound as pictures and numbers, since Claude can't hear: a spectrogram and a waveform to look at, and its
// length, loudness, peak and silences printed. It says whether a file is clipped, quiet, cut off or mostly silence,
// and where its energy is; it doesn't say whether it sounds good.
//
//   node scripts/soundLook.mjs <file> [more files] [--out dir]
//
//   Any file ffmpeg reads (wav, mp3, ogg, flac, a video's sound). Pictures go to debug-shots/sounds/ (git-ignored)
//   unless --out says where: <name>.spectrum.png (log frequency, time along the bottom) and <name>.wave.png.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import ffmpeg from 'ffmpeg-static';

const args = process.argv.slice(2);
const opt = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
  else files.push(args[i]);
}
if (!files.length) {
  console.log('Usage: node scripts/soundLook.mjs <file> [more files] [--out dir]');
  process.exit(1);
}
const out = resolve(opt.out ?? join('debug-shots', 'sounds'));
mkdirSync(out, { recursive: true });

const last = (re, text) => {
  let m;
  let found = null;
  const g = new RegExp(re, 'g');
  while ((m = g.exec(text))) found = m;
  return found;
};

for (const f of files) {
  const file = resolve(f);
  const name = basename(file, extname(file)).replace(/[^\w.-]+/g, '_');
  const spectrum = join(out, `${name}.spectrum.png`);
  const wave = join(out, `${name}.wave.png`);
  const run = spawnSync(
    ffmpeg,
    [
      '-hide_banner', '-nostats', '-y', '-i', file,
      '-filter_complex',
      '[0:a]asplit=3[a][b][c];' +
        '[a]showspectrumpic=s=1600x512:legend=1:fscale=log:color=magma[s];' +
        '[b]aformat=channel_layouts=mono,showwavespic=s=1600x240:colors=white:filter=peak,format=rgb24[w];' +
        '[c]ebur128=peak=true,silencedetect=n=-50dB:d=0.25[n]',
      '-map', '[s]', '-frames:v', '1', spectrum,
      '-map', '[w]', '-frames:v', '1', wave,
      '-map', '[n]', '-f', 'null', '-',
    ],
    { encoding: 'utf8' },
  );
  const log = run.stderr;
  if (run.status !== 0) {
    console.log(`${file}\n  ffmpeg failed:\n${log.split('\n').slice(-6).join('\n')}`);
    continue;
  }
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const length = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : NaN;
  const stream = /Audio: ([^\n]+)/.exec(log)?.[1].trim() ?? '';
  // The summary ebur128 prints at the end; the last of each is the whole file's.
  const lufs = last('I:\\s+(-?[\\d.]+|-inf) LUFS', log)?.[1];
  const range = last('LRA:\\s+(-?[\\d.]+) LU', log)?.[1];
  const peak = last('Peak:\\s+(-?[\\d.]+|-inf) dBFS', log)?.[1];
  const silences = [...log.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [Math.max(0, Number(m[1])), Number(m[2])]);
  const open = last('silence_start: (-?[\\d.]+)', log);
  if (open && !silences.some((s) => s[0] === Math.max(0, Number(open[1])))) silences.push([Math.max(0, Number(open[1])), length]);
  const silent = silences.reduce((t, s) => t + (s[1] - s[0]), 0);

  console.log(file);
  console.log(`  ${length.toFixed(2)} s, ${stream}`);
  // A file normalised to full scale and then encoded reads a few tenths of a dB over; only more than that is a fault.
  // ebur128 needs 0.4 s of sound before it gives a loudness.
  const loud = Number(lufs) <= -70 ? 'loudness not measured (too short or silent)' : `loudness ${lufs} LUFS, range ${range} LU`;
  console.log(`  ${loud}, true peak ${peak} dBFS${Number(peak) > 1 ? '  (over full scale: clips unless played turned down)' : ''}`);
  console.log(
    silences.length
      ? `  quieter than -50 dB for ${silent.toFixed(2)} s: ${silences.slice(0, 8).map((s) => `${s[0].toFixed(2)}-${s[1].toFixed(2)}`).join(', ')}${silences.length > 8 ? ', ...' : ''}`
      : '  no silences',
  );
  console.log(`  ${spectrum}\n  ${wave}`);
}
