// A check of the pistol from the driver's window: how near ahead there's a line of fire, the blocked crosshair with
// the gun pulled back, the flash, and the engine's smoke from the cockpit.
// node debug-shots/_lean.mjs <out dir> [parts: aim,hip,smoke]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/lean';
const parts = (process.argv[3] ?? 'aim,hip,smoke').split(',');
const clock = process.argv[4] ?? '14:00';
const spawn = process.argv[5] ?? 'city_garage.front';
const view = process.argv[6] ?? 'chase';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const big = false;
const page = await browser.newPage({ viewport: big ? { width: 1900, height: 1060 } : { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript((v) => localStorage.setItem('rainyplace.driveView', v), view);
if (parts.includes('saloon') || parts.includes('hardtop'))
  await page.addInitScript(() =>
    localStorage.setItem('rainyplace.race.v1.profile', JSON.stringify({ v: 1, yen: 1e6, earned: 0, current: 'car2', cars: [
      { id: 'car1', type: 'hatch', paint: 0xf0f0ec, paint2: 0x121316, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false },
      { id: 'car2', type: 'hardtop', paint: 0x0a0a0c, paint2: null, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false },
    ] })),
  );
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${spawn}&car=home&clock=${clock}&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
let n = 0;
const shot = async (name) => page.screenshot({ path: `${out}/${String(n++).padStart(2, '0')}_${name}.png`, ...(big ? { clip: { x: 600, y: 330, width: 700, height: 520 } } : {}) });
await page.evaluate(() => window.__drive());
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelectorAll('body > div, body > pre').forEach((d) => (d.style.visibility = 'hidden')));
await page.keyboard.down('KeyA');
await page.waitForTimeout(1500);
await shot('cockpit');
for (const [name, yaw, pitch] of [['down', 0, -1.1], ['downleft', 0.5, -1.0], ['downleft2', 1.0, -1.0], ['back', 3.0, -0.4]]) {
  await page.evaluate(([y, p]) => window.__bike.driving.setLook(y, p), [yaw, pitch]);
  await page.waitForTimeout(600);
  await shot(name);
}
await browser.close();
await server.close();
