// The windows' look at night from a height: node debug-shots/windowsshot.mjs <out dir> [x,y,z,yaw,pitch]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import fs from 'node:fs';
const out = process.argv[2] ?? 'debug-shots/windows';
const cam = process.argv[3] ?? '3436.2,13.5,1301.7,-178,0';
fs.mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 620 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=night&weather=clear&fly=1&cam=${cam}`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/night.png` });
await browser.close();
await server.close();
