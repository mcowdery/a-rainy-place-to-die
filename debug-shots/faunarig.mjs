// The rigged animals in the Tōto room, two shots a third of a second apart each: node debug-shots/faunarig.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/fauna/rig';
mkdirSync(out, { recursive: true });
const COL = 3.0, ROW = 2.6, ROWS = 21, depth = (ROWS - 1) * ROW;
const rowZ = (i) => depth - i * ROW;
// [name, column, row, size]: the cat's animated candidates start at column 7, the gull's at 5
const VIEWS = [['cat-walk', 7, 4, 5], ['cat-run', 8, 4, 5], ['cat-sit', 10, 4, 5], ['cat-loaf', 11, 4, 5], ['gull-flap', 5, 3, 6], ['gull-glide', 6, 3, 6]];
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'warning' && /candidate/i.test(m.text())) console.log('WARN', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}models-fauna.html`, { timeout: 300000 });
await page.waitForFunction(() => typeof window.__focusAt === 'function', null, { timeout: 300000, polling: 500 });
await page.waitForTimeout(6000);
for (const [name, c, r, size] of VIEWS) {
  await page.evaluate((v) => window.__focusAt(...v), [c * COL, 0.5 + (name.startsWith('gull') ? 1.4 : 0), rowZ(r), size, 0.9, 0.25, 1]);
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}/${name}-a.png` });
  await page.waitForTimeout(330);
  await page.screenshot({ path: `${out}/${name}-b.png` });
  console.log('shot', name);
}
await browser.close();
await server.close();
