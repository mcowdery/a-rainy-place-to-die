// Downloads reference models from Sketchfab into refs/models/<name>/ (git-ignored: refs/README.md): models to look at
// and measure, never to use in the game. Sketchfab only gives a download to a logged-in account, so this needs your
// API token (sketchfab.com → Settings → Password & API → API token) in `.env.sketchfab` at the repo's root, one line:
//   SKETCHFAB_TOKEN=xxxxxxxx
// (git-ignored). A model that is sold, or whose author hasn't allowed downloads, is reported and skipped.
//   node scripts/refs/sketchfab.mjs <model page URL or id> [...]
// Each model gets its archives as Sketchfab offers them (the author's own files as `source`, and glTF, which keeps the
// skeleton and the skin's weights), unzipped, and an `info.json` (name, author, licence, sizes, the page).
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = join(root, '.env.sketchfab');
const token = process.env.SKETCHFAB_TOKEN ?? (existsSync(envFile) ? /SKETCHFAB_TOKEN\s*=\s*(\S+)/.exec(readFileSync(envFile, 'utf8'))?.[1] : undefined);
const ids = process.argv.slice(2).map((a) => /([0-9a-f]{32})\/?$/.exec(a)?.[1]).filter(Boolean);
if (!ids.length) {
  console.log('usage: node scripts/refs/sketchfab.mjs <model page URL or id> [...]');
  process.exit(1);
}
if (!token) {
  console.log('No token: put SKETCHFAB_TOKEN=... in .env.sketchfab (see this script\'s header).');
  process.exit(1);
}
const api = async (path, auth = false) => {
  const r = await fetch(`https://api.sketchfab.com/v3/${path}`, auth ? { headers: { Authorization: `Token ${token}` } } : undefined);
  return { status: r.status, body: r.ok ? await r.json() : null };
};
for (const id of ids) {
  const { body: m } = await api(`models/${id}`);
  if (!m) {
    console.log(`${id}: not found`);
    continue;
  }
  const name = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || id;
  if (!m.isDownloadable) {
    console.log(`${m.name}: no download${m.price ? ` (sold, ${(m.price / 100).toFixed(2)} USD)` : ''}; skipped`);
    continue;
  }
  const { status, body: d } = await api(`models/${id}/download`, true);
  if (!d) {
    console.log(`${m.name}: the download was refused (${status}); is the token right?`);
    continue;
  }
  const dir = join(root, 'refs', 'models', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'info.json'), JSON.stringify({ name: m.name, page: m.viewerUrl, author: m.user?.displayName, licence: m.license?.label, faces: m.faceCount, vertices: m.vertexCount, animations: m.animationCount, fetched: new Date().toISOString() }, null, 2));
  for (const [kind, f] of Object.entries(d)) {
    if (!f?.url || kind === 'usdz') continue;
    const zip = join(dir, kind === 'glb' ? 'model.glb' : `${kind}.zip`);
    const r = await fetch(f.url);
    if (!r.ok) {
      console.log(`${m.name}: ${kind} failed (${r.status})`);
      continue;
    }
    await pipeline(Readable.fromWeb(r.body), createWriteStream(zip));
    // (A .glb comes as itself, not zipped; the others unzip beside the archive. On Windows with its own tar: the one
    // Git Bash has reads "C:" as another machine.)
    if (kind === 'glb') {
      console.log(`${m.name}: glb ${(f.size / 1e6).toFixed(1)} MB -> refs/models/${name}/model.glb`);
      continue;
    }
    const out = join(dir, kind);
    mkdirSync(out, { recursive: true });
    try {
      execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', out]);
    } catch {
      console.log(`  (${kind}.zip kept as it is: not an archive tar can open)`);
    }
    console.log(`${m.name}: ${kind} ${(f.size / 1e6).toFixed(1)} MB -> refs/models/${name}/${kind}/`);
  }
}
