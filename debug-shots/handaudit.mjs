// Close-ups of the hands on the lever gun in each hold, in the gun's own frame.
//   node debug-shots/handaudit.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const gunKind = process.argv[3] ?? 'lever';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
await page.keyboard.press('Digit3');
await page.evaluate(() => { for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const views = {
  left: [[-0.2, 0.02, 0.1], [0, -0.04, 0.07]],
  right: [[0.2, 0.0, 0.1], [0, -0.04, 0.07]],
  below: [[0.03, -0.24, 0.12], [0, -0.05, 0.07]],
  above: [[0.05, 0.22, 0.08], [0, -0.03, 0.07]],
};
const fore = {
  fl_left: [[-0.2, 0.04, -0.2], [0, -0.01, -0.2]],
  fl_right: [[0.2, 0.0, -0.2], [0, -0.01, -0.2]],
  fl_below: [[0.04, -0.2, -0.2], [0, -0.01, -0.2]],
};
for (const [hold, setup, set] of [
  ['two', () => { __fp.kind(K); __fp.oneHand(false); __fp.aim(true); __fp.look(0, 0); }, { ...views, ...fore }],
  ['one', () => { __fp.kind(K); __fp.oneHand(true); __fp.aim(true); __fp.look(0, 0); }, views],
]) {
  await page.evaluate(() => __fp.freeze(false));
  await page.evaluate(`const K = '${gunKind}'; (${setup.toString()})()`);
  await page.waitForTimeout(1000);
  await page.evaluate(() => __fp.freeze(true));
  for (const [name, [eye, at]] of Object.entries(set)) {
    await page.evaluate(([e, a]) => {
      const g = __fp.rig().guns[__fp.rig().kind].root;
      const V = g.position.constructor;
      const E = new V(...e).applyMatrix4(g.matrixWorld);
      const A = new V(...a).applyMatrix4(g.matrixWorld);
      __view(E.x, E.y, E.z, A.x, A.y, A.z);
    }, [eye, at]);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${hold}_${name}.png` });
  }
}
await browser.close(); await server.close();
