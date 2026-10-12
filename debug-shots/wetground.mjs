// Is the ground wet in rain? One load, the same view at the spot of a user's snapshot, wetness set live
// (0, 0.5, 1, then back to following the rain, which needs a minute to wet through).
//   node debug-shots/wetground.mjs <out dir> [x z yaw]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/wetground';
const [x, z, yaw] = [process.argv[3] ?? 3962.3, process.argv[4] ?? 1417.9, process.argv[5] ?? 133].map(Number);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=dawn&weather=rain`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 420000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.evaluate(([x, z, yaw]) => {
  window.__camera.position.set(x, 1.7, z);
  const e = new window.__camera.rotation.constructor(-0.5, (-yaw * Math.PI) / 180, 0, 'YXZ');
  window.__camera.quaternion.setFromEuler(e);
}, [x, z, yaw]);
for (const wet of [0, 0.5, 1, null]) {
  await page.evaluate((w) => { window.__mood.wetness = w; }, wet);
  await page.waitForTimeout(wet === null ? 20000 : 4000);
  console.log(wet, await page.evaluate(() => ({ uWet: window.__city.uWet.value, rain: document.body.innerText.match(/rain [\d.]+/)?.[0] })));
  await page.screenshot({ path: `${out}/wet_${wet ?? 'rain'}.png` });
}
await browser.close(); await server.close();
