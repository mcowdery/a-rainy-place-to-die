// The jeepney and the tricycle in the showroom (models-cars-ph.html), lit, from several angles.
//   node debug-shots/jeepneyshots.mjs <out dir> [studio|night|day] [livery 0-3]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/jeepney';
const mode = process.argv[3] ?? 'studio';
const li = Number(process.argv[4] ?? 0);
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}models-cars-ph.html`);
await page.waitForTimeout(9000);
await page.keyboard.press(mode === 'night' ? 'Digit2' : mode === 'day' ? 'Digit3' : 'Digit1');
await page.addStyleTag({ content: '.label{display:none !important}' });
await page.evaluate(() => {
  for (const id of ['panel', 'hud']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
  document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none'));
});
const cx = -10 + li * 5.4;
const z = 0;
const shots = {
  side: [cx - 12, 1.5, z, cx, 1.15, z],
  sideclose: [cx - 6.5, 1.4, z + 1.6, cx, 1.1, z + 1.6],
  front34: [cx - 4.5, 1.7, z + 8.5, cx, 1.1, z + 1.5],
  front: [cx, 1.5, z + 9, cx, 1.2, z],
  rear34: [cx - 3.5, 1.9, z - 8, cx, 1.0, z - 1],
  rear: [cx, 1.6, z - 9, cx, 1.2, z],
  top: [cx + 3, 6, z + 5, cx, 1.8, z],
  tricycle: [14 + 3, 1.4, z + 4.5, 14, 0.7, z],
};
for (const [name, [x, y, zz, tx, ty, tz]] of Object.entries(shots)) {
  await page.evaluate(([x, y, z, tx, ty, tz]) => __view(x, y, z, tx, ty, tz), [x, y, zz, tx, ty, tz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${mode}-${li}-${name}.png` });
}
await browser.close(); await server.close();
