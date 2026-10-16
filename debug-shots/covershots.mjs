// Space on foot on the fight page (models/cover.ts): cover against a tall block, crouched behind a low wall, a vault, a roll from a stand, a roll from a run.
// Each move is set up at a spot in the yard, Space pressed, and photographed a few times as it plays (third person is forced
// for it), into <out dir>/<move>_<n>.png, with the controller's state printed beside each.
//   node debug-shots/covershots.mjs <out dir> [gun] [move ...]       ('gun': the pistol out for every move)      moves: hug, low, vault, peek, roll, sprint
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
// 'gun' among the names (or GUN=1 where the environment reaches the script: not on the pod) has the pistol out for every move.
const GUN = !!process.env.GUN || process.argv.slice(3).includes('gun');
const only = process.argv.slice(3).filter((a) => a !== 'gun');
if (!out) { console.log('Usage: node debug-shots/covershots.mjs <out dir> [hug|low|vault|peek|roll|sprint ...]'); process.exit(1); }
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=fists`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'MX_AA_stand_to_cover'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => __fp.spawn(0));
await wait(1500);
const where = () => page.evaluate(() => __fp.coverState());
/** Puts him at (x, z) looking `yaw` (0 looks north, -z), the keys let go, standing. */
const place = async (x, z, yaw) => {
  for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) await page.keyboard.up(k);
  await page.evaluate(([x, z, yaw]) => { __fp.third(false); const c = __fp.camera(); c.position.x = x; c.position.z = z; __fp.look(yaw, -0.08); }, [x, z, yaw]);
  await wait(500);
  if (GUN) { await page.evaluate(() => { __fp.hand('gun'); __fp.rig().armed = true; }); await wait(700); }
};
let n = 0;
const snap = async (name) => { n++; await page.screenshot({ path: `${out}/${name}_${String(n).padStart(2, '0')}.png` }); console.log(`${name} ${n}:`, JSON.stringify(await where())); };
const series = async (name, times) => { n = 0; let t0 = 0; for (const t of times) { await wait(t - t0); t0 = t; await snap(name); } };

const MOVES = {
  // A high block (x 4.6..7, z -2.2..-1.4), 1.8 m from its south face: stand against it, sidle right, step out.
  async hug() {
    await place(5.8, 0.4, 0);
    await page.keyboard.press('Space');
    await series('hug', [250, 600, 1000, 1500]);
    await page.keyboard.down('KeyD'); await series('hugD', [500, 1000]); await page.keyboard.up('KeyD');
    await page.keyboard.press('Space');
    await series('hugExit', [300, 700, 1100, 1600]);
  },
  // A low wall (x -3.2..-0.6, z -6.4..-5.8, 0.9 m): crouch behind it, then W + Space over it.
  async low() {
    await place(-1.9, -3.9, 0);
    await page.keyboard.press('Space');
    await series('low', [300, 700, 1100, 1700]);
    await page.keyboard.down('KeyW'); await page.keyboard.press('Space');
    await series('lowVault', [250, 550, 850, 1200]);
    await page.keyboard.up('KeyW');
  },
  // A crate (x 2..4, z -4.6..-4, 1.1 m): W held, Space, over it.
  async vault() {
    await place(3, -2.3, 0);
    await page.keyboard.down('KeyW');
    await page.keyboard.press('Space');
    await series('vault', [200, 450, 700, 950, 1300]);
    await page.keyboard.up('KeyW');
  },
  // A high block, the pistol out: into cover, aim to peek out (the right button: `rig.aiming`), fire, let go.
  async peek() {
    await page.evaluate(() => { __fp.hand('gun'); __fp.rig().armed = true; });
    await place(5.8, 0.4, 0);
    await page.keyboard.press('Space');
    await wait(1800);
    n = 0; await snap('peek');
    await page.evaluate(() => (__fp.rig().aiming = true));
    await wait(100); await snap('peek'); await wait(500); await snap('peek');
    await page.evaluate(() => __fp.rig().fire());
    await wait(120); await snap('peek'); await wait(500); await snap('peek');
    await page.evaluate(() => (__fp.rig().aiming = false));
    await wait(150); await snap('peekBack'); await wait(700); await snap('peekBack');
    await page.keyboard.press('Space');
    await wait(1800);
    if (!GUN) await page.evaluate(() => __fp.hand('fists'));
  },
  // Open ground: a roll from standing still (the sprint-to-roll, its run-in skipped).
  async roll() {
    await place(0, 6, 0);
    await page.keyboard.press('Space');
    await series('roll', [150, 350, 550, 800, 1100]);
  },
  // Open ground: a forward roll out of a run.
  async sprint() {
    await place(0, 8, 0);
    await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
    await wait(300);
    await page.keyboard.press('Space');
    await series('sprint', [150, 350, 550, 800, 1100]);
    await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  },
};
if (!only.length || only.includes('panel')) {
  await page.locator('#panel h3', { hasText: 'Roll' }).scrollIntoViewIfNeeded();
  await wait(300);
  await page.locator('#panel').screenshot({ path: `${out}/panel.png` });
}
// GUN=1: the pistol out for every move (it should stay in his hand through them).
if (GUN) await page.evaluate(() => { __fp.hand('gun'); __fp.rig().armed = true; });
for (const name of Object.keys(MOVES)) {
  if (only.length && !only.includes(name)) continue;
  await MOVES[name]();
  await wait(1500);
}
await browser.close();
await server.close();
