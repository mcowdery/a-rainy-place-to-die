// Does showing the park's pools (hidden by day) compile a program? Reads lamps, visibility and the program count before/after.
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0`, { timeout: 180000 });
await page.waitForFunction(() => window.__own && window.__district, null, { timeout: 240000, polling: 200 });
await page.waitForTimeout(3000);
const n = () => window.__renderer.info.programs.length;
console.log(await page.evaluate(() => {
  let pp; window.__scene.traverse((o) => { if (o.name === 'parkpools') pp = o; });
  return { found: !!pp, visible: pp?.visible, opacity: pp?.material.opacity, programs: window.__renderer.info.programs.length };
}));
await page.evaluate(() => { window.__scene.traverse((o) => { if (o.name === 'parkpools') { o.visible = true; o.frustumCulled = false; } }); });
await page.waitForTimeout(1500);
console.log('after showing:', await page.evaluate(() => window.__renderer.info.programs.length));
await browser.close(); await server.close();
