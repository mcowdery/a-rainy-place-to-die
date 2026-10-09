// What one collision probe costs in the city, by part (microseconds a call, 4000 calls on a street): the chase cars
// make ~50 a frame each. node debug-shots/probecost.mjs [spawn]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const spawn = process.argv[2] ?? 'city_garage.front';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=${spawn}&car=home&clock=14:00&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => (document.getElementById('overlay').hidden = true));
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(4000);
console.log(
  await page.evaluate(() => {
    const h = window.__chase.chase.host;
    const d = window.__district;
    const s = window.__own.sim;
    const N = 4000;
    const time = (f) => {
      const t0 = performance.now();
      for (let i = 0; i < N; i++) f(s.x + (i % 40) * 1.3, s.z + ((i >> 3) % 7) * 1.1, 0.35);
      return (((performance.now() - t0) / N) * 1000).toFixed(1);
    };
    const g0 = performance.now();
    const near = d.obstacleNear(s.x, s.z, 70);
    const gather = performance.now() - g0;
    let diff = 0;
    let walls = 0;
    const M = 20000;
    for (let i = 0; i < M; i++) {
      const x = s.x + (Math.random() * 2 - 1) * 66;
      const z = s.z + (Math.random() * 2 - 1) * 66;
      const r = [0.35, 0.8, 1.2, 1.5, 2][i % 5];
      const a = d.obstacle(x, z, r);
      const b = near(x, z, r);
      if (a === 'wall') walls++;
      if (a !== b) diff++;
    }
    return { 'district.obstacle': time(d.obstacle), 'host.solid': time(h.solid), 'host.probe': time(h.probe), 'obstacleNear': time(near), 'gather ms': gather.toFixed(2), mismatches: `${diff} of ${M} (${walls} walls)` };
  }),
);
await browser.close();
await server.close();
