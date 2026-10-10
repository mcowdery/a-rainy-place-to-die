// 歌舞路交番 Kaburo Kōban: from the square at night and by day, its side wall, inside; and the GPS line to it.
//   node debug-shots/koban.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/koban';
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
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(5000);
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
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
// The front faces north onto the square: yaw 180 looks south at it, 90 west, 0 north.
await open('&spawn=koban.front&clock=22:30');
await shot('a1_front_night');
const f = await pos();
await place(f[0] - 9, f[1], f[2] - 6); await look(4, 145); await page.waitForTimeout(1200); await shot('a2_corner_night');
await place(f[0] - 9, f[1], f[2] + 12.5); await look(2, -90); await page.waitForTimeout(1200); await shot('a3_side_wall');
await place(f[0], f[1], f[2] + 7.5); await look(-6, 180); await page.waitForTimeout(1200); await shot('b1_inside');
await look(-4, 120); await page.waitForTimeout(800); await shot('b2_inside_posters');
await open('&spawn=koban.front&clock=12:00');
await shot('c1_front_day');
// The GPS line: from the crossing, looking toward a destination 250 m off and one 60 m off.
await open('&spawn=kaburo_crossing.view&clock=22:30');
const toward = (id, pitch) => page.evaluate(([n, p]) => {
  const node = window.__district.nodes.find((q) => q.id === n);
  window.__gps(n);
  const c = window.__camera;
  const e = new c.rotation.constructor().setFromQuaternion(c.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  e.y = Math.atan2(-(node.x - c.position.x), -(node.z - c.position.z));
  e.z = 0;
  c.quaternion.setFromEuler(e);
  return Math.hypot(node.x - c.position.x, node.z - c.position.z);
}, [id, pitch]);
console.log('far', await toward('hotel_rouge.front', 12)); await page.waitForTimeout(2500); await shot('d1_gps_far');
console.log('near', await toward('yasuichi.front', 8)); await page.waitForTimeout(2500); await shot('d2_gps_near');
await browser.close(); await server.close();
writeGallery(out);
