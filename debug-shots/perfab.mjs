// A/B frame cost at places the frame-rate recorder found slow on the user's PC (positions from debug-shots/perf events).
// draw calls and triangles from the renderer, triangles in view by top-level group from __tris).
//   node debug-shots/perfab.mjs <out dir> [label] [spots=all|name,name] [extra query]
// Runs exclusive on the GPU (it times frames).
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/perf_manila';
const city = process.argv[3] ?? "ab";
const only = process.argv[4] && process.argv[4] !== 'all' ? process.argv[4].split(',') : null;
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
mkdirSync(out, { recursive: true });
const C = 128;
// [name, x, z, yaw]  (eye 1.7 m, on a cell-edge road)
const SPOTS = [
  ["start-crossing", 5323, 18, 2693, 90],
  ["kaburo-30-11", 3842, 2, 1534, -71],
  ["kaburo-27-10", 3584, 2, 1288, 117],
  ["kasumi-25-14", 3323, 2, 1797, 150],
  ["port-fly-40-20", 5166, 16, 2661, 29],
  ["denko-fly-33-12", 4249, 132, 1627, -92],
];
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});
const rows = [];
try {
  const q = '';
  for (const [name, x, y, z, yaw] of SPOTS) {
    if (only && !only.includes(name)) continue;
    // One boot a spot, the camera placed by ?cam= (Tokyo's start otherwise drifts the player off the spot).
    const page = await browser.newPage({ viewport: { width: 2413, height: 922 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 500)));
    await page.goto(`${server.resolvedUrls.local[0]}?${q}debug=1&diag=1&res=100&perflog=0&cam=${x},${y},${z},${yaw},0${/(^|&)time=/.test(extra) ? '' : '&time=day'}${/(^|&)weather=/.test(extra) ? '' : '&weather=clear'}${extra}`, { timeout: 300000 });
    for (let i = 0; i < 120; i++) {
      const st = await page.evaluate(() => ({ d: !!window.__district && !!window.__perf, o: document.getElementById('overlay')?.textContent?.slice(0, 40) }));
      if (st.d && st.o === 'click to walk') break;
      await page.waitForTimeout(3000);
    }
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
    // let the chunks come in, then measure
    await page.waitForTimeout(8000);
    for (let i = 0; i < 20; i++) {
      const n = await page.evaluate(() => window.__district.inFlightCount ?? 0);
      if (!n) break;
      await page.waitForTimeout(1000);
    }
    // six windows of 2.5 s: the minimum of their averages is the number to trust on a machine other agents share
    const wins = [];
    for (let w = 0; w < 6; w++) {
      await page.evaluate(() => { window.__perf.cpu.length = 0; window.__perf.gpu.length = 0; });
      await page.waitForTimeout(2500);
      wins.push(await page.evaluate(() => { const a = (x) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0); return { cpu: a(window.__perf.cpu), gpu: a(window.__perf.gpu) }; }));
    }
    wins.sort((a, b) => a.gpu - b.gpu);
    const best = wins[0];
    const med = wins[wins.length >> 1];
    const r = await page.evaluate(() => {
      const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
      const info = window.__renderer.info.render;
      const tri = window.__tris();
      return { cpu: avg(window.__perf.cpu), gpu: avg(window.__perf.gpu), n: window.__perf.cpu.length, calls: info.calls, tris: info.triangles, top: tri.slice(0, 8), loaded: `${window.__district.loaded}/${window.__district.detailedChunks}`, sun: `sun ${window.__sun.intensity.toFixed(2)} shadow ${window.__sun.shadow.intensity}/${window.__sun.shadow.autoUpdate}` };
    });
    r.name = name;
    r.best = best;
    r.med = med;
    rows.push(r);
    await page.close();
    console.log(`${city} ${name.padEnd(9)} gpu min ${r.best.gpu.toFixed(2)} med ${r.med.gpu.toFixed(2)} ms  cpu (min-window) ${r.best.cpu.toFixed(2)} med ${r.med.cpu.toFixed(2)} ms  calls ${r.calls}  tris ${(r.tris / 1000).toFixed(0)}k  (${r.n} frames) ${r.sun} loaded ${r.loaded}\n    ${r.top.join(' | ')}`);
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(`${out}/spots_${city}_${(process.argv[5] ?? '').replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify(rows, null, 1));
