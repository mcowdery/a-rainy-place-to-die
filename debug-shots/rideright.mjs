// On the black cruiser, shotgun raised, looking right by several amounts: first person and close from outside.
//   node debug-shots/rideright.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
await page.evaluate(async () => { await __fp.enter(13.0, 38.6, 0); __fp.ride(); __fp.armed(true); __fp.aim(true); });
for (const yaw of [-0.6, -1.1, -1.6]) {
  await page.evaluate((y) => __fp.look(y, -0.05), yaw);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/y${-yaw}_fp.png` });
  // Close on the arm from behind-left, above, and from the right.
  for (const [n, e] of [['back', [-0.9, 0.9, 1.4]], ['top', [0.2, 1.6, 0.3]], ['right', [1.6, 0.4, 0.2]]]) {
    await page.evaluate(([e]) => {
      __fp.freeze(true);
      const rig = __fp.rig();
      const sh = rig.arms.r.upper.getWorldPosition(rig.object.position.clone());
      const b = __fp.riding().bike.root;
      const q = b.quaternion;
      const off = new sh.constructor(...e).applyQuaternion(q);
      __view(sh.x + off.x, sh.y + off.y, sh.z + off.z, sh.x, sh.y - 0.1, sh.z);
    }, [e]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/y${-yaw}_${n}.png` });
    await page.evaluate(() => __fp.freeze(false));
  }
}
await browser.close(); await server.close();
