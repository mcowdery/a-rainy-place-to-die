// What the rooms behind the windows cost (city.ts): the warm start's time (a cold shader compile on the first page)
// and, in one page, the GPU's time a frame with no room furnished (the block is skipped), as it ships, and with every
// lit room furnished and full, alternated so other load on the machine falls on each alike.
//   node debug-shots/windowpeopleperf.mjs [query] [spawn] [yaw:pitch] [rounds]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ? `&${process.argv[2]}` : '&clock=20:30';
const spawn = process.argv[3] ?? 'toto_bank.front';
const [yaw, pitch] = (process.argv[4] ?? '90:16').split(':').map(Number);
const rounds = Number(process.argv[5] ?? 4);
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const t0 = Date.now();
await page.goto(`${server.resolvedUrls.local[0]}?diag=1&weather=clear&res=100&spawn=${spawn}${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 600000, polling: 250 });
console.log('warm start (s)', ((Date.now() - t0) / 1000).toFixed(1), '· the page says', await page.evaluate(() => /warm start[^\n]*/.exec(document.getElementById('hud').textContent)?.[0]));
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
const base = await page.evaluate(() => {
  const e = new window.__camera.rotation.constructor().setFromQuaternion(window.__camera.quaternion, 'YXZ');
  return (e.y * 180) / Math.PI;
});
await page.evaluate(([y, p]) => window.__look(y, p), [base + yaw, pitch]);
await page.waitForTimeout(10000);
// Nobody and nothing (no room furnished: the block is skipped), as it ships, and every lit room furnished and full.
const sums = { none: [], shipped: [], all: [] };
for (let r = 0; r < rounds; r++) {
  for (const [name, furnished, folk] of [['none', 0, 0], ['shipped', 0.8, 1], ['all', 1, 3]]) {
    await page.evaluate(([w, f]) => { window.__city.uWindow.value.w = w; window.__mood.windowFolk = f; }, [furnished, folk]);
    await page.waitForTimeout(4000);
    sums[name].push(await page.evaluate(() => {
      const a = [...window.__perf.gpu.slice(-120)].sort((x, y) => x - y);
      return +(a[Math.floor(a.length / 2)] ?? 0).toFixed(2);
    }));
  }
}
for (const [name, v] of Object.entries(sums)) console.log(name.padEnd(8), 'gpu ms', v.join(' '), '· mean', (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2));
await browser.close();
await server.close();
