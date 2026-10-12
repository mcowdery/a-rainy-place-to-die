// The beacon hand-over seen from outside the car: a new game's start (the open deck out of the Yūnagi tunnel), the car
// stopped, the far chase swung round to one side, the hand-over held at each time (`__siren.seek`).
// node debug-shots/sirenside.mjs <out dir> <yaw rad: + one side, - the other> [view far|chase]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/sirenside';
const yaw = Number(process.argv[3] ?? 1.5);
const view = process.argv[4] ?? 'far';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript((v) => {
  localStorage.setItem('rainyplace.allCameraViews', '1');
  localStorage.setItem('rainyplace.driveView', v);
}, view);
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=night&spawn=kaburo_crossing.view`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3000);
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
await page.evaluate(() => window.__drive());
await page.waitForTimeout(2500);
await key('KeyS', true);
await page.waitForTimeout(3000);
await key('KeyS', false);
await page.waitForTimeout(500);
await page.evaluate((y) => {
  Object.defineProperty(document, 'pointerLockElement', { get: () => document.body });
  const mv = (x, ys) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: ys }));
  let left = -y / 0.003;
  while (Math.abs(left) > 1) {
    const d = Math.max(-250, Math.min(250, left));
    mv(d, 0);
    left -= d;
  }
  mv(0, -60);
  setInterval(() => mv(0, 0), 40);
}, yaw);
await page.waitForTimeout(800);
await key('KeyB', true);
await key('KeyB', false);
await page.evaluate(() => {
  window.__siren.paused = true;
});
for (const t of [0.8, 1.7, 2.2, 2.7, 3.0, 3.4]) {
  await page.evaluate((tt) => window.__siren.seek(tt), t);
  await page.waitForTimeout(900);
  console.log(t, await page.evaluate(() => JSON.stringify({ busy: window.__siren.busy, mode: window.__siren.mode, hands: window.__siren.hands(), vis: window.__chase?.vis?.() })));
  await page.screenshot({ path: `${out}/${String(t).replace('.', '_')}.png` });
}
await browser.close();
await server.close();
