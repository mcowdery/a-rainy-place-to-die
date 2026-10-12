// Hotel Rouge, the big plan, in the city: the outside, the entrance, the lobby and hall, the stair, and every room shut then
// opened (the doors flipped through the same state E flips).
//   node debug-shots/rougexl.mjs <out dir> [only: rooms or sections, comma separated: out,doors,lobby,hall,stair,201,303 ...] [tp]
// (`tp`: in third person, Mack standing where the camera is put, for judging the furniture's size against him.)
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, readFileSync } from 'fs';
const plan = JSON.parse(readFileSync(new URL('../content/world3d/rouge_plan.json', import.meta.url), 'utf8'));
const out = process.argv[2] ?? 'debug-shots/rougexl_game';
const only = (process.argv[3] ?? '').split(',').filter(Boolean);
const third = process.argv[4] === 'tp';
const want = (k) => only.length === 0 || only.includes(k);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (/interior model|failed/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 200)); });
await page.addInitScript((tp) => { try { localStorage.setItem('rainyplace.thirdPerson', tp ? '1' : '0'); } catch {} }, third);
const open = async (q) => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=22:30${q}`);
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
const shot = async (n, wait = 1200) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); };
const flip = (key) => page.evaluate(async (k) => { (await import('/src/poc3d/real/swingDoors.ts')).toggleDoor(k); }, key);
// The front faces south: yaw 0 looks north (inward), 180 south (out), 90 west, -90 east. Local u runs east, t north.
await open('&spawn=hotel_rouge.lobby');
const h = await pos(); // u 17, t 5.4, floor 0
const at = (u, t, y) => place(h[0] + (u - 17), y ?? h[1], h[2] - (t - 5.4));
const eye = h[1];
if (want('out')) {
  await open('&spawn=hotel_rouge.front');
  const f = await pos(); // u 21, t -11.5 out in the street
  await look(8, 0); await shot('a1_front', 2500);
  place(f[0] - 4, f[1], f[2] + 8); await look(12, 0); await shot('a2_front_far');
  await place(f[0] - 22, f[1], f[2] + 6); await look(6, 40); await shot('a3_corner_west');
  await open('&spawn=hotel_rouge.side');
  await look(4, -90); await shot('a4_side_door');
}
await open('&spawn=hotel_rouge.lobby');
if (want('doors')) {
  // The doorways are real openings: the lobby from the front court (the doors slide open as you come), the street from
  // the lobby, the side doorway from the alley with its door shut and open.
  await at(17, -6, eye); await look(4, 0); await shot('e1_from_street', 2500);
  await at(17, 2.4, eye); await look(0, 0); await shot('e2_court_doors_open', 2500);
  await at(19.5, 3.2, eye); await look(0, 30); await shot('e3_court_aside');
  await at(17, 9.0); await look(-2, 180); await shot('e4_lobby_looking_out', 2500);
  await at(0.9, 13.5, eye); await look(0, -90); await shot('e5_side_shut', 2500);
  await flip('hotel_rouge.side_door');
  await shot('e6_side_open', 2500);
  await flip('hotel_rouge.side_door');
  await at(17, 6.0);
}
if (want('lobby')) {
  await at(17, 9.0); await look(-2, 180); await shot('b1_entrance_closed');
  await at(17, 6.5); await look(-2, 180); await shot('b2_entrance_open', 1800);
  await at(17, 6.0); await look(-3, 0); await shot('b3_lobby_panel');
  await at(14, 7.0); await look(-3, 90); await shot('b4_staff_window');
  await at(19.5, 7.6); await look(-2, -90); await shot('b5_garage_door_shut');
  await flip('hotel_rouge.garage_door');
  await shot('b6_garage_door_open', 2200);
  await flip('hotel_rouge.garage_door');
}
if (want('hall')) {
  await at(16, 16.0); await look(-3, 180); await shot('c1_hall_amenity');
  await at(10.5, 16.0); await look(-3, 90); await shot('c2_hall_west');
  await at(8.4, 16.0); await look(-3, 180); await shot('c3_vending');
  await at(12, 14.5); await look(-3, 90); await shot('c4_side_door_shut');
  await flip('hotel_rouge.side_door');
  await shot('c5_side_door_open', 2200);
  await flip('hotel_rouge.side_door');
  await at(20, 22); await look(-3, 0); await shot('c6_hall_east');
}
if (want('stair')) {
  await at(23, 17.1); await look(4, -90); await shot('d1_stair_foot');
  await at(26.5, 17.1, eye + 1.0); await look(6, -90); await shot('d2_flight1');
  await at(29.8, 16.5, eye + 2.5); await look(0, 180); await shot('d3_landing');
  await at(27.3, 15.65, eye + 3.8); await look(8, 90); await shot('d4_flight2');
  await at(25.2, 15.65, eye + 4.9); await look(4, 90); await shot('d5_flight2_top');
}
// Every room: its door shut, then open, then from just inside.
for (const r of plan.rooms) {
  if (!want(r.no) && !(only.includes('rooms'))) continue;
  const front = r.door.wall === 't1';
  const y = eye + r.floor;
  const [u0, u1, t0, t1] = r.rect;
  const du = r.door.u;
  const key = `hotel_rouge.door_${r.no}`;
  await open(`&spawn=hotel_rouge.${r.floor === 0 ? 'lobby' : r.floor === 5 ? 'floor2' : 'floor3'}`);
  const b = await pos();
  const atR = (u, t, yy) => place(b[0] + (u - (r.floor === 0 ? 17 : 23)), yy ?? y, b[2] - (t - (r.floor === 0 ? 5.4 : 13.65)));
  const outT = front ? t1 + 1.6 : t0 - 1.6; // in the corridor or the hall, facing the door
  await atR(du, outT); await look(-2, front ? 180 : 0); await shot(`r${r.no}_1_shut`);
  await flip(key);
  await page.waitForTimeout(2000); await shot(`r${r.no}_2_open`, 100);
  const inT = front ? t1 - 1.2 : t0 + 1.2;
  const farT = front ? t0 + 1.5 : t1 - 1.5;
  await atR(du, inT); await look(-6, front ? 180 : 0); await shot(`r${r.no}_3_inside`);
  await atR(u0 + 1.5, farT === t0 + 1.5 ? t0 + 5 : t1 - 5); await look(-4, front ? 120 : 60); await shot(`r${r.no}_4_across`);
  if (r.kind === 'guest') { await atR(u0 + 2.0, front ? t0 + 5.5 : t1 - 5.5); await look(-12, front ? -35 : 215); await shot(`r${r.no}_5_bath`); }
  // The bath's glass door: shut, then open, then the water from inside the bath.
  const lay = plan.layouts[r.layout ?? ''];
  if (lay?.bath && lay.bathDoor) {
    const a0 = u1 - u0 + parseFloat(lay.bath[0].slice(1));
    const T = (b) => (front ? t0 + b : t1 - b);
    const mid = (lay.bathDoor[0] + lay.bathDoor[1]) / 2;
    await atR(u0 + a0 - 2.2, T(mid)); await look(-6, -90); await shot(`r${r.no}_6_bathdoor_shut`);
    await flip(`hotel_rouge.bath_${r.no}`);
    await page.waitForTimeout(2000); await shot(`r${r.no}_7_bathdoor_open`, 100);
    await atR(u0 + a0 + 0.55, T(mid)); await look(-32, front ? -142 : -38); await shot(`r${r.no}_8_water`);
  }
}
await browser.close(); await server.close();
