// The people following Mack: standing behind him, walking, running, round a corner, in his car's seats from the
// cockpit and from outside, and out of it again.
//   node debug-shots/followers.mjs <out dir> [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/followers';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); localStorage.setItem('citypop.driveView', 'cockpit'); } catch {} });
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&time=day&weather=clear&spawn=city_garage.front&car=home&flags=following_koharu,following_detective${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(4000);
const key = async (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
const tap = async (code) => { await key(code, true); await key(code, false); };
const look = (pitchDeg, yawDeg) => page.evaluate(([p, y]) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.x = (p * Math.PI) / 180;
  if (y !== undefined && y !== null) e.y = (y * Math.PI) / 180;
  e.z = 0;
  cam.quaternion.setFromEuler(e);
}, [pitchDeg, yawDeg ?? null]);
const turn = (deg) => page.evaluate((d) => {
  const cam = window.__camera;
  const e = new cam.rotation.constructor().setFromQuaternion(cam.quaternion, 'YXZ');
  e.y += (d * Math.PI) / 180;
  cam.quaternion.setFromEuler(e);
}, deg);
const state = () => page.evaluate(() => {
  const c = window.__camera.position;
  return JSON.stringify(window.__followers.members.map((m) => ({ id: m.def.id, state: m.state, d: +Math.hypot(m.walk.x - c.x, m.walk.z - c.z).toFixed(2), pace: +m.walk.pace.toFixed(2), warps: m.walk.warps, floor: +m.walk.floor.toFixed(2) })));
});
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
// Away from the garage (the spawn faces its door), along the pavement; stop, and turn round to look at them.
await look(-4);
await turn(90);
await key('KeyW', true); await page.waitForTimeout(2500); await key('KeyW', false);
await page.waitForTimeout(2500);
console.log('stopped', await state());
await turn(180); await page.waitForTimeout(700); await shot('f1_behind_him_standing');
await page.waitForTimeout(6000); await shot('f2_standing_later');
await turn(180);
// Third person: walking, then running.
await tap('KeyQ');
await key('KeyW', true); await page.waitForTimeout(1800); await shot('f3_walking_third');
console.log('walking', await state());
await key('ShiftLeft', true); await page.waitForTimeout(1500); await shot('f4_running_third');
console.log('running', await state());
await key('ShiftLeft', false); await key('KeyW', false);
await tap('KeyQ');
// Walking backward from them (first person, looking at them as they come).
await page.waitForTimeout(1500);
await turn(180); await page.waitForTimeout(300);
await key('KeyS', true); await page.waitForTimeout(1600); await shot('f5_walking_toward_you');
await key('ShiftLeft', true); await page.waitForTimeout(1300); await shot('f6_running_toward_you');
await key('ShiftLeft', false); await key('KeyS', false);
await page.waitForTimeout(2500);
console.log('settled', await state());
// The car: the cockpit (the passenger beside you, the other behind), looking back, then from outside.
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(2500);
console.log('in car', await state());
await shot('c1_cockpit');
// (Looking about from the seat: the mouse's orbit, held where it's put.)
const orbit = (yaw, pitch = 0) => page.evaluate(([y, p]) => { const d = window.__bike.driving; d.orbitYaw = y; d.lookPitch = p; d.mouseIdle = 0; }, [yaw, pitch]);
await orbit(1.3, -0.25); await page.waitForTimeout(300); await shot('c2_cockpit_look_left');
await orbit(2.2, -0.2); await page.waitForTimeout(300); await shot('c3_cockpit_look_back_left');
await orbit(0);
await key('KeyW', true); await page.waitForTimeout(2200); await shot('c4_cockpit_moving'); await key('KeyW', false);
await key('KeyS', true); await page.waitForTimeout(1500); await key('KeyS', false);
for (const n of ['c5_hood', 'c6_bumper', 'c7_chase', 'c8_far']) {
  await tap('KeyQ'); await page.waitForTimeout(900); await shot(n);
  // (The chase cameras swung round to the car's left side and its front, to see in through the glass.)
  if (n === 'c7_chase') {
    await orbit(1.57, -0.05); await page.waitForTimeout(400); await shot('c7b_chase_left_side');
    await orbit(2.7, -0.1); await page.waitForTimeout(400); await shot('c7c_chase_front_left');
    await orbit(0);
  }
}
await tap('KeyE'); await page.waitForTimeout(1500);
console.log('got out', await state());
await shot('o1_out_of_the_car');
// (He's by the driver's door, the car on his left: they're getting out on its far side and coming round.)
await turn(90); await page.waitForTimeout(100); await shot('o2_out_across_the_car');
await page.waitForTimeout(1200); await shot('o3_coming_round');
await page.waitForTimeout(3500); await shot('o4_with_him_again');
console.log('round the car', await state());
await browser.close(); await server.close();
writeGallery(out);
