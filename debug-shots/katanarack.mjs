// The katana on its rack in the showroom, and the helmets on the gun stand.
//   node debug-shots/katanarack.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html`);
await page.waitForTimeout(8000);
await page.keyboard.press('Digit1');
await page.evaluate(() => { for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const k = await page.evaluate(() => { const o = window.__lab.scene.getObjectByName('katana'); const p = o.parent.position; return [p.x, p.y, p.z]; });
const views = {
  rack: [k[0] + 0.1, 1.1, k[2] + 1.5, k[0] + 0.1, 0.6, k[2]],
  rack34: [k[0] - 1.0, 1.2, k[2] + 1.1, k[0], 0.6, k[2]],
  stand: [k[0] - 0.2, 1.6, k[2] + 0.2, k[0] - 0.2, 1.3, k[2] - 0.95],
};
for (const [name, [x, y, z, tx, ty, tz]] of Object.entries(views)) {
  await page.evaluate(([x, y, z, tx, ty, tz]) => __view(x, y, z, tx, ty, tz), [x, y, z, tx, ty, tz]);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
