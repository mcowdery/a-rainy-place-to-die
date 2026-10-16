// The helmet on Mack (on the sports bike, from outside) and his Type 54 on foot in first person.
//   node debug-shots/helmetpistol.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.keyboard.press('Digit3');
await page.evaluate(() => { for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
// On foot: the pistol, low ready, two hands up, one hand out.
await page.evaluate(async () => { await __fp.enter(14, 24, 0); __fp.kind('pistol'); __fp.oneHand(false); __fp.armed(true); __fp.look(0, -0.1); });
await page.waitForTimeout(900);
await shot('p1_low');
await page.evaluate(() => __fp.aim(true));
await page.waitForTimeout(900);
await shot('p2_aim');
await page.evaluate(() => __fp.fire());
await page.waitForTimeout(60);
await shot('p3_fire');
await page.waitForTimeout(600);
await page.evaluate(() => __fp.oneHand(true));
await page.waitForTimeout(900);
await shot('p4_one_aim');
await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; __view(c.x + 1.7, 1.6, c.z - 1.2, c.x, 1.35, c.z - 0.3); });
await page.waitForTimeout(400);
await shot('p5_one_aim_out');
await page.evaluate(() => { __fp.freeze(false); __fp.oneHand(false); });
await page.waitForTimeout(700);
await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; __view(c.x + 1.7, 1.6, c.z - 1.2, c.x, 1.35, c.z - 0.3); });
await page.waitForTimeout(400);
await shot('p6_two_aim_out');
await page.evaluate(() => { __fp.freeze(false); __fp.aim(false); __fp.armed(false); });
// The sports bike: on it, the helmet on, seen from outside with the head shown.
await page.evaluate(async () => {
  const b = window.__lab.scene.getObjectByName('bike:hayate');
  const p = b.getWorldPosition(b.position.clone());
  await __fp.enter(p.x + 0.8, p.z + 0.4, 0);
  __fp.ride();
});
await page.waitForTimeout(800);
await shot('h1_first');
await page.evaluate(() => { __fp.headless(false); });
await page.waitForTimeout(500);
for (const [n, dx, dy, dz] of [['h2_side', 2.0, 0.2, 0.2], ['h3_front', -0.6, 0.3, -2.2], ['h4_close', 0.7, 0.55, -0.6]]) {
  await page.evaluate(([dx, dy, dz]) => {
    __fp.freeze(true);
    const r = __fp.riding();
    const q = r.bike.root.quaternion;
    const o = new r.bike.root.position.constructor(dx, dy, dz).applyQuaternion(q);
    const head = __fp.rig().object.children[0].position;
    __view(r.x + o.x, 1.4 + o.y, r.z + o.z, r.x, 1.25, r.z);
  }, [dx, dy, dz]);
  await page.waitForTimeout(400);
  await shot(n);
}
// Close on the head: side, front, three-quarter.
for (const [n, dx, dy, dz] of [['h5_head_side', 0.7, 0.05, 0.0], ['h6_head_front', 0.0, 0.05, -0.75], ['h7_head_34', 0.5, 0.1, -0.5]]) {
  await page.evaluate(([dx, dy, dz]) => {
    __fp.freeze(true);
    const rig = __fp.rig();
    let head = null;
    rig.object.traverse((o) => { if (!head && o.isBone && o.name === 'head') head = o; });
    const p = head.getWorldPosition(head.position.clone());
    const q = __fp.riding().bike.root.quaternion;
    const o = new p.constructor(dx, dy, dz).applyQuaternion(q);
    __view(p.x + o.x, p.y + 0.1 + o.y, p.z + o.z, p.x, p.y + 0.1, p.z);
  }, [dx, dy, dz]);
  await page.waitForTimeout(300);
  await shot(n);
}
await browser.close(); await server.close();
