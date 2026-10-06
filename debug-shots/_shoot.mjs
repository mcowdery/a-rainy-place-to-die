import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); else if (/^DBG/.test(m.text())) console.log(m.text()); });
await page.addInitScript(() => localStorage.setItem('citypop.driveView', 'chase'));
await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1&spawn=kaburo_crossing.view&car=home&clock=14:00&weather=clear`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__chase, null, { timeout: 60000 });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1000);
console.log('start', await page.evaluate(() => window.__chase.start(process.argv?.[2] ?? 'runner')).catch(() => page.evaluate(() => window.__chase.start('runner'))));
await page.waitForFunction(() => window.__chase.state()?.phase === 'running', null, { timeout: 20000 });
const info = () => page.evaluate(() => {
  const g = window.__chase.gun; const st = window.__chase.state(); const rig = window.__chase.chase; 
  return { side: g.side, out: g.out, slow: +g.slow.toFixed(2), car: st.cars[0], aim: window.__bike.driving.aim };
});
for (let k = 0; k < 10; k++) {
  const side = await page.evaluate(() => window.__chase.aim(0));
  await page.waitForTimeout(200);
  await page.evaluate(() => (window.__chase.aim(0), window.__chase.fire()));
  await page.waitForTimeout(250);
  console.log(k, side, JSON.stringify(await info()));
  if (k === 3) await page.screenshot({ path: 'debug-shots/carchase/shoot.png' });
}
await browser.close();
await server.close();
