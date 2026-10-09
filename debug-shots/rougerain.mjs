// Rain inside Hotel Rouge (should be none): the stair up to 3F from the F9 snapshot, the lobby, and a look out of
// the front doors (rain should still fall outside). node debug-shots/rougerain.mjs <out dir>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/rougerain';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const views = {
  '1_stair_3f': '3897.5,11.7,1382.7,-121,0',
  '2_stair_3f_up': '3897.5,11.7,1382.7,-121,20',
};
const base = server.resolvedUrls.local[0];
for (const [name, cam] of Object.entries(views)) {
  await page.goto(`${base}?debug=1&diag=1&spawn=hotel_rouge.floor3&cam=${cam}&clock=00:02&weather=rain&rain=1`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    document.getElementById('hud').hidden = true;
  });
  await page.waitForTimeout(4000);
  console.log(name, await page.evaluate(() => {
    const c = window.__camera.position;
    return JSON.stringify({ at: [c.x, c.y, c.z].map((v) => +v.toFixed(1)), sheltered: window.__district.sheltered(c.x, c.z, c.y), near: window.__district.sheltersNear(c.x, c.z, 45, 11).length });
  }));
  await page.screenshot({ path: `${out}/${name}.png` });
  // More frames of the same view (the streaks are random).
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}_${i}.png` });
  }
}
// The lobby, looking out of the front doors.
await page.goto(`${base}?debug=1&diag=1&spawn=hotel_rouge.lobby&clock=00:02&weather=rain&rain=1`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/3_lobby.png` });
await browser.close();
await server.close();
