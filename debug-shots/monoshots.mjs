// The monorail car in the transit showroom: node debug-shots/monoshots.mjs [out dir]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/monocar';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}models-transit.html`);
  await page.waitForFunction(() => !!window.__view, null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  const mx = -18;
  const views = {
    side: [mx + 14, 4.5, 40, mx, 2.6, 6],
    nose: [mx + 7, 3, 36, mx, 2.4, 28],
    nose_front: [mx, 3, 42, mx, 2.4, 28],
    inside: [mx, 3.5, 6, mx, 3.3, -6],
    cab: [mx, 3.5, 20, mx, 3.3, 32],
    under: [mx + 6, 0.6, 14, mx, 1.4, 6],
  };
  for (const [name, v] of Object.entries(views)) {
    await page.evaluate((v) => window.__view(...v), v);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  // The same at night (key 2) and by day (3).
  for (const [key, tag] of [['Digit2', 'night'], ['Digit3', 'day']]) {
    await page.keyboard.press(key);
    for (const name of ['side', 'nose', 'inside']) {
      await page.evaluate((v) => window.__view(...v), views[name]);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${name}_${tag}.png` });
    }
  }
} finally {
  await browser.close();
  await server.close();
}
