// Which shader programs get compiled while driving (each is a stall of tens to hundreds of ms): drives your own car on
// the auto-pilot and logs every change in the renderer's program list, with when, where and what the program is.
// Runs exclusive. node debug-shots/driveprograms.mjs [seconds] [mode] [node id] [query]
//   node debug-shots/driveprograms.mjs 60 fast kaburo_crossing.view "cam=2681,1.7,1739,3,0"
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
const secs = Number(process.argv[2] ?? 60);
const mode = process.argv[3] ?? 'fast';
const dest = process.argv[4] ?? 'kaburo_crossing.view';
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&spawn=city_garage.front&car=home&clock=22:30&res=100&perflog=0${extra}`, { timeout: 180000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
await page.evaluate(() => (document.getElementById('overlay').hidden = true));
await page.waitForFunction(() => typeof window.__drive === 'function' && window.__auto, null, { timeout: 60000 });
await page.waitForTimeout(3000);
console.log(await page.evaluate(() => window.__drive()));
await page.waitForTimeout(1500);
await page.evaluate((d) => window.__gps(d), dest);
// Poll every frame-ish in the page, so nothing is missed between our reads.
await page.evaluate(() => {
  const r = window.__renderer;
  const seen = new Map();
  window.__progLog = [];
  const t0 = performance.now();
  const tick = () => {
    const list = r.info.programs ?? [];
    if (list.length !== seen.size) {
      const now = new Set(list.map((p) => p.id));
      const fresh = new Set();
      for (const p of list) if (!seen.has(p.id)) fresh.add(p.id);
      // Which objects use the new programs: the material's current program says (renderer.properties).
      const users = new Map();
      if (fresh.size && window.__scene) {
        window.__scene.traverse((o) => {
          const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          for (const m of ms) {
            const pr = r.properties.get(m)?.currentProgram;
            if (pr && fresh.has(pr.id)) {
              const chain = [];
              for (let q = o, i = 0; q && i < 4; q = q.parent, i++) chain.push(q.name || q.type);
              const k = `${chain.join(' < ')} | mat ${m.name || m.type}`;
              users.set(k, (users.get(k) ?? 0) + 1);
            }
          }
        });
      }
      if (users.size) window.__progLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), n: list.length, name: 'USERS', key: [...users].slice(0, 12).map(([k, c]) => `${c}x ${k}`).join(' ;; '), at: null, kmh: null });
      for (const p of list) {
        if (!seen.has(p.id)) {
          seen.set(p.id, 1);
          const o = window.__own;
          window.__progLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), n: list.length, name: p.name, key: String(p.cacheKey).slice(0, 60), at: o ? [Math.round(o.sim.x), Math.round(o.sim.z)] : null, kmh: o ? Math.round(o.sim.u * 3.6) : null });
        }
      }
      for (const id of [...seen.keys()]) if (!now.has(id)) seen.delete(id);
    }
    requestAnimationFrame(tick);
  };
  tick();
});
await page.waitForTimeout(2000);
const start = await page.evaluate(() => window.__progLog.length);
console.log(`programs at start: ${start}`);
await page.evaluate(() => (window.__progLog.length = 0));
await page.evaluate((m) => window.__auto.set(m), mode);
await page.waitForTimeout(secs * 1000);
const log = await page.evaluate(() => window.__progLog);
console.log(`${log.length} programs compiled in ${secs}s of driving (${mode})`);
for (const e of log) console.log(`${String(e.t).padStart(5)}s  #${e.n}  ${e.name}  @${e.at}  ${e.kmh} km/h  ${e.key}`);
await browser.close();
await server.close();
