// Far chase look-round jitter: drives straight, swings the view to one side, and records each frame the camera's
// place against the drawn car's (second differences = jitter). node debug-shots/farjitter.mjs [out dir] [yaw rad] [spawn]
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/farjitter';
const yaw = Number(process.argv[3] ?? 1.5);
const spawn = process.argv[4] ?? 'city_garage.front';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const zoom = process.argv[5] ?? '1';
await page.addInitScript((z) => { localStorage.setItem('rainyplace.driveView', 'far'); localStorage.setItem('rainyplace.chaseZoom', z); }, zoom);
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&${spawn.includes(",") ? "cam=" + spawn : "spawn=" + spawn}&car=home`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);
const key = (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
await key('KeyW', true);
for (let i = 0; i < 3; i++) { await page.waitForTimeout(1000); console.log('u', await page.evaluate(() => [window.__own.sim.u.toFixed(1), window.__own.sim.x.toFixed(0), window.__own.sim.z.toFixed(0), !!window.__driving.car])); }
for (const look of [1.5, 0.8]) {
  await page.evaluate((l) => window.__driving.setLook(l, 0), look);
  await page.waitForTimeout(300);
  for (let k = 0; k < 3; k++) await page.screenshot({ path: `${out}/z${zoom}_look${look}_${k}.png` });
}
await browser.close();
await server.close();
