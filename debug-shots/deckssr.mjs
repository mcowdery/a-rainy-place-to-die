// Under the expressway deck in the rain, looking up (the SSR underside check). node debug-shots/deckssr.mjs <out dir> <name>
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/deckssr';
const name = process.argv[3] ?? 'shot';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&weather=rain&wet=1&clock=01:00&cam=3844.4,1.7,1298.3,30,30`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(4000);
for (const [y, p] of [[30, 30], [30, 15], [60, 25]]) {
  await page.evaluate(([a, b]) => window.__look(a, b), [y, p]);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}_y${y}_p${p}.png` });
}
await browser.close();
await server.close();
