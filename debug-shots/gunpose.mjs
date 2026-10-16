// A gunman close up: waits for one to be peeking, freezes the fight (the orbit view pauses it) and photographs him from the front, the side and
// from above-behind; and again while he's behind his cover.
//   node debug-shots/gunpose.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/gunpose';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=gun`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'Pistol_Aim_Neutral'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => { __fp.spawn(0); __fp.rig().armed = true; __fp.brawl().health = 9999; });
await page.evaluate(() => __fp.mixed(0, 1));
const shoot = async (tag, want) => {
  await page.waitForFunction((w) => __fp.gunmen().men[0] === w, want, { timeout: 60000, polling: 40 });
  await page.keyboard.press('KeyV'); // out to the orbiting view: the fight pauses where it is
  await wait(300);
  const g = await page.evaluate(() => { const t = __fp.thugs().find((t) => t.role === 'gunman'); return { x: t.root.position.x, z: t.root.position.z, yaw: t.yaw }; });
  console.log(tag, JSON.stringify(g));
  // From his front (the way he faces), his right side and from behind and above.
  const f = [Math.sin(g.yaw), Math.cos(g.yaw)];
  const views = { front: [g.x + f[0] * 3, 1.5, g.z + f[1] * 3], side: [g.x + f[1] * 3, 1.5, g.z - f[0] * 3], back: [g.x - f[0] * 2.5, 2.4, g.z - f[1] * 2.5] };
  for (const [name, p] of Object.entries(views)) {
    await page.evaluate(([p, t]) => __view(p[0], p[1], p[2], t[0], t[1], t[2]), [p, [g.x, 1.15, g.z]]);
    await wait(250);
    await page.screenshot({ path: `${out}/${tag}_${name}.png` });
  }
  await page.keyboard.press('KeyV');
  await wait(400);
};
await shoot('peek', 'peek');
await shoot('cover', 'covered');
await browser.close();
await server.close();
