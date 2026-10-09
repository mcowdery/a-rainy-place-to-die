// The water: the park's pond (the user's F9 spot), the river from its west bank, the bay from the port's
// seawall; by day and at night. node debug-shots/water.mjs <out dir> [name] [query]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/water';
const name = process.argv[3] ?? 'shot';
const extra = process.argv[4] ? `&${process.argv[4]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// [label, x, y, z, yaw, pitch]
const SPOTS = [
  ['pond', 2654.9, 1.7, 1459.7, 46, -8],
  ['pond_low', 2654.9, 1.7, 1459.7, 46, -25],
  ['river', 4733, 1.7, 1350, -90, -6],
  ['river_along', 4733, 1.7, 1300, -160, -5],
  ['bay', 3100, 1.7, 2811, 180, -5],
  ['bay_down', 3100, 1.7, 2811, 150, -22],
];
// (A 5th argument, day or night, takes only those.)
for (const [when, clock] of [['day', '13:00'], ['night', '21:00']].filter(([w]) => !process.argv[5] || process.argv[5] === w)) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400));
  });
  await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&weather=clear&clock=${clock}&cam=2654.9,1.7,1459.7,46,-8${extra}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  let at = '';
  for (const [label, x, y, z, yaw, pitch] of SPOTS) {
    const spot = `${x},${z}`;
    await page.evaluate(([x, y, z, yaw, pitch]) => {
      window.__camera.position.set(x, y, z);
      window.__look(yaw, pitch);
    }, [x, y, z, yaw, pitch]);
    // (A new place: its chunks to stream in.)
    await page.waitForTimeout(spot === at ? 1200 : 9000);
    at = spot;
    await page.screenshot({ path: `${out}/${name}_${when}_${label}.png` });
  }
  const perf = await page.evaluate(() => {
    const p = window.__perf;
    const mean = (a) => a.slice(-120).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(120, a.length));
    return p ? `gpu ${mean(p.gpu).toFixed(2)} cpu ${mean(p.cpu).toFixed(2)}` : '';
  });
  console.log(when, perf);
  await page.close();
}
await browser.close();
await server.close();
