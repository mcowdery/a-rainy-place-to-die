// The mob in the city: a shot at a spawn and what the crowd costs there (figures, triangles, GPU and CPU a frame).
//   node debug-shots/mobcity.mjs <out dir> [query] [spawn,spawn...]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/mobcity';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const spawns = (process.argv[4] ?? 'kaburo_crossing.view').split(',');
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const spawn of spawns) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 300)); });
  await page.goto(`${server.resolvedUrls.local[0]}district.html?debug=1&diag=1${extra}&time=day&weather=clear&res=100&spawn=${spawn}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(12000);
  const stats = await page.evaluate(() => {
    let tris = 0, figures = 0, draws = 0;
    const crowd = window.__scene.getObjectByName('crowd');
    crowd?.traverseVisible((o) => {
      // (Not the emotes' layers, real/emotes.ts: the marks and the breath, a draw each over the same figures.)
      if (!o.isMesh || o.name.startsWith('emotes')) return;
      const n = o.geometry.instanceCount ?? 1;
      tris += (o.geometry.index.count / 3) * n;
      figures += n;
      draws++;
    });
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
    const p = window.__perf;
    return { figures, draws, tris: Math.round(tris / 1000) + 'k', gpu: +med(p.gpu.slice(-300)).toFixed(2), cpu: +med(p.cpu.slice(-300)).toFixed(2) };
  });
  console.log(spawn, JSON.stringify(stats));
  await page.screenshot({ path: `${out}/${spawn.replace(/\W+/g, '_')}.png` });
  await page.close();
}
await browser.close();
await server.close();
