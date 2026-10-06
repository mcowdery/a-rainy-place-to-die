// Your car in the city from each driving camera: the cockpit (parked and driving off), the bonnet, chase, far
// chase, bumper; and the bike's two views still working. node debug-shots/citycockpit.mjs <out dir> [query]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/citycockpit';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'cockpit'));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=city_garage.front&car=home${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3500);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
await shot('1_cockpit');
await key('KeyW', true);
await page.waitForTimeout(2200);
await shot('2_cockpit_moving');
await key('KeyW', false);
await key('KeyD', true);
await page.waitForTimeout(500);
await shot('3_cockpit_turning');
await key('KeyD', false);
await key('KeyS', true);
await page.waitForTimeout(1500);
await key('KeyS', false);
await key('KeyZ', true);
await page.waitForTimeout(700);
await shot('4_look_back');
await key('KeyZ', false);
await page.waitForTimeout(700);
for (const n of ['5_hood', '6_bumper', '7_chase', '8_far']) {
  await key('KeyQ', true);
  await key('KeyQ', false);
  await page.waitForTimeout(900);
  await shot(n);
}
await key('KeyQ', true);
await key('KeyQ', false);
await page.waitForTimeout(600);
console.log(await page.evaluate(() => window.__district && JSON.stringify({ fov: window.__camera.fov })));
await browser.close();
await server.close();
