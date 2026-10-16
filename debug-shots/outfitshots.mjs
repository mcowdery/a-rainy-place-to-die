// The mob showroom (mob.html): the views whose names contain the given parts, the sculpted generation only (for the Filipino outfits: node debug-shots/outfitshots.mjs debug-shots/outfits '' filipino).
//   node debug-shots/mobshots.mjs [out dir] [query] [views: parts of their names, comma separated]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/mob';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}mob.html?labels=0${extra}&t=3`);
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
console.log(await page.evaluate(() => JSON.stringify(window.__mob.stats)));
const views = await page.evaluate(() => window.__mob.items);
const key = (code) => page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
for (const gen of ['new']) {
  await key('KeyM');
  if (gen === 'new') { await key('KeyM'); await key('KeyM'); }
  for (const v of views) {
    if (only && !only.some((o) => v.includes(o))) continue;
    await page.evaluate((n) => window.__focus(n), v);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${slug(v)}_${gen}.png` });
  }
}
writeGallery(out);
await browser.close();
await server.close();
