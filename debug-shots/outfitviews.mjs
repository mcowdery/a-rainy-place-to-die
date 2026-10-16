// Close views of the Filipino outfits in the mob showroom, from the side and from low down (for the feet), with the figures going about
// their walk (T). node debug-shots/outfitviews.mjs [out dir] [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/outfits';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}mob.html?labels=0${extra}&t=3`);
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
const views = (await page.evaluate(() => window.__mob.items)).filter((v) => v.includes('filipino') && (v.includes(': close') || v.includes(': feet')) && !v.includes('backs'));
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 60);
for (const v of views) {
  for (const [tag, yaw, lift] of [['side', Math.PI / 2, 0], ['threeq', -0.7, 0]]) {
    await page.evaluate(([n, yw, lf]) => {
      window.__focus(n);
      const m = window.__mob;
      const t = m.controls.target, c = m.camera.position;
      const dx = c.x - t.x, dz = c.z - t.z;
      const cs = Math.cos(yw), sn = Math.sin(yw);
      m.camera.position.set(t.x + dx * cs - dz * sn, c.y - lf, t.z + dx * sn + dz * cs);
      m.controls.update();
    }, [v, yaw, lift]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/view_${slug(v)}_${tag}.png` });
  }
}
await browser.close();
await server.close();
