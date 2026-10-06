// Numbers for the stomp: your eyes, his head, the foot's target and where the foot is, through the move.
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1000);
await page.evaluate(async () => { await __fp.enter(14, 30, 0); __fp.hand('fists'); __fp.spawn(1); __fp.draw(); });
await page.waitForFunction(() => __fp.thugs().length > 0, null, { timeout: 60000, polling: 200 });
await page.evaluate(() => { const t = __fp.thugs()[0]; const c = __fp.camera().position; t.place(c.x, 0.15, c.z - 1.1, Math.PI); __fp.thugs().slice(1).forEach((x) => (x.root.visible = false)); t.knockDown(t.root.position.clone().set(0, 0, -1)); });
await page.waitForTimeout(800);
console.log('floored', await page.evaluate(() => __fp.thugs()[0].state), 'start', await page.evaluate(() => __fp.forceKill('stomp')));
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(130);
  console.log(await page.evaluate(() => {
    const t = __fp.thugs()[0];
    const r = __fp.rig();
    const f = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
    const P = r.poseOverride;
    return `eye ${f(__fp.camera().position)} head ${f(t.headCentre())} target ${P && P.footWorld ? f(P.footWorld.p) + ' w' + P.footWorld.w.toFixed(2) : '-'} foot ${f(r.legs.r.hand.getWorldPosition(t.root.position.clone()))} run ${__fp.brawl().run?.u.toFixed(2)}`;
  }));
}
await browser.close(); await server.close();
