// Rain at Hotel Rouge: the floors indoors stay dry, the street outside (and seen from inside) stays wet.
//   node debug-shots/rougewet.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/rougewet';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&weather=rain&clock=22:30${q}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(7000);
};
const look = (pitchDeg, yawDeg) => page.evaluate(([p, y]) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180; e.y = (y * Math.PI) / 180; e.z = 0;
  cam.quaternion.setFromEuler(e);
}, [pitchDeg, yawDeg]);
const place = (x, y, z) => page.evaluate(([a, b, c]) => window.__camera.position.set(a, b, c), [x, y, z]);
const pos = () => page.evaluate(() => [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z]);
const shot = async (n, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); };
// The front faces south: yaw 0 looks north (inward), 180 south (out to the street). Local u runs east, t north.
await open('&spawn=hotel_rouge.lobby');
const h = await pos(); // u 12, t 5.4
const at = (u, t, y) => place(h[0] + (u - 12), y ?? h[1], h[2] - (t - 5.4));
await shot('a1_lobby_floor_dry', 2500);
await at(12, 6.5); await look(-35, 0); await shot('a2_lobby_floor_down');
await at(12, 6.0); await look(-3, 180); await shot('a3_from_inside_out_the_doors');
await open('&spawn=hotel_rouge.front');
await shot('b1_street_wet', 2500);
await look(-25, 0); await shot('b2_street_down');
await browser.close(); await server.close();
