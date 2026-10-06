import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=kurokami&mode=free&ride=cruiser`);
await page.waitForFunction(() => window.__race && window.__race.ride()?.rig, null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const R = window.__race;
  R.ride().rig.armed = true;
  const c = R.car;
  const V = R.camera.position.constructor;
  const t = R.targets.list
    .filter((t) => t.kind !== 'mover').filter((t) => { const n = new V(0, 0, 1).transformDirection(t.face.matrixWorld); const ctr = R.targets.centre(t, new V()); return n.x * (c.x - ctr.x) + n.z * (c.z - ctr.z) > 0; })
    .map((t) => R.targets.centre(t, new V()))
    .sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
  window.__t = t;
  R.aimAt(t.x, t.y, t.z);
  R.ride().rig.aiming = true;
});
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => {
  const R = window.__race;
  const cam = R.camera;
  const V = cam.position.constructor;
  const d = cam.getWorldDirection(new V());
  const p = R.shooting.pick(cam.position, d);
  const t = window.__t;
  const toT = t.clone().sub(cam.position).normalize();
  const m = R.ride().rig.muzzle();
  const near = R.targets.list.map((tt) => ({ tt, c: R.targets.centre(tt, new V()) })).sort((a, b) => a.c.distanceTo(t) - b.c.distanceTo(t))[0].tt;
  const f = near.face;
  const n = new V(0, 0, 1).transformDirection(f.matrixWorld);
  const extra = ` | face side ${f.material.side} fall ${near.fall} kind ${near.kind} normal.toCam ${n.dot(cam.position.clone().sub(t).normalize()).toFixed(2)} visible ${f.visible} geo ${f.geometry.type}`;
  return extra + ` target dist ${t.distanceTo(cam.position).toFixed(1)} m; view vs target ${(d.angleTo(toT) * 57.3).toFixed(2)} deg; pick target ${!!p.target} ground ${p.ground} at ${p.point.distanceTo(cam.position).toFixed(1)} m; muzzle-to-cam ${m.distanceTo(cam.position).toFixed(2)}; targets ${R.targets.list.length}`;
}));
await browser.close(); await server.close();
