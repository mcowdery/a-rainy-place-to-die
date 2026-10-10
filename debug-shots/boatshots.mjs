// The boats in the showroom (models-boats-ph.html): the bangkas, the launch, the barge, the ships, from a few views.
//   node debug-shots/boatshots.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/boats/room';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}models-boats-ph.html`, { timeout: 300000 });
await page.waitForTimeout(9000);
if (process.env.NIGHT) await page.keyboard.press('Digit2');
await page.waitForTimeout(2000);
const X = 0, Z = 0;
const views = {
  bangkas: [X + 20, 1.2, Z, 22, 0.4, 0.35, 0.8],
  bangka_a: [X, 1.2, Z, 10, 1, 0.3, 0.6],
  bangka_sail: [X + 16, 2, Z, 10, 1, 0.3, 0.6],
  bangka_rear: [X + 8, 1.2, Z, 10, -0.5, 0.3, -1],
  launch: [X, 2, Z + 24, 32, 1, 0.35, 0.7],
  launch2: [X, 2, Z + 24, 32, -0.8, 0.3, 1],
  launch3: [X, 2, Z + 24, 20, 0.2, 0.5, 1],
  lighter: [X + 24, 1.5, Z + 24, 28, 1, 0.35, 0.7],
  cargo: [X + 20, 12, Z + 220, 190, 1, 0.25, 0.9],
  tankers: [X + 140, 8, Z + 220, 250, 1, 0.25, 0.9],
  far: [X + 60, 4, Z + 220, 900, 0.3, 0.06, 1],
};
for (const [n, v] of Object.entries(views)) {
  await page.evaluate((v) => window.__focusAt(...v), v);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${n}.png` });
  console.log('shot', n);
}
await browser.close(); await server.close();
