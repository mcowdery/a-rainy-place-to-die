// 霞町総合病院: the forecourt and tower (night and day), the lobby, the ward on 5F, the basement.
//   node debug-shots/hospital.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/hospital';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${q}${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 500000, polling: 500 });
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
// The front faces south onto Kasumi-dori: yaw 0 looks north at it, 90 west, -90 east, 180 south.
// Local u runs east along the front (+x), t north into the building (-z).
await open('&spawn=hospital.front&clock=22:30');
await shot('a1_front_night', 200);
const f = await pos();
await place(f[0] - 4, f[1] + 1, f[2] + 16); await look(22, -6); await shot('a2_tower_night');
await place(f[0] + 12, f[1], f[2] - 2); await look(4, -40); await shot('a3_emergency');
await place(f[0], f[1], f[2] - 6); await look(2, 0); await shot('a4_canopy');
// The lobby: just inside the doors, then toward the counter and the benches, then the elevators.
await place(f[0], f[1], f[2] - 18.5); await look(-4, 0); await shot('b1_lobby', 3000);
await place(f[0] - 1, f[1], f[2] - 23); await look(-8, 70); await shot('b2_counter');
await place(f[0] + 2, f[1], f[2] - 24); await look(-6, -80); await shot('b3_kiosk');
await place(f[0], f[1], f[2] - 31); await look(0, 0); await shot('b4_elevators');
await open('&spawn=hospital.ward&clock=22:30');
await shot('c1_ward_arrive', 200);
const w = await pos();
await place(w[0], w[1], w[2] + 2.9); await look(-4, -90); await shot('c2_corridor_east');
await look(-4, 90); await shot('c3_corridor_west');
await look(-6, 180); await shot('c4_nurse_station');
await place(w[0] - 19, w[1], w[2] + 5.5); await look(-6, 60); await shot('c5_day_room');
await place(w[0] + 19.5, w[1], w[2] + 2.9); await look(0, -90); await shot('c6_room_501');
await open('&spawn=hospital.basement&clock=22:30');
await shot('d1_b1_arrive', 200);
const bp = await pos();
await place(bp[0], bp[1], bp[2] + 2.7); await look(-2, 90); await shot('d2_b1_west');
await place(bp[0] - 13, bp[1], bp[2] + 2.7); await look(-2, 90); await shot('d3_sealed_door');
await look(-6, 150); await shot('d4_gurney');
await open('&spawn=hospital.front&clock=13:00');
await shot('e1_front_day', 200);
const g = await pos();
await place(g[0] - 30, g[1] + 6, g[2] + 30); await look(14, -40); await shot('e2_whole_day');
await browser.close(); await server.close();
writeGallery(out);
