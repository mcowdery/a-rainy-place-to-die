// Does the reflections' dry-floor test (ssr.ts setShelters) dry ground it shouldn't? The same views with the volumes as
// the game hands them, with every covered volume, and with none, wetness held at 1.
//   node debug-shots/wetshelter.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/wetshelter';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=dawn&weather=rain&people=0`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 420000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// Under the rail viaduct in Kaburo (a covered street, open to the rain round it) and in front of Hotel Rouge: as the game
// hands the volumes in (the enclosed ones), with every covered volume (the first version: the fault), and with none.
const SPOTS = [['viaduct', 4060, 1408, -90], ['viaduct_side', 4040, 1420, -60], ['rouge', 3893, 1412, 0]];
const view = (x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => {
  window.__camera.position.set(x, 1.7, z);
  window.__camera.quaternion.setFromEuler(new window.__camera.rotation.constructor(pitch, (-yaw * Math.PI) / 180, 0, 'YXZ'));
}, [x, z, yaw, pitch]);
await page.evaluate(() => { window.__mood.wetness = 1; });
for (const [name, x, z, yaw] of SPOTS) {
  await view(x, z, yaw, -0.35);
  await page.waitForTimeout(6000);
  console.log(name, 'handed in:', await page.evaluate(() => window.__passes.ssr.mat.uniforms.uShelters.value));
  await page.screenshot({ path: `${out}/${name}_a_game.png` });
  await page.evaluate(() => { const s = window.__passes.ssr; s.__set = s.setShelters; s.setShelters = () => {}; const c = window.__camera.position; s.__set(window.__district.sheltersNear(c.x, c.z, 70, 24)); });
  await page.waitForTimeout(700);
  console.log(name, 'every cover:', await page.evaluate(() => window.__passes.ssr.mat.uniforms.uShelters.value));
  await page.screenshot({ path: `${out}/${name}_b_every_cover.png` });
  await page.evaluate(() => { window.__passes.ssr.mat.uniforms.uShelters.value = 0; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${name}_c_none.png` });
  await page.evaluate(() => { const s = window.__passes.ssr; s.setShelters = s.__set; });
}
await browser.close();
await server.close();
