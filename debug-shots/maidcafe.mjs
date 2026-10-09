// めいどかふぇ ♡ぴゅあ♡: the front (night and day), the stair hall, the café upstairs; and a shot at a wall.
//   node debug-shots/maidcafe.mjs <out dir> [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/maidcafe';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
// ONLY=c,e runs only those groups of shots (a front, b hall, c café, d day, e gunfire).
const only = process.env.ONLY?.split(',');
const want = (g) => !only || only.includes(g);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${q}${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(5000);
};
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
const tap = async (code) => { await key(code, true); await key(code, false); };
const look = (pitchDeg, yawDeg) => page.evaluate(([p, y]) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  if (y !== undefined) e.y = (y * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, [pitchDeg, yawDeg]);
/** Put the camera at world (x, eye y, z). */
const place = (x, y, z) => page.evaluate(([a, b, c]) => window.__camera.position.set(a, b, c), [x, y, z]);
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

// The front, at night and by day (the building faces west onto Denkō-dōri: yaw -90 looks east at it; yaw 0
// looks north, 90 west toward the street, 180 south).
if (want('a') || want('b')) {
await open('&spawn=maid_cafe.front&clock=22:30');
await shot('a1_front_night');
await look(22); await page.waitForTimeout(800); await shot('a2_signs_night');
// Back across the street for the whole building.
const front = await page.evaluate(() => [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z]);
await place(front[0] - 12, front[1], front[2] + 4); await look(10, -100); await page.waitForTimeout(1500); await shot('a3_across_night');
// The doorway, then inside: the stair hall and up.
await place(front[0] + 4, front[1], front[2] - 3.5); await look(2, -90); await page.waitForTimeout(1500); await shot('b1_door');
await place(front[0] + 6.5, front[1], front[2] - 3.5); await page.waitForTimeout(1500); await shot('b2_hall');
await look(25, -90); await page.waitForTimeout(800); await shot('b3_stair_up');
}
// The café: from the arrival spawn, then round the room: the maid, the windows, the stage, the counter.
if (want('c')) {
await open('&spawn=maid_cafe.inside&clock=22:30');
await shot('c1_arrive');
await look(-8, 40); await page.waitForTimeout(800); await shot('c2_maid');
await look(-10, 120); await page.waitForTimeout(800); await shot('c3_to_windows');
await look(-10, 150); await page.waitForTimeout(800); await shot('c4_to_stage');
await look(-8, 185); await page.waitForTimeout(800); await shot('c5_counter');
const cafe = await page.evaluate(() => [window.__camera.position.x, window.__camera.position.y, window.__camera.position.z]);
// From the windows looking back at the room.
await place(cafe[0] - 12.5, cafe[1], cafe[2] + 2.5); await look(-12, -100); await page.waitForTimeout(1000); await shot('c6_from_window');
}
// By day.
if (want('d')) {
await open('&spawn=maid_cafe.front&clock=13:00');
await shot('d1_front_day');
await open('&spawn=maid_cafe.inside&clock=13:00');
await look(-10, 120); await page.waitForTimeout(800); await shot('d2_inside_day');
}
// A shot: the shotgun at the wall across the street.
if (want('e')) {
await open('&spawn=maid_cafe.front&clock=22:30');
await look(-4, 90); await page.waitForTimeout(600);
await tap('KeyX'); await page.waitForTimeout(900);
await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousedown', { button: 2 })));
await page.waitForTimeout(900);
const fired = await page.evaluate(() => window.__fire());
await page.waitForTimeout(60); await shot('e1_fire');
await page.waitForTimeout(500); await shot('e2_after');
console.log('fired', fired);
}
await browser.close(); await server.close();
writeGallery(out);
