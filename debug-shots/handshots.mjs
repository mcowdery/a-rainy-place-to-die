import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const kind = process.argv[3] ?? 'lever';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
await page.evaluate((k) => { __fp.kind(k); __fp.oneHand(false); __fp.aim(true); __fp.look(0, 0); }, kind);
await page.waitForTimeout(900);
await page.evaluate(() => __fp.freeze(true));
// Views about the gun, in the gun's own frame (x right, y up, -z forward), so they hold whatever the pose.
const only = process.argv[4];
const views = only === 'grip' ? {
  g_left: [[-0.2, 0.0, 0.1], [0, -0.035, 0.07]],
  g_right: [[0.2, 0.0, 0.08], [0, -0.035, 0.07]],
  g_below: [[0.02, -0.22, 0.12], [0, -0.04, 0.07]],
  g_back: [[0.06, 0.05, 0.28], [0, -0.035, 0.07]],
  g_front: [[0.08, -0.08, -0.15], [0, -0.035, 0.06]],
  g_above: [[0.04, 0.2, 0.1], [0, -0.02, 0.07]],
} : {
  r_left: [[-0.22, 0.02, 0.1], [0, -0.05, 0.05]],
  r_right: [[0.22, -0.02, 0.06], [0, -0.05, 0.05]],
  r_below: [[0.05, -0.25, 0.1], [0, -0.05, 0.04]],
  l_below: [[0.06, -0.24, -0.2], [0, -0.02, -0.19]],
  l_right: [[0.22, 0.0, -0.2], [0, -0.02, -0.19]],
  l_left: [[-0.2, 0.04, -0.22], [0, -0.02, -0.19]],
};
for (const [name, [eye, at]] of Object.entries(views)) {
  await page.evaluate(([e, a, k]) => {
    const g = __fp.rig().guns[k].root;
    const V = g.position.constructor;
    const E = new V(...e).applyMatrix4(g.matrixWorld);
    const A = new V(...a).applyMatrix4(g.matrixWorld);
    __view(E.x, E.y, E.z, A.x, A.y, A.z);
  }, [eye, at, kind]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
