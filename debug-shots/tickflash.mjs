// Records the fog and sky each rendered frame across minute ticks; reports one-frame outliers: node debug-shots/tickflash.mjs
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.goto(`${base}?debug=1&diag=1&clock=22:00&weather=rain&spawn=kaburo_crossing.view`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
  await page.waitForTimeout(3000);
  const log = await page.evaluate(async () => {
    const r = window.__renderer;
    const sky = window.__scene.children.find((o) => o.material?.uniforms?.uSunPos);
    const rows = [];
    let last = -1;
    const orig = r.render.bind(r);
    r.render = (scene, cam) => {
      // (The first scene draw each animation frame.)
      if (scene === window.__scene && last !== window.__frameNo) {
        last = window.__frameNo;
        rows.push([window.__scene.fog.far, sky.material.uniforms.uZenith.value.r, Math.floor(window.__clock.total())]);
      }
      return orig(scene, cam);
    };
    let n = 0;
    const count = () => { window.__frameNo = n++; requestAnimationFrame(count); };
    count();
    await new Promise((res) => setTimeout(res, 9000));
    return rows;
  });
  let outliers = 0;
  let ticks = 0;
  for (let i = 1; i + 1 < log.length; i++) {
    if (log[i][2] !== log[i - 1][2]) ticks++;
    for (const k of [0, 1]) {
      const [a, b, c] = [log[i - 1][k], log[i][k], log[i + 1][k]];
      if (Math.abs(b - a) > 1e-4 * Math.max(1, Math.abs(a)) && Math.abs(b - c) > 1e-4 * Math.max(1, Math.abs(c)) && Math.abs(a - c) < Math.abs(b - a) * 0.5) {
        outliers++;
        console.log('outlier', k === 0 ? 'fog.far' : 'zenith', 'frame', i, a, b, c);
      }
    }
  }
  console.log(`frames ${log.length}, minute ticks ${ticks}, one-frame outliers ${outliers}`);
} finally {
  await browser.close();
  await server.close();
}
