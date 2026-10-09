// The mega-sign's screens from the crossing, a shot every few seconds through the ads' cycle.
// node debug-shots/megasign.mjs <out dir> <name> [shots] [gap ms]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/megasign';
const name = process.argv[3] ?? 'shot';
const shots = Number(process.argv[4] ?? 15);
const gap = Number(process.argv[5] ?? 3500);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1650, height: 1281 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
setTimeout(() => { console.log('TIMEOUT: gave up after 9 minutes'); process.exit(2); }, 540000).unref();
console.log('loading');
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&clock=22:06&cam=3831.5,1.7,1551.7,-53,14`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
console.log('ready');
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/${name}_full.png` });
for (let i = 0; i < shots; i++) {
  await page.screenshot({ path: `${out}/${name}_${String(i).padStart(2, '0')}.png`, clip: { x: 150, y: 250, width: 750, height: 620 } });
  await page.waitForTimeout(gap);
}
await browser.close();
await server.close();
