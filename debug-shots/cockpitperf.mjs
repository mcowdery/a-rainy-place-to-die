// Frame times at the wheel of your car in the city, by camera: GPU and CPU (ms, the mean of 180 frames), parked
// on the street facing the crossing. node debug-shots/cockpitperf.mjs [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ? `&${process.argv[2]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=kaburo_crossing.view&res=100${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3000);
await page.evaluate(() => window.__drive());
const key = async (code) => page.evaluate((c) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
}, code);
const measure = async (label) => {
  await page.waitForTimeout(6000);
  const r = await page.evaluate(() => {
    const p = window.__perf;
    const mean = (a) => a.slice(-180).reduce((s, x) => s + x, 0) / Math.max(1, Math.min(180, a.length));
    return { gpu: mean(p.gpu).toFixed(2), cpu: mean(p.cpu).toFixed(2) };
  });
  console.log(label, JSON.stringify(r));
};
await page.waitForTimeout(6000);
await measure('chase');
for (const v of ['far', 'cockpit', 'hood', 'bumper', 'chase']) {
  await key('KeyQ');
  await measure(v);
}
await browser.close();
await server.close();
