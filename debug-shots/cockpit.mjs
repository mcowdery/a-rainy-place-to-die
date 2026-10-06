// The car interiors and driving cameras on the race page: for each sports car, the cockpit, looking round inside
// (the wheel and his hands, the passenger side, the back and the mirror), the bonnet, chase and far views.
// node debug-shots/cockpit.mjs <out dir> [types=sports,hatch,...] [venue]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/cockpit';
const types = (process.argv[3] ?? 'sports,hatch,rotary,awd,roadster').split(',');
const venue = process.argv[4] ?? 'kurokami';
// What he wears (models/wardrobe.ts): a pale suit shows his arms against the dark cabin.
const outfit = process.argv[5] ?? 'suit_cream';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const type of types) {
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
  await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=${venue}&mode=free&cam=cockpit`);
  await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 90000, polling: 250 });
  await page.waitForTimeout(2000);
  const shot = (n) => page.screenshot({ path: `${out}/${type}_${n}.png` });
  await shot('1_cockpit');
  // Looking round from his eyes: (yaw left +, pitch up +) in the car's frame.
  const look = async (n, yaw, pitch, fov = 72) => {
    await page.evaluate(([yaw, pitch, fov]) => {
      const R = window.__race;
      R.freezeCam = true;
      const o = R.car;
      const eye = R.interior.layout.eye.clone();
      const obj = R.interior.group.parent;
      obj.updateMatrixWorld();
      const p = eye.applyMatrix4(obj.matrixWorld);
      const h = o.h + yaw;
      R.camera.position.copy(p);
      R.camera.fov = fov;
      R.camera.updateProjectionMatrix();
      R.camera.lookAt(p.x + Math.sin(h) * Math.cos(pitch), p.y + Math.sin(pitch), p.z + Math.cos(h) * Math.cos(pitch));
    }, [yaw, pitch, fov]);
    await page.waitForTimeout(300);
    await shot(n);
  };
  await look('2_down_wheel', 0, -0.45);
  await look('3_passenger', 1.2, -0.15);
  await look('4_right_door', -1.3, -0.2);
  await look('5_back', 2.6, -0.1);
  await look('6_mirror', 0.35, 0.12, 30);
  await page.evaluate(() => {
    window.__race.freezeCam = false;
  });
  for (const [n, v] of [['7_hood', 'hood'], ['8_chase', 'chase'], ['9_far', 'far'], ['10_bumper', 'bumper']]) {
    await page.evaluate((v) => window.__race.view(v), v);
    await page.waitForTimeout(700);
    await shot(n);
  }
  // From outside, close, through the driver's open window: his hands on the wheel.
  await page.evaluate(() => {
    const R = window.__race;
    R.freezeCam = true;
    const c = R.car;
    const l = { x: Math.cos(c.h), z: -Math.sin(c.h) };
    const f = { x: Math.sin(c.h), z: Math.cos(c.h) };
    R.camera.fov = 50;
    R.camera.updateProjectionMatrix();
    R.camera.position.set(c.x - l.x * 0.15 + f.x * 1.9, c.y + 1.25, c.z - l.z * 0.15 + f.z * 1.9);
    R.camera.lookAt(c.x - l.x * 0.35, c.y + 0.85, c.z - l.z * 0.35);
  });
  await page.waitForTimeout(300);
  await shot('11_front_in');
  await page.close();
}
await browser.close();
await server.close();
