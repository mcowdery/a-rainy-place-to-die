// Windscreen wipers in the rain: from the driver's seat (a few frames through a sweep, standing and moving), your
// car's windscreen from outside in front, and the traffic's at the crossing.
// node debug-shots/wipers.mjs <out dir> [name] [query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/wipers';
const name = process.argv[3] ?? 'shot';
const extra = process.argv[4] ? `&${process.argv[4]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 500));
});
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'cockpit'));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=kaburo_crossing.view&weather=rain&rain=0.7&wet=1&res=100&clock=14:00${extra}`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
  for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
});
await page.waitForTimeout(2500);
const shot = (n) => page.screenshot({ path: `${out}/${name}_${n}.png` });
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
for (let i = 0; i < 5; i++) {
  await shot(`cockpit_${i}`);
  await page.waitForTimeout(230);
}
await key('KeyW', true);
await page.waitForTimeout(2600);
for (let i = 0; i < 3; i++) {
  await shot(`cockpit_moving_${i}`);
  await page.waitForTimeout(260);
}
await key('KeyW', false);
await key('KeyS', true);
await page.waitForTimeout(2500);
await key('KeyS', false);
// Outside, in front of your car: the chase view looking back (Z held), big, to crop the windscreen from; the
// blades on the glass and the fans they clear.
await page.setViewportSize({ width: 1920, height: 1080 });
for (let i = 0; i < 3; i++) {
  await key('KeyQ', true);
  await key('KeyQ', false);
}
await key('KeyZ', true);
await page.waitForTimeout(1500);
for (let i = 0; i < 4; i++) {
  await shot(`front_${i}`);
  await page.waitForTimeout(260);
}
await key('KeyZ', false);
// On foot at the kerb: the traffic's.
await key('KeyE', true);
await key('KeyE', false);
await page.waitForTimeout(6000);
for (let i = 0; i < 3; i++) {
  await shot(`traffic_${i}`);
  await page.waitForTimeout(1500);
}
console.log(await page.evaluate(() => JSON.stringify({ wipers: window.__tracks?.wipers?.value })));
await browser.close();
await server.close();
