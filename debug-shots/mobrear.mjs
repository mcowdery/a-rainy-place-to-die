// The characters page (characters.html): every view of the named characters and of the bare body they are built on.
//   node debug-shots/mobrear.mjs [out dir] [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/mobrear';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? "&" + process.argv[3] : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(server.resolvedUrls.local[0] + 'characters.html?labels=0&t=3' + extra);
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
console.log(await page.evaluate(() => JSON.stringify(window.__mob.stats.shaped)));
const views = await page.evaluate(() => window.__mob.items);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 48);
const shot = async (name) => { await page.waitForTimeout(200); await page.screenshot({ path: out + '/' + name + '.png' }); };
for (const v of views) {
  await page.evaluate((n) => window.__focus(n), v);
  await shot(slug(v));
}
writeGallery(out);
await browser.close();
await server.close();
