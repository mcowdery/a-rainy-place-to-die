// Trees in the wind: a street of them and the park, in a breeze and at a typhoon's strength, a few frames apart
// (the same camera, so the frames can be flipped through). node debug-shots/treewind.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/treewind';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
// [label, x, y, z, yaw, pitch]
const SPOTS = [
  ['park', 2654.9, 1.7, 1459.7, 46, 4],
  ['riverwalk', 4733, 1.7, 1300, -160, 6],
];
for (const [name, query] of [['breeze', 'wind=0.2'], ['typhoon', 'wind=1&season=autumn&weather=rain&rain=0.9']]) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400));
  });
  await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&clock=13:00&windDir=90&cam=2654.9,1.7,1459.7,46,4&${query}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
  });
  let at = '';
  for (const [label, x, y, z, yaw, pitch] of SPOTS) {
    await page.evaluate(([x, y, z, yaw, pitch]) => {
      window.__camera.position.set(x, y, z);
      window.__look(yaw, pitch);
    }, [x, y, z, yaw, pitch]);
    // (The wind eases up to its strength over several seconds; a new place streams in.)
    await page.waitForTimeout(label === at ? 1000 : 12000);
    at = label;
    for (let i = 0; i < 4; i++) {
      await page.screenshot({ path: `${out}/${name}_${label}_${i}.png` });
      await page.waitForTimeout(450);
    }
  }
  page.on('console', (m) => console.log(m.text()));
  console.log(name, await page.evaluate(() => document.getElementById('info')?.textContent?.slice(0, 120) ?? ''));
  await page.close();
}
await browser.close();
await server.close();
