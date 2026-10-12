// Close side views of the animals in the showroom rooms: node debug-shots/faunaclose.mjs <out dir>
// Views are [room, name, x, y, z, size]; the camera looks along the animals' side (they face 0.6 rad).
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/fauna/close';
mkdirSync(out, { recursive: true });
const S = 3.4;
const P = 1.7;
// [room, name, column, pose row, height, size]: one animal each, from the side.
const VIEWS = [
  ['fauna-ph', 'cat-stand', 4, 0, 0.2, 1.0], ['fauna-ph', 'cat-sit', 4, 1, 0.2, 1.0], ['fauna-ph', 'cat-loaf', 4, 2, 0.15, 1.0], ['fauna-ph', 'cat-run', 4, 4, 0.2, 1.0],
  ['fauna-ph', 'dog-stand', 5, 0, 0.3, 1.5], ['fauna-ph', 'dog-sit', 5, 1, 0.3, 1.5], ['fauna-ph', 'dog-run', 5, 4, 0.3, 1.5],
  ['fauna-ph', 'hen', 6, 0, 0.2, 1.0], ['fauna-ph', 'egret', 2, 0, 0.4, 1.6],
  ['fauna', 'crow-stand', 2, 0, 0.15, 0.9], ['fauna', 'crow-fly', 2, 3, 1.5, 1.4], ['fauna', 'pigeon', 1, 0, 0.12, 0.8], ['fauna', 'gull-fly', 3, 3, 1.5, 1.4], ['fauna', 'butterfly', -4.4, 0, 1.6, 0.5],
];
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let room = '';
let page;
for (const [r, name, col, row, y, size] of VIEWS) {
  // (A column below 0 is the air group: the first animal there, row counting along it.)
  const x = col < 0 ? 2 - col - 1 : col * S;
  const z = col < 0 ? 14.6 : row * P;
  if (r !== room) {
    if (page) await page.close();
    room = r;
    page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
    await page.goto(`${server.resolvedUrls.local[0]}models-${r}.html`, { timeout: 300000 });
    await page.waitForFunction(() => typeof window.__focusAt === 'function', null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(3000);
  }
  await page.evaluate((v) => window.__focusAt(...v), [x, y, z, size, 0.83, 0.1, -0.56]);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${r}-${name}.png` });
  console.log('shot', r, name);
}
await browser.close();
await server.close();
