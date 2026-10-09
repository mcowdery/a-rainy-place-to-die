// Does figures.html show a different figure for each one picked? Opens it, picks three and photographs each.
//   node debug-shots/figures_switch.mjs <out prefix>
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}figures.html?light=studio&dist=3`);
await page.waitForFunction(() => window.__figures && window.__figures.ready(), null, { timeout: 120000, polling: 500 });
const names = await page.evaluate(() => window.__figures.names());
const pick = [names.find((n) => n.includes('julie_hunyuan/julie_rigged.glb')), names.find((n) => n.includes('nude01/nude01_rigged.glb')), names.find((n) => n.includes('tpose/tpose_rigged.glb'))].filter(Boolean);
for (const [i, n] of pick.entries()) {
  await page.evaluate((n) => window.__figures.show(n), n);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${process.argv[2]}_${i}.png` });
  console.log(n);
}
await browser.close();
await server.close();
process.exit(0);
