// Voice comparison: the page to hear the clips on. Reads what gen.py, fish.sh and higgs.sh left in debug-shots/voice/
// and writes index.html there: the designed voices, then a row a line and a column a model.
//   node scripts/voice/index.mjs [dir]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, '..', '..', 'debug-shots', 'voice');
const spec = JSON.parse(readFileSync(join(here, 'lines.json'), 'utf8'));
const MODELS = [
  ['chatterbox', 'Chatterbox', 'MIT (what Trame has now)'],
  ['qwen', 'Qwen3-TTS', 'Apache 2.0'],
  ['f5', 'F5-TTS', 'CC BY-NC 4.0'],
  ['fish', 'Fish Audio S2 Pro', 'research, non-commercial'],
  ['higgs', 'Higgs TTS 3', 'research, non-commercial'],
].filter(([id]) => existsSync(join(dir, id)));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const player = (src, label) => `<figure>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}<audio controls preload="none" src="${src}"></audio></figure>`;

const voices = spec.voices.filter((v) => existsSync(join(dir, 'voices', `${v.id}.wav`)));
const rows = spec.lines.map((line, i) => {
  const stem = `${String(i + 1).padStart(2, '0')}-${line.id}`;
  const cells = MODELS.map(([id]) => {
    const takes = readdirSync(join(dir, id)).filter((f) => f.startsWith(stem) && f.endsWith('.wav')).sort();
    return `<td>${takes.map((f) => player(`${id}/${f}`, f.slice(stem.length + 1, -4))).join('') || '—'}</td>`;
  });
  return `<tr><th>${esc(line.text)}</th>${cells.join('')}</tr>`;
});

writeFileSync(join(dir, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>Mack's voice</title>
<style>
  body { background: #14161a; color: #d8d4cc; font: 15px/1.45 system-ui, sans-serif; margin: 24px; }
  h1, h2 { font-weight: 600; } h2 { margin-top: 32px; }
  table { border-collapse: collapse; } th, td { border-top: 1px solid #2c3038; padding: 10px 12px; vertical-align: top; text-align: left; }
  tbody th { font-weight: 400; max-width: 300px; } thead small { display: block; font-weight: 400; color: #8d8a84; }
  figure { margin: 0 0 6px; } figcaption { font-size: 12px; color: #8d8a84; } audio { width: 230px; height: 32px; }
  p { max-width: 760px; color: #a8a49c; }
</style>
<h1>Mack's voice: the same lines through each model</h1>
<p>Every clip is in the voice of "${esc(process.env.VOICE ?? 'gravel')}" below. "slow" is Chatterbox with its pacing lowered; "tags" is the line with that model's own delivery tags written into it.</p>
<h2>The designed voices (Qwen3-TTS VoiceDesign, from a written description)</h2>
<table>${voices.map((v) => `<tr><th>${esc(v.id)}</th><td>${player(`voices/${v.id}.wav`)}</td><td>${esc(v.instruct)}</td></tr>`).join('')}</table>
<h2>The lines</h2>
<table><thead><tr><th></th>${MODELS.map(([, name, lic]) => `<th>${name}<small>${lic}</small></th>`).join('')}</tr></thead>
<tbody>${rows.join('\n')}</tbody></table>
`);
console.log(`wrote ${join(dir, 'index.html')} (${MODELS.length} models, ${voices.length} voices)`);
