// Mack's face styles in the showroom's review mirror: each style front and three-quarter, the bare face in each
// pair of sunglasses, and the helmet in third person.  node debug-shots/faces.mjs <outdir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/faces';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.addInitScript(() => { try { localStorage.removeItem('citypop.wardrobe'); } catch {} });
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '.label { visibility: hidden !important; }' });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.third(false); __fp.armed(false); __fp.look(Math.PI * 0.8, 0); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const styles = ['shadow', 'brim', 'none', 'mosaic', 'blur', 'smooth', 'chrome', 'bar', 'robo'];
for (const [i, s] of styles.entries()) {
  for (const [m, tag] of [[1, 'front'], [2, '34']]) {
    await page.evaluate(([s, m]) => { __fp.face(s); __fp.mirror(m); }, [s, m]);
    await page.waitForTimeout(700);
    await shot(`f${i}_${s}_${tag}`);
  }
}
for (const g of ['wrap', 'aviator', 'slim']) {
  await page.evaluate((g) => { __fp.face('none'); __fp.wear('leathers', g); __fp.mirror(2); }, g);
  await page.waitForTimeout(800);
  await shot(`g_${g}_bare`);
}
await page.evaluate(() => { __fp.wear('leathers', null); __fp.face('robo'); __fp.mirror(0); __fp.third(true); __fp.look(Math.PI * 0.8, -0.05); });
await page.waitForTimeout(800);
await shot('robo_third');
await page.evaluate(() => { __fp.face('shadow'); });
await browser.close();
await server.close();
writeGallery(out);
