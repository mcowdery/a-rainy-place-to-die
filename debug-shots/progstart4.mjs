// Which shader programs get compiled while driving (each is a stall of tens to hundreds of ms): drives your own car on
// the auto-pilot and logs every change in the renderer's program list, with when, where and what the program is.
// Runs exclusive. node debug-shots/driveprograms.mjs [seconds] [mode] [node id] [query]
//   node debug-shots/driveprograms.mjs 60 fast kaburo_crossing.view "cam=2681,1.7,1739,3,0"
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const secs = Number(process.argv[2] ?? 60);
const mode = process.argv[3] ?? 'fast';
const dest = process.argv[4] ?? 'kaburo_crossing.view';
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0${extra}`, { timeout: 180000 });
await page.waitForFunction(() => window.__own && window.__district, null, { timeout: 240000, polling: 200 });

await page.waitForFunction(() => typeof window.__drive === 'function' && window.__auto, null, { timeout: 60000 });
await page.waitForTimeout(3000);

await page.waitForTimeout(1500);

// Poll every frame-ish in the page, so nothing is missed between our reads.
await page.evaluate(() => {
  const r = window.__renderer;
  const seen = new Map();
  window.__progLog = [];
  window.__seenObj = new WeakSet(); window.__fresh = [];
  window.__scene.traverse((o) => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) { const prev = o.onBeforeRender; o.onBeforeRender = function (...a) { if (!window.__seenObj.has(o)) { window.__seenObj.add(o); const m = o.material; window.__fresh.push({ t: performance.now(), s: (o.name || o.type) + '<' + (o.parent && (o.parent.name || o.parent.type)) + '>[' + (m && m.type) + (m && m.transparent ? ',t' : '') + (m && m.map ? ',map' : '') + (m && m.vertexColors ? ',vc' : '') + ']@' + Math.round(o.matrixWorld.elements[12]) + ',' + Math.round(o.matrixWorld.elements[14]) }); } return prev.apply(this, a); }; } });
  const t0 = performance.now();
  window.__linkLog = [];
  { const r0 = window.__renderer; const gl = r0.getContext(); const orig = r0.renderBufferDirect.bind(r0); let cur = null;
    r0.renderBufferDirect = function (camera, scene, geometry, material, object, group) { cur = object; return orig(camera, scene, geometry, material, object, group); };
    const ll = gl.linkProgram.bind(gl);
    gl.linkProgram = (p) => { const o = cur; const chain = []; for (let q = o, i = 0; q && i < 5; q = q.parent, i++) chain.push(q.name || q.type); const m = o && o.material; window.__linkLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), what: o ? chain.join(' < ') + ' | ' + (m && (Array.isArray(m) ? 'array' : m.type + ' ' + (m.name || ''))) + ' geo=' + (o.geometry && o.geometry.type) + '/' + (o.geometry && o.geometry.attributes.position && o.geometry.attributes.position.count) + ' col=' + (m && m.color && m.color.getHexString()) + ' tr=' + (m && m.transparent) + ' bl=' + (m && m.blending) + ' side=' + (m && m.side) + ' fog=' + (m && m.fog) + ' ud=' + JSON.stringify(o.userData).slice(0, 80) + ' local=' + o.position.x.toFixed(0) + ',' + o.position.y.toFixed(0) + ',' + o.position.z.toFixed(0) + ' inst=' + !!(o && o.isInstancedMesh) + ' pos=' + Math.round(o.matrixWorld.elements[12]) + ',' + Math.round(o.matrixWorld.elements[14]) : 'no object' }); return ll(p); }; }

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
      window.__progLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), n: list.length, name: 'FRESH', key: window.__fresh.filter((f) => performance.now() - f.t < 600).map((f) => f.s).slice(0, 30).join(' ;; '), at: null, kmh: null });
      if (users.size) window.__progLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), n: list.length, name: 'USERS', key: [...users].slice(0, 12).map(([k, c]) => `${c}x ${k}`).join(' ;; '), at: null, kmh: null });
      for (const p of list) {
        if (!seen.has(p.id)) {
          seen.set(p.id, 1);
          const o = window.__own;
          window.__progLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), n: list.length, name: p.name, key: String(p.cacheKey).slice(0, 400), at: o ? [Math.round(o.sim.x), Math.round(o.sim.z)] : null, kmh: o ? Math.round(o.sim.u * 3.6) : null });
        }
      }
      for (const id of [...seen.keys()]) if (!now.has(id)) seen.delete(id);
    }
    requestAnimationFrame(tick);
  };
  tick();
});
await page.waitForTimeout(500);
console.log(await page.evaluate(() => { const r = window.__renderer, out = []; window.__scene.traverse((o) => { const m = o.material; if (!m || Array.isArray(m)) return; if (m.type === 'MeshBasicMaterial' && !m.map && !r.properties.get(m).currentProgram) out.push((o.name || o.type) + '<' + (o.parent && (o.parent.name || o.parent.type)) + '> inst=' + !!o.isInstancedMesh + ' vis=' + o.visible + ' @' + Math.round(o.matrixWorld.elements[12]) + ',' + Math.round(o.matrixWorld.elements[14])); }); return 'NEVER-RENDERED basic no-map: ' + out.length + ' :: ' + out.slice(0, 40).join(' || '); }));
const start = await page.evaluate(() => window.__progLog.length);
console.log(`programs at start: ${start}`);

await page.evaluate((m) => window.__auto.set(m), mode);
await page.waitForTimeout(secs * 1000);
console.log('LINKS', JSON.stringify(await page.evaluate(() => window.__linkLog.filter((l) => l.t > 1)), null, 1));
const log = await page.evaluate(() => window.__progLog);
console.log(`${log.length} programs compiled in ${secs}s of driving (${mode})`);
for (const e of log) console.log(`${String(e.t).padStart(5)}s  #${e.n}  ${e.name}  @${e.at}  ${e.kmh} km/h  ${e.key}`);
await browser.close();
await server.close();
