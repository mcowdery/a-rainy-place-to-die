// 霧島探偵事務所 (the detective's office, Kaburo): the tenement's front, then the baked Blender room from inside.
//   node debug-shots/kirishima.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/kirishima';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (/interior model|warn|error/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200)); });
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${q}${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(6000);
};
const look = (pitchDeg, yawDeg) => page.evaluate(([p, y]) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  if (y !== undefined) e.y = (y * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, [pitchDeg, yawDeg]);
const place = (x, y, z) => page.evaluate(([a, b, c]) => window.__camera.position.set(a, b, c), [x, y, z]);
const pos = () => page.evaluate(() => [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z]);
const shot = async (n, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); };
// The front faces south: yaw 180 looks south, 0 north (inward). Local u runs east, t north (inward).
await open('&spawn=kirishima.front&clock=22:30');
await shot('a1_front_night', 200);
const f = await pos();
await place(f[0] + 1.5, f[1], f[2] + 2); await look(32, 20); await shot('a2_sign_up');
await open('&spawn=kirishima.front&clock=13:00');
await shot('a3_front_day', 200);
await open('&spawn=kirishima.home&clock=22:30');
await shot('b1_inside_door', 2500);
const h = await pos(); // u 2.0, t 3.2
const at = (u, t) => place(h[0] + (u - 2.0), h[1], h[2] - (t - 3.2));
await at(3.2, 4.5); await look(-6, 90); await shot('b2_sofa_side');
await at(2.0, 6.8); await look(-8, 0); await shot('b3_toward_desk');
await at(2.0, 9.0); await look(-12, 0); await shot('b4_desk_close');
await at(1.0, 7.7); await look(0, -90); await shot('b5_case_board');
await at(2.0, 10.8); await look(-4, 180); await shot('b6_back_to_door');
await at(2.0, 10.9); await look(-6, 0); await shot('b7_window_blinds');
await browser.close(); await server.close();
writeGallery(out);
