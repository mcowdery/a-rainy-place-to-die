import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2000);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; });
await page.evaluate(() => { __fp.kind('lever'); __fp.oneHand(true); __fp.aim(false); __fp.look(0, -0.05); });
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/u1_fp.png` });
await page.evaluate(() => __fp.look(-0.5, -0.1));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/u2_fp_right.png` });
await page.evaluate(() => __fp.look(Math.PI, 0));
await page.waitForTimeout(900);
const view = async (name, dx, dy, dz) => {
  await page.evaluate(([dx, dy, dz]) => {
    __fp.freeze(true);
    const c = __fp.rig().object.children[0].position;
    __view(c.x + dx, 1.3 + dy, c.z + dz, c.x - 0.15, 1.15, c.z + 0.1);
  }, [dx, dy, dz]);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png` });
};
// Turned round, he faces +z.
await view('u3_front', -0.4, 0.1, 3.0);
await view('u4_side', -2.8, 0.1, 0.4);
await browser.close(); await server.close();
