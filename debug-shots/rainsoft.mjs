// Rain look: node debug-shots/rainsoft.mjs [outdir] [rain amount]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/rainsoft';
const amt = process.argv[3] ?? '0.6';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&weather=rain&rain=${amt}&wet=1&clock=22:30`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  await page.waitForTimeout(4000);
  for (let i = 0; i < 3; i++) { await page.screenshot({ path: `${out}/rain_${amt}_${i}.png` }); await page.waitForTimeout(900); }
} finally { await browser.close(); await server.close(); }
