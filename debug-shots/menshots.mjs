// The hair room (men.html): each of its views, the new figures only.
//   node debug-shots/menshots.mjs [out dir] [query] [views: parts of their names, comma separated]
// With no views: every row whole. Views are parts of their names ('close' is not special here: use 'stout' etc.).
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/men';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}men.html?labels=1${extra}&t=3`);
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
console.log(await page.evaluate(() => JSON.stringify(window.__mob.stats)));
const views = await page.evaluate(() => window.__mob.items);
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const want = (v) => (only ? only.some((o) => v.includes(o)) : !v.includes(':') && !v.includes('half'));
for (const v of views) {
  if (!want(v)) continue;
  await page.evaluate((n) => window.__focus(n), v);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${slug(v)}.png` });
}
writeGallery(out);
await browser.close();
await server.close();
