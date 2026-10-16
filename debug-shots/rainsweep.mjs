// Look round from a spawn in rain, one shot every 45 degrees: node debug-shots/rainsweep.mjs <dir> <spawn> [rain] [extra query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/rainsweep';
const spawn = process.argv[3] ?? 'kaburo_crossing.view';
const amt = process.argv[4] ?? '1';
const extra = process.argv[5] ?? '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&${spawn.startsWith('cam=') ? spawn : 'spawn=' + spawn}&weather=rain&rain=${amt}&clock=22:30${extra}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  await page.waitForTimeout(20000);
  for (let i = 0; i < 8; i++) {
    await page.evaluate((a) => { const c = window.__camera; c.lookAt(c.position.x + Math.sin(a), c.position.y - 0.1, c.position.z - Math.cos(a)); }, (i * Math.PI) / 4);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/sweep_${i}.png` });
  }
} finally { await browser.close(); await server.close(); }
