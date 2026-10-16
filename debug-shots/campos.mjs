import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=${process.argv[2]}&weather=clear&clock=22:30`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  console.log('CAM', JSON.stringify(await page.evaluate(() => window.__camera.position.toArray())));
} finally { await browser.close(); await server.close(); }
