// The gun sounds, rendered offline to be measured and listened to (they're synthesised: race/gunSound.ts).
// node scripts/gunSounds.mjs [out dir]
//   Writes each as a WAV into debug-shots/guns/ (the recorded voices as the game plays them: near, three in a row, 40 m
//   and 120 m off; the synthesised report near and far; the magazine change) with an
//   index.html to play them (/debug-shots/guns/ on the dev server), and prints each one's peak, loudness, length and
//   where its energy is. `old` is the pistol as it was before the report was rebuilt in layers, for comparison.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from './shotServer.mjs';

const out = process.argv[2] ?? 'debug-shots/guns';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'off' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}mob.html`, { waitUntil: 'domcontentloaded' });

const results = await page.evaluate(async () => {
  const { GunSound } = await import('/src/race/gunSound.ts');
  const SR = 48000;
  const at = (d) => ({ distanceTo: () => d });
  // The pistol as it was: three layers straight to the output, the body into the slap-back.
  const old = (ctx, t0) => {
    const outG = ctx.createGain();
    outG.gain.value = 0.8;
    outG.connect(ctx.destination);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.23;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    echo.connect(lp).connect(fb).connect(echo);
    lp.connect(outG);
    const nb = ctx.createBuffer(1, SR, SR);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = (len, type, freq, gain, attack, toEcho) => {
      const s = ctx.createBufferSource();
      s.buffer = nb;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + len);
      s.connect(f).connect(g).connect(outG);
      if (toEcho) g.connect(echo);
      s.start(t0, Math.random() * 0.5);
      s.stop(t0 + attack + len + 0.05);
    };
    noise(0.18, 'lowpass', 3200, 0.9, 0.002, true);
    noise(0.012, 'highpass', 4000, 0.6, 0.0005, false);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t0);
    o.frequency.exponentialRampToValueAtTime(38, t0 + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.7, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.182);
    o.connect(g).connect(outG);
    o.start(t0);
    o.stop(t0 + 0.25);
  };
  const render = async (secs, build) => {
    const ctx = new OfflineAudioContext(2, Math.floor(SR * secs), SR);
    await build(ctx);
    const buf = await ctx.startRendering();
    return [buf.getChannelData(0), buf.getChannelData(1)];
  };
  // (An offline context's clock doesn't run while the graph is built: later shots are scheduled by suspending it.)
  const shots = (kind, dist, times, voice = 'synth') => async (ctx) => {
    const s = new GunSound();
    s.voice = voice;
    s.start(ctx);
    await s.ready;
    for (const t of times) {
      if (t === 0) s.play([{ kind, at: at(dist) }], null);
      else void ctx.suspend(t).then(() => (s.play([{ kind, at: at(dist) }], null), ctx.resume()));
    }
  };
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const wr = Math.cos(ang * k);
          const wi = Math.sin(ang * k);
          const a = i + k;
          const b = a + len / 2;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  };
  // Where a stretch's energy is: its centre (Hz) and the share in each band.
  const spectrum = (x, from, len) => {
    const n = 1 << Math.ceil(Math.log2(len));
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < len && from + i < x.length; i++) re[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)));
    fft(re, im);
    const bands = [0, 0, 0, 0, 0];
    let sum = 0;
    let centre = 0;
    for (let i = 1; i < n / 2; i++) {
      const f = (i * SR) / n;
      const p = re[i] * re[i] + im[i] * im[i];
      sum += p;
      centre += p * f;
      bands[f < 150 ? 0 : f < 500 ? 1 : f < 2000 ? 2 : f < 6000 ? 3 : 4] += p;
    }
    return { centre: Math.round(centre / (sum || 1)), bands: bands.map((b) => Math.round((100 * b) / (sum || 1))) };
  };
  const stats = (x) => {
    let peak = 0;
    let peakAt = 0;
    for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak) [peak, peakAt] = [Math.abs(x[i]), i];
    // The loudest 50 ms (RMS), and when the envelope (5 ms RMS) has fallen 20, 40 and 60 dB below its top.
    const win = (n) => {
      const e = [];
      for (let i = 0; i + n <= x.length; i += n) {
        let s = 0;
        for (let k = 0; k < n; k++) s += x[i + k] * x[i + k];
        e.push(Math.sqrt(s / n));
      }
      return e;
    };
    const env = win(240);
    const top = Math.max(...env);
    const first = env.findIndex((v) => v > top * 0.1);
    const last = (db) => {
      const th = top * Math.pow(10, -db / 20);
      let i = env.length - 1;
      while (i > 0 && env[i] < th) i--;
      return Math.round((i - first) * 5);
    };
    const db = (v) => +(20 * Math.log10(Math.max(1e-6, v))).toFixed(1);
    const start = Math.max(0, first * 240);
    return { peak: +peak.toFixed(2), peakDb: db(peak), rms50: db(Math.max(...win(2400))), attackMs: +(((peakAt - start) / SR) * 1000).toFixed(1), to20: last(20), to40: last(40), to60: last(60), first30ms: spectrum(x, start, 1440), whole: spectrum(x, start, 16384) };
  };
  const jobs = [
    ['old_near', 2.2, (ctx) => old(ctx, 0)],
    ['new_near', 2.2, shots('pistol', 0, [0])],
    ['old_three', 2.6, (ctx) => [0, 0.32, 0.64].forEach((t) => old(ctx, t))],
    ['new_three', 2.6, shots('pistol', 0, [0, 0.32, 0.64])],
    ['new_far_40m', 2.2, shots('pistol', 40, [0])],
    ['new_far_120m', 2.2, shots('pistol', 120, [0])],
    ['magazine', 2.2, shots('magazine', 0, [0])],
    ...['9mm', '45', '380', 'tokarev'].flatMap((v) => [
      [`recorded_${v}_near`, 2.2, shots('pistol', 0, [0], v)],
      [`recorded_${v}_three`, 2.8, shots('pistol', 0, [0, 0.32, 0.64], v)],
      [`recorded_${v}_40m`, 2.8, shots('pistol', 40, [0], v)],
      [`recorded_${v}_120m`, 2.8, shots('pistol', 120, [0], v)],
    ]),
  ];
  const outs = [];
  for (const [name, secs, build] of jobs) {
    const [l, r] = await render(secs, build);
    outs.push({ name, stats: stats(l), l: Array.from(l), r: Array.from(r) });
  }
  return outs;
});

const wav = (l, r) => {
  const n = l.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 4, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(48000 * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  return b;
};
console.log('bands: share of energy under 150 Hz, 150-500, 500-2k, 2k-6k, over 6k');
for (const { name, stats, l, r } of results) {
  writeFileSync(`${out}/${name}.wav`, wav(l, r));
  const s = stats;
  console.log(`${name.padEnd(14)} peak ${s.peak} (${s.peakDb} dB) loudest 50 ms ${s.rms50} dB · attack ${s.attackMs} ms · -20/-40/-60 dB after ${s.to20}/${s.to40}/${s.to60} ms · first 30 ms centre ${s.first30ms.centre} Hz ${JSON.stringify(s.first30ms.bands)} · whole centre ${s.whole.centre} Hz ${JSON.stringify(s.whole.bands)}`);
}
writeFileSync(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Gun sounds</title><body style="background:#111;color:#ddd;font:14px sans-serif;padding:20px"><h3>Gun sounds (race/gunSound.ts)</h3>${results.map(({ name }) => `<p>${name}<br><audio controls src="${name}.wav"></audio></p>`).join('')}</body>`);
await browser.close();
await server.close();
