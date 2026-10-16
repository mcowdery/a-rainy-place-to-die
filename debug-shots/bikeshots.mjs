// A hero bike alone against white: side, three-quarters, rear, and from the seat.
//   node debug-shots/bikeshots.mjs <out dir> [bosozoku|cruiser|cruiser:black|hayate|hayate:white]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const which = process.argv[3] ?? 'bosozoku';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html`);
await page.waitForTimeout(7000);
await page.keyboard.press('Digit1');
await page.keyboard.press('KeyB');
await page.evaluate((which) => {
  for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none';
  document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none'));
  const { THREE, scene, buildBosozoku, buildCruiser, CRUISER_LOOKS, buildSportBike, SPORT_LOOKS, env } = window.__lab;
  scene.background = new THREE.Color(0xf2f2f0);
  const b = which.startsWith('cruiser') ? buildCruiser(env, CRUISER_LOOKS[which.split(':')[1] ?? 'silver']) : which.startsWith('hayate') ? buildSportBike(env, SPORT_LOOKS[which.split(':')[1] ?? 'black']) : buildBosozoku(env);
  b.root.position.set(300, 0, 300);
  scene.add(b.root);
  window.__bike = b;
}, which);
const shots = {
  side: [-3.2, 1.0, 0, 0, 0.8, 0],
  front34: [-2.2, 1.4, -2.3, 0, 0.8, -0.1],
  rear34: [1.9, 1.5, 2.4, 0, 0.8, 0.1],
  front: [0, 1.0, -3.4, 0, 0.85, 0],
  seat: [0, 1.62, 0.32, 0, 1.0, -0.9],
};
for (const [name, [x, y, z, tx, ty, tz]] of Object.entries(shots)) {
  await page.evaluate(([x, y, z, tx, ty, tz]) => __view(300 + x, y, 300 + z, 300 + tx, ty, 300 + tz), [x, y, z, tx, ty, tz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
