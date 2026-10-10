// Mack's wardrobe in the showroom: each outfit in third person and from the front, each pair of sunglasses close up.
//   node debug-shots/wardrobe.mjs <outdir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/wardrobe';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => { try { localStorage.removeItem('citypop.wardrobe'); } catch {} });
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.third(true); __fp.armed(false); __fp.look(Math.PI, -0.08); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const outfits = ['leathers', 'suit_black', 'suit_charcoal', 'suit_navy', 'suit_cream', 'nude'];
for (const o of outfits) {
  await page.evaluate((o) => __fp.wear(o, null), o);
  await page.waitForFunction((o) => __fp.rig().model === (o === 'leathers' ? 'mack' : `mack_${o}`), o, { timeout: 30000, polling: 200 });
  await page.evaluate(() => { __fp.freeze(false); __fp.third(true); __fp.look(Math.PI, -0.08); });
  await page.waitForTimeout(900);
  await shot(`o_${o}_back`);
  // From the front, frozen: a full-length look.
  await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; const y = __fp.rig().eyeHeight; __view(c.x + 0.9, y * 0.62, c.z + 2.6, c.x, y * 0.52, c.z); });
  await page.waitForTimeout(500);
  await shot(`o_${o}_front`);
}
await page.evaluate(() => __fp.wear('leathers', null));
await page.waitForFunction(() => __fp.rig().model === 'mack', null, { timeout: 30000, polling: 200 });
for (const g of ['wrap', 'aviator', 'slim']) {
  await page.evaluate((g) => { __fp.freeze(false); __fp.wear('leathers', g); __fp.third(true); __fp.look(Math.PI, 0); }, g);
  await page.waitForTimeout(700);
  await page.evaluate(() => { __fp.freeze(true); });
  await page.waitForTimeout(200);
  for (const [n, dx, dz] of [['front34', 0.28, 0.42], ['side', 0.5, 0.05]]) {
    await page.evaluate(([dx, dz]) => {
      const rig = __fp.rig();
      const h = rig.object.getObjectByName(`glasses:${rig.glassesKind}`);
      const p = h.getWorldPosition(new h.position.constructor());
      __view(p.x + dx, p.y + 0.03, p.z + dz, p.x, p.y, p.z);
    }, [dx, dz]);
    await page.waitForTimeout(400);
    await shot(`g_${g}_${n}`);
  }
}
await browser.close();
await server.close();
writeGallery(out);
