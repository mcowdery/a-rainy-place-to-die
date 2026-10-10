// The start exactly as a player gets it: no parameters, a fresh profile, a first-time viewer's settings.
//   node debug-shots/tunnelplain.mjs [out dir] [query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/tunnelplain';
const query = process.argv[3] ?? '';
const view = process.argv[4];
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  if (view) await page.addInitScript((v) => { try { localStorage.setItem('rainyplace.driveView', v); } catch {} }, view);
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${server.resolvedUrls.local[0]}district.html${query}`, { timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 100 });
  for (let k = 0; k < 14; k++) {
    await page.screenshot({ path: `${out}/p_${String(k).padStart(2, '0')}.png` });
    await page.waitForTimeout(500);
  }
} finally {
  await browser.close();
  await server.close();
}
