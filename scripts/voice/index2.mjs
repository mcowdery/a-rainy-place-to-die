// Voice comparison, round 2: the page to hear r2.py's clips on (debug-shots/voice/r2/index.html): the voice candidates,
// then a section a group of round2.json, a row an item, a column an engine, with the text each engine was given.
//   node scripts/voice/index2.mjs [dir]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, '..', '..', 'debug-shots', 'voice', 'r2');
const spec = JSON.parse(readFileSync(join(here, 'round2.json'), 'utf8'));
const engines = spec.engines.filter(([id]) => existsSync(join(dir, id)));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const audio = (src) => `<audio controls preload="none" src="${src}"></audio>`;
const usedVoice = (id) => (existsSync(join(dir, id, 'voice.txt')) ? readFileSync(join(dir, id, 'voice.txt'), 'utf8').trim() : '?');

/** What an engine was sent, as text: pieces and the silences between them, then any settings. */
function describe(s) {
  const o = typeof s === 'object' && !Array.isArray(s) ? s : { t: s };
  const text = Array.isArray(o.t) ? o.t.map((p) => (typeof p === 'number' ? `<i>(${p} s)</i>` : esc(p))).join(' ') : esc(o.t);
  const opts = Object.entries(o).filter(([k]) => k !== 't').map(([k, v]) => `${k} ${v}`).join(', ');
  return text + (opts ? ` <i>[${esc(opts)}]</i>` : '');
}

const voices = spec.voices.map((v) => {
  const takes = [];
  for (let n = 1; n <= spec.voice_takes; n++) if (existsSync(join(dir, 'voices', `${v.id}-${n}.wav`))) takes.push(`<figure><figcaption>${v.id}-${n}</figcaption>${audio(`voices/${v.id}-${n}.wav`)}</figure>`);
  return takes.length ? `<tr><th>${esc(v.id)}</th><td>${takes.join('')}</td><td class="said">${esc(v.instruct)}</td></tr>` : '';
}).join('');

const groups = spec.groups.map((g) => {
  const rows = g.items.map((item) => {
    const cells = engines.map(([id]) => {
      const s = item[id] ?? item.all;
      const file = `${id}/${item.id}.wav`;
      return `<td>${s !== undefined && existsSync(join(dir, file)) ? `${audio(file)}<div class="said">${describe(s)}</div>` : '—'}</td>`;
    });
    return `<tr><th>${esc(item.label)}</th>${cells.join('')}</tr>`;
  });
  return `<h2>${esc(g.title)}</h2><p>${esc(g.note)}</p>
<table><thead><tr><th></th>${engines.map(([, name, lic]) => `<th>${name}<small>${lic}</small></th>`).join('')}</tr></thead><tbody>${rows.join('\n')}</tbody></table>`;
});

writeFileSync(join(dir, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>Mack's voice, round 2</title>
<style>
  body { background: #14161a; color: #d8d4cc; font: 15px/1.45 system-ui, sans-serif; margin: 24px; }
  h1, h2 { font-weight: 600; } h2 { margin-top: 40px; }
  table { border-collapse: collapse; } th, td { border-top: 1px solid #2c3038; padding: 10px 12px; vertical-align: top; text-align: left; }
  tbody th { font-weight: 400; width: 190px; } thead small { display: block; font-weight: 400; color: #8d8a84; }
  figure { display: inline-block; margin: 0 10px 6px 0; } figcaption { font-size: 12px; color: #8d8a84; } audio { width: 250px; height: 32px; }
  .said { font-size: 12px; color: #8d8a84; max-width: 330px; } p { max-width: 820px; color: #a8a49c; }
</style>
<h1>Mack's voice, round 2: what can be controlled</h1>
<h2>Voice candidates</h2>
<p>Seven descriptions, two takes each, from Qwen3-TTS VoiceDesign. The clip you pick becomes the voice: every model clones it.</p>
<table>${voices}</table>
${engines.length ? `<p>The clips below are in these voices: ${engines.map(([id, name]) => `${name}: <b>${esc(usedVoice(id))}</b>`).join(', ')}.</p>` : ''}
${groups.join('\n')}
`);
console.log(`wrote ${join(dir, 'index.html')} (${engines.length} engines)`);
