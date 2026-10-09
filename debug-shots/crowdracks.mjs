// The crowd at Yasuichi's racks (the F9 snapshot 2026-10-03_00-16-20: two people standing inside a rack).
// node debug-shots/crowdracks.mjs <out dir> <name> [before]   ('before': the crowd built without the set pieces' fixtures)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/crowdracks';
const name = process.argv[3] ?? 'after';
const before = process.argv[4] === 'before';
mkdirSync(out, { recursive: true });
const plugins = before ? [{ name: 'crowd-before', enforce: 'pre', transform: (code, id) => (id.includes('district/chunkBuild.ts') ? code.replace('solid.stamps, solid.fixtures', 'solid.stamps, []') : null) }] : [];
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent', plugins });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const views = [['snap', '3823.8,1.7,1518.7,-131,-4'], ['front', '3819,1.7,1525.5,-50,-6'], ['west', '3806.5,1.7,1522,-80,-6']];
for (const [view, cam] of views) {
  const page = await browser.newPage({ viewport: { width: 1155, height: 896 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  const url = `${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=22:27&res=100&cam=${cam}`;
  const load = async () => {
    await page.goto(url, { timeout: 240000 });
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  };
  try {
    await load();
  } catch (e) {
    console.log('retrying', view, String(e).slice(0, 120));
    await load();
  }
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  // (The crowd is the last stage to stream in; people fade in and out and walk, so a few shots some seconds apart.)
  await page.waitForTimeout(12000);
  for (let i = 0; i < 5; i++) {
    await page.screenshot({ path: `${out}/${name}_${view}_${i}.png` });
    await page.waitForTimeout(5000);
  }
  await page.close();
}
await browser.close();
await server.close();
