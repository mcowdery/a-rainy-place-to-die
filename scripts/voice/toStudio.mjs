// Voice bench -> Studio: saves the voices made in the bench (debug-shots/voice/bench/voices/) as Studio voices,
// through Studio's own route (POST /api/voices), logged in as .env.krea says.
//   node scripts/voice/toStudio.mjs [--dry-run] [name ...]     no names = every voice in the folder
// Studio keeps a voice's first 30 s as mono 24 kHz and has no place yet for the words spoken in it or the description
// it was designed from, which Fish Audio S2 needs (the words) and a redo needs (the description): those go in
// scripts/voice/studio-voices.json, by the id Studio gave the voice. A voice of the same name already in Studio is left.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, Studio } from '../krea/studio.mjs';

const DIR = path.join(ROOT, 'debug-shots', 'voice', 'bench', 'voices');
const RECORD = path.join(ROOT, 'scripts', 'voice', 'studio-voices.json');
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const only = args.filter((a) => !a.startsWith('--'));
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '');

const studio = new Studio();
const user = await studio.me();
if (!user) throw new Error('Not logged in to Studio: npm run krea:login');
const have = (await studio.request('GET', '/api/voices')).voices ?? [];
console.log(`Studio: ${user.username}, ${have.length} voices`);
const record = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : {};

const names = fs.readdirSync(DIR).filter((f) => f.endsWith('.wav') && !f.includes('.shift')).map((f) => f.slice(0, -4)).filter((n) => !only.length || only.includes(n));
for (const n of names) {
  const name = `${n} (designed)`.slice(0, 40);
  if (have.some((v) => v.name === name)) { console.log(`  ${name}: already there`); continue; }
  if (dry) { console.log(`  ${name}: would add`); continue; }
  const form = new FormData();
  form.append('name', name);
  form.append('file', new Blob([fs.readFileSync(path.join(DIR, `${n}.wav`))], { type: 'audio/wav' }), `${n}.wav`);
  const res = await fetch(studio.cfg.url + '/api/voices', { method: 'POST', headers: { cookie: studio.session.cookie }, body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.log(`  ${name}: FAILED ${res.status} ${JSON.stringify(body.detail ?? body)}`); continue; }
  const v = body.voice ?? body;
  record[v.id] = { name, bench: n, text: read(path.join(DIR, `${n}.txt`)), instruct: read(path.join(DIR, `${n}.instruct`)) };
  console.log(`  ${name}: added as ${v.id} (${v.seconds} s)`);
}
if (!dry) fs.writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
