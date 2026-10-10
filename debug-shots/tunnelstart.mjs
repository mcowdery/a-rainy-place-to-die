// The game's start: in your car, rolling out of the Yūnagi tunnel onto the Wangan (no ?spawn/?cam). Then the mouth from outside.
//   node debug-shots/tunnelstart.mjs [out dir] [query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/tunnelstart';
const query = process.argv[3] ?? 'clock=22:00';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&${query}`, { timeout: 240000 });
  try {
    await page.waitForFunction(() => window.__own && window.__district, null, { timeout: 240000, polling: 50 });
  } catch (e) {
    await page.screenshot({ path: `${out}/timeout.png` });
    console.log('TIMEOUT; page text:', (await page.evaluate(() => document.body.innerText)).slice(0, 600));
    throw e;
  }
  for (let k = 0; k < 9; k++) {
    await page.screenshot({ path: `${out}/start_${k}.png` });
    console.log('t', k, JSON.stringify(await page.evaluate(() => ({ x: window.__own?.sim.x, z: window.__own?.sim.z, u: window.__own?.sim.u }))));
    await page.waitForTimeout(k < 7 ? 250 : 1500);
  }
} finally {
  await browser.close();
  await server.close();
}
