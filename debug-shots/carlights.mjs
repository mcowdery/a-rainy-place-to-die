// Your car's lights in the city at night: the dipped beam, braking, reversing, the main beam, off, the cockpit's
// view of the road, and up on the expressway. node debug-shots/carlights.mjs <out dir> [query]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/carlights';
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
await page.addInitScript(() => {
  localStorage.setItem('citypop.driveView', 'chase');
  localStorage.setItem('citypop.carLights', 'auto');
});
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=city_garage.front&car=home&clock=23:30&weather=clear${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3500);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
const tap = async (code) => {
  await key(code, true);
  await key(code, false);
};
await page.waitForFunction(() => typeof window.__drive === 'function', null, { timeout: 60000 });
await shot('0_parked_dark');
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2000);
await shot('1_garage_dipped');
// Up on the expressway (the street's list never lit it there): an open road to see the beams on.
await page.evaluate(() => window.__onExpressway?.(40));
await page.waitForTimeout(3000);
await key('KeyS', true);
await page.waitForTimeout(1200);
await key('KeyS', false);
await page.waitForTimeout(1500);
await shot('2_dipped');
await key('KeyZ', true);
await page.waitForTimeout(900);
await shot('3_front');
await key('KeyZ', false);
await page.waitForTimeout(900);
await key('KeyW', true);
await page.waitForTimeout(3000);
await key('KeyW', false);
await key('KeyS', true);
await page.waitForTimeout(300);
await shot('4_braking');
await page.waitForTimeout(3500);
await shot('5_reversing');
await key('KeyS', false);
await page.waitForTimeout(2500);
await tap('KeyF');
await page.waitForTimeout(900);
await shot('6_main_beam');
// The driver's view of the beams.
for (let i = 0; i < 2; i++) await tap('KeyQ');
await page.waitForTimeout(900);
await shot('7_cockpit_main');
await tap('KeyF');
await page.waitForTimeout(900);
await shot('8_cockpit_off');
await tap('KeyF');
await page.waitForTimeout(900);
await shot('9_cockpit_dipped');
console.log(await page.evaluate(() => JSON.stringify({ lamps: Object.fromEntries(Object.entries(window.__own.view.lamps).map(([k, m]) => [k, m.visible])), my: window.__district && [...document.querySelectorAll('canvas')].length })));
await browser.close();
await server.close();
