// The traffic's wipers in the rain: the camera put just ahead of the nearest car in traffic (the page keeps
// walking it nowhere), a few frames through a sweep. node debug-shots/trafficwipers.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/wipers';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=kaburo_crossing.view&weather=rain&rain=0.7&wet=1&res=100&clock=14:00&fly=1`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
  for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
});
await page.waitForTimeout(4000);
for (let i = 0; i < 6; i++) {
  const info = await page.evaluate(() => {
    const cam = window.__camera;
    const cars = window.__traffic.vehicles.filter((v) => !v.bus && v.mode === 'traffic' && v.live && v.carType);
    window.__pick ??= cars.sort((a, b) => Math.hypot(a.x - cam.position.x, a.z - cam.position.z) - Math.hypot(b.x - cam.position.x, b.z - cam.position.z))[0];
    const v = window.__pick;
    // Ahead of its bonnet and a little to its left, looking back at the windscreen.
    cam.position.set(v.x + v.dx * 3.6 + v.dz * 0.5, v.obj.position.y + 1.55, v.z + v.dz * 3.6 - v.dx * 0.5);
    window.__look((Math.atan2(v.dx, v.dz) * 180) / Math.PI, -12);
    return `${v.label} ${v.carType} v=${v.v.toFixed(1)}`;
  });
  await page.waitForTimeout(60);
  await page.screenshot({ path: `${out}/traffic_close_${i}.png` });
  if (i === 0) console.log(info);
  await page.waitForTimeout(200);
}
await browser.close();
await server.close();
