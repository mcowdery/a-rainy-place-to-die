// Manila's jeepney lines: a jeepney at its stop, the open back from the step, the cabin from the step, sitting inside,
// out the back, and the hail.
//   node debug-shots/jeepney_ride/jeepshots.mjs [out dir] [line]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/jeepney_ride';
const line = process.argv[3] ?? 'kubao_divisora';
const edge = Number(process.env.EDGE ?? 0);
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
await page.goto(`${server.resolvedUrls.local[0]}?city=manila&debug=1&diag=1&clock=${process.env.CLOCK ?? '15:00'}&weather=clear&season=summer&spawn=bayside.start`, { timeout: 600000 });
for (let i = 0; i < 300; i++) {
  const st = await page.evaluate(() => ({ d: !!window.__district, j: !!window.__jeep, o: document.getElementById('overlay')?.textContent?.slice(0, 80) }));
  if (st.d && st.j && st.o === 'click to walk') break;
  if (i % 4 === 3) console.log('booting:', JSON.stringify(st));
  await page.waitForTimeout(5000);
}
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(3000);
const shot = async (n, wait = 1500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };
console.log('lines', JSON.stringify(await page.evaluate(() => window.__jeep.lines())));
if (process.env.RIDE !== '0') {
  const STOPONLY = process.env.STOPONLY === '1';
console.log('arrive', await page.evaluate(([l, e]) => window.__jeep.arrive(l, e), [line, edge]));
await shot('1_waiting', 2500);
// Wait for it to stand with its back open (up to ~3 min of real time).
let at = false;
for (let i = 0; i < 90 && !at; i++) {
  await page.waitForTimeout(2000);
  at = await page.evaluate(() => window.__jeep.ready());
}
console.log('standing', at, JSON.stringify(await page.evaluate(() => window.__jeep.info())));
// From the pole, looking along the kerb at the jeepney standing beside it.
await page.evaluate(() => { const c = window.__camera; const yaw = (Math.atan2(-c.getWorldDirection(new c.position.constructor()).x, -c.getWorldDirection(new c.position.constructor()).z) * 180) / Math.PI; window.__jeep.view(yaw + 180 - 25, -4); });
await shot('2_at_the_stop', 800);
await page.evaluate(([l, e]) => window.__jeep.stopAt(l, e, 9, 5, 20), [line, edge]);
await shot('2c_the_stop', 800);
await page.evaluate(([l, e]) => window.__jeep.stopAt(l, e, -9, 5, 160), [line, edge]);
await shot('2d_the_stop_from_ahead', 800);
if (process.env.STOPONLY === '1') { await browser.close(); await server.close(); process.exit(0); }
await page.evaluate(() => window.__jeep.behind());
await shot('2b_at_the_back_step', 800);
console.log('board', await page.evaluate(() => window.__jeep.board()));
await shot('3_on_the_step', 1200);
// Walk in along the aisle, then sit.
await page.keyboard.down('w');
await page.waitForTimeout(1300);
await page.keyboard.up('w');
await shot('4_in_the_aisle', 800);
await page.keyboard.press('e');
await shot('5_seated_across', 1200);
await page.evaluate(() => window.__rider.look(0, 0));
await shot('6_seated_looking_out_the_back', 1200);
await page.evaluate(() => window.__rider.look(-Math.PI / 2, 0));
await shot('7_seated_other_way', 800);
console.log('state', JSON.stringify(await page.evaluate(() => ({ seated: !!window.__rider.seated, where: window.__rider.where }))));
}
// The hail: a kerb 200 m on from the stop, a wave (Shift+H's call), and the jeepney pulls in with its back step at you.
if (process.env.HAIL !== '0') {
  await page.evaluate(() => window.__rider.leave?.());
  console.log('hailTest', await page.evaluate(() => window.__jeep.hailTest('pasag_kiyapo', 0)));
  await page.waitForTimeout(4000);
  console.log('hail', await page.evaluate(() => window.__jeep.hail()));
  await shot('8_hail_waiting', 500);
  let ok = false;
  for (let i = 0; i < 90 && !ok; i++) { await page.waitForTimeout(2000); ok = await page.evaluate(() => window.__jeep.ready()); }
  console.log('hailed one standing', ok, JSON.stringify(await page.evaluate(() => window.__jeep.info().filter((v) => v.line === 'pasag_kiyapo'))));
  await shot('9_hailed_stopped', 500);
}
await browser.close();
await server.close();
