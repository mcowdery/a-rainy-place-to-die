/**
 * Footsteps to listen to and measure, without the game: renders every surface in every kind of footwear
 * (src/poc3d/real/stepSynth.ts) as a WAV of four steps walking, four running and a landing, into
 * debug-shots/steps/ with an index.html to play them from (the dev server shows it at /debug-shots/steps/),
 * and prints each one's measurements (a walking step: peak, how long it lasts, where its energy sits).
 *   node scripts/stepSounds.mjs [surface ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { renderStep, renderSplash, stepStats, STEP_SECONDS } = await server.ssrLoadModule('/src/poc3d/real/stepSynth.ts');
const { SURFACES, FOOTWEAR } = await server.ssrLoadModule('/src/poc3d/district/footing.ts');
const SR = 48000;
const dir = resolve(server.config.root, 'debug-shots/steps');
mkdirSync(dir, { recursive: true });
const only = process.argv.slice(2);
const surfaces = only.length ? SURFACES.filter((s) => only.includes(s)) : SURFACES;

/** 16-bit mono WAV. */
function wav(samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

const rows = [];
let seed = 1;
for (const surface of surfaces) {
  for (const footwear of FOOTWEAR) {
    // Four steps at a walk (1.6 a second), four at a run (2.6), then a landing.
    const plan = [];
    let t = 0.1;
    for (let i = 0; i < 4; i++, t += 1 / 1.6) plan.push({ t, run: false, land: false });
    t += 0.3;
    for (let i = 0; i < 4; i++, t += 1 / 2.6) plan.push({ t, run: true, land: false });
    t += 0.5;
    plan.push({ t, run: false, land: true });
    const out = new Float32Array(Math.ceil((t + STEP_SECONDS + 0.1) * SR));
    for (const p of plan) {
      const s = renderStep(surface, footwear, { run: p.run, land: p.land, seed: seed++, sampleRate: SR });
      const i0 = Math.round(p.t * SR);
      for (let i = 0; i < s.length; i++) out[i0 + i] += s[i];
    }
    const name = `${surface}_${footwear}`;
    writeFileSync(resolve(dir, `${name}.wav`), wav(out));
    const st = stepStats(renderStep(surface, footwear, { run: false, land: false, seed: 7, sampleRate: SR }), SR);
    rows.push({ name, surface, footwear, ...st });
  }
}
// In the wet: boots on paving with the water over them, as the game mixes them (the step dulled in a puddle).
const WATER = [['wet ground', 0, 0.7], ['shallow puddle', 0.45, 1.07], ['deep puddle', 1, 1.4]];
for (const [label, depth, gain] of only.length ? [] : WATER) {
  const plan = [];
  let t = 0.1;
  for (let i = 0; i < 4; i++, t += 1 / 1.6) plan.push({ t, run: false });
  t += 0.3;
  for (let i = 0; i < 4; i++, t += 1 / 2.6) plan.push({ t, run: true });
  const out = new Float32Array(Math.ceil((t + STEP_SECONDS + 0.1) * SR));
  for (const p of plan) {
    const s = renderStep('paving', 'boots', { run: p.run, land: false, seed: seed++, sampleRate: SR });
    const w = renderSplash({ depth, run: p.run, seed: seed++, sampleRate: SR });
    const i0 = Math.round(p.t * SR);
    for (let i = 0; i < s.length; i++) out[i0 + i] += s[i] * (1 - 0.5 * depth) + w[i] * gain;
  }
  const name = `water_${label.replace(/ /g, '_')}`;
  writeFileSync(resolve(dir, `${name}.wav`), wav(out));
  rows.push({ name, ...stepStats(renderSplash({ depth, run: false, seed: 7, sampleRate: SR }), SR) });
}
const pct = (v) => `${Math.round(v * 100)}`.padStart(3);
console.log('step                 peak   ms  centre Hz   <250  -1k  -4k  4k+  (% of energy)');
for (const r of rows) console.log(`${r.name.padEnd(20)} ${r.peak.toFixed(2)}  ${String(Math.round(r.seconds * 1000)).padStart(3)}  ${String(Math.round(r.centroid)).padStart(8)}   ${r.bands.map(pct).join('  ')}`);

const html = `<!doctype html><meta charset="utf-8"><title>Footsteps</title>
<style>body{background:#111;color:#ddd;font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{padding:6px 12px;text-align:left;border-bottom:1px solid #333}audio{height:28px;width:300px}small{color:#888}</style>
<h2>Footsteps</h2><p><small>Each: four steps walking, four running, a landing. Dry (in the game a little of the street's or the room's echo is added, and a splash on wet ground).</small></p>
<table><tr><th>surface</th>${FOOTWEAR.map((f) => `<th>${f}</th>`).join('')}</tr>
${surfaces.map((s) => `<tr><td>${s}</td>${FOOTWEAR.map((f) => `<td><audio controls preload="none" src="${s}_${f}.wav"></audio></td>`).join('')}</tr>`).join('\n')}
</table>
${only.length ? '' : `<h3>In the wet <small>(boots on paving, four steps walking, four running)</small></h3><table>${WATER.map(([label]) => `<tr><td>${label}</td><td><audio controls preload="none" src="water_${label.replace(/ /g, '_')}.wav"></audio></td></tr>`).join('')}</table>`}`;
writeFileSync(resolve(dir, 'index.html'), html);
console.log(`\n${rows.length} sounds in debug-shots/steps/ (index.html)`);
await server.close();
