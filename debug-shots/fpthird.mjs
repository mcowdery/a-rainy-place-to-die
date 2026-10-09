// Third person and the shadowed face: node debug-shots/fpthird.mjs <outdir>
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/third';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${base}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; });
const shot = async (name, fn, wait = 700) => { await page.evaluate(fn); await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
await shot('1_third', () => { __fp.third(true); __fp.armed(false); __fp.look(0, -0.1); });
await shot('2_third_gun', () => { __fp.armed(true); __fp.look(0, -0.05); });
await shot('3_third_aim', () => { __fp.aim(true); });
await shot('4_third_up', () => { __fp.aim(false); __fp.look(0, 0.7); });
await shot('5_third_down', () => { __fp.look(0, -0.9); });
await shot('6_third_walk', () => { __fp.look(0.6, -0.1); __fp.walk(true); __fp.run(true); }, 900);
await page.evaluate(() => { __fp.walk(false); __fp.run(false); __fp.armed(false); __fp.look(0, 0); });
await page.waitForTimeout(800);
// From outside, the face: front, 3/4, profile.
await page.evaluate(() => { __fp.freeze(true); const c = __fp.rig().object.children[0].position; const y = __fp.rig().eyeHeight; window.__c = [c.x, c.z, y]; });
const views = { '7_front': [0, -1.2], '8_three_quarter': [0.8, -0.9], '9_profile': [1.2, -0.05], '10_close_front': [0.15, -0.55] };
for (const [name, [dx, dz]] of Object.entries(views)) {
  await page.evaluate(([dx, dz]) => { const [x, z, y] = window.__c; __view(x + dx, y - 0.02, z + dz, x, y - 0.05, z - 0.05); }, [dx, dz]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close();
await server.close();
writeGallery(out);
