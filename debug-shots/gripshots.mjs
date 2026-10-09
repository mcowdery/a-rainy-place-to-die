// Hands on the black cruiser's grips: first person, and close from outside, around each grip.
//   node debug-shots/gripshots.mjs <out dir>
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.keyboard.press('Digit3');
await page.evaluate(() => { for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
await page.evaluate(async () => { await __fp.enter(13.0, 38.6, 0); __fp.ride(); });
await page.waitForTimeout(600);
await page.evaluate(() => __fp.look(0, -0.55));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/h_fp.png` });
await page.evaluate(() => __fp.look(-0.5, -0.6));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/h_fp_right.png` });
// Around the right grip, in the bike's frame.
const views = { above: [0.05, 0.3, 0.12], front: [0.05, 0.05, -0.35], outside: [0.35, 0.05, 0.0], below: [0.05, -0.3, -0.05], behind: [-0.05, 0.12, 0.35] };
for (const side of ['R', 'L']) {
  for (const [n, e] of Object.entries(views)) {
    await page.evaluate(([e, side]) => {
      __fp.freeze(true);
      const r = __fp.riding();
      const b = r.bike;
      const g = b.rider['grip' + side].clone();
      const s = side === 'R' ? 1 : -1;
      const steerFrame = b.steer.children[0] ?? b.steer;
      const gw = steerFrame.localToWorld(g.clone());
      const off = new g.constructor(e[0] * s, e[1], e[2]).applyQuaternion(b.root.quaternion);
      __view(gw.x + off.x, gw.y + off.y, gw.z + off.z, gw.x, gw.y, gw.z);
    }, [e, side]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/h${side}_${n}.png` });
    await page.evaluate(() => __fp.freeze(false));
  }
}
await browser.close(); await server.close();
