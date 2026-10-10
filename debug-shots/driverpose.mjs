// Mack at the wheel on the race page, up close: his hands on the rim (at rest, and with the wheel wound left and
// right), and his feet at the pedals (off, on the throttle, on the brake).
// node debug-shots/driverpose.mjs <out dir> [car type] [outfit]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/driverpose';
const type = process.argv[3] ?? 'hatch';
const outfit = process.argv[4] ?? 'suit_cream';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
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
// Dusk on the coast: light enough in the cabin to see hands and feet.
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=yunagi&mode=free&cam=cockpit&at=lot`);
await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 90000, polling: 250 });
await page.waitForTimeout(2500);
const shot = (n) => page.screenshot({ path: `${out}/${type}_${n}.png` });
// Light to see by: every light riding with the car turned well up (the cabin's fill light is dim by design).
const lights = () => page.evaluate(() => window.__race.interior.group.parent.traverse((o) => {
  if (o.isPointLight) {
    o.intensity = 6;
    o.distance = 6;
  }
}));
// The camera at a point in the car's frame (x left, y up, z forward), looking at another.
const cam = async (from, at, fov = 55) => {
  await page.evaluate(([from, at, fov]) => {
    const R = window.__race;
    R.freezeCam = true;
    const obj = R.interior.group.parent;
    obj.updateMatrixWorld();
    // (Riding with the car, so it holds while the car moves.)
    obj.add(R.camera);
    const q = new R.camera.position.constructor(...at).applyMatrix4(obj.matrixWorld);
    R.camera.position.set(...from);
    R.camera.fov = fov;
    R.camera.near = 0.02;
    R.camera.updateProjectionMatrix();
    R.camera.updateMatrixWorld(true);
    R.camera.lookAt(q);
  }, [from, at, fov]);
  await page.waitForTimeout(350);
};
const L = await page.evaluate(() => {
  const l = window.__race.interior.layout;
  return { eye: l.eye.toArray(), wheel: l.wheel.c.toArray(), r: l.wheel.r, pedals: l.pedals.toArray(), side: l.side, floor: l.floor, seat: l.seat.toArray() };
});
console.log(JSON.stringify(L));
const [wx, wy, wz] = L.wheel;
const key = (code, down) => page.evaluate(([c, d]) => (d ? window.__race.keys.add(c) : window.__race.keys.delete(c)), [code, down]);
const views = async (tag) => {
  await lights();
  // From his eyes down at the wheel; over the wheel from behind his shoulder; each hand close from the middle of
  // the car; and from the dash looking back at his fingers round the rim.
  await cam(L.eye, [wx, wy - 0.05, wz], 62);
  await shot(`${tag}_1_eyes`);
  await cam([wx + 0.28, wy + 0.3, wz - 0.4], [wx, wy, wz], 50);
  await shot(`${tag}_2_over_shoulder`);
  await cam([wx - L.r + 0.3, wy + 0.16, wz - 0.16], [wx - L.r, wy, wz], 36);
  await shot(`${tag}_3_right_hand`);
  await cam([wx + L.r + 0.3, wy + 0.16, wz - 0.16], [wx + L.r, wy, wz], 36);
  await shot(`${tag}_4_left_hand`);
  await cam([wx + 0.1, wy + 0.22, wz + 0.3], [wx, wy, wz], 50);
  await shot(`${tag}_5_from_dash`);
  // The rim's top and bottom, where the hands are with the wheel wound over.
  await cam([wx + 0.3, wy + L.r + 0.14, wz - 0.24], [wx, wy + L.r * 0.9, wz + 0.03], 36);
  await shot(`${tag}_6_top`);
  await cam([wx + 0.32, wy - 0.02, wz - 0.3], [wx, wy - L.r * 0.9, wz - 0.05], 36);
  await shot(`${tag}_7_bottom`);
};
await views('a_rest');
await key('KeyA', true);
await page.waitForTimeout(1200);
await views('b_left');
await key('KeyA', false);
await key('KeyD', true);
await page.waitForTimeout(1200);
await views('c_right');
await key('KeyD', false);
await page.waitForTimeout(800);
// The footwell: from beside his knees looking forward and down at the pedals, and from the passenger's footwell.
const [px, py, pz] = L.pedals;
const feet = async (tag) => {
  await lights();
  // From above his knees looking down and forward; from his eyes.
  await cam([px + 0.1, py + 0.42, pz - 0.5], [px, py, pz], 60);
  await shot(`${tag}_1_from_above`);
  await cam(L.eye, [px, py, pz - 0.15], 70);
  await shot(`${tag}_2_eyes_down`);
};
await feet('d_feet_off');
await key('KeyW', true);
await page.waitForTimeout(700);
await feet('e_feet_throttle');
await key('KeyW', false);
await key('KeyS', true);
await page.waitForTimeout(400);
await feet('f_feet_brake');
await key('KeyS', false);
await browser.close();
await server.close();
