// Through a run: each frame, how far forward (along his heading) each foot and hand is, from the pelvis.
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(async () => { await __fp.enter(14, 30, 0); __fp.kind('lever'); __fp.oneHand(false); __fp.aim(false); __fp.look(0, 0); __fp.walk(true); __fp.run(true); });
await page.waitForTimeout(1500);
console.log(await page.evaluate(async () => {
  const rig = __fp.rig();
  const bones = {};
  rig.body.traverse((o) => { bones[o.name] = o; });
  const out = [];
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const fwd = new rig.body.position.constructor(0, 0, 1).applyQuaternion(rig.body.quaternion);
    const p0 = bones.pelvis.getWorldPosition(new rig.body.position.constructor());
    const f = (n) => (bones[n].getWorldPosition(new rig.body.position.constructor()).sub(p0).dot(fwd) * 100).toFixed(0).padStart(4);
    if (i % 3 === 0) out.push(`footL ${f('foot_l')} footR ${f('foot_r')} | handL ${f('hand_l')} handR ${f('hand_r')}`);
  }
  return out.join('\n');
}));
await browser.close(); await server.close();
