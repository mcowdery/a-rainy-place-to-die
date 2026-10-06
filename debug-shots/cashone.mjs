// Cash One and 質 マルヨシ (the back alleys' mixed-tenant building): the front, the pawn shop, the stair, the office.
//   node debug-shots/cashone.mjs <out dir> [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/cashone';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1${q}${extra}`);
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
// The front faces east: yaw 90 looks west at it, 0 north, -90 east. Local u runs north along the front, t west.
await open('&spawn=cash_one.front&clock=22:30');
await shot('a1_front_night', 200);
const f = await pos();
await place(f[0] + 5, f[1], f[2] + 5); await look(28, 70); await shot('a2_up_night');
await place(f[0] - 8.2, f[1], f[2] - 1.0); await look(-8, 90); await shot('b1_pawn_door', 2500);
await place(f[0] - 10.2, f[1], f[2] + 0.2); await look(-10, 75); await shot('b2_pawn_cases');
await place(f[0] - 15.0, f[1], f[2] - 2.2); await look(-6, 100); await shot('b3_pawn_counter');
await place(f[0] - 7.9, f[1], f[2] + 3.13); await look(18, 90); await shot('c1_stair', 2500);
await open('&spawn=cash_one.office&clock=22:30');
await shot('d1_lobby', 200);
const o = await pos();
await place(o[0] - 0.6, o[1], o[2] - 2.4); await look(-8, 90); await shot('d2_counter');
await place(o[0] - 8.5, o[1], o[2] - 4.7); await look(-6, -80); await shot('d3_from_back');
await place(o[0] - 3.0, o[1], o[2] - 4.6); await look(-10, 120); await shot('d4_desks');
await open('&spawn=cash_one.front&clock=13:00');
await shot('e1_front_day', 200);
await browser.close(); await server.close();
writeGallery(out);
