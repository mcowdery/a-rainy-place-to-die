// What the reflection pass costs dry, now that it runs for open water: GPU ms (the mean of 180 frames) with the
// pass on and off, at the crossing (no water in view), by the river, the pond and the bay.
// node debug-shots/waterperf.mjs [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ? `&${process.argv[2]}` : '';
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&weather=clear&clock=13:00&res=100&spawn=kaburo_crossing.view${extra}`, { timeout: 240000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  document.getElementById('overlay').hidden = true;
});
const mean = async () => {
  await page.waitForTimeout(5000);
  return page.evaluate(() => {
    const a = window.__perf.gpu.slice(-180);
    return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  });
};
const SPOTS = [
  ['crossing (no water)', null],
  ['river', [4733, 1.7, 1350, -90, -6]],
  ['pond', [2654.9, 1.7, 1459.7, 46, -8]],
  ['bay', [3100, 1.7, 2811, 180, -5]],
];
for (const [label, at] of SPOTS) {
  if (at) {
    await page.evaluate(([x, y, z, yaw, pitch]) => {
      window.__camera.position.set(x, y, z);
      window.__look(yaw, pitch);
    }, at);
  }
  await page.waitForTimeout(12000);
  const out = [];
  // Twice round, so a drift in the scene's own cost shows.
  for (const on of [true, false, true, false]) {
    await page.evaluate((on) => {
      window.__passes.ssr.enabled = on;
    }, on);
    out.push(`${on ? 'on' : 'off'} ${(await mean()).toFixed(2)}`);
  }
  console.log(label.padEnd(20), out.join('  '));
}
await browser.close();
await server.close();
