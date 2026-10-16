// Find a feeder bus near a point and photograph it: node debug-shots/feederbus.mjs x,z name
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const [px, pz] = (process.argv[2] ?? '4230,900').split(',').map(Number);
const name = process.argv[3] ?? 'dome';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}?diag=1&debug=1&clock=12:00&weather=clear&fly=1&cam=${px},40,${pz},0,-60`);
  await page.waitForTimeout(40_000);
  for (let i = 0; i < 6; i++) {
    const r = await page.evaluate(([px, pz]) => {
      const t = window.__traffic;
      const buses = t.vehicles.filter((v) => v.bus);
      buses.sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
      const b = buses[0];
      // Behind and to the left (the kerb side), looking at it.
      const lx = b.dz, lz = -b.dx;
      const cx = b.x - b.dx * 18 + lx * 5, cz = b.z - b.dz * 18 + lz * 5;
      window.__camera.position.set(cx, 3, cz);
      window.__camera.lookAt(b.x, 1.5, b.z);
      return { bus: [Math.round(b.x), Math.round(b.z)], d: Math.round(Math.hypot(b.x - px, b.z - pz)), v: b.v.toFixed(1), n: buses.length };
    }, [px, pz]);
    console.log(JSON.stringify(r));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `debug-shots/feeder_${name}_${i}.png` });
    await page.waitForTimeout(6000);
  }
} finally {
  await browser.close();
  await server.close();
}
