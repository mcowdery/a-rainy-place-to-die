// Fighting on the fight page (fight.html): fists (guard, jab, cross, hook, uppercut, kick) and the katana (draw,
// guard, cuts, thrust), against the test thug, in first person and from outside.
//   node debug-shots/fpfight.mjs <out dir> [fists|katana|both]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const which = process.argv[3] ?? 'both';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}fight.html`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1500);
await page.evaluate(() => { for (const id of ['panel']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const wait = (ms) => page.waitForTimeout(ms);
// In the yard, facing its north wall.
await page.evaluate(async () => { await __fp.enter(0, 3, 0); __fp.look(0, -0.05); });
await wait(600);
// A frozen outside view of you both, from your right front.
// (The camera is your eyes: kept and put back, so the outside view doesn't move you.)
const outside = async (name, view = [2.2, 1.7, -1.6, 0, 1.2, -1.2]) => {
  await page.evaluate((v) => {
    __fp.freeze(true);
    __fp.headless(false);
    const cam = window.__camera ?? __fp.camera();
    window.__saved = { p: cam.position.clone(), q: cam.quaternion.clone() };
    const c = __fp.rig().object.children[0].position;
    __view(c.x + v[0], v[1], c.z + v[2], c.x + v[3], v[4], c.z + v[5]);
  }, view);
  await wait(350);
  await shot(name);
  await page.evaluate(() => {
    const cam = window.__camera ?? __fp.camera();
    cam.position.copy(window.__saved.p);
    cam.quaternion.copy(window.__saved.q);
    __fp.headless(true);
    __fp.freeze(false);
  });
  await wait(100);
};
const log = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(() => __fp.state())));
if (which !== 'katana') {
  await page.evaluate(() => __fp.hand('fists'));
  await page.waitForFunction(() => __fp.thug(), null, { timeout: 60000, polling: 250 });
  await wait(800);
  await page.evaluate(() => __fp.draw());
  await wait(700);
  await shot('f1_guard');
  await outside('f1_guard_out');
  await outside('f1_fists', [0.55, 1.62, -0.75, 0, 1.45, -0.4]);
  for (const [name, ms, id] of [['f2_jab', 110, 'jab'], ['f3_cross', 160, 'cross'], ['f4_hook', 220, 'hook'], ['f5_upper', 250, 'uppercut']]) {
    await page.evaluate((id) => __fp.move(id), id);
    await wait(ms);
    await shot(name);
    await outside(`${name}_out`);
    await wait(500);
    await log(name);
  }
  await page.evaluate(() => __fp.kick());
  await wait(330);
  await shot('f6_kick');
  await outside('f6_kick_out');
  await wait(600);
  await log('kick');
  await page.evaluate(() => __fp.guard(true));
  await wait(400);
  await shot('f7_block');
  await page.evaluate(() => __fp.guard(false));
  // Beat him down.
  for (let i = 0; i < 16; i++) {
    await page.evaluate(() => __fp.attack());
    await wait(260);
  }
  await wait(1500);
  await log('after');
  await shot('f8_down');
  await outside('f8_down_out');
}
if (which !== 'fists') {
  await page.evaluate(() => { __fp.hand('katana'); __fp.spawn(); __fp.gore('full'); });
  await page.waitForFunction(() => __fp.thug(), null, { timeout: 60000, polling: 250 });
  await wait(600);
  await shot('k0_sheathed');
  await page.evaluate(() => __fp.draw());
  await wait(220);
  await shot('k1_drawing');
  await wait(700);
  await shot('k2_guard');
  await outside('k2_guard_out');
  for (const [name, ms, id] of [['k3_slashR', 280, 'slashR'], ['k4_slashL', 280, 'slashL'], ['k5_overhead', 300, 'overhead']]) {
    await page.evaluate((id) => __fp.move(id), id);
    await wait(ms);
    await shot(name);
    await outside(`${name}_out`);
    await wait(650);
    await log(name);
  }
  await page.evaluate(() => __fp.guard(true));
  await wait(300);
  await shot('k6_block');
  await page.evaluate(() => __fp.attack());
  await wait(230);
  await shot('k7_thrust');
  await page.evaluate(() => __fp.guard(false));
  await wait(600);
  await log('thrust');
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => __fp.attack());
    await wait(450);
  }
  await wait(2500);
  await log('kill');
  await shot('k8_after');
  await outside('k8_after_out');
  await wait(6000);
  await page.evaluate(() => __fp.look(0, -0.7));
  await wait(300);
  await shot('k9_floor');
}
await browser.close(); await server.close();
