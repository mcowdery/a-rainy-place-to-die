// The mob showroom's 'shady' stage, one figure at a time from chosen angles.
//   node debug-shots/shadyshots.mjs <out dir> <figures: indexes, comma separated, or 'all'> [angles: front,back,side,head,headside,headback,top] [stage] [count]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/shady1';
mkdirSync(out, { recursive: true });
const stage = process.argv[5] ?? 'shady';
const N = Number(process.argv[6] ?? 30);
const which = !process.argv[3] || process.argv[3] === 'all' ? Array.from({ length: N }, (_, i) => i) : process.argv[3].split(',').map(Number);
const angles = (process.argv[4] ?? 'front,back').split(',');
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}mob.html?labels=0&t=3&still=1`);
await page.waitForFunction(() => window.__mob, null, { timeout: 120000 });
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.getElementById('hud').style.display = 'none'; });
await page.evaluate((n) => window.__focus(n), stage);
await page.waitForTimeout(300);
const z = await page.evaluate(() => { const p = window.__mob.camera.position; return p.z - (p.y - 1) / 0.04; });
const step = 1.3, x0 = (-(N - 1) * step) / 2;
const VIEWS = {
  front: [0.5, 1.25, 3.3, 0, 0.98, 0],
  back: [-0.5, 1.25, -2.1, 0, 0.98, 0],
  side: [3.2, 1.2, 0.3, 0, 0.98, 0],
  head: [0.3, 1.78, 1.0, 0, 1.68, 0],
  headside: [1.0, 1.75, 0.15, 0, 1.68, 0],
  headback: [-0.35, 1.8, -1.0, 0, 1.68, 0],
  top: [0.5, 2.75, 1.25, 0, 1.75, 0],
  diag: [2.0, 1.2, 1.6, 0, 1.0, 0],
  diagback: [-2.0, 1.2, -1.5, 0, 1.0, 0],
  chest: [0.35, 1.5, 1.3, 0, 1.3, 0],
  chestback: [-0.35, 1.5, -1.3, 0, 1.3, 0],
};
for (const c of which) {
  const x = x0 + c * step;
  for (const a of angles) {
    const v = VIEWS[a];
    await page.evaluate(([x, z, v]) => window.__view(x + v[0], v[1], z + v[2], x + v[3], v[4], z + v[5]), [x, z, v]);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/${String(c).padStart(2, '0')}_${a}.png` });
  }
}
await browser.close();
await server.close();
