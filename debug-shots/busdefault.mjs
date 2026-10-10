// The new bus by default: count the traffic's buses by model, then stand behind one and photograph it.
//   node debug-shots/busdefault.mjs <out dir> [query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 650 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&clock=21:00${extra}`);
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
console.log(await page.evaluate(() => {
  const vs = window.__traffic.vehicles;
  const buses = vs.filter((v) => v.line);
  return `${vs.length} vehicles, ${buses.length} with a bus line, ${vs.filter((v) => v.bus2).length} of them the new bus`;
}));
// Stand 12 m behind-left of the nearest new bus and look at it.
await page.evaluate(() => {
  const c = window.__camera;
  const vs = window.__traffic.vehicles.filter((v) => v.bus2);
  vs.sort((a, b) => a.obj.position.distanceTo(c.position) - b.obj.position.distanceTo(c.position));
  const b = vs[0].obj;
  const fwd = new c.position.constructor(0, 0, 1).applyQuaternion(b.quaternion);
  const side = new c.position.constructor(fwd.z, 0, -fwd.x);
  c.position.copy(b.position).addScaledVector(fwd, -10).addScaledVector(side, 6);
  c.position.y = b.position.y + 2;
  c.lookAt(b.position.x, b.position.y + 1.5, b.position.z);
  window.__traffic.__frozen = true;
});
await page.evaluate(() => { window.__fly?.(true); });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/bus.png` });
await browser.close(); await server.close();
