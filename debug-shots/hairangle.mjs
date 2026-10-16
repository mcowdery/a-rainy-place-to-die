// The hair room, a cut from a few angles round it, close: for the shoulders and the tails.
//   node debug-shots/hairangle.mjs [out dir] [query] [cuts: names, comma separated] [angles in degrees from the front, comma separated]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/hairangle';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const cuts = (process.argv[4] ?? 'lowpony_over_loose').split(',');
const angles = (process.argv[5] ?? '0,50,90,140,180').split(',').map(Number);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}hair.html?labels=0${extra}&t=3`);
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
for (const cut of cuts) {
  // (The head close-up shows the cut three ways side by side: the middle one, the side view, is the one to turn about.)
  await page.evaluate((n) => window.__focus(n), `head: woman · ${cut}`);
  await page.waitForTimeout(200);
  const base = await page.evaluate(() => {
    const m = window.__mob;
    return { t: [m.controls.target.x, m.controls.target.y, m.controls.target.z] };
  });
  for (const a of angles) {
    const r = (a * Math.PI) / 180;
    // The middle figure of the three is at the target; look at its chest and shoulders from 2.2 m round it.
    const tx = base.t[0], tz = base.t[2], ty = 1.28;
    await page.evaluate(([x, y, z, tx, ty, tz]) => window.__view(x, y, z, tx, ty, tz), [tx + Math.sin(r) * 2.2, ty + 0.1, tz + Math.cos(r) * 2.2, tx, ty, tz]);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${cut}_${String(a).padStart(3, '0')}.png` });
  }
}
writeGallery(out);
await browser.close();
await server.close();
