// The gunmen on the fight page (models/gunman.ts, gunmanBrain.ts): two come on, run to low cover, peek and shoot; then you take cover and see
// whether they flush you out. Photographs as it goes into <out dir>/<phase>_<n>.png, with what each is doing and the shots, hits and grenades so far.
//   node debug-shots/gunmen.mjs <out dir> [brawlers]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/gunmen';
const brawlers = Number(process.argv[3] ?? 0);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(`${server.resolvedUrls.local[0]}fight.html?hand=gun`);
await page.waitForFunction(() => window.__fp && window.__fp.rig() && window.__fp.rig().anims && window.__fp.rig().anims.clips.some((c) => c.name === 'Pistol_Aim_Neutral'), null, { timeout: 90000, polling: 250 });
await page.evaluate(() => { __fp.spawn(0); __fp.third(true); __fp.rig().armed = true; });
await wait(1200);
const state = () => page.evaluate(() => JSON.stringify({ ...__fp.gunmen(), cover: __fp.coverState().state, at: __fp.coverState().body }));
let n = 0;
const snap = async (phase) => { n++; await page.screenshot({ path: `${out}/${phase}_${String(n).padStart(2, '0')}.png` }); console.log(`${phase} ${n}:`, await state()); };
// 1. They come on, run to cover, peek and shoot (you stand in the open).
await page.evaluate(([b]) => __fp.mixed(b, 2), [brawlers]);
await wait(1500);
for (let i = 0; i < 9; i++) { await page.evaluate(() => (__fp.brawl().health = 999)); await wait(1100); await snap('open'); }
// 2. You take cover behind the high block and stay there: they should come for you.
// (First person for the move: the third-person camera's position is put back at the next frame.)
await page.evaluate(() => __fp.third(false));
await wait(400);
await page.evaluate(() => { const c = __fp.camera(); c.position.x = 5.8; c.position.z = 0.4; __fp.look(0, -0.08); });
await wait(600);
await page.keyboard.press('Space');
n = 0;
for (let i = 0; i < 12; i++) { await page.evaluate(() => (__fp.brawl().health = 999)); await wait(1500); await snap('hiding'); }
await browser.close();
await server.close();
