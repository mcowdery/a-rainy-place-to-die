// The river's lights at night (bridge lamps, houseboats): node debug-shots/riverlights.mjs
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const VIEWS = [
  ['warmup', '4799.5,24.2,1506.4,-70,-18'],
  ['bridge', '4841,20.2,793.5,44,-22'],
  ['houseboats', '4799.5,24.2,1506.4,-70,-18'],
];
try {
  for (const [name, cam] of VIEWS) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 640 } });
    page.on('pageerror', (e) => console.log('pageerror', String(e)));
    await page.goto(`${base}district.html?debug=1&diag=1&clock=19:10&weather=clear&moonShape=gibbous&fly=1&res=100&cam=${cam}`);
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
    await page.waitForFunction(() => !document.body.innerText.includes("building the city"), null, { timeout: 180_000 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `debug-shots/riverlights_${name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
