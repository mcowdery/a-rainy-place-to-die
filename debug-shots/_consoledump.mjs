// Prints every console message of a page: node debug-shots/_consoledump.mjs <page.html> [wait ms]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('console', (m) => console.log(m.type(), m.text().slice(0, 700)));
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 500)));
await page.goto(`${server.resolvedUrls.local[0]}${process.argv[2]}`, { timeout: 300000 });
await page.waitForTimeout(Number(process.argv[3] ?? 15000));
if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
await browser.close();
await server.close();
