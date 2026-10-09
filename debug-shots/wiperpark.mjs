// The wipers parked and sweeping in light rain, from the driver's seat of the coupe (wide, as the game is played).
// node debug-shots/wiperpark.mjs <out dir> [name] [query]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/wiperpark';
const name = process.argv[3] ?? 'shot';
const query = process.argv[4] ?? 'weather=rain&rain=0.15&wet=1&clock=23:00';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 2027, height: 774 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400));
});
await page.addInitScript(() => {
  localStorage.setItem('citypop.driveView', 'cockpit');
  const car = { id: 'c1', type: 'sports', paint: 0xc01818, paint2: null, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false };
  localStorage.setItem('citypop.race.v1.profile', JSON.stringify({ v: 1, yen: 60000, cars: [car], current: 'c1', earned: 0 }));
});
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=kaburo_crossing.view&res=100&${query}`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
  for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
});
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
for (let i = 0; i < 6; i++) {
  await page.screenshot({ path: `${out}/${name}_${i}.png` });
  await page.waitForTimeout(420);
}
await browser.close();
await server.close();
