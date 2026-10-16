// Steady stretches of a long engine recording, cut into seamless loops for the pitch ladder (race/engineSamples.ts).
//   node scripts/audio/cut_engine_runs.mjs <input> <name> [maxLoops=6] [minSeconds=1.5]
// Finds runs where the engine's pitch and loudness hold (autocorrelation on a 11 kHz copy, 0.25 s hops), cuts each at
// 48 kHz, crossfades its tail into its head so it loops, and writes assets/audio/engines/<name>_<n>.ogg plus
// <name>.json (each loop's measured pitch in Hz: the engine's dominant periodicity). Prints what it found: the pitch
// is an estimate, so a ladder it builds still wants a listen.
import ffmpeg from 'ffmpeg-static';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [input, name, maxLoops = '6', minSec = '1.5'] = process.argv.slice(2);
const OUT = 'assets/audio/engines';
mkdirSync(OUT, { recursive: true });
const pcm = (sr) => {
  const raw = execFileSync(ffmpeg, ['-v', 'error', '-i', input, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
};
const SR = 11025, WIN = 4096, HOP = 0.25;
const x = pcm(SR);
const frames = [];
for (let t = 0; t + WIN / SR < x.length / SR; t += HOP) {
  const o = Math.floor(t * SR);
  let rms = 0;
  for (let i = 0; i < WIN; i++) rms += x[o + i] ** 2;
  rms = Math.sqrt(rms / WIN);
  // Correlation at every lag from 25 to 400 Hz; the fundamental is the shortest lag nearly as good as the best.
  const cs = [];
  let best = 0;
  for (let l = Math.floor(SR / 400); l < SR / 25; l++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < WIN - l; i += 2) { s += x[o + i] * x[o + i + l]; e1 += x[o + i] ** 2; e2 += x[o + i + l] ** 2; }
    const c = s / Math.sqrt(e1 * e2 + 1e-9);
    cs.push(c);
    if (c > best) best = c;
  }
  const lag0 = Math.floor(SR / 400);
  let pick = 0;
  for (let k = 1; k < cs.length - 1; k++) if (cs[k] >= 0.9 * best && cs[k] >= cs[k - 1] && cs[k] >= cs[k + 1]) { pick = k; break; }
  frames.push({ t, rms, c: best, f: SR / (lag0 + pick) });
}
const loud = frames.map((f) => f.rms).sort((a, b) => a - b)[Math.floor(frames.length * 0.75)] || 0.03; // a file's own level, so a quiet recording counts
const ok = (f) => f.rms > 0.4 * loud && f.c > 0.85;
const runs = [];
let cur = [];
const flush = () => { if (cur.length * HOP >= +minSec) runs.push(cur); cur = []; };
// A run's whole pitch range stays within BAND: a stretch that is slowly revving up would loop as a glide that snaps back
// at the seam every few seconds (the first Honda idle did, 58 to 63 Hz, and sounded like a gear change).
const BAND = 1.035;
for (const f of frames) {
  const lo = cur.length ? Math.min(f.f, ...cur.map((q) => q.f)) : f.f;
  const hi = cur.length ? Math.max(f.f, ...cur.map((q) => q.f)) : f.f;
  if (ok(f) && hi / lo <= BAND) cur.push(f); else { flush(); if (ok(f)) cur = [f]; }
}
flush();
// The longest runs, one per pitch region (not two within 8% of each other), lowest first.
runs.sort((a, b) => b.length - a.length);
const chosen = [];
for (const r of runs) {
  const f = r.map((q) => q.f).sort((a, b) => a - b)[r.length >> 1];
  if (chosen.every((c) => Math.abs(c.f - f) / f > 0.08)) chosen.push({ f, t0: r[0].t, t1: r[r.length - 1].t + WIN / SR });
  if (chosen.length >= +maxLoops) break;
}
chosen.sort((a, b) => a.f - b.f);
const big = pcm(48000);
const loops = [];
chosen.forEach((c, n) => {
  const a = Math.floor((c.t0 + 0.4) * 48000), b = Math.min(big.length, Math.floor((c.t1 - 0.2) * 48000)); // the edges are where the engine is still moving into and out of the steady stretch
  const seg = big.subarray(a, b), N = seg.length, L = Math.floor(0.06 * 48000);
  // The seam: the end is moved (within 0.25 s) to where the engine's waveform lines up with the start's, so the two
  // blend in phase. Blindly fading one stretch into another, out of phase, dips the level at every loop (honda_1 fell to
  // 44% at the seam: a pulse once a second as the loop's rate rose).
  let e = N - L, bestC = -2;
  for (let k = N - L - Math.floor(0.25 * 48000); k <= N - L; k += 2) {
    if (k < L * 2) continue;
    let sx = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < L; i += 2) { sx += seg[i] * seg[k + i]; e1 += seg[i] ** 2; e2 += seg[k + i] ** 2; }
    const c = sx / Math.sqrt(e1 * e2 + 1e-9);
    if (c > bestC) { bestC = c; e = k; }
  }
  const out = new Float32Array(e);
  for (let i = 0; i < e; i++) {
    if (i < L) {
      const q = i / L; // blended in step with the tail's waveform; equal power only where they don't match
      const wa = bestC > 0.6 ? q : Math.sin(q * Math.PI / 2), wb = bestC > 0.6 ? 1 - q : Math.cos(q * Math.PI / 2);
      out[i] = seg[i] * wa + seg[e + i] * wb;
    } else out[i] = seg[i];
  }
  // The level held even: the loop's slow swells (a gentle rev, a gust) flattened by dividing by the rms over 0.25 s,
  // smoothed round the loop's end so the seam is no step. The engine's own pulses stay.
  const W = Math.floor(0.25 * 48000), nW = Math.ceil(out.length / W);
  const win = [];
  for (let k = 0; k < nW; k++) { let r = 0, n = 0; for (let i = k * W; i < Math.min(out.length, (k + 1) * W); i++) { r += out[i] ** 2; n++; } win.push(Math.sqrt(r / n) + 1e-6); }
  const target = [...win].sort((p, q) => p - q)[win.length >> 1];
  const gainAt = (i) => { // linear between window centres, wrapping
    const pos = i / W - 0.5, k0 = Math.floor(pos), f = pos - k0;
    const g = (k) => target / win[((k % nW) + nW) % nW];
    return g(k0) * (1 - f) + g(k0 + 1) * f;
  };
  if (nW > 1) for (let i = 0; i < out.length; i++) out[i] *= gainAt(i);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] *= 0.8 / (peak || 1);
  const tmp = join(tmpdir(), `${name}_${n}.f32`);
  writeFileSync(tmp, Buffer.from(out.buffer));
  const dst = `${OUT}/${name}_${n}.ogg`;
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '1', '-i', tmp, '-c:a', 'libopus', '-b:a', '96k', dst]);
  unlinkSync(tmp);
  loops.push({ file: `${name}_${n}.ogg`, pulse: +c.f.toFixed(1) });
  console.log(dst, `${c.f.toFixed(1)} Hz`, `${c.t0.toFixed(1)}-${c.t1.toFixed(1)} s`);
});
writeFileSync(`${OUT}/${name}.json`, JSON.stringify(loops, null, 1) + '\n');
console.log(`${input}: ${runs.length} steady runs, ${loops.length} loops kept`);
