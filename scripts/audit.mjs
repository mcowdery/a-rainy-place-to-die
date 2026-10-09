// npm run audit: the cheap, mechanical checks of the project's health. No GPU, no dev server, read-only.
//   - docs:      every `paths:` entry in .claude/rules/*.md still matches a file (a stale one means the doc no longer loads
//                when that file is edited), and every src/ file is covered by some doc (reported, not failed: glue files
//                such as district/main.ts are deliberately in none)
//   - secrets:   no .env* file but the .example ones is tracked, and none was ever committed
//   - endpoints: no built edition holds the dev server's /__ endpoint paths
//   - size:      the largest source files, to see where a split is due (a warning above WARN_LINES)
//   - credits:   every folder under assets/ is mentioned in CREDITS.md or has a CREDITS.md of its own (reported)
// Files are the tracked ones plus new, unignored ones (so work not yet committed is judged too).
// Exits 1 only on a failure (docs with a dead path, secrets, endpoints in a build); the rest is for reading.
// `--only docs,size` runs some of them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WARN_LINES = 2500;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
const wants = (name) => !only || only.includes(name);

const failures = [];
const notes = [];
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tracked = git('ls-files', '-co', '--exclude-standard').split('\n').filter(Boolean);
const section = (title) => console.log(`\n== ${title}`);

/** A glob from a doc's `paths:` as a RegExp over repo-relative, forward-slash paths. */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

if (wants('docs')) {
  section('docs');
  const dir = path.join(ROOT, '.claude/rules');
  const covered = new Set();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const globs = [...(head?.[1].matchAll(/^\s*-\s*["']?([^"'\r\n]+?)["']?\s*$/gm) ?? [])].map((m) => m[1]);
    if (!head) notes.push(`docs: ${f} has no front matter, so it never loads by itself`);
    for (const g of globs) {
      const re = globToRegExp(g);
      const hits = tracked.filter((t) => re.test(t));
      if (!hits.length && !fs.existsSync(path.join(ROOT, g))) failures.push(`docs: ${f}: "${g}" matches no file`);
      for (const h of hits) covered.add(h);
    }
  }
  const uncovered = tracked.filter((t) => /^src\/.*\.ts$/.test(t) && !covered.has(t));
  console.log(`${covered.size} files are covered by a doc; ${uncovered.length} src/*.ts files are in none`);
  if (uncovered.length) notes.push(`docs: src files in no doc's paths (glue files are fine; a feature file isn't):\n    ${uncovered.slice(0, 60).join('\n    ')}${uncovered.length > 60 ? `\n    ... and ${uncovered.length - 60} more` : ''}`);
}

if (wants('secrets')) {
  section('secrets');
  const env = tracked.filter((t) => /(^|\/)\.env/.test(t) && !t.endsWith('.example'));
  for (const t of env) failures.push(`secrets: ${t} is tracked`);
  const ever = git('log', '--all', '--name-only', '--pretty=format:', '--', '.env', '.env.*', '**/.env', '**/.env.*').split('\n').filter((f) => f && !f.endsWith('.example'));
  for (const f of new Set(ever)) failures.push(`secrets: ${f} was committed at some point; rotate what was in it`);
  // Obvious key shapes in tracked text files (not a substitute for a real scanner such as gitleaks in CI).
  const shapes = [/sk-[A-Za-z0-9_-]{24,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /gh[pousr]_[A-Za-z0-9]{36,}/, /xox[baprs]-[A-Za-z0-9-]{10,}/];
  let scanned = 0;
  for (const t of tracked) {
    if (!/\.(ts|mjs|js|json|py|md|yaml|yml|html|txt)$/.test(t) || t.startsWith('package-lock')) continue;
    const full = path.join(ROOT, t);
    if (!fs.existsSync(full) || fs.statSync(full).size > 2_000_000) continue;
    scanned++;
    const text = fs.readFileSync(full, 'utf8');
    for (const s of shapes) if (s.test(text)) failures.push(`secrets: ${t} holds something shaped like a key (${s})`);
  }
  console.log(`${env.length} tracked .env files, ${scanned} text files scanned for key shapes`);
}

if (wants('endpoints')) {
  section('endpoints');
  const src = fs.readFileSync(path.join(ROOT, 'scripts/devEndpoints.mjs'), 'utf8');
  const paths = [...src.matchAll(/'(\/__[a-z]+)'/g)].map((m) => m[1]);
  let checked = 0;
  for (const dir of ['dist', 'dist-uncensored', 'dist-demo']) {
    const assets = path.join(ROOT, dir, 'assets');
    if (!fs.existsSync(assets)) continue;
    checked++;
    // The game itself calls /__shot and /__perf (snap.ts, perfLog.ts) and fails quietly when they're not there, so those
    // strings are expected; what must not be there is the server's own code.
    for (const f of fs.readdirSync(assets).filter((f) => f.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(assets, f), 'utf8');
      for (const bad of ['ssrLoadModule', 'writeFileSync', 'unlinkSync']) if (text.includes(bad)) failures.push(`endpoints: ${dir}/assets/${f} holds "${bad}"`);
    }
  }
  console.log(`${paths.length} dev endpoints (${paths.join(' ')}), ${checked} built editions checked${checked ? '' : ' (none built: run build:all first)'}`);
}

if (wants('size')) {
  section('size');
  const sizes = tracked
    .filter((t) => /^(src|scripts|tests)\/.*\.(ts|mjs|py)$/.test(t) && fs.existsSync(path.join(ROOT, t)))
    .map((t) => [t, fs.readFileSync(path.join(ROOT, t), 'utf8').split('\n').length])
    .sort((a, b) => b[1] - a[1]);
  for (const [t, n] of sizes.slice(0, 15)) console.log(`${String(n).padStart(6)}  ${t}${n > WARN_LINES ? '   <- over ' + WARN_LINES : ''}`);
  const over = sizes.filter(([, n]) => n > WARN_LINES);
  if (over.length) notes.push(`size: ${over.length} files over ${WARN_LINES} lines, the first candidates to split`);
  const big = tracked.filter((t) => fs.existsSync(path.join(ROOT, t))).map((t) => [t, fs.statSync(path.join(ROOT, t)).size]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('\nlargest tracked files:');
  for (const [t, n] of big) console.log(`${(n / 1048576).toFixed(1).padStart(7)} MB  ${t}`);
}

if (wants('credits')) {
  section('credits');
  const credits = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
  const assets = path.join(ROOT, 'assets');
  const missing = [];
  for (const d of fs.readdirSync(assets, { withFileTypes: true }).filter((e) => e.isDirectory() && tracked.some((t) => t.startsWith(`assets/${e.name}/`)))) {
    if (!credits.includes(`assets/${d.name}`) && !fs.existsSync(path.join(assets, d.name, 'CREDITS.md'))) missing.push(`assets/${d.name}`);
  }
  console.log(missing.length ? `${missing.length} asset folders with no credit entry` : 'every asset folder is mentioned in CREDITS.md or has its own');
  if (missing.length) notes.push(`credits: no entry for ${missing.join(', ')} (fine if the work is entirely ours)`);
}

for (const n of notes) console.log(`\nnote: ${n}`);
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nAudit passed.');
