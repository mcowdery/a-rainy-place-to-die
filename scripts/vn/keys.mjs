// The keys a VN story can use (src/vn/keys.ts):
//
//   npm run vn:keys                    list entry keys (npcs, story doors: a frame's entry point) and exit keys
//                                      (spawns: a target exit:<key>), with where they are and any scene they have
//   npm run vn:keys -- --json <file>   write them as JSON (for Studio's destination picker, or anything else)
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { ROOT } from '../krea/studio.mjs';

/** Loads the world and the stories through Vite (they use import.meta.glob), returns the keys. */
export async function loadKeys() {
  const server = await createServer({ root: ROOT, configFile: path.join(ROOT, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  try {
    const mod = await server.ssrLoadModule('/src/vn/keysReport.ts');
    return mod.report();
  } finally {
    await server.close();
  }
}

function print(keys) {
  const byPlace = (rows) => {
    const m = new Map();
    for (const [key, v] of Object.entries(rows)) m.set(v.place, [...(m.get(v.place) ?? []), [key, v]]);
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  };
  const width = Math.max(...Object.keys(keys.entries).map((k) => k.length), ...Object.keys(keys.exits).map((k) => k.length)) + 2;
  const floor = (f) => (f ? `  (${f} m)` : '');
  console.log('ENTRY KEYS: set a frame\'s entry point to one of these (talk to / use it in the city -> that frame)\n');
  for (const [place, rows] of byPlace(keys.entries)) {
    console.log(`  ${place}`);
    for (const [key, v] of rows) console.log(`    ${key.padEnd(width)}${v.kind.padEnd(8)}${v.name}${floor(v.floor)}${v.scene ? `   -> ${v.scene}` : ''}`);
  }
  console.log('\nEXIT KEYS: a choice or hotspot target exit:<key> returns you to that spot in the city\n');
  for (const [place, rows] of byPlace(keys.exits)) {
    console.log(`  ${place}`);
    for (const [key, v] of rows) console.log(`    ${key.padEnd(width)}${v.name}${floor(v.floor)}`);
  }
  const n = Object.keys(keys.entries).length;
  const done = Object.values(keys.entries).filter((v) => v.scene).length;
  console.log(`\n${n} entry keys (${done} with a scene), ${Object.keys(keys.exits).length} exit keys.`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('keys.mjs')) {
  const keys = await loadKeys();
  const i = process.argv.indexOf('--json');
  if (i > 0) {
    const out = path.resolve(process.argv[i + 1] ?? 'vn-keys.json');
    fs.writeFileSync(out, JSON.stringify(keys, null, 2) + '\n');
    console.log(`Wrote ${Object.keys(keys.entries).length} entry keys and ${Object.keys(keys.exits).length} exit keys to ${out}`);
  } else print(keys);
}
