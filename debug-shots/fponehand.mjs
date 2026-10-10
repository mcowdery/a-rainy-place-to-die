import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2000);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const shot = async (name, fn, wait = 700) => { await page.evaluate(fn); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
await shot('o1_low', () => { __fp.kind('lever'); __fp.oneHand(true); __fp.look(0, -0.05); });
await shot('o2_aim', () => { __fp.aim(true); });
// Reach of the right arm when aimed one-handed.
console.log(await page.evaluate(() => {
  const rig = __fp.rig();
  const arm = rig.arms.r;
  const V = arm.hand.position.constructor;
  const S = arm.upper.getWorldPosition(new V());
  const H = arm.hand.getWorldPosition(new V());
  return `right shoulder->wrist ${(S.distanceTo(H) * 100).toFixed(1)} cm of ${((arm.lenA + arm.lenB) * 100).toFixed(1)}`;
}));
// The flip-cock, frame by frame: fire, then shots through the spin.
await page.evaluate(() => __fp.fire());
for (const [i, t] of [[1, 160], [2, 120], [3, 120], [4, 120]]) {
  await page.waitForTimeout(t);
  await page.screenshot({ path: `${out}/o3_flip${i}.png` });
}
await page.waitForTimeout(800);
// From outside: one-handed aim, side and three-quarter.
await page.evaluate(() => { __fp.aim(true); __fp.look(0, 0); });
await page.waitForTimeout(700);
await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; window.__c = [c.x, c.z]; __view(c.x + 1.8, 1.6, c.z - 0.5, c.x, 1.3, c.z - 0.4); });
await page.waitForTimeout(400); await page.screenshot({ path: `${out}/o4_side.png` });
await page.evaluate(() => { const [x, z] = window.__c; __view(x + 1.0, 1.8, z - 1.8, x, 1.35, z - 0.3); });
await page.waitForTimeout(400); await page.screenshot({ path: `${out}/o5_front.png` });
// Outside, through the flip.
// Outside, through the flip: frozen when the muzzle points down, back and up.
for (const [name, test] of [['down', 'y < -0.8'], ['back', 'z > 0.8'], ['up', 'y > 0.8']]) {
  await page.evaluate(async (test) => {
    // The walker follows the camera, so put him back where he started before letting go.
    await __fp.enter(0.6, 40.2, 0);
    __fp.freeze(false);
    __fp.aim(true);
    __fp.look(0, 0);
    await new Promise((r) => setTimeout(r, 900));
    __fp.fire();
    const g = __fp.rig().guns.lever.root;
    const f = new Function('y', 'z', `return ${test}`);
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const e = g.matrixWorld.elements;
      if (f(-e[9], -e[10])) break;
    }
    __fp.freeze(true);
    const c = __fp.rig().object.children[0].position;
    const [x, z] = [c.x, c.z];
    __view(x + 1.5, 1.5, z - 1.0, x + 0.15, 1.3, z - 0.45);
  }, test);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/o6_flip_${name}.png` });
}
await browser.close();
await server.close();
