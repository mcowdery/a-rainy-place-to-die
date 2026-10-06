// The motorcycle helmet worn on foot: third person, and the review mirror's front and three-quarter, both looks.
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/helmetwear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.addInitScript(() => { try { localStorage.removeItem('citypop.wardrobe'); localStorage.removeItem('citypop.showroom.labels.fp'); } catch {} });
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.armed(false); });
for (const h of ['black', 'redblack']) {
  await page.evaluate((h) => { __fp.helmet(h); __fp.mirror(0); __fp.third(true); __fp.look(0, -0.08); }, h);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${h}_third.png` });
  for (const [m, n] of [[1, 'front'], [2, '34']]) {
    await page.evaluate((m) => __fp.mirror(m), m);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${h}_${n}.png` });
  }
}
await page.evaluate(() => { __fp.helmet(null); __fp.mirror(0); __fp.third(false); });
await browser.close(); await server.close();
writeGallery(out);
