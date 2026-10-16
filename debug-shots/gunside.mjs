// The lever gun alone, against white, from its left side (barrel left) like the reference photos.
//   node debug-shots/gunside.mjs <out dir>
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}models-mack.html`);
await page.waitForTimeout(7000);
await page.keyboard.press('Digit1');
await page.evaluate(async () => {
  for (const id of ['panel', 'hud']) document.getElementById(id).style.display = 'none';
  document.querySelectorAll('.label').forEach((l) => (l.style.display = 'none'));
  const { THREE, scene: sc, buildShotgun, env } = window.__lab;
  sc.background = new THREE.Color(0xf2f2f0);
  window.__gunAt = new THREE.Vector3(300, 1.5, 300);
  const g = buildShotgun('lever', env);
  g.root.position.copy(window.__gunAt);
  sc.add(g.root);
  window.__gun = g;
});
const shots = {
  // [eye offset from the gun's middle, in its frame], looking at its middle (gun frame z -0.2 is mid-length)
  side: [-1.15, 0, -0.2],
  quarter: [-0.8, 0.45, 0.45],
  handle: [-0.26, 0.16, 0.26],
  under: [0.12, -0.1, 0.34],
};
for (const [name, [x, y, z]] of Object.entries(shots)) {
  await page.evaluate(([x, y, z, n]) => {
    const p = window.__gunAt;
    const lookZ = n === 'handle' || n === 'under' ? 0.05 : -0.2;
    __view(p.x + x, p.y + y, p.z + z, p.x, p.y - 0.02, p.z + lookZ);
  }, [x, y, z, name]);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png` });
}
await browser.close(); await server.close();
