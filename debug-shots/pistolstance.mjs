// Mack standing with the pistol out (the showroom's first person, seen from outside): the library's stance under his
// own handling of the gun (models/cityMoves.ts): ready, aimed, a shot, the magazine change part way, and walking with
// it; and how far the stance lowers his eyes in first person.
//   node debug-shots/pistolstance.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/pistolstance';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`, { timeout: 240000 });
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 120000, polling: 250 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.look(0, 0); __fp.third(true); __fp.kind('pistol'); __fp.armed(true); });
// (His moves come with the library: wait for it.)
await page.waitForFunction(() => __fp.rig().moves, null, { timeout: 120000, polling: 250 });
const shoot = async (name) => {
  await page.evaluate(() => __fp.freeze(true));
  const b = await page.evaluate(() => { const p = __fp.rig().body.position; return [p.x, p.y, p.z]; });
  // (He faces -z with the view at yaw 0: from in front, and square on from his right.)
  for (const [view, from] of [['front', [b[0] + 0.5, b[1] + 1.3, b[2] - 3.2]], ['side', [b[0] + 3.2, b[1] + 1.0, b[2]]]]) {
    await page.evaluate(([f, a]) => __view(f[0], f[1], f[2], a[0], a[1], a[2]), [from, [b[0], b[1] + 0.95, b[2]]]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/${name}_${view}.png`, clip: { x: 390, y: 60, width: 500, height: 620 } });
  }
  await page.evaluate(() => __fp.freeze(false));
  console.log(`${out}/${name}`);
};
await page.waitForTimeout(1500);
await shoot('1_ready');
await page.evaluate(() => __fp.aim(true));
await page.waitForTimeout(700);
await shoot('2_aimed');
await page.evaluate(() => __fp.fire());
await page.waitForTimeout(110);
await shoot('3_shot');
await page.evaluate(() => { __fp.aim(false); __fp.rig().reloadHold = 0.5; __fp.rig().reload(); });
await page.waitForTimeout(500);
console.log('reloading:', await page.evaluate(() => __fp.rig().reloading));
await shoot('4_reload');
await page.evaluate(() => { __fp.rig().reloadHold = null; });
await page.waitForTimeout(1900);
await page.evaluate(() => __fp.walk(true));
await page.waitForTimeout(900);
await shoot('5_walking');
await page.evaluate(() => __fp.walk(false));
// First person: how far the stance brings his eyes down.
await page.evaluate(() => __fp.third(false));
await page.waitForTimeout(900);
console.log('eye drop, first person, ready (m):', await page.evaluate(() => +__fp.rig().eyeDrop.toFixed(3)));
await page.evaluate(() => __fp.look(0, -0.5));
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/6_first_person_down.png` });
await page.evaluate(() => { __fp.look(0, 0); __fp.aim(true); });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/7_first_person_aimed.png` });
console.log('first person, aimed: eye drop (m)', await page.evaluate(() => +__fp.rig().eyeDrop.toFixed(3)), 'aim', await page.evaluate(() => +__fp.rig().aim.toFixed(2)), 'reloading', await page.evaluate(() => __fp.rig().reloading));
// The same without the library's stance, to tell what is its doing.
await page.evaluate(() => { window.__moves = __fp.rig().moves; __fp.rig().moves = null; });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/8_first_person_aimed_keyed.png` });
await page.evaluate(() => { __fp.rig().moves = window.__moves; });
await browser.close();
await server.close();
process.exit(0);
