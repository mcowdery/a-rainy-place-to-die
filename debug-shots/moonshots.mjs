// The moon's shapes: node debug-shots/moonshots.mjs  (a wide view from the crossing, and a zoomed one on the moon)
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const shapes = process.argv[2]?.split(',') ?? ['full', 'gibbous', 'half', 'crescent', 'hazy', 'classic'];
const extra = process.argv[3] ?? 'clock=23:00';
const tag = process.argv[4] ?? '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ready = async (page) => {
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  await page.waitForTimeout(3500);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 600)));
  for (const shape of shapes) {
    await page.goto(`${base}district.html?debug=1&diag=1&${extra}&weather=clear&moonShape=${shape}&spawn=kaburo_crossing.view`);
    await ready(page);
    // The street with the moon above it.
    await page.evaluate(() => {
      const c = window.__camera;
      const m = window.__scene.children.find((o) => o.material?.uniforms?.uMoonR).material.uniforms.uMoonDir.value.clone();
      m.y -= 0.45;
      c.lookAt(c.position.clone().add(m));
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `debug-shots/sky/moon-${shape}${tag}-wide.png` });
    // Zoomed on the moon.
    await page.evaluate(() => {
      const c = window.__camera;
      c.fov = 6;
      c.updateProjectionMatrix();
      c.lookAt(c.position.clone().add(window.__scene.children.find((o) => o.material?.uniforms?.uMoonR).material.uniforms.uMoonDir.value));
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `debug-shots/sky/moon-${shape}${tag}-zoom.png` });
    console.log(shape);
  }
} finally {
  await browser.close();
  await server.close();
}
