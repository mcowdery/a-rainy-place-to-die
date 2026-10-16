// Auto drive in the city: from the garage to a place, each way of driving; logs how it goes every few seconds and
// photographs it now and then. node debug-shots/autodrive.mjs <out dir> [mode] [node id] [query] [bike id]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/autodrive';
const mode = process.argv[3] ?? 'traffic';
const dest = process.argv[4] ?? 'kaburo_crossing.view';
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&clock=14:00&weather=clear${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__auto, null, { timeout: 60000 });
await page.waitForTimeout(3000);
// (A bike instead of the car: node debug-shots/autodrive.mjs <dir> <mode> <node> "" cruiser)
const bike = process.argv[6];
console.log(await page.evaluate((b) => (b ? window.__ride(b) : window.__drive()), bike));
await page.waitForTimeout(1500);
console.log('gps', await page.evaluate((d) => window.__gps(d), dest));
await page.evaluate((m) => window.__auto.set(m), mode);
const state = () =>
  page.evaluate(() => {
    const o = window.__bike?.riding()?.own ?? window.__own;
    return { auto: window.__auto.state(), at: [Math.round(o.sim.x), Math.round(o.sim.z)], kmh: Math.round(o.sim.u * 3.6), damage: Math.round(o.condition * 10) / 10, dash: [...document.querySelectorAll('div')].map((d) => d.textContent).find((t) => /km\/h {2}/.test(t ?? ''))?.trim() };
  });
let n = 0;
for (let t = 0; t < 420; t += 4) {
  await page.waitForTimeout(4000);
  const s = await state();
  console.log(t + 4, JSON.stringify(s));
  if (n < 12 && (t % 24 === 0 || !s.auto)) await page.screenshot({ path: `${out}/${mode}${bike ? `_${bike}` : ''}_${String(n++).padStart(2, '0')}.png` });
  if (!s.auto) break;
}
await browser.close();
await server.close();
