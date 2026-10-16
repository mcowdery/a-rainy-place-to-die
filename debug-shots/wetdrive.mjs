// Does the ground wet through when the weather turns to rain? Starts dry, switches to rain by the debug menu's
// route (the weather flag), logs uWet, the rain amount and the wetness target every 10 s.
//   node debug-shots/wetdrive.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/wetdrive';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&time=dawn&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 420000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.keyboard.press('Escape');
const read = () => page.evaluate(() => ({ uWet: +window.__city.uWet.value.toFixed(3), moodRain: window.__mood.rain, moodWet: window.__mood.wetness }));
console.log('dry start', await read());
await page.evaluate(() => { window.__mood.rain = 0.6; });
for (let t = 10; t <= 90; t += 10) {
  await page.waitForTimeout(10000);
  console.log(`t+${t}s`, await read());
}
await page.screenshot({ path: `${out}/after90.png` });
await browser.close(); await server.close();
