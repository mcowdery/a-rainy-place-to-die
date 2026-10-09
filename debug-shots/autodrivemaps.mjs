// The Maps app's auto drive row: at the wheel with a destination marked, pick a way of driving on the phone, then
// take the wheel back with a key. node debug-shots/autodrivemaps.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/autodrive';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=city_garage.front&car=home&clock=14:00&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__auto && window.__phone, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const key = async (code) => page.evaluate((c) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: c }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: c }));
}, code);
const state = () => page.evaluate(() => JSON.stringify(window.__auto.state()));
// N with no destination: it says to mark one.
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1000);
await key('KeyN');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/maps_0_no_destination.png` });
console.log('no destination:', await state());
await page.evaluate(() => window.__gps('kaburo_crossing.view'));
await page.evaluate(() => window.__phone.ui.openApp('maps'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/maps_1_row.png` });
await page.click('.mp-auto button[data-auto="fast"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/maps_2_fast.png` });
console.log('after Fast:', await state());
// N cycles on: fast is the last, so it turns it off; then traffic, slow.
await key('KeyN');
await page.waitForTimeout(300);
console.log('after N:', await state());
await key('KeyN');
await page.waitForTimeout(300);
console.log('after N:', await state());
await key('KeyN');
await page.waitForTimeout(1500);
console.log('after N:', await state());
// A driving key takes the wheel back.
await key('KeyA');
await page.waitForTimeout(400);
console.log('after A:', await state());
await page.screenshot({ path: `${out}/maps_3_wheel_back.png` });
await browser.close();
await server.close();
