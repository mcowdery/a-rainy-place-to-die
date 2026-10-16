// Mack smoking (models/smoking.ts, real/smoke.ts MackSmoke) in the showroom's first person: lighting up, a drag, the
// cigarette in his lips with a gun out, flicking it away. node debug-shots/macksmoke.mjs <outdir> [cigar]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
import { writeGallery } from './gallery.mjs';
const out = process.argv[2] ?? 'debug-shots/macksmoke';
const kind = process.argv[3] === 'cigar' ? 'cigar' : 'cigarette';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && /GL_|WebGL|X\d{4}|Shader/.test(m.text()))) console.log('CONSOLE', m.text().slice(0, 900)); });
await page.goto(`${base}models-mack.html?fp=1`, { timeout: 240000 });
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; });
let n = 0;
const snap = async (name) => page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${name}.png` });
const wait = (ms) => page.waitForTimeout(ms);
// From outside, close on his head and chest (the pose held while the camera's away).
const outside = async (name, dx, dy, dz) => {
  await page.evaluate(([dx, dy, dz]) => {
    __fp.freeze(true);
    const c = __fp.rig().object.children[0].position;
    const y = __fp.rig().eyeHeight;
    __view(c.x + dx, y + dy, c.z + dz, c.x, y - 0.12, c.z + 0.05);
  }, [dx, dy, dz]);
  await wait(350);
  await snap(name);
  await page.evaluate(() => __fp.freeze(false));
  await wait(120);
};
const state = () => page.evaluate(() => { const s = __fp.rig().smoking; return { what: s.what, stage: s.stage, t: +s.t.toFixed(2), inHand: s.inHand, lift: +s.lift.toFixed(2), heat: +s.heat.toFixed(2), lit: s.out.lit }; });

// Lighting up, seen from in front of him and a little to one side (the showroom's mirror, further off).
await page.evaluate((kind) => { __fp.armed(false); __fp.look(0.5, -0.05); __fp.watch(0.55, 1.25); window.__kind = kind; }, kind);
await page.waitForFunction(() => __fp.rig().smoking.free, null, { timeout: 60000, polling: 100 });
await wait(500);
await snap('before');
console.log('lights:', await page.evaluate(() => __fp.smoke(window.__kind)));
for (let i = 0; i < 14; i++) {
  await wait(170);
  await snap(`light_${i}`);
}
console.log('after lighting', JSON.stringify(await state()));
await wait(1500);
await snap('held_low');
// A drag, now: close on his face, then further off for the breath.
await page.evaluate(() => { __fp.watch(0.7, 0.7); __fp.rig().smoking.wait = 0.05; });
for (const [name, ms] of [['drag_up', 350], ['drag_at_mouth', 600], ['drag_at_mouth_b', 500], ['drag_down', 900]]) {
  await wait(ms);
  await snap(name);
}
await page.evaluate(() => __fp.watch(1.2, 1.6));
for (const [name, ms] of [['breath_out', 700], ['breath_out_b', 500], ['breath_hangs', 1200]]) {
  await wait(ms);
  await snap(name);
}
await page.evaluate(() => { __fp.watch(null); __fp.third(true); });
await wait(600);
await snap('third_held_low');
// The same from his eyes.
await page.evaluate(() => { __fp.third(false); __fp.look(0, -0.25); __fp.rig().smoking.wait = 0.05; });
for (const [name, ms] of [['low', 150], ['drag_up', 450], ['drag_at_mouth', 700], ['drag_down', 1300], ['breath_out', 900], ['breath_hangs', 1300]]) {
  await wait(ms);
  await snap(`eyes_${name}`);
}
await page.evaluate(() => __fp.look(0, -0.9));
await wait(500);
await snap('eyes_looking_down');
// A gun drawn: it goes to his lips and stays there.
await page.evaluate(() => { __fp.look(0.5, -0.05); __fp.watch(0.6, 0.9); __fp.armed(true); });
await wait(250);
await snap('to_lips');
await wait(1200);
console.log('armed', JSON.stringify(await state()));
await snap('gun_in_lips');
await page.evaluate(() => { __fp.rig().smoking.wait = 0.05; });
await wait(1500);
await snap('gun_puff');
await page.evaluate(() => { __fp.watch(null); __fp.third(true); });
// Walking with it.
await page.evaluate(() => { __fp.armed(false); __fp.walk(true); });
await wait(2600);
console.log('walking', JSON.stringify(await state()));
await snap('third_walking');
await page.evaluate(() => __fp.walk(false));
await wait(600);
// Flicked away.
console.log('flick:', await page.evaluate(() => __fp.flick()));
for (const ms of [300, 250, 300, 500, 1500]) {
  await wait(ms);
  await snap('flick');
}
console.log('end', JSON.stringify(await state()));
await browser.close();
await server.close();
writeGallery(out);
