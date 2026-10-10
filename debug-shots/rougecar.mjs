// Hotel Rouge's garage car, from where the F9 snapshot was taken and closer to a wheel.
// node debug-shots/rougecar.mjs <out dir> [query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/rougecar';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
const views = [['1_snapshot', '3904.1,1.7,1389.7,123,-12'], ['2_low', '3904.1,1.0,1389.7,123,-20']];
for (const [n, cam] of views) {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=22:42&cam=${cam}${extra}`, { timeout: 240000 });
  await page.waitForFunction(() => /building/.test(document.getElementById('overlay')?.textContent ?? ''), null, { timeout: 240000, polling: 50 });
  await page.waitForFunction(() => window.__district && window.__scene && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
  });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${n}.png` });
}
await browser.close();
await server.close();
