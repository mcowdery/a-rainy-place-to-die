// The wet street's look at fixed places, wetness held at 1, for comparing one build with another (run it in each
// checkout): three spawns, each looked at shallow and steep, at dawn and at night.
//   node debug-shots/wetlook.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/wetlook';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
// Spawns both builds have (an older build starts at the wheel, where a camera set by script doesn't hold): on foot at
// each, looking down the street away from the door.
const SPOTS = [['rouge', 'hotel_rouge.front', 180], ['cashone', 'cash_one.front', 180], ['maid', 'maid_cafe.front', 90]];
for (const time of ['dawn', 'night']) {
  for (const [name, spawn, yaw] of SPOTS) {
    await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=${time}&weather=rain&people=0&spawn=${spawn}`);
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 420000, polling: 500 });
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__mood.wetness = 1; });
    for (const [tag, pitch] of [['shallow', -0.3], ['steep', -1.0]]) {
      await page.evaluate(([yaw, pitch]) => {
        window.__camera.quaternion.setFromEuler(new window.__camera.rotation.constructor(pitch, (-yaw * Math.PI) / 180, 0, 'YXZ'));
      }, [yaw, pitch]);
      await page.waitForTimeout(6000);
      console.log(time, name, tag, await page.evaluate(() => [window.__city.uWet.value, window.__camera.position.toArray().map((v) => Math.round(v))]));
      await page.screenshot({ path: `${out}/${time}_${name}_${tag}.png` });
    }
  }
}
await browser.close();
await server.close();
