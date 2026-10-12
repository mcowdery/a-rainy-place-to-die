// Mack's left hand at the radio (race page, so the cabin and his body without the city): at rest, then while the
// radio's being worked, from his eyes, over his shoulder and from the passenger's side.
// node debug-shots/radiohand.mjs <out dir> [car type] [outfit]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/radiohand';
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
await page.goto(`${server.resolvedUrls.local[0]}race.html?venue=yunagi&mode=free&cam=cockpit&at=lot`);
await page.waitForFunction(() => window.__race && window.__race.driver?.()?.rig, null, { timeout: 90000, polling: 250 });
await page.waitForTimeout(2500);
const shot = (n) => page.screenshot({ path: `${out}/${type}_${n}.png` });
const lights = () => page.evaluate(() => window.__race.interior.group.parent.traverse((o) => {
  if (o.isPointLight) {
    o.intensity = 6;
    o.distance = 6;
  }
}));
const cam = async (from, at, fov = 55) => {
  await page.evaluate(([from, at, fov]) => {
    const R = window.__race;
    R.freezeCam = true;
    const obj = R.interior.group.parent;
    obj.updateMatrixWorld();
    obj.add(R.camera);
    const q = new R.camera.position.constructor(...at).applyMatrix4(obj.matrixWorld);
    R.camera.position.set(...from);
    R.camera.fov = fov;
    R.camera.near = 0.02;
    R.camera.updateProjectionMatrix();
    R.camera.updateMatrixWorld(true);
    R.camera.lookAt(q);
  }, [from, at, fov]);
  await page.waitForTimeout(150);
};
const L = await page.evaluate(() => {
  const l = window.__race.interior.layout;
  return { eye: l.eye.toArray(), wheel: l.wheel.c.toArray(), side: l.side, dash: l.dash };
});
console.log(JSON.stringify(L));
await lights();
// Radio keys held: the page's own driver is told every 200 ms, as the key repeat would.
await page.evaluate(() => {
  window.__radioTimer = setInterval(() => window.__race.driver().touchRadio(), 200);
});
await page.waitForTimeout(3000);
const [wx, wy, wz] = L.wheel;
const kx = 0, ky = L.dash.top - 0.35, kz = L.dash.lip + 0.03;
await cam(L.eye, [kx, ky, kz], 70);
await shot('1_eyes');
await cam([wx - 0.35, wy + 0.3, wz - 0.35], [kx, ky, kz], 55);
await shot('2_over_shoulder');
await cam([kx - 0.45, ky + 0.05, kz - 0.3], [kx + 0.1, ky, kz], 55);
await shot('3_from_passenger');
await cam([kx + 0.2, ky + 0.35, kz - 0.35], [kx, ky, kz], 50);
await shot('4_from_above');
// Close on the hand (the thumb): from the passenger side, from the front of the dash looking back, from below.
const hx = kx - 0.1, hy = ky + 0.03, hz = kz - 0.12;
await cam([hx - 0.32, hy + 0.02, hz + 0.02], [hx, hy, hz], 38);
await shot('6_close_passenger');
await cam([hx - 0.05, hy + 0.03, hz + 0.32], [hx, hy, hz], 38);
await shot('7_close_front');
await cam([hx - 0.15, hy - 0.3, hz - 0.1], [hx, hy, hz], 38);
await shot('8_close_below');
await cam([hx + 0.25, hy + 0.15, hz - 0.2], [hx, hy, hz], 38);
await shot('9_close_driver');
await page.evaluate(() => clearInterval(window.__radioTimer));
await page.waitForTimeout(1800);
await cam(L.eye, [kx, ky, kz], 70);
await shot('5_after_eyes');
await browser.close();
await server.close();
