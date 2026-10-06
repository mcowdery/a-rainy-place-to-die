// Mack changing gear on the race page: pulling away through first into second, his left hand off the wheel to the
// lever and back, the clutch foot; photographed through the change and its timing logged.
// node debug-shots/gearshift.mjs <out dir> [car type] [outfit]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/gearshift';
const type = process.argv[3] ?? 'hatch';
const outfit = process.argv[4] ?? 'suit_cream';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
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
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=yunagi&mode=free&cam=cockpit&at=road`);
await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 90000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  for (const el of document.querySelectorAll('body > div')) if (!el.querySelector('canvas')) el.style.display = 'none';
  const R = window.__race;
  R.interior.group.parent.traverse((o) => {
    if (o.isPointLight) {
      o.intensity = 9;
      o.distance = 8;
    }
  });
  // The camera riding with the car: over his left shoulder from the back seat, at the wheel, the lever and his knees.
  R.freezeCam = true;
  const obj = R.interior.group.parent;
  const L = R.interior.layout;
  obj.add(R.camera);
  R.camera.position.set(L.side + 0.5, L.eye.y + 0.12, L.eye.z - 0.5);
  R.camera.fov = 58;
  R.camera.near = 0.02;
  R.camera.updateProjectionMatrix();
  obj.updateMatrixWorld(true);
  R.camera.lookAt(obj.localToWorld(new R.camera.position.constructor(L.side + 0.12, L.shifter.y + 0.2, L.eye.z + 0.42)));
});
const state = () => page.evaluate(() => {
  const M = window.__race.interior.motion;
  return { gear: window.__race.car.gear, lever: M.gear, hand: +M.hand.toFixed(2), clutch: +M.clutch.toFixed(2), leftFoot: +M.leftFoot.toFixed(2), rightFoot: +M.rightFoot.toFixed(2), kmh: Math.round(window.__race.car.u * 3.6) };
});
await page.screenshot({ path: `${out}/${type}_0_on_the_wheel.png` });
await page.evaluate(() => window.__race.keys.add('KeyW'));
let n = 1;
let shot = { reach: false, on: false, back: false };
const t0 = Date.now();
while (Date.now() - t0 < 9000) {
  const s = await state();
  const t = ((Date.now() - t0) / 1000).toFixed(2);
  if (s.hand > 0 || s.clutch > 0.05) console.log(t, JSON.stringify(s));
  if (!shot.reach && s.hand > 0.4 && s.hand < 0.8) {
    shot.reach = true;
    await page.screenshot({ path: `${out}/${type}_${n++}_reaching.png` });
  }
  if (!shot.on && s.hand >= 1) {
    shot.on = true;
    await page.screenshot({ path: `${out}/${type}_${n++}_on_the_lever.png` });
  }
  if (shot.on && !shot.back && s.hand < 0.5 && s.hand > 0.1) {
    shot.back = true;
    await page.screenshot({ path: `${out}/${type}_${n++}_going_back.png` });
    break;
  }
  await page.waitForTimeout(30);
}
await page.evaluate(() => window.__race.keys.delete('KeyW'));
await browser.close();
await server.close();
