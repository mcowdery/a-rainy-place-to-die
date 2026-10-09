// The rooms behind the windows in the city (real/city.ts, windowScenes.ts): shots looking up at facades from a spawn,
// with the share of windows lit there and then (the atmosphere's share times each kind of building's factor for the
// hour, season and weather, averaged over the buildings' own bias), the warm start's time and the GPU's a frame.
//   node debug-shots/windowpeople.mjs <out dir> [query] [spawn,spawn...] [yaw:pitch[:fov],yaw:pitch...]
// The looks are turns from the spawn's own view (degrees; left and up positive). Useful in the query: clock=21:00,
// weather=rain, season=winter, windowFolk=3 (more people), windowVice=4, vignette=<scene id or cell> (that scene in
// every furnished room: ids are on the contact sheets, debug-shots/windowsheet.mjs).
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/windowpeople';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '&clock=21:00';
const spawns = (process.argv[4] ?? 'kaburo_crossing.view').split(',');
const looks = (process.argv[5] ?? '0:18').split(',').map((l) => l.split(':').map(Number));
// (No file watching: other edits to the tree would reload the page mid-shot.)
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const spawn of spawns) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
  const t0 = Date.now();
  await page.goto(`${server.resolvedUrls.local[0]}district.html?diag=1${/weather=/.test(extra) ? '' : '&weather=clear'}&res=100&spawn=${spawn}${extra}`);
  await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 250 });
  const warm = ((Date.now() - t0) / 1000).toFixed(1);
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
  await page.waitForTimeout(9000);
  const lit = await page.evaluate(() => {
    const U = window.__city;
    const wl = U.uWindowLit.value, k = U.uLit.value.toArray();
    // A room is lit when its hash is under the building's share; an office's hash is mostly its floor's (0.65 of
    // one uniform number and 0.35 of another), so its share goes through that sum's distribution.
    const office = (x) => { let n = 0; for (let i = 0; i < 4000; i++) if (0.65 * ((i * 0.6180339) % 1) + 0.35 * ((i * 0.7548776) % 1) < x) n++; return n / 4000; };
    const share = (f, through = (x) => x) => { let s = 0; for (let b = 0; b < 8; b++) s += through(Math.min(1, wl * (0.35 + (1.3 * b) / 7) * f)); return Math.round((s / 8) * 100); };
    return { atmosphere: +wl.toFixed(2), offices: share(k[0], office), homes: share(k[1]), hotels: share(k[2]), nightlife: share(k[3]), folk: U.uFolk.value.toArray().map((v) => +v.toFixed(2)), night: U.uNight.value.toArray().map((v) => +v.toFixed(2)) };
  });
  console.log(spawn, 'lit %', JSON.stringify(lit));
  const base = await page.evaluate(() => {
    const e = new window.__camera.rotation.constructor().setFromQuaternion(window.__camera.quaternion, 'YXZ');
    return [(e.y * 180) / Math.PI, (e.x * 180) / Math.PI];
  });
  let i = 0;
  for (const [yaw, pitch, fov] of looks) {
    await page.evaluate(([y, p]) => window.__look(y, p), [base[0] + yaw, pitch]);
    // (A third number is the field of view, to look closely at a facade: 270:14:12.)
    if (fov) await page.evaluate((f) => { window.__camera.fov = f; window.__camera.updateProjectionMatrix(); }, fov);
    await page.waitForTimeout(3500);
    const gpu = await page.evaluate(() => {
      const a = [...window.__perf.gpu.slice(-150)].sort((x, y) => x - y);
      return +(a[Math.floor(a.length / 2)] ?? 0).toFixed(2);
    });
    const name = `${spawn.replace(/\W+/g, '_')}_${i++}`;
    console.log(name, JSON.stringify({ warm: +warm, gpu, yaw, pitch }));
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  await page.close();
}
await browser.close();
await server.close();
