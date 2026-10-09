// A subway train turning back past an end station, seen from its platform: node debug-shots/subturn.mjs
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}?debug=1&diag=1&clock=12:00&fly=1&cam=3584,-8,3300,180,-3`);
  await page.waitForTimeout(40_000);
  // Moments in the turn of a wakaba train: crossing over, standing, leaving (the line's clock set to each).
  const moments = await page.evaluate(() => {
    const sub = window.__subway;
    const tr = sub.trains.find((t) => t.line.id === 'wakaba' && t.dir === 1);
    const P = tr.period;
    // Its last run ends at P: crossing ~10 s before, then the other way's stand for 25 s, then leaving.
    const at = (cyc) => ((cyc - tr.offset) % P + P) % P;
    return { cross: at(P - 9), stand: at(P + 8), leave: at(P + 31) };
  });
  console.log(moments);

  for (const [name, c] of Object.entries(moments)) {
    await page.evaluate((c) => { window.__subway.clock = c; window.__camera.position.set(3584, -8.6, 3300); window.__camera.lookAt(3584, -9, 3400); }, c);
    await page.waitForTimeout(600);
    console.log(name, await page.evaluate(() => window.__subway.trains.filter((t) => t.line.id === 'wakaba').map((t) => `${t.dir} vis ${t.obj.visible} ${t.obj.children.map((c) => `${Math.round(c.position.x)},${Math.round(c.position.z)}`).join(' ')}`).join(' | ') + ' grp ' + window.__subway.group.visible + ' cam ' + window.__camera.position.toArray().map(Math.round)));
    await page.screenshot({ path: `debug-shots/subturn_${name}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
