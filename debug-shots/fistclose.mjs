// Mack's fists up close in the guard (and the right in a cross), from several sides.
//   node debug-shots/fistclose.mjs <out dir>
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
await page.keyboard.press('Digit3');
await page.evaluate(() => { for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
await page.evaluate(async () => { await __fp.enter(14, 30, 0); __fp.look(0, 0); __fp.hand('fists'); __fp.draw(); });
await page.waitForTimeout(1200);
const views = { front: [0, 0.02, -0.35], side: [0.3, 0.0, -0.05], above: [0.05, 0.3, -0.12], palm: [-0.25, -0.05, -0.1] };
for (const [side, label] of [['r', 'R'], ['l', 'L']]) {
  for (const [name, off] of Object.entries(views)) {
    await page.evaluate(([side, off]) => {
      __fp.freeze(true);
      const h = __fp.rig().arms[side].hand.getWorldPosition(__fp.camera().position.clone());
      const k = __fp.rig().arms[side].fingers[1][0].getWorldPosition(h.clone());
      const c = h.clone().lerp(k, 0.6);
      const s = side === 'l' ? -1 : 1;
      __view(c.x + off[0] * s, c.y + off[1], c.z + off[2], c.x, c.y, c.z);
    }, [side, off]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${label}_${name}.png` });
  }
}
await browser.close(); await server.close();
