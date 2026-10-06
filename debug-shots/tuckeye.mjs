import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
for (const bike of ['hayate', 'cruiser']) {
  await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=kurokami&mode=free&ride=${bike}`);
  await page.waitForFunction(() => window.__race && window.__race.ride()?.rig, null, { timeout: 60000, polling: 250 });
  await page.waitForTimeout(800);
  console.log(bike, await page.evaluate(() => {
    const R = window.__race;
    const b = R.ride().bike.root;
    const cam = R.camera.position.clone();
    const l = b.worldToLocal(cam);
    const f = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
    return `eye in bike frame (x right, y up, -z fwd): ${f(l)}`;
  }));
}
await browser.close(); await server.close();
