// The police beacon: B at the wheel puts it up by hand (glovebox, middle, out of the driver's window, onto the roof),
// then lights only, then takes it down. Frames of the whole move from the chase camera (and the cockpit).
// node debug-shots/siren.mjs <out dir> [view: chase|far|cockpit] [yaw rad: swings the camera round the car, 0 behind] [query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/siren';
const view = process.argv[3] ?? 'chase';
const yaw = Number(process.argv[4] ?? 0);
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript((v) => {
  localStorage.setItem('rainyplace.allCameraViews', '1');
  localStorage.setItem('rainyplace.driveView', v);
}, view);
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&time=night${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3500);
const key = async (code) => {
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), code);
};
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
// Out of the garage onto the street, and stopped.
const hold = async (code, ms) => {
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c })), code);
  await page.waitForTimeout(ms);
  await page.evaluate((c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c })), code);
};
await hold('KeyW', 2200);
await hold('KeyS', 2500);
if (yaw) {
  // (Swings the camera round the car as the mouse would: a pointer lock faked, a burst of movement, then idle moves to hold it.)
  await page.evaluate((y) => {
    Object.defineProperty(document, 'pointerLockElement', { get: () => document.body });
    const mv = (x, ys) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: ys }));
    let left = -y / 0.003;
    while (Math.abs(left) > 1) {
      const d = Math.max(-250, Math.min(250, left));
      mv(d, 0);
      left -= d;
    }
    mv(0, -40);
    setInterval(() => mv(0, 0), 40);
  }, yaw);
}
await page.waitForTimeout(1500);
let n = 0;
const frames = async (secs, step, tag) => {
  for (let t = 0; t < secs; t += step) {
    await page.screenshot({ path: `${out}/${tag}_${String(n++).padStart(2, '0')}.png` });
    await page.waitForTimeout(step * 1000);
  }
};
await page.screenshot({ path: `${out}/0_before.png` });
await key('KeyB');
await frames(4.6, 0.4, 'up');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/1_siren_on.png` });
await key('KeyB');
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/2_lights_only.png` });
await key('KeyB');
await frames(4.2, 0.4, 'down');
await page.screenshot({ path: `${out}/3_after.png` });
await browser.close();
await server.close();
