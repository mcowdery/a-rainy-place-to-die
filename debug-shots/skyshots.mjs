// Night sky looks side by side: node debug-shots/skyshots.mjs
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const shots = [
  ['crossing', 'spawn=kaburo_crossing.view'],
  ['asagiri', 'spawn=city_hall.observatory'],
];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  for (const sky of ['noir', 'deep'])
    for (const w of ['clear', 'rain'])
      for (const [name, q] of shots) {
        await page.goto(`${base}?debug=1&diag=1&clock=23:00&weather=${w}&sky=${sky}&${q}`);
        await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
        await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: `debug-shots/sky/${name}-${w}-${sky}.png` });
        console.log(name, w, sky);
      }
} finally {
  await browser.close();
  await server.close();
}
