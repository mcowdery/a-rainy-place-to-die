// The trains turning back at the Toto Line's south stub: shots at moments through the turn.
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';

const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}district.html?debug=1&clock=12:00&weather=clear&fly=1&cam=3328,75,2085,0,-89`);
  await page.waitForTimeout(50_000);
  // Find the times (in the line's clock) when train 0 is entering the crossover, standing at the stub's end, and leaving.
  const times = await page.evaluate(() => {
    const t = window.__trains.get('toto');
    const tr = t.trains[0];
    const out = {};
    for (let time = 0; time < tr.period; time += 1) {
      t.time = time;
      t.update(0, window.__camera ?? { position: { x: 0, y: 0, z: 0 } });
      const c = tr.cars.children[1].position;
      if (c.z > 2030 && c.z < 2045 && tr.dir > 0 && out.cross === undefined) out.cross = time;
      if (c.z > 2110 && out.stand === undefined) out.stand = time + 8;
      if (out.stand !== undefined && tr.dir < 0 && c.z < 2075 && out.leave === undefined) out.leave = time;
    }
    return out;
  });
  console.log(times);
  for (const [name, time] of Object.entries(times)) {
    await page.evaluate((tm) => {
      const t = window.__trains.get('toto');
      t.time = tm;
      t.running = true;
    }, time);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `debug-shots/turn_${name}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
