// Kaburo Station's stair up to the upper concourse: from the F9 snapshot's place, on the stair, and from the top.
// node debug-shots/stationstair.mjs <out dir> [query]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/stationstair';
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300));
});
const views = (process.env.VIEWS ? JSON.parse(process.env.VIEWS) : [
  ['1_snapshot', '3354.5,1.7,1592.4,174,30'],
  ['2_foot_level', '3353.5,1.7,1590,180,8'],
  ['3_on_stair', '3353.5,6.25,1603.5,180,10'],
  ['4_top_looking_down', '3353.5,10.8,1614,0,-28'],
  ['5_upper_side', '3346,10.8,1600,-110,-18'],
  ['6_under_slab', '3349,1.7,1606,-90,35'],
]);
const load = async (cam) => {
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=22:00&cam=${cam}${extra}`, { timeout: 240000 });
  await page.waitForFunction(() => /building/.test(document.getElementById('overlay')?.textContent ?? ''), null, { timeout: 240000, polling: 50 });
  await page.waitForFunction(() => window.__district && window.__scene && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
};
let walked = false;
for (const [n, cam] of views) {
  try {
    await load(cam);
  } catch (e) {
    console.log(n, 'load failed, retrying:', String(e).slice(0, 120));
    await load(cam);
  }
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
  });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => ({ cam: window.__camera.position.toArray().map((v) => +v.toFixed(2)), floor: window.__district.floorAt(window.__camera.position.x, window.__camera.position.z, window.__camera.position.y - 1.7) }));
  console.log(n, JSON.stringify(info));
  await page.screenshot({ path: `${out}/${n}.png` });
  if (walked) continue;
  walked = true;
  // The walk up, as the controls do it (floorAt at the walker's level, blocked at that level, radius 0.3): from the
  // paid area up the middle of the stair and on along the upper concourse; then the stair's back at ground level.
  const walk = await page.evaluate(() => {
    const d = window.__district;
    const x = 3338 + 15.5;
    let level = d.floorAt(x, 1562 + 31, 0);
    const log = [];
    let stopped = null;
    for (let u = 31; u <= 55; u += 0.05) {
      const z = 1562 + u;
      if (d.blocked(x, z, 0.3, level)) {
        stopped = +u.toFixed(2);
        break;
      }
      level = d.floorAt(x, z, level);
      if (Math.abs(u - Math.round(u)) < 0.02 && Math.round(u) % 3 === 0) log.push([Math.round(u), +level.toFixed(2)]);
    }
    const back = [];
    for (let u = 53; u >= 48; u -= 0.05) {
      const z = 1562 + u;
      if (d.blocked(x, z, 0.3, 0)) {
        back.push('blocked at u ' + u.toFixed(2));
        break;
      }
      const y = d.floorAt(x, z, 0);
      if (y > 1) {
        back.push('floor jumps to ' + y.toFixed(2) + ' at u ' + u.toFixed(2));
        break;
      }
    }
    return { stopped, level: +level.toFixed(2), log, back };
  });
  console.log('walk', JSON.stringify(walk));
}
await browser.close();
await server.close();
