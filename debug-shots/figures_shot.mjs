import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('ERROR', m.text().slice(0, 300)); });
const out = process.argv[2];
for (const [light, dist, clip] of [['studio', 3, 'Walk_Normal_105_Loop'], ['night', 2, 'Idle_Loop']]) {
  await page.goto(`${server.resolvedUrls.local[0]}figures.html?light=${light}&dist=${dist}&clip=${clip}`);
  await page.waitForFunction(() => window.__figures && window.__figures.ready(), null, { timeout: 120000, polling: 500 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}_${light}.png` });
  console.log(`${out}_${light}.png`);
}
await browser.close();
await server.close();
process.exit(0);
