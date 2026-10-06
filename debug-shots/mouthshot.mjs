// District shots at given spots: node debug-shots/mouthshot.mjs '{"name":"x,y,z,yaw,pitch"}' [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const shots = JSON.parse(process.argv[2] ?? '{"mouth":"3966.1,1.7,2364.6,99,-12"}');
const query = process.argv[3] ?? 'clock=23:57&weather=clear';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => { try { localStorage.setItem('citypop.thirdPerson', '0'); } catch {} });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  for (const [name, cam] of Object.entries(shots)) {
    await page.goto(`${base}district.html?debug=1&diag=1&${query}&cam=${cam}`);
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(3000);
      const s = await page.evaluate(() => ({ d: !!window.__district, o: document.getElementById('overlay')?.textContent?.slice(0, 80) }));
      if (i % 5 === 0) console.log(name, i, JSON.stringify(s));
      if (s.d && s.o === 'click to walk') break;
    }
    await page.evaluate(() => { const o = document.getElementById('overlay'); if (o) o.hidden = true; });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `debug-shots/${name}.png`, timeout: 60000 });
  }
} finally {
  await browser.close();
  await server.close();
}
