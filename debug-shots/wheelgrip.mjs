// Mack's grip on the steering wheel, each hand from four sides, well lit (and with the wheel wound either way).
// node debug-shots/wheelgrip.mjs <out dir> [car type] [outfit]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/wheelgrip';
const type = process.argv[3] ?? 'hatch';
const outfit = process.argv[4] ?? 'suit_cream';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
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
await page.evaluate(() => {
  for (const el of document.querySelectorAll('body > div')) if (!el.querySelector('canvas')) el.style.display = 'none';
});
const lights = () => page.evaluate(() => window.__race.interior.group.parent.traverse((o) => {
  if (o.isPointLight) {
    o.intensity = 9;
    o.distance = 8;
  }
}));
const cam = async (from, at, fov = 30) => {
  await page.evaluate(([from, at, fov]) => {
    const R = window.__race;
    R.freezeCam = true;
    const obj = R.interior.group.parent;
    obj.updateMatrixWorld();
    obj.add(R.camera);
    const q = new R.camera.position.constructor(...at).applyMatrix4(obj.matrixWorld);
    R.camera.position.set(...from);
    R.camera.fov = fov;
    R.camera.near = 0.01;
    R.camera.updateProjectionMatrix();
    R.camera.updateMatrixWorld(true);
    R.camera.lookAt(q);
  }, [from, at, fov]);
  await page.waitForTimeout(300);
};
// Where each hand is now (the car's frame), from the rig's own hand bones.
const hands = () => page.evaluate(() => {
  const R = window.__race;
  const obj = R.interior.group.parent;
  const rig = R.driver().rig;
  const out = {};
  rig.object.traverse((b) => {
    if (b.isBone && (b.name === 'hand_l' || b.name === 'hand_r' || b.name === 'middle_01_l' || b.name === 'middle_01_r')) out[b.name] = obj.worldToLocal(b.getWorldPosition(new R.camera.position.constructor())).toArray();
  });
  return { ...out, eye: R.interior.layout.eye.toArray(), wheel: R.interior.layout.wheel.c.toArray() };
});
const key = (code, down) => page.evaluate(([c, d]) => (d ? window.__race.keys.add(c) : window.__race.keys.delete(c)), [code, down]);
const around = async (tag) => {
  await lights();
  const H = await hands();
  for (const side of ['r', 'l']) {
    const w = H[`hand_${side}`];
    const k = H[`middle_01_${side}`];
    // The middle of the hand: between the wrist and the knuckle.
    const c = [(w[0] + k[0]) / 2, (w[1] + k[1]) / 2, (w[2] + k[2]) / 2];
    await cam(H.eye, c, 22);
    await page.screenshot({ path: `${out}/${type}_${tag}_${side}_1_eyes.png` });
    await cam([c[0], c[1] + 0.3, c[2] - 0.05], c, 40);
    await page.screenshot({ path: `${out}/${type}_${tag}_${side}_2_above.png` });
    // From the hub's side, looking out at the palm and the thumb.
    await cam([H.wheel[0] + (c[0] - H.wheel[0]) * 0.1, c[1] + 0.08, c[2] - 0.2], c, 50);
    await page.screenshot({ path: `${out}/${type}_${tag}_${side}_3_inside.png` });
    // From beyond the rim (the dash's side), looking back at the fingers.
    await cam([c[0] + (side === 'r' ? 0.1 : -0.1), c[1] + 0.1, c[2] + 0.28], c, 45);
    await page.screenshot({ path: `${out}/${type}_${tag}_${side}_4_front.png` });
  }
};
await around('rest');
await key('KeyA', true);
await page.waitForTimeout(1400);
await around('left');
await key('KeyA', false);
await browser.close();
await server.close();
