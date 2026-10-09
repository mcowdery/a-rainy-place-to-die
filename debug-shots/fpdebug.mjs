import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto(`${base}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
for (const [kind, aim] of [['lever', true], ['lever', false], ['double', true]]) {
  await page.evaluate(([k, a]) => { __fp.kind(k); __fp.look(0, 0); __fp.aim(a); }, [kind, aim]);
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => {
    const rig = __fp.rig();
    const out = [];
    for (const s of ['r', 'l']) {
      const arm = rig.arms[s];
      const V = arm.hand.position.constructor;
      const gun = rig.guns[rig.kind];
      const h = s === 'r' ? gun.grip : gun.fore;
      const fr = s === 'r' ? gun.gripParent : gun.root.children[0];
      const palm = h.palm.clone().transformDirection(fr.matrixWorld);
      const fwd = h.fwd.clone().transformDirection(fr.matrixWorld);
      const want = h.at.clone().applyMatrix4(fr.matrixWorld).addScaledVector(palm, -0.032).addScaledVector(fwd, -0.055);
      const got = arm.hand.getWorldPosition(new V());
      const sh = arm.upper.getWorldPosition(new V());
      const B = (n) => { let x; rig.body.traverse((o) => { if (o.name === n) x = o; }); return x.getWorldPosition(new V()); };
      const f = B(`middle_01_${s}`).sub(got).normalize();
      const a = B(`pinky_01_${s}`).sub(B(`index_01_${s}`)).normalize();
      const pa = f.clone().cross(a).normalize().multiplyScalar(s === 'r' ? 1 : -1);
      const fmt = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
      out.push(`${s}: palm ${fmt(pa)} want ${fmt(palm)} fwd ${fmt(f)} want ${fmt(fwd)}`);
      out.push(`${s}: miss ${(got.distanceTo(want) * 100).toFixed(1)} cm, shoulder->target ${(sh.distanceTo(want) * 100).toFixed(1)} cm, reach ${((arm.lenA + arm.lenB) * 100).toFixed(1)} cm`);
    }
    return out.join(' | ');
  });
  console.log(kind, aim ? 'aim' : 'low', r);
}
await browser.close(); await server.close();
