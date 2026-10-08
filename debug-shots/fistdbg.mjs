// Numbers for the fist: each digit's tip distance from the hand bone and how far each joint is bent.
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
await page.goto(`${server.resolvedUrls.local[0]}fight.html`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(1000);
await page.evaluate(async () => { await __fp.enter(0, 3, 0); __fp.look(0, 0); __fp.hand('fists'); __fp.draw(); });
await page.waitForTimeout(1200);
console.log(await page.evaluate(() => {
  __fp.freeze(true);
  const out = [];
  for (const s of ['r', 'l']) {
    const arm = __fp.rig().arms[s];
    const P = (b) => b.getWorldPosition(__fp.camera().position.clone());
    const h = P(arm.hand);
    const ang = (a, b, c) => { const u = P(b).sub(P(a)).normalize(); const v = P(c).sub(P(b)).normalize(); return Math.round(Math.acos(Math.max(-1, Math.min(1, u.dot(v)))) * 57.3); };
    for (const [i, ch] of arm.fingers.entries()) {
      const tip = P(ch[2]);
      out.push(`${s} finger${i}: tip ${(tip.distanceTo(h) * 100).toFixed(1)}cm bends ${ang(arm.hand, ch[0], ch[1])} ${ang(ch[0], ch[1], ch[2])} names ${ch.map((b) => b.name).join(',')}`);
    }
    out.push(`${s} thumb tip ${(P(arm.thumb[2]).distanceTo(h) * 100).toFixed(1)}cm names ${arm.thumb.map((b) => b.name).join(',')} children ${arm.fingers[0][2].children.map((c) => c.name).join(',')}`);
  }
  return out.join('\n');
}));
await browser.close(); await server.close();
