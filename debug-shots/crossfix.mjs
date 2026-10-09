// The three reported spots (two avenue crossings whose halves didn't line up, a square pavement corner), each from
// the reporter's camera and from above. node debug-shots/crossfix.mjs <out dir> <name>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/crossfix';
const name = process.argv[3] ?? 'shot';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// Each spot: the reporter's camera [x, y, z, yaw, pitch], then views from above [x, y, z, yaw, pitch].
const SPOTS = [
  { id: 'asagiri', cam: [3065.1, 1.7, 1538.7, 47, -14], above: [[3061, 34, 1537, 0, -88], [3074, 14, 1552, 50, -38]] },
  { id: 'kaburo', cam: [3834.5, 1.7, 1284.6, 15, -14], above: [[3831, 34, 1281, 0, -88], [3842, 14, 1298, 40, -38]] },
  { id: 'corner', cam: [3765.2, 1.7, 1547.6, 99, -14], above: [[3756, 22, 1551, 0, -88], [3764, 7, 1541, 150, -35]] },
  // Other cases of the same fixes (only when named): a staggered junction at the city's edge (one box for the
  // outer street and the street across the line), a pavement-less cell-edge lane crossing a street at a grid corner.
  { id: 'verge', extra: true, cam: [1930, 30, 262, 0, -88], above: [[1930, 30, 250, 0, -88], [1950, 16, 275, 60, -40]] },
  { id: 'lane', extra: true, cam: [2180, 22, 254, 0, -88], above: [[2560, 24, 142, 0, -88], [2170, 9, 262, -50, -35], [2176, 34, 256, 0, -88], [2548, 7, 142, -90, -22]] },
];
const only = process.argv[4]?.split(',');
const open = async (spot) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&clock=13:00&weather=clear&res=100&cam=${spot.cam.join(',')}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  return page;
};
for (const spot of SPOTS) {
  if (only ? !only.includes(spot.id) : spot.extra) continue;
  // (Other work loads the district at the same time: one retry on a slow load.)
  const page = await open(spot).catch(() => open(spot));
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${out}/${name}_${spot.id}_user.png` });
  for (const [i, v] of spot.above.entries()) {
    await page.evaluate(([x, y, z, yaw, pitch]) => { window.__camera.position.set(x, y + (window.__district.terrain?.height(x, z) ?? 0), z); window.__look(yaw, pitch); }, v);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${name}_${spot.id}_above${i}.png` });
  }
  console.log('shot', spot.id);
  await page.close();
}
await browser.close();
await server.close();
