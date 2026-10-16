// The beacon hand-over, one pose at a time: B puts the beacon up, the stage is held (`__siren.paused`) and moved to each
// time (`__siren.seek`), and the cockpit camera looks where the hands are (left and down at the glovebox, ahead at the
// middle, right out of the driver's window and up at the roof). node debug-shots/sirenpose.mjs <out dir> [stow]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/sirenpose';
const stow = process.argv[3] === 'stow';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
await page.addInitScript(() => localStorage.setItem('rainyplace.driveView', 'cockpit'));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&time=night`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(3500);
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
await page.evaluate(() => window.__drive());
await page.waitForTimeout(2500);
await key('KeyW', true);
await page.waitForTimeout(2200);
await key('KeyW', false);
await key('KeyS', true);
await page.waitForTimeout(2500);
await key('KeyS', false);
await page.waitForTimeout(800);
// A mouse at hand: a faked pointer lock, and each look as a burst of movement then idle moves to hold it.
await page.evaluate(() => {
  Object.defineProperty(document, 'pointerLockElement', { get: () => document.body });
  window.__mv = (x, y) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y }));
  setInterval(() => window.__mv(0, 0), 40);
});
const look = async (yaw, pitch) => {
  // (Back to ahead first: the look eases; then the burst.)
  await page.evaluate(([y, p]) => {
    const look = window.__lookNow?.();
    void look;
    let left = -y / 0.003;
    while (Math.abs(left) > 1) {
      const d = Math.max(-250, Math.min(250, left));
      window.__mv(d, 0);
      left -= d;
    }
    window.__mv(0, -p / 0.003);
  }, [yaw, pitch]);
};
if (stow) {
  await page.evaluate(() => window.__siren.set('lights'));
  await page.waitForTimeout(500);
}
await key('KeyB', true);
await key('KeyB', false);
await page.evaluate(() => {
  window.__siren.paused = true;
});
const times = stow ? [0.3, 0.8, 1.1, 1.5, 2.0, 2.4, 2.8, 3.2, 3.6] : [0.4, 0.8, 1.2, 1.7, 2.2, 2.7, 3.0, 3.3, 3.8];
const views = {
  glove: [0.9, -0.25],
  mid: [0, -0.2],
  right: [-1.5, 0.15],
};
let cur = 'ahead';
const face = async (name) => {
  if (name === cur) return;
  // Undo the last turn, then make this one (yaw accumulates, so each is relative to ahead).
  const prev = views[cur] ?? [0, 0];
  await look(-prev[0], -prev[1]);
  const to = views[name] ?? [0, 0];
  await look(to[0], to[1]);
  cur = name;
};
for (const t of times) {
  await page.evaluate((tt) => window.__siren.seek(tt), t);
  const name = stow ? (t < 2.0 ? 'right' : t < 2.6 ? 'mid' : 'glove') : t < 1.1 ? 'glove' : t < 2.0 ? 'mid' : 'right';
  await face(name);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${String(t).replace('.', '_')}_${name}.png` });
}
await browser.close();
await server.close();
