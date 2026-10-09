// Rain on a car, up close: your car set down in the street in front of the garage, wet, by day and at night:
// the bonnet and roof (beads), the door and the windscreen (drops running down), and from a few metres off.
// node debug-shots/carrain.mjs <out dir> [name]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/carrain';
const name = process.argv[3] ?? 'shot';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// Camera relative to the car (forward, left, up) and what it looks at (the same frame).
const VIEWS = [
  ['bonnet', [2.6, 0.9, 1.5], [1.5, 0, 0.8]],
  ['bonnet_close', [2.0, 0.55, 1.15], [1.6, 0.15, 0.82]],
  ['roof', [0.2, 1.5, 1.9], [-0.2, 0, 1.25]],
  ['door', [0.3, 1.9, 1.1], [0.1, 0.85, 0.75]],
  ['door_close', [0.2, 1.3, 0.95], [0.1, 0.85, 0.8]],
  ['windscreen', [1.9, 0.7, 1.5], [0.9, 0, 1.05]],
  ['off', [4.5, 3.0, 1.7], [0, 0, 0.7]],
];
for (const [when, clock] of [['day', '13:00'], ['night', '21:00']]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400));
  });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&weather=rain&rain=0.5&wet=1&res=100&clock=${clock}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
    // The car out in the street, a few metres in front of where you stand.
    const c = window.__camera.position;
    window.__own.place(c.x, c.z + 6, 0.6);
  });
  await page.waitForTimeout(3000);
  for (const [label, at, look] of VIEWS) {
    await page.evaluate(([at, look]) => {
      const s = window.__own.sim;
      const f = [Math.sin(s.h), Math.cos(s.h)];
      const l = [Math.cos(s.h), -Math.sin(s.h)];
      const P = ([a, b, y]) => [s.x + f[0] * a + l[0] * b, s.y + y, s.z + f[1] * a + l[1] * b];
      const cam = window.__camera;
      cam.position.set(...P(at));
      cam.lookAt(...P(look));
    }, [at, look]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}_${when}_${label}.png` });
  }
  await page.close();
}
await browser.close();
await server.close();
