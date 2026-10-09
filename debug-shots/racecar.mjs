// Mack at the wheel on the race page: chase view, aiming out of the driver's window, across the car, a shot,
// and close-ups of the open windows. node debug-shots/racecar.mjs <out dir> [venue]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const venue = process.argv[3] ?? 'kurokami';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=${venue}&mode=free`);
await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await shot('c1_chase');
// From the side, close: Mack at the wheel, windows up.
const around = async (n, dx, dy, dz, ty = 1.0) => {
  await page.evaluate(([dx, dy, dz, ty]) => {
    const R = window.__race;
    const c = R.car;
    const f = { x: Math.sin(c.h), z: Math.cos(c.h) };
    const l = { x: Math.cos(c.h), z: -Math.sin(c.h) };
    R.freezeCam = true;
    const p = { x: c.x + f.x * dz + l.x * dx, y: c.y + dy, z: c.z + f.z * dz + l.z * dx };
    R.camera.position.set(p.x, p.y, p.z);
    R.camera.lookAt(c.x, c.y + ty, c.z);
  }, [dx, dy, dz, ty]);
  await page.waitForTimeout(250);
  await shot(n);
  await page.evaluate(() => { window.__race.freezeCam = false; });
};
await around('c2_side_right', -3.2, 1.4, 0.4);
// Aim out of the driver's (right) window.
await page.evaluate(() => window.__race.aim(true, -1.3, 0.02));
await page.waitForTimeout(1400);
await shot('c3a_aim_driver');
await page.evaluate(() => window.__race.aim(true, -0.5, 0.02));
await page.waitForTimeout(1400);
await shot('c3_aim_driver');
await around('c4_aim_driver_out', -3.4, 1.6, 2.2);
await page.evaluate(() => window.__race.trigger(true));
await page.waitForTimeout(80);
await page.evaluate(() => window.__race.trigger(false));
await page.waitForTimeout(250);
await shot('c5_fire');
// Across, through the passenger window.
await page.evaluate(() => window.__race.aim(true, 1.15, 0.0));
await page.waitForTimeout(1400);
await shot('c6_across');
await around('c7_across_out', 3.4, 1.6, 1.0);
await page.evaluate(() => window.__race.aim(false));
await page.waitForTimeout(2600);
await around('c8_wound_up', -3.2, 1.4, 0.4);
console.log(await page.evaluate(() => `shots ${window.__race.shooting.shots} hits ${window.__race.shooting.hits}`));
await browser.close(); await server.close();
