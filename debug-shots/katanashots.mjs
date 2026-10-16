// The katana alone against white (sword and saya apart), and the helmets: whole, fittings, point, from above.
//   node debug-shots/katanashots.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
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
await page.evaluate(() => {
  for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none';
  document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none'));
  const { THREE, scene, buildKatana, buildHelmet, HELMET_LOOKS, env } = window.__lab;
  scene.background = new THREE.Color(0xf2f2f0);
  const k = buildKatana(env);
  // Blade along +x, edge down, at 1 m; the saya 12 cm below.
  k.root.rotation.set(0, -Math.PI / 2, 0);
  k.root.position.set(300, 1, 300);
  k.saya.position.y = -0.12;
  scene.add(k.root);
  Object.keys(HELMET_LOOKS).forEach((n, i) => {
    const h = buildHelmet(env, HELMET_LOOKS[n]);
    h.position.set(310 + i * 0.5, 1, 300);
    h.rotation.y = -0.6;
    scene.add(h);
  });
});
const shots = {
  k_whole: [300.2, 1.0, 301.1, 300.2, 0.95, 300],
  k_fittings: [299.85, 1.03, 300.3, 299.85, 0.99, 300],
  k_point: [300.68, 1.02, 300.2, 300.66, 1.02, 300],
  k_above: [300.2, 1.9, 300.05, 300.2, 1.0, 300],
  k_spine: [299.3, 1.06, 300.04, 300.4, 1.0, 300],
  helmets: [310.25, 1.15, 301.2, 310.25, 1.0, 300],
  helmets_back: [310.25, 1.15, 298.9, 310.25, 1.0, 300],
  helmets_side: [309.2, 1.05, 300.0, 310.25, 1.0, 300],
  helmet_near: [310.15, 1.03, 300.55, 310.0, 1.0, 300],
};
for (const [name, [x, y, z, tx, ty, tz]] of Object.entries(shots)) {
  await page.evaluate(([x, y, z, tx, ty, tz]) => __view(x, y, z, tx, ty, tz), [x, y, z, tx, ty, tz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
