// Looking round from the driver's seat (the cockpit view): over each shoulder and down, with passengers aboard.
// His eyes swing round his neck (race/driveCam.ts turnedEye), so the view never looks into his own collar.
// node debug-shots/lookback.mjs <out dir> [name] [outfit]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/lookback';
const name = process.argv[3] ?? 'shot';
const outfit = process.argv[4] ?? 'suit_cream';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 2027, height: 774 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript((outfit) => {
  localStorage.setItem('citypop.driveView', 'cockpit');
  localStorage.setItem('citypop.wardrobe', JSON.stringify({ outfit }));
  const car = { id: 'c1', type: 'sports', paint: 0xc01818, paint2: null, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false };
  localStorage.setItem('citypop.race.v1.profile', JSON.stringify({ v: 1, yen: 60000, cars: [car], current: 'c1', earned: 0 }));
}, outfit);
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=kaburo_crossing.view&res=100&clock=14:00&weather=clear&flags=following_koharu,following_detective`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
  for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
});
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(3000);
// [yaw, pitch]: over the left shoulder (the passengers), further, down into the lap, over the right shoulder.
const looks = { left: [1.2, -0.3], back_left: [2.2, -0.45], back_left_level: [2.2, 0], down: [0, -0.6], back_right: [-2.2, -0.45], right: [-1.3, -0.4] };
for (const [n, [yaw, pitch]] of Object.entries(looks)) {
  await page.evaluate(([y, p]) => window.__look(y, p), [yaw, pitch]);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}_${n}.png` });
}
await browser.close();
await server.close();
