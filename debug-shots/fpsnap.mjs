import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(() => { __fp.kind('lever'); __fp.oneHand(true); __fp.aim(false); __fp.look(0, 0); });
await page.waitForTimeout(900);
console.log(await page.evaluate(async () => {
  const rig = __fp.rig();
  const g = rig.guns.lever.root;
  const out = [];
  const before = rig.shells;
  rig.fire();
  const t0 = performance.now();
  let firedAt = null;
  while (performance.now() - t0 < 2200) {
    await new Promise((r) => requestAnimationFrame(r));
    const e = g.matrixWorld.elements;
    if (firedAt === null && rig.shells < before) firedAt = [Math.round(performance.now() - t0), (-e[9]).toFixed(2)];
    out.push([Math.round(performance.now() - t0), (-e[9]).toFixed(2)]);
  }
  return `fired at ${firedAt?.[0]} ms with the muzzle's up ${firedAt?.[1]}; muzzle up at 0/500/1500/2100 ms: ${[0, 500, 1500, 2100].map((t) => out.find((o) => o[0] >= t)?.[1]).join(' / ')}`;
}));
await browser.close(); await server.close();
