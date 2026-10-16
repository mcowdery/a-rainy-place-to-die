// Walking and running in first person: views ahead and down, and from outside at points in the stride.
//   node debug-shots/fprun.mjs <out dir>
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
await page.evaluate(() => { for (const id of ['panel']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
for (const mode of ['one', 'two']) {
  await page.evaluate(async (m) => { await __fp.enter(14, 30, 0); __fp.kind('lever'); __fp.oneHand(m === 'one'); __fp.aim(false); __fp.look(0, -0.95); __fp.walk(true); }, mode);
  await page.waitForTimeout(1500);
  await shot(`${mode}_walk_down`);
  await page.evaluate(() => { __fp.run(true); __fp.look(0, -0.05); });
  await page.waitForTimeout(1500);
  await shot(`${mode}_run_ahead`);
  await page.evaluate(() => __fp.look(0, -0.95));
  await page.waitForTimeout(500);
  await shot(`${mode}_run_down`);
  for (const i of [0, 1, 2]) {
    await page.waitForTimeout(170);
    await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; __view(c.x + 2.4, 1.5, c.z - 0.8, c.x, 1.1, c.z - 0.2); });
    await page.waitForTimeout(250);
    await shot(`${mode}_run_side${i}`);
    await page.evaluate(() => { const c = __fp.rig().object.children[0].position; __view(c.x - 2.4, 1.5, c.z - 0.6, c.x, 1.1, c.z - 0.2); });
    await page.waitForTimeout(250);
    await shot(`${mode}_run_left${i}`);
    await page.evaluate(() => { const c = __fp.rig().object.children[0].position; __view(c.x - 0.6, 1.6, c.z - 3.0, c.x, 1.1, c.z); });
    await page.waitForTimeout(250);
    await shot(`${mode}_run_front${i}`);
    await page.evaluate(() => { __fp.freeze(false); });
  }
  await page.evaluate(() => { __fp.run(false); __fp.walk(false); });
}
await browser.close(); await server.close();
