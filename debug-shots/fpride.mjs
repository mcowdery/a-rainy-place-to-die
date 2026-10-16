// Riding the black cruiser in the showroom's first person: seated views, a turn, and the pose from outside.
//   node debug-shots/fpride.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html?fp=1`);
await page.waitForFunction(() => window.__fp && window.__fp.rig(), null, { timeout: 60000, polling: 250 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.getElementById('panel').style.display = 'none'; document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none')); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
await page.evaluate(async () => { await __fp.enter(13.0, 38.6, 0); __fp.ride(); });
await page.waitForTimeout(800);
console.log(await page.evaluate(() => (__fp.riding() ? 'riding' : 'not riding')));
await shot('r1_seat');
await page.evaluate(() => __fp.look(0, -0.9)); await page.waitForTimeout(500); await shot('r2_down');
await page.evaluate(() => __fp.look(1.2, -0.2)); await page.waitForTimeout(500); await shot('r3_left');
await page.evaluate(() => __fp.look(0, -0.12));
// From outside, parked with the rider on.
const outside = async (n, dx, dy, dz) => {
  await page.evaluate(([dx, dy, dz]) => { __fp.freeze(true); const r = __fp.riding(); __view(r.x + dx, 1.2 + dy, r.z + dz, r.x, 0.9, r.z); }, [dx, dy, dz]);
  await page.waitForTimeout(400); await shot(n);
  await page.evaluate(() => __fp.freeze(false));
};
await outside('r4_side', -2.6, 0, -1.4);
await outside('r5_front', -1.0, 0.3, -3.0);
// Ride off and turn right.
await page.evaluate(() => { __fp.key('KeyW', true); });
await page.waitForTimeout(2500);
await page.evaluate(() => { __fp.key('KeyD', true); });
await page.waitForTimeout(900);
await shot('r6_turn');
await outside('r7_turn_out', -3.0, 0.6, -2.5);
await page.evaluate(() => { __fp.key('KeyD', false); __fp.key('KeyW', false); });
console.log(await page.evaluate(() => { const r = __fp.riding(); return `u ${r.u.toFixed(1)} m/s lean ${(r.lean * 57.3).toFixed(0)} deg`; }));
await browser.close(); await server.close();
