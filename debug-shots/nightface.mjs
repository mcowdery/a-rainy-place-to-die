import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html`);
await page.waitForTimeout(9000);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const x = await page.evaluate(() => { const c = window.__mob.scene.getObjectByName('character:mack'); return c ? c.position.x : null; });
console.log('mack x', x);
for (const [k, name] of [['Digit2', 'night'], ['Digit3', 'day']]) {
  await page.keyboard.press(k);
  await page.evaluate((x) => { __view(x + 0.25, 1.85, 38 + 0.7, x, 1.78, 38); }, x ?? 0);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/face_${name}.png` });
  await page.evaluate((x) => { __view(x + 0.9, 1.5, 38 + 2.6, x, 1.1, 38); }, x ?? 0);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/body_${name}.png` });
}
await browser.close(); await server.close();
