// Mack's head from behind and above, as third person sees it: node debug-shots/fphead.mjs <outdir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/third';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${base}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; __fp.third(true); __fp.armed(false); __fp.look(0, 0); });
await page.waitForTimeout(800);
await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; const y = __fp.rig().eyeHeight; window.__c = [c.x, c.z, y]; });
const views = { 'h1_back': [0, 0.7, 0.05], 'h2_back_high': [0.15, 0.6, 0.45], 'h3_back_right': [0.5, 0.5, 0.1], 'h5_back_right_far': [0.9, 0.9, 0.15], 'h4_side': [0.7, 0.0, 0.0] };
for (const [name, [dx, dz, dy]] of Object.entries(views)) {
  await page.evaluate(([dx, dz, dy]) => { const [x, z, y] = window.__c; __view(x + dx, y + dy, z + dz, x, y - 0.02, z - 0.05); }, [dx, dz, dy]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close();
await server.close();
writeGallery(out);
