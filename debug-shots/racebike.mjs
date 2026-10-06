// The bike on the race page's free drive (the practice lot's targets): first and third person, the shotgun,
// riding and drifting. node debug-shots/racebike.mjs <out dir> [venue] [bike]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const venue = process.argv[3] ?? 'kurokami';
const bike = process.argv[4] ?? 'cruiser';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=${venue}&mode=free&ride=${bike}`);
await page.waitForFunction(() => window.__race && window.__race.ride()?.rig, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const key = (c, d) => page.evaluate(([c, d]) => (d ? window.__race.keys.add(c) : window.__race.keys.delete(c)), [c, d]);
await shot('b1_first');
await page.evaluate(() => window.__race.view('chase'));
await page.waitForTimeout(600);
await shot('b2_third');
// The shotgun, aimed at the nearest target.
await page.evaluate(() => { const r = window.__race.ride(); r.rig.armed = true; });
await page.waitForTimeout(800);
await shot('b3_third_gun');
await page.evaluate(() => {
  const R = window.__race;
  const c = R.car;
  const V = R.camera.position.constructor;
  const t = R.targets.list
    .filter((t) => t.kind !== 'mover').filter((t) => { const n = new V(0, 0, 1).transformDirection(t.face.matrixWorld); const ctr = R.targets.centre(t, new V()); return n.x * (c.x - ctr.x) + n.z * (c.z - ctr.z) > 0; })
    .map((t) => R.targets.centre(t, new V()))
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
  window.__t = t;
  if (t) R.aimAt(t.x, t.y, t.z);
  else R.aim(true, 0, 0.02);
  R.ride().rig.aiming = true;
});
await page.waitForTimeout(1200);
await shot('b4_third_aim');
await page.evaluate(() => window.__race.view('bumper'));
await page.waitForTimeout(800);
await shot('b5_first_aim');
const before = await page.evaluate(() => window.__race.shooting.score);
await page.evaluate(() => window.__race.ride().rig.fire());
await page.waitForTimeout(150);
await shot('b6_fire');
await page.waitForTimeout(900);
console.log('score', before, '->', await page.evaluate(() => window.__race.shooting.score), 'shots', await page.evaluate(() => window.__race.shooting.shots));
await page.evaluate(() => { window.__race.aim(false); window.__race.ride().rig.aiming = false; window.__race.ride().rig.armed = false; });
// Ride: throttle, then a turn with the handbrake: a slide.
await key('KeyW', true);
await page.waitForTimeout(2200);
await key('KeyA', true);
await key('Space', true);
await page.waitForTimeout(500);
await key('Space', false);
await page.waitForTimeout(400);
await shot('b7_slide_first');
console.log(await page.evaluate(() => { const c = window.__race.car; return `speed ${(Math.hypot(c.u, c.w) * 3.6).toFixed(0)} km/h slide ${(c.slide * 57.3).toFixed(0)} lean ${(window.__race.ride().lean * 57.3).toFixed(0)}`; }));
await page.evaluate(() => window.__race.view('chase'));
await page.waitForTimeout(300);
await shot('b8_slide_third');
await key('KeyA', false);
await key('KeyW', false);
await browser.close(); await server.close();
