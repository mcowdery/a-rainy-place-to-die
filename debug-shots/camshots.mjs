// Photographs the city from given cameras (an F9 snapshot's camera and yaw, say), by day, clear: to compare two checkouts.
//   node debug-shots/camshots.mjs <out dir> <x,y,z,yawDeg,pitchDeg> [...more] [--query extra=1&...]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';

const args = process.argv.slice(2);
const out = args[0] ?? 'debug-shots/camshots';
const qi = args.indexOf('--query');
const extra = qi >= 0 ? `&${args[qi + 1]}` : '';
const cams = args.slice(1).filter((a, i) => !a.startsWith('--') && args[i] !== '--query').map((a) => a.split(',').map(Number));
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 640 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
  for (const [i, [x, y, z, yaw, pitch]] of cams.entries()) {
    await page.goto(`${base}?debug=1&diag=1&fly=1&eracard=0&cam=${x},${y},${z},${yaw},${pitch}&clock=12:00&weather=clear${extra}`);
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240_000, polling: 500 });
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
    // (The game's yaw: facing -z at 0, turning toward -x as it grows.)
    await page.evaluate(({ x, y, z, yaw, pitch }) => {
      const c = window.__camera;
      const r = (yaw * Math.PI) / 180;
      const p = (pitch * Math.PI) / 180;
      c.position.set(x, y, z);
      c.lookAt(x - Math.sin(r) * Math.cos(p) * 100, y + Math.sin(p) * 100, z - Math.cos(r) * Math.cos(p) * 100);
    }, { x, y, z, yaw, pitch });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${out}/cam${i}.png` });
    console.log('cam', i);
  }
} finally {
  await browser.close();
  await server.close();
}
