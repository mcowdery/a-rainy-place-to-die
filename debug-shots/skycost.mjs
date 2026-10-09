// GPU time with the sky shown and hidden, and the triangles by group: node debug-shots/skycost.mjs [query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ?? '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const q of ['clock=23:00&weather=clear', 'clock=18:10&weather=clear', 'clock=18:10&weather=clear&skyColors=computed']) {
    await page.goto(`${base}?debug=1&diag=1&${q}&spawn=kaburo_crossing.view${extra ? '&' + extra : ''}`);
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 180_000, polling: 500 });
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
    await page.waitForTimeout(6000);
    const skyVisible = (v) => page.evaluate((v) => { window.__scene.children.find((o) => o.material?.uniforms?.uCover && o.material?.uniforms?.uZenith).visible = v; }, v);
    // Alternate shown and hidden, 2.5 s each, six times; the median of each frame's GPU time per state.
    const runs = { shown: [], hidden: [] };
    for (let i = 0; i < 12; i++) {
      const state = i % 2 === 0 ? 'shown' : 'hidden';
      await skyVisible(state === 'shown');
      await page.waitForTimeout(300);
      const g = await page.evaluate(async () => {
        window.__perf.gpu.length = 0;
        await new Promise((r) => setTimeout(r, 2500));
        return [...window.__perf.gpu];
      });
      runs[state].push(...g);
    }
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)] ?? NaN; };
    const ms = med(runs.shown);
    const mh = med(runs.hidden);
    console.log(`${q}: GPU median sky shown ${ms.toFixed(2)} ms, hidden ${mh.toFixed(2)} ms (${runs.shown.length}/${runs.hidden.length} frames) · sky costs ${(ms - mh).toFixed(2)} ms`);
  }
} finally {
  await browser.close();
  await server.close();
}
