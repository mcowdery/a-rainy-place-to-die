// Triangles and draws in view by top-level group (the page's __district.__tris) at given camera spots.
// node debug-shots/trisat.mjs [x,y,z,yaw,pitch ...]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const spots = (process.argv.length > 2 ? process.argv.slice(2) : ['4511,5,2709,70,0', '4472,4,2548,-64,0', '4509,5,2297,-89,0', '4706,6,2312,-15,0', '4929,7,2441,-125,0']);
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const at of spots) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0&time=day&cam=${at}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__scene, null, { timeout: 240000, polling: 300 });
  await page.waitForTimeout(9000);
  console.log('\n==', at, '\n' + (await page.evaluate(() => window.__tris())).slice(0, 12).join('\n'));
  await page.close();
}
await browser.close(); await server.close();
