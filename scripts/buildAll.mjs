// npm run build:all: typecheck once, build every edition (standard into dist/, uncensored into dist-uncensored/,
// demo into dist-demo/; src/edition/types.ts), then check each build holds only what its edition should:
//   - the demo: none of DEMO_HIDDEN_ART's images or DEMO_HIDDEN_CHARACTERS' models, no VN stills, no story text
//     (scenes, and chats other than KAIWA's welcome), no age check;
//   - standard and demo: nothing from adult/ (its files by name, its overlays' text), no age check;
//   - uncensored: the age check;
//   - every build: the __EDITION__ define replaced everywhere.
// Exits 1 on any problem, listing them all.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (label, args) => {
  console.log(`\n== ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`${label} failed`);
    process.exit(1);
  }
};

run('typecheck', ['node_modules/typescript/bin/tsc']);
const BUILDS = { standard: 'dist', uncensored: 'dist-uncensored', demo: 'dist-demo' };
for (const [mode, dir] of Object.entries(BUILDS)) run(`build ${mode} -> ${dir}/`, ['node_modules/vite/bin/vite.js', 'build', '--mode', mode, '--logLevel', 'warn']);

// ---- What to look for.
const files = (dir, test = () => true) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter(test).map((f) => path.join(dir, f)) : []);
/** Text worth searching a bundle for: long enough to be telling, plain ASCII so bundling can't have escaped it. */
const searchable = (s) => typeof s === 'string' && s.length >= 12 && /^[\x20-\x7e]+$/.test(s) && !/["'\\`]/.test(s);
const texts = new Set();
const collect = (v, into) => {
  if (Array.isArray(v)) for (const x of v) collect(x, into);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === 'text' || k === 'caption' ? searchable(x) && into.add(x) : collect(x, into));
};
const storyText = new Set();
for (const f of files(path.join(ROOT, 'content/vn'), (f) => f.endsWith('scene.json'))) collect(JSON.parse(fs.readFileSync(f, 'utf8')).frames, storyText);
for (const f of files(path.join(ROOT, 'content/phone'), (f) => f.endsWith('.yaml') && path.basename(f) !== 'kaiwa.yaml')) collect(YAML.parse(fs.readFileSync(f, 'utf8')), storyText);
const adultText = new Set();
for (const f of files(path.join(ROOT, 'adult/content'), (f) => f.endsWith('scene.json'))) collect(JSON.parse(fs.readFileSync(f, 'utf8')).frames, adultText);
for (const f of files(path.join(ROOT, 'adult/content'), (f) => f.endsWith('.yaml'))) collect(YAML.parse(fs.readFileSync(f, 'utf8')), adultText);
const adultFiles = files(path.join(ROOT, 'adult/content'), (f) => /\.(jpe?g|png|webp|gif|mp4|webm)$/i.test(f)).map((f) => path.parse(f).name);
const hiddenArt = [...fs.readFileSync(path.join(ROOT, 'src/edition/demoArt.ts'), 'utf8').matchAll(/'(\d{2}_[a-z0-9_]+)'/g)].map((m) => m[1]);
const hiddenCharacters = [...(fs.readFileSync(path.join(ROOT, 'src/edition/demoArt.ts'), 'utf8').match(/DEMO_HIDDEN_CHARACTERS.*/)?.[0] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
const vnStill = /^s\d+\.fr\d+/;

// ---- Check each build.
const problems = [];
for (const [mode, dir] of Object.entries(BUILDS)) {
  const assets = fs.readdirSync(path.join(ROOT, dir, 'assets'));
  const js = assets.filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(ROOT, dir, 'assets', f), 'utf8')).join('\n');
  const bad = (what) => problems.push(`${dir}/: ${what}`);
  const shipped = (name) => assets.some((f) => f.startsWith(`${name}-`) || f.startsWith(`${name}.`));
  if (js.includes('__EDITION__')) bad('__EDITION__ left unreplaced');
  const gate = js.includes('ADULTS ONLY');
  if (mode === 'uncensored' && !gate) bad('no age check');
  if (mode !== 'uncensored') {
    if (gate) bad('has the age check');
    for (const n of adultFiles) if (shipped(n)) bad(`ships adult/ file ${n}`);
    for (const t of adultText) if (js.includes(t)) bad(`has uncensored text "${t.slice(0, 40)}"`);
  }
  if (mode === 'demo') {
    for (const n of hiddenArt) if (shipped(n)) bad(`ships hidden art ${n}`);
    for (const n of hiddenCharacters) if (shipped(n)) bad(`ships hidden model ${n}`);
    for (const f of assets) if (vnStill.test(f)) bad(`ships VN still ${f}`);
    for (const t of storyText) if (js.includes(t)) bad(`has story text "${t.slice(0, 40)}"`);
  }
  console.log(`${dir}/: ${assets.length} files${mode === 'demo' ? `, checked against ${hiddenArt.length} hidden images and ${storyText.size} story lines` : ''}${mode !== 'uncensored' ? `, ${adultFiles.length} adult/ files and ${adultText.size} uncensored lines` : ''}`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nAll three editions built, and each holds only its own files.');
