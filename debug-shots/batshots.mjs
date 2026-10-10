// The baseball bat alone against white (whole, the maker's mark, the knob, the end, bloodied), and on its pegs
// in the showroom.
//   node debug-shots/batshots.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
await page.goto(`${server.resolvedUrls.local[0]}models.html`);
await page.waitForTimeout(7000);
await page.keyboard.press('KeyB');
// On its pegs, labels and all.
await page.evaluate(() => document.querySelectorAll('#panel button').forEach((b) => b.textContent === 'baseball bat' && b.click()));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/pegs.png` });
await page.evaluate(() => {
  for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none';
  document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none'));
  const { THREE, scene, buildBat, env } = window.__lab;
  scene.background = new THREE.Color(0xf2f2f0);
  // The barrel along +x at 1 m, the mark turned up toward the camera; a second one below it, bloodied.
  [0, 1].forEach((i) => {
    const b = buildBat(env);
    b.root.rotation.set(0, -Math.PI / 2, 0.5, 'YXZ');
    b.root.position.set(300, 1 - i * 0.14, 300);
    if (i) b.setBlood(0.9);
    scene.add(b.root);
  });
});
const shots = {
  whole: [300.18, 0.98, 301.05, 300.18, 0.93, 300],
  mark: [300.32, 1.08, 300.26, 300.32, 1.0, 300],
  knob: [299.72, 1.04, 300.2, 299.8, 1.0, 300],
  end: [300.75, 1.03, 300.2, 300.58, 1.0, 300],
  blood: [300.42, 0.92, 300.36, 300.42, 0.86, 300],
};
for (const [name, [x, y, z, tx, ty, tz]] of Object.entries(shots)) {
  await page.evaluate(([x, y, z, tx, ty, tz]) => __view(x, y, z, tx, ty, tz), [x, y, z, tx, ty, tz]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
