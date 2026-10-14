// The 1970s cars (models/vehicles.ts SEVENTIES_TYPES) close up in the cars showroom: each car three ways, labels off.
//   node debug-shots/cars70.mjs [out dir] [--night]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'debug-shots/cars70';
const night = process.argv.includes('--night');
mkdirSync(out, { recursive: true });
// The row: coupe70, box70, kei70, hardtop, from x -9 by 8 (the alt paint 3.6 on, the rear-facing one at z 27).
const CARS = [['coupe', -9], ['box', -1], ['kei', 7], ['hardtop', 15]];
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.goto(`${server.resolvedUrls.local[0]}models-cars.html`, { timeout: 300000 });
  await page.waitForFunction(() => typeof window.__view === 'function', null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(5000);
  if (night) await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(800);
  for (const [name, x] of CARS) {
    for (const [view, args] of [
      ['front', [x, 0.8, 20, 6.2, 0.75, 0.25, 1]],
      ['side', [x, 0.8, 20, 6.2, 1, 0.12, 0.05]],
      ['rear', [x, 0.8, 27, 6.2, 0.75, 0.25, -1]],
      ['alt', [x + 3.6, 0.8, 20, 6.2, 0.75, 0.25, 1]],
    ]) {
      await page.evaluate((a) => window.__focusAt(...a), args);
      await page.waitForTimeout(2400);
      await page.screenshot({ path: `${out}/${name}-${view}.png`, clip: { x: 0, y: 0, width: 1010, height: 760 } });
    }
    console.log(name);
  }
} finally {
  await browser.close();
  await server.close();
}
