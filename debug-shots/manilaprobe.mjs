// At one spot (x,z,yaw), the biggest meshes in view by triangles, and the GPU/CPU ms with each top-level group hidden in turn.
//   node debug-shots/manilaprobe.mjs <out dir> <city> x,z,yaw [extra query]
import { chromium } from 'playwright-core';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/perf_manila';
const city = process.argv[3] ?? 'manila';
const [x, z, yaw] = (process.argv[4] ?? '1536,448,0').split(',').map(Number);
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
let res;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 500)));
  await page.goto(`${server.resolvedUrls.local[0]}?${city === 'manila' ? 'city=manila&' : ''}debug=1&diag=1&res=100&perflog=0${/(^|&)time=/.test(extra) ? "" : "&time=day"}${/(^|&)weather=/.test(extra) ? "" : "&weather=clear"}${extra}`, { timeout: 300000 });
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => ({ d: !!window.__district && !!window.__perf, o: document.getElementById('overlay')?.textContent?.slice(0, 40) }));
    if (st.d && st.o === 'click to walk') break;
    await page.waitForTimeout(3000);
  }
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(3000);
  await page.evaluate(([x, z, yaw]) => {
    const cam = window.__camera;
    cam.position.set(x, 1.7, z);
    const e = new cam.rotation.constructor();
    e.set(0, (yaw * Math.PI) / 180, 0, 'YXZ');
    cam.quaternion.setFromEuler(e);
  }, [x, z, yaw]);
  await page.waitForTimeout(12000);
  res = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const THREE_Frustum = null;
    const sc = window.__scene;
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
    const measure = async () => {
      window.__perf.cpu.length = 0; window.__perf.gpu.length = 0;
      await wait(3000);
      return { cpu: +avg(window.__perf.cpu).toFixed(2), gpu: +avg(window.__perf.gpu).toFixed(2), tris: window.__renderer.info.render.triangles, calls: window.__renderer.info.render.calls };
    };
    const out = { base: await measure(), hidden: {} };
    const tops = sc.children.map((c, i) => ({ c, i, name: (c.name || c.type) + `#${i}`, n: (() => { let t = 0; c.traverse((o) => { if (o.isMesh) t++; }); return t; })() })).filter((t) => t.n > 0);
    for (const t of tops) {
      if (t.c.name === 'first-person') continue;
      const was = t.c.visible;
      t.c.visible = false;
      const m = await measure();
      t.c.visible = was;
      out.hidden[`${t.name} (${t.n} meshes)`] = m;
    }
    // biggest meshes in view
    const list = [];
    sc.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
      let p = o; const path = [];
      while (p && p !== sc) { path.push(p.name || p.type); p = p.parent; }
      list.push({ n, path: path.reverse().slice(0, 4).join('/'), mat: o.material?.name || o.material?.type, inst: o.isInstancedMesh ? o.count : 0 });
    });
    list.sort((a, b) => b.n - a.n);
    out.top = list.slice(0, 25).map((l) => `${Math.round(l.n / 1000)}k ${l.path} [${l.mat}] ${l.inst ? 'x' + l.inst : ''}`);
    out.names = sc.children.map((c, i) => `${i}:${c.name || c.type}`);
    return out;
  });
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(res, null, 1));
writeFileSync(`${out}/probe_${city}_${process.argv[4] ?? ''}_${(process.argv[5] ?? '').replace(/[^a-z0-9]+/gi, '_')}.json`, JSON.stringify(res, null, 1));
