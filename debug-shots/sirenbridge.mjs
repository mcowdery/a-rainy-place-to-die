// The beacon's red on a street bridge's deck (the decks are outside the city shader: real/sea.ts `snowy`).
// node debug-shots/sirenbridge.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/sirenbridge';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600));
});
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=${process.argv[3] ?? 'night'}&cam=4853,3,2047,-154,-8`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/0_off.png` });
// The car brought to the bridge with its beacon on (set at once, not by hand).
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
await page.evaluate(() => window.__siren.set('lights'));
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/1_on_a.png` });
await page.waitForTimeout(210);
await page.screenshot({ path: `${out}/1_on_b.png` });
await browser.close();
await server.close();
