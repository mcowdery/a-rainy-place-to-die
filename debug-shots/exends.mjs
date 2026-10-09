// The expressway's trimmed ends (expressway.yaml `trim`): the airport branch at Hanejima, the Shiomi branch, the
// Wangan's west end. node debug-shots/exends.mjs [out dir] ['{"name":"x,y,z,yaw,pitch"}'] [query]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/exends';
const shots = JSON.parse(
  process.argv[3] ??
    '{"hanejima":"1075,32,3010,38,-12","hanejima_street":"1044.3,24.8,3082.8,52,-6","hanejima_deck":"1029.2,17,2890,180,-6","shiomi":"3640,34,3080,38,-12","wangan_west":"960,34,2740,-45,-14"}',
);
const query = process.argv[4] ?? 'clock=09:00&weather=clear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  for (const [name, cam] of Object.entries(shots)) {
    await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&res=100&${query}&cam=${cam}`, { timeout: 240000 });
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
    await page.evaluate(() => {
      document.getElementById('overlay').hidden = true;
      for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
    });
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name);
  }
} finally {
  await browser.close();
  await server.close();
}
