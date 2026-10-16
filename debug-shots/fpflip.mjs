import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.evaluate(() => { __fp.kind('lever'); __fp.oneHand(true); __fp.aim(true); __fp.look(0, 0); });
await page.waitForTimeout(800);
const r = await page.evaluate(async () => {
  const g = __fp.rig().guns.lever.root;
  const out = [];
  __fp.fire();
  const t0 = performance.now();
  while (performance.now() - t0 < 900) {
    await new Promise((res) => requestAnimationFrame(res));
    const e = g.matrixWorld.elements;
    // the gun's forward is its -z: minus the third column
    out.push(`${Math.round(performance.now() - t0)}ms fwd.y ${(-e[9]).toFixed(2)} fwd.z ${(-e[10]).toFixed(2)}`);
  }
  return out.filter((_, i) => i % 3 === 0).join('\n');
});
console.log(r);
await browser.close(); await server.close();
