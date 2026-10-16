// Space on foot in the city itself (models/cover.ts, district/main.ts `coverTick`): finds a building wall and a low prop near where he
// starts, stands him 1.8 m in front of each looking at it, presses Space (without a locked pointer: `__cover.press`), and photographs
// what happens; then a roll in the open. Into <out dir>/<move>_<n>.png with the controller's state printed beside each.
//   node debug-shots/citycover.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/citycover';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&time=day`, { timeout: 240000 });
await page.waitForFunction(() => document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForFunction(() => window.__mack && window.__mack() && window.__mack().anims && window.__mack().anims.clips.some((c) => c.name === 'MX_AA_stand_to_cover'), null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(3000);
// (The debug map is open over the picture here: Escape closes it.)
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' })));
const wait = (ms) => page.waitForTimeout(ms);
const state = () => page.evaluate(() => window.__cover.state());
let n = 0;
const snap = async (name) => { n++; await page.screenshot({ path: `${out}/${name}_${String(n).padStart(2, '0')}.png` }); const s = await state(); console.log(`${name} ${n}:`, JSON.stringify({ ...s, tuning: undefined, body: s.body && s.body.map((v) => +v.toFixed(2)) })); };
const key = (code, down) => page.evaluate(([c, d]) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c })), [code, down]);
const [px, , pz] = await page.evaluate(() => window.__cover.pos());
const boxes = await page.evaluate(([x, z]) => window.__cover.obstacles(x, z, 40), [px, pz]);
console.log(`${boxes.length} obstacles within 40 m of (${px.toFixed(1)}, ${pz.toFixed(1)}); heights:`, [...new Set(boxes.map((b) => +b.h.toFixed(1)))].sort((a, b) => a - b).slice(0, 14).join(' '));
/** Where to stand, and the yaw (degrees), to face a box's nearest face from 1.8 m. */
const faceOf = (b) => {
  const cx = Math.max(b.x0, Math.min(px, b.x1)), cz = Math.max(b.z0, Math.min(pz, b.z1));
  const dx = px - cx, dz = pz - cz;
  const n = Math.abs(dx) > Math.abs(dz) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dz) || 1];
  // (The face's middle, not the corner nearest him.)
  const mx = n[0] ? (n[0] > 0 ? b.x1 : b.x0) : (b.x0 + b.x1) / 2, mz = n[1] ? (n[1] > 0 ? b.z1 : b.z0) : (b.z0 + b.z1) / 2;
  const x = mx + n[0] * 1.8, z = mz + n[1] * 1.8;
  const yaw = (Math.atan2(n[0], n[1]) * 180) / Math.PI; // looks along -n: forward (-sin y, -cos y) = (-nx, -nz)
  return { x, z, yaw };
};
const near = (b) => Math.hypot(Math.max(b.x0 - px, 0, px - b.x1), Math.max(b.z0 - pz, 0, pz - b.z1));
const wall = boxes.filter((b) => b.h >= 3 && b.x1 - b.x0 > 3 && b.z1 - b.z0 > 3).sort((a, b) => near(a) - near(b))[0];
const low = boxes.filter((b) => b.h >= 0.55 && b.h < 1.45).sort((a, b) => near(a) - near(b))[0];
const moves = {
  async wall() {
    if (!wall) return console.log('no wall found');
    const f = faceOf(wall);
    console.log('wall', JSON.stringify({ h: wall.h, ...f }));
    await page.evaluate(([x, z, y]) => window.__cover.at(x, z, y), [f.x, f.z, f.yaw]);
    await wait(900);
    await page.evaluate(() => window.__cover.press());
    n = 0; await wait(250); await snap('wall'); await wait(700); await snap('wall'); await wait(1000); await snap('wall');
    await page.evaluate(() => window.__cover.press());
    await wait(350); await snap('wallOut'); await wait(1500); await snap('wallOut');
  },
  async low() {
    if (!low) return console.log('no low prop found');
    const f = faceOf(low);
    console.log('low', JSON.stringify({ h: low.h, ...f }));
    await page.evaluate(([x, z, y]) => window.__cover.at(x, z, y), [f.x, f.z, f.yaw]);
    await wait(900);
    await page.evaluate(() => window.__cover.press());
    n = 0; await wait(300); await snap('low'); await wait(900); await snap('low'); await wait(900); await snap('low');
    await page.evaluate(() => window.__cover.press());
    await wait(1800);
  },
  async roll() {
    await page.evaluate(([x, z]) => window.__cover.at(x, z, 0), [px, pz]);
    await wait(900);
    await page.evaluate(() => window.__cover.press());
    n = 0; await wait(200); await snap('roll'); await wait(300); await snap('roll'); await wait(500); await snap('roll');
    await wait(1500);
  },
};
for (const name of Object.keys(moves)) { await moves[name](); await wait(1000); }
console.log('after:', JSON.stringify(await state()).slice(0, 120));
await browser.close();
await server.close();
