// The rooms behind the windows, for review (real/windowScenes.ts, windowAtlas.ts): a contact sheet of every scene by
// kind, each with its two frames, its cell number, id and what it is; and how long the whole atlas takes to paint.
//   node debug-shots/windowsheet.mjs [out dir] [kinds: home,office,... or all] [vite mode: demo | uncensored]
// (No city: the scenes are painted on their own in a blank page, so it takes seconds.)
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/windowpeople/sheets';
mkdirSync(out, { recursive: true });
const want = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : null;
const mode = process.argv[4];
const server = await shotServer({ mode, server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}debug-shots/blank.html`, { waitUntil: 'domcontentloaded' }).catch(() => {});
// (`ground`: the shady shops' rooms at street level.)
const GROUND = ['g_cabaret', 'g_hostess', 'g_host', 'g_cards', 'g_loan', 'g_lobby', 'g_slumped', 'g_exchange'];
const groups = [['home', 'home_tv'], ['office'], ['hotel'], ['den'], ['v_home'], ['v_office'], ['v_hotel', 'v_love'], ['v_den'], GROUND].filter((g) => !want || g.some((c) => want.includes(c)) || (g === GROUND && want.includes('ground')));
const info = await page.evaluate(async () => {
  const atlas = await import('/src/poc3d/real/windowAtlas.ts');
  const first = atlas.paintWindowAtlas();
  const again = atlas.paintWindowAtlas();
  return { scenes: first.scenes.length, ids: first.scenes.map((s) => s.id), width: first.width, height: first.height, coldMs: first.ms, ms: again.ms };
});
console.log(`${info.scenes} scenes in ${info.width}x${info.height} px · painted in ${info.coldMs} ms (the first time, building the figures' templates), ${info.ms} ms again`);
for (const g of groups) {
  const url = await page.evaluate(async (cats) => {
    const atlas = await import('/src/poc3d/real/windowAtlas.ts');
    return atlas.windowContactSheet(cats, 96, 2).toDataURL('image/png');
  }, g);
  const file = `${out}/${mode ? `${mode}_` : ''}${g === GROUND ? 'ground' : g[0]}.png`;
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log(file);
}
await browser.close();
await server.close();
