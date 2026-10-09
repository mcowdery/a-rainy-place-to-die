import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(async () => { await __fp.enter(13.0, 38.6, 0); __fp.ride(); __fp.armed(true); __fp.aim(true); });
for (const yaw of [0, -0.6, -1.1, -1.6]) {
  await page.evaluate((y) => __fp.look(y, -0.05), yaw);
  await page.waitForTimeout(900);
  console.log(yaw, await page.evaluate(() => {
    const rig = __fp.rig();
    const gun = rig.guns.lever.root;
    const V = gun.position.constructor;
    const cam = rig.object.parent.children.find((o) => o.isCamera) ?? null;
    const bore = new V(0, 0, -1).transformDirection(gun.matrixWorld);
    const sh = rig.arms.r.upper.getWorldPosition(new V());
    const el = rig.arms.r.lower.getWorldPosition(new V());
    const wr = rig.arms.r.hand.getWorldPosition(new V());
    const g = rig.guns.lever;
    const gm = g.gripParent.matrixWorld;
    const want = g.grip.at.clone().applyMatrix4(gm).addScaledVector(g.grip.palm.clone().transformDirection(gm), -0.032).addScaledVector(g.grip.fwd.clone().transformDirection(gm), -0.055);
    const bikeF = new V(0, 0, -1).applyQuaternion(__fp.riding().bike.root.quaternion);
    const f = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
    const ang = (a, b) => ((Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())))) * 180) / Math.PI).toFixed(0);
    return `bore ${f(bore)} (pitch ${(Math.asin(bore.y) * 57.3).toFixed(0)}) bore-vs-bike ${ang(bore, bikeF)}deg | wrist miss ${(wr.distanceTo(want) * 100).toFixed(1)} cm | arm vs bike-fwd ${ang(wr.clone().sub(sh), bikeF)}deg, elbow bend ${ang(el.clone().sub(sh), wr.clone().sub(el))}deg, wrist below shoulder ${((sh.y - wr.y) * 100).toFixed(0)} cm`;
  }));
}
await browser.close(); await server.close();
