// Third person on the fight page: which way the body faces as the camera turns while he walks, with and without Shift (and standing).
//   node debug-shots/facingcheck.mjs
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=${process.env.HAND ?? 'fists'}`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims, null, { timeout: 90000, polling: 250 });
await page.evaluate(() => { __fp.spawn(0); __fp.third(true); });
await page.waitForTimeout(1500);
const deg = (r) => Math.round(((r * 180) / Math.PI + 540) % 360 - 180);
const body = () => page.evaluate(() => __fp.rig().body.rotation.y);
/** Turns the camera from yaw 0 to a quarter turn in steps while the keys are held, and says the body's heading beside the walking direction. */
async function turnWhile(label, keys) {
  await page.evaluate(() => { const c = __fp.camera(); c.position.x = 0; c.position.z = 8; __fp.look(0, -0.08); });
  await page.waitForTimeout(500);
  for (const k of keys) await page.keyboard.down(k);
  const out = [];
  for (let i = 0; i <= 6; i++) {
    const yaw = (i * Math.PI) / 12; // 0 .. 90 degrees to the left
    await page.evaluate((y) => __fp.look(y, -0.08), yaw);
    await page.waitForTimeout(450);
    // The camera's yaw y faces (-sin y, -cos y); the body's heading h faces (sin h, cos h): same way when h = y + 180.
    const f = await page.evaluate(() => __fp.facing());
    out.push(`cam ${String(deg(yaw)).padStart(3)} -> body ${String(deg((await body()) - Math.PI)).padStart(4)} (${f.speed.toFixed(1)} m/s)`);
  }
  for (const k of keys) await page.keyboard.up(k);
  console.log(label.padEnd(24), out.join(' | '));
}
await turnWhile('running (Shift + W)', ['ShiftLeft', 'KeyW']);
await turnWhile('walking (W)', ['KeyW']);
await turnWhile('walking, D held', ['KeyD']);
await browser.close();
await server.close();
