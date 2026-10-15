// Mack in third person standing by a lamp in Hotel Rouge, seen from the front: is he lit by it?
//   node debug-shots/mackfixture.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/mackfixture';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => { try { localStorage.setItem('rainyplace.thirdPerson', '1'); } catch {} });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=22:30&spawn=hotel_rouge.lobby&people=0`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(7000);
const h = await page.evaluate(() => window.__camera.position.toArray());
// local (u, t) -> world: lobby spawn is u 17, t 5.4
const at = (u, t) => page.evaluate(([x, y, z]) => window.__camera.position.set(x, y, z), [h[0] + (u - 17), h[1], h[2] - (t - 5.4)]);
page.on('console', (m) => { if (m.type() === 'error' && !/Pointer/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const shot = async (n) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${n}.png` }); };
await at(17, 8.0); await shot('lobby_chandelier');
await at(13.6, 5.9); await shot('by_bench_lamp');
await browser.close(); await server.close();
