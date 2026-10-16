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
await page.waitForTimeout(1500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
for (const [name, run] of [['walk', false], ['run', true]]) {
  await page.evaluate(async (r) => { await __fp.enter(14, 30, 0); __fp.kind('lever'); __fp.oneHand(true); __fp.aim(false); __fp.look(0.5, -0.9); __fp.walk(true); __fp.run(r); }, run);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/lh_${name}_fp.png` });
  await page.evaluate(() => {
    __fp.freeze(true);
    const h = __fp.rig().arms.l.hand.getWorldPosition(__fp.rig().object.position.clone());
    window.__h = h;
    __view(h.x - 0.35, h.y + 0.1, h.z - 0.25, h.x, h.y - 0.05, h.z);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/lh_${name}_out.png` });
  await page.evaluate(() => { const h = window.__h; __view(h.x + 0.05, h.y + 0.1, h.z - 0.4, h.x, h.y - 0.05, h.z); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/lh_${name}_front.png` });
  await page.evaluate(() => { __fp.freeze(false); __fp.walk(false); __fp.run(false); });
}
await browser.close(); await server.close();
