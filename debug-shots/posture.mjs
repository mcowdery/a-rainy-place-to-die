// How Mack sits to the driving, on the race page: both hands on the wheel racing; driving calmly (as in the city),
// the left hand resting on the gear lever after a change and the right up the rim; both back for a hard turn; the
// left hand to the handbrake. node debug-shots/posture.mjs <out dir> [car type] [outfit]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/posture';
const type = process.argv[3] ?? 'hatch';
const outfit = process.argv[4] ?? 'suit_cream';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.addInitScript((outfit) => localStorage.setItem('citypop.wardrobe', JSON.stringify({ outfit, glasses: null, face: 'shadow', helmet: null })), outfit);
await page.addInitScript((type) => {
  const KEY = 'citypop.race.v1.profile';
  let p;
  try {
    p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    p = null;
  }
  p ??= { v: 1, yen: 99999999, cars: [], current: '', earned: 0 };
  const id = `shot_${type}`;
  if (!p.cars.some((c) => c.id === id)) p.cars.push({ id, type, paint: 0xc01818, paint2: null, parts: {}, livery: { stripes: null, side: null, number: null, banner: null }, neon: null, neonFitted: false });
  p.current = id;
  localStorage.setItem(KEY, JSON.stringify(p));
}, type);
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=wharf&mode=free&cam=cockpit`);
await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 90000, polling: 250 });
await page.waitForTimeout(2500);
const cam = (which) => page.evaluate((which) => {
  for (const el of document.querySelectorAll('body > div')) if (!el.querySelector('canvas')) el.style.display = 'none';
  const R = window.__race;
  R.interior.group.parent.traverse((o) => {
    if (o.isPointLight) {
      o.intensity = 9;
      o.distance = 8;
    }
  });
  R.freezeCam = true;
  const obj = R.interior.group.parent;
  const L = R.interior.layout;
  const V = R.camera.position.constructor;
  obj.add(R.camera);
  obj.updateMatrixWorld(true);
  R.camera.near = 0.02;
  if (which === 'eyes') {
    R.camera.position.copy(L.eye);
    R.camera.fov = 78;
    R.camera.updateProjectionMatrix();
    R.camera.lookAt(obj.localToWorld(new V(L.side + 0.1, L.eye.y - 0.42, L.eye.z + 0.6)));
  } else if (which === 'brake') {
    // Down between the seats at the handbrake, from over the passenger's seat.
    R.camera.position.set(L.side * 0.2 + 0.36, L.shifter.y + 0.42, L.seat.z - 0.1);
    R.camera.fov = 55;
    R.camera.updateProjectionMatrix();
    R.camera.lookAt(obj.localToWorld(new V(L.side * 0.2, L.shifter.y, L.seat.z + 0.08)));
  } else {
    // Over his left shoulder from the back seat: the wheel, the lever, the handbrake.
    R.camera.position.set(L.side + 0.52, L.eye.y + 0.14, L.eye.z - 0.55);
    R.camera.fov = 60;
    R.camera.updateProjectionMatrix();
    R.camera.lookAt(obj.localToWorld(new V(L.side + 0.14, L.shifter.y + 0.16, L.eye.z + 0.36)));
  }
}, which);
const state = () => page.evaluate(() => {
  const M = window.__race.interior.motion;
  return { gear: window.__race.car.gear, hand: +M.hand.toFixed(2), high: +M.high.toFixed(2), pull: +M.pull.toFixed(2), kmh: Math.round(window.__race.car.u * 3.6) };
});
const key = (code, down) => page.evaluate(([c, d]) => (d ? window.__race.keys.add(c) : window.__race.keys.delete(c)), [code, down]);
const both = async (name) => {
  for (const which of ['back', 'eyes']) {
    await cam(which);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${type}_${name}_${which}.png` });
  }
  console.log(name, JSON.stringify(await state()));
};
// Calm, as in the city: pulling away through a change, then the hand rests on the lever and the other goes up the rim.
await page.evaluate(() => (window.__race.calm = true));
await both('1_setting_off');
await key('KeyW', true);
await page.waitForTimeout(2300);
await key('KeyW', false);
await page.waitForTimeout(2600);
await both('2_calm_one_handed');
// A hard turn: both hands come back.
await key('KeyA', true);
await page.waitForTimeout(900);
await both('3_turning_hard');
await key('KeyA', false);
await page.waitForTimeout(2800);
await both('4_calm_again');
// The handbrake.
await key('Space', true);
await page.waitForTimeout(450);
await both('5_handbrake');
await cam('brake');
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/${type}_5_handbrake_lever.png` });
await key('Space', false);
await page.waitForTimeout(1500);
// Racing: both hands, whatever the gear.
await page.evaluate(() => (window.__race.calm = false));
await key('KeyW', true);
await page.waitForTimeout(3200);
await both('6_racing');
await key('KeyW', false);
await browser.close();
await server.close();
