// A figure in figures.html as it is seen from behind and from the side at 1.2 m, standing and walking.
//   node debug-shots/figures_behind.mjs <the .glb under debug-shots/props/, e.g. tpose/tpose_rigged.glb> <out prefix>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const [fig, out] = process.argv.slice(2);
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}figures.html?figure=${fig}&light=${process.env.LIGHT ?? "day"}&dist=1.2`);
await page.waitForFunction(() => window.__figures && window.__figures.ready(), null, { timeout: 120000, polling: 500 });
await page.evaluate(() => document.getElementById('panel').remove());
const views = { back: [0, 1.1, -2.2, 0, 0.95, 0], backclose: [0.3, 1.25, -1.2, 0, 1.2, 0], side: [2.2, 1.1, 0, 0, 0.95, 0], front: [0, 1.1, 2.2, 0, 0.95, 0] };
for (const [name, v] of Object.entries(views)) {
  await page.evaluate((v) => window.__view(...v), v);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}_${name}.png` });
}
await browser.close();
await server.close();
process.exit(0);
