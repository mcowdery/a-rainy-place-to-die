// The lit windows and who's behind them through a night (real/city.ts, windowScenes.ts windowsAt): one page a spawn,
// the clock moved on from hour to hour, a shot at each with the share of windows lit by kind of building.
//   node debug-shots/windowhours.mjs <out dir> [query] [spawn,spawn...] [hours: 18:30,21:00,00:30,03:30,06:30] [yaw:pitch]
// The query can set the weather and the season (weather=rain, season=winter).
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/windowpeople/hours';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const spawns = (process.argv[4] ?? 'kaburo_crossing.view,kopo_sakura.front').split(',');
const hours = (process.argv[5] ?? '18:30,21:00,00:30,03:30,06:30').split(',');
const [yaw, pitch] = (process.argv[6] ?? '0:14').split(':').map(Number);
const mins = (h) => Number(h.split(':')[0]) * 60 + Number(h.split(':')[1]);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const spawn of spawns) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${/weather=/.test(extra) ? '' : '&weather=clear'}&res=100&spawn=${spawn}&clock=${hours[0]}${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 250 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  // (With ?debug=1 the page's __look is the car's, so the view is turned here: up a little from the spawn's own.)
  const y0 = await page.evaluate(() => new window.__camera.rotation.constructor().setFromQuaternion(window.__camera.quaternion, 'YXZ').y);
  let at = mins(hours[0]);
  for (const h of hours) {
    const step = (mins(h) - at + 1440) % 1440;
    at = mins(h);
    if (step) await page.evaluate((m) => window.__clock.advance(m), step);
    await page.waitForTimeout(7000);
    await page.evaluate(([y, p]) => window.__camera.quaternion.setFromEuler(new window.__camera.rotation.constructor(p, y, 0, 'YXZ')), [y0 + (yaw * Math.PI) / 180, (pitch * Math.PI) / 180]);
    await page.waitForTimeout(1500);
    const lit = await page.evaluate(() => {
      const U = window.__city;
      const wl = U.uWindowLit.value, k = U.uLit.value.toArray();
      const office = (x) => { let n = 0; for (let i = 0; i < 4000; i++) if (0.65 * ((i * 0.6180339) % 1) + 0.35 * ((i * 0.7548776) % 1) < x) n++; return n / 4000; };
      const share = (f, through = (x) => x) => { let s = 0; for (let b = 0; b < 8; b++) s += through(Math.min(1, wl * (0.35 + (1.3 * b) / 7) * f)); return Math.round((s / 8) * 100); };
      return { clock: window.__clock.now?.(), atmosphere: +wl.toFixed(2), homes: share(k[1]), offices: share(k[0], office), hotels: share(k[2]), nightlife: share(k[3]), folk: U.uFolk.value.toArray().map((v) => +v.toFixed(2)), night: U.uNight.value.toArray().map((v) => +v.toFixed(2)) };
    });
    const name = `${spawn.replace(/\W+/g, '_')}_${h.replace(':', '')}`;
    console.log(name, 'lit %', JSON.stringify(lit));
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await page.close();
}
await browser.close();
await server.close();
