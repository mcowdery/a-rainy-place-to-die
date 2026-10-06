import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=yunagi&mode=free`);
await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1000);
for (const yaw of [-1.3, -0.6, 1.15]) {
  await page.evaluate((y) => window.__race.aim(true, y, 0.02), yaw);
  await page.waitForTimeout(1200);
  console.log(yaw, await page.evaluate(() => {
    const R = window.__race;
    const d = R.driver();
    const rig = d.rig;
    const car = R.car;
    const V = R.camera.position.constructor;
    const toLocal = (p) => { const dx = p.x - car.x, dz = p.z - car.z; return [dx * Math.cos(car.h) - dz * Math.sin(car.h), p.y - car.y, dx * Math.sin(car.h) + dz * Math.cos(car.h)].map((x) => x.toFixed(2)).join(','); };
    const m = rig.muzzle();
    const sh = rig.arms.r.upper.getWorldPosition(new V());
    const wr = rig.arms.r.hand.getWorldPosition(new V());
    const g = rig.guns[rig.kind].root;
    return `armed ${rig.armed} aim ${rig.aim.toFixed(2)} gunVisible ${g.visible} | car-local (x left, z fwd): shoulder ${toLocal(sh)} wrist ${toLocal(wr)} muzzle ${toLocal(m)} | win ${d.winL.toFixed(2)}/${d.winR.toFixed(2)}`;
  }));
}
await browser.close(); await server.close();
