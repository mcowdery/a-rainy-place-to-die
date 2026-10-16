// Engine loops for race/engineSamples.ts: the downloaded WAVs in .cache/engine-sounds/ to mono Ogg Opus in
// assets/audio/engines/ (see that folder's CREDITS.md for where each came from).
//   .cache/engine-sounds/domasx2/loop_*.wav   opengameart.org/node/5633 (CC0)            -> loop_0..5.ogg
//   .cache/engine-sounds/qubodup/x/engine-loop/engine-loop-1-normalized.wav (CC BY 3.0)  -> real.ogg
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const C = '.cache/engine-sounds';
const OUT = 'assets/audio/engines';
mkdirSync(OUT, { recursive: true });
const jobs = [
  ...['loop_0', 'loop_1_0', 'loop_2_0', 'loop_3_0', 'loop_4_0', 'loop_5_0'].map((f, i) => [`${C}/domasx2/${f}.wav`, `${OUT}/loop_${i}.ogg`]),
  [`${C}/qubodup/x/engine-loop/engine-loop-1-normalized.wav`, `${OUT}/real.ogg`],
];
for (const [src, dst] of jobs) {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k', dst]);
  console.log(dst);
}
