// At one spot (x,z,yaw), the biggest meshes in view by triangles, and the GPU/CPU ms with each top-level group hidden in turn.
//   node debug-shots/manilaprobe.mjs <out dir> <city> x,z,yaw [extra query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync, writeFileSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/perf_manila';
const city = process.argv[3] ?? 'manila';
const [x, z, yaw] = (process.argv[4] ?? '1536,448,0').split(',').map(Number);
const extra = process.argv[5] ? `&${process.argv[5]}` : '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
let res;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 500)));
  await page.goto(`${server.resolvedUrls.local[0]}?${city === 'manila' ? 'city=manila&' : ''}debug=1&diag=1&res=100&perflog=0&cam=${x},1.7,${z},${yaw},0${/(^|&)time=/.test(extra) ? "" : "&time=day"}${/(^|&)weather=/.test(extra) ? "" : "&weather=clear"}${extra}`, { timeout: 300000 });
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
    // the sun's shadow pass: triangles of the shadow casters inside its camera's frustum, by top-level group, and the cost of switching it off
    {
      const sun = window.__sun;
      const cam = sun.shadow.camera;
      cam.updateMatrixWorld(true);
      const E = cam.matrixWorldInverse.elements;
      const inBox = (c, r) => {
        const x = E[0] * c.x + E[4] * c.y + E[8] * c.z + E[12];
        const y = E[1] * c.x + E[5] * c.y + E[9] * c.z + E[13];
        const z = E[2] * c.x + E[6] * c.y + E[10] * c.z + E[14];
        return x > cam.left - r && x < cam.right + r && y > cam.bottom - r && y < cam.top + r && -z > cam.near - r && -z < cam.far + r;
      };
      const byTop = {};
      sc.children.forEach((top, i) => {
        const key = (top.name || top.type) + '#' + i;
        top.traverseVisible((o) => {
          if (!o.isMesh || !o.castShadow || !o.geometry) return;
          const g = o.geometry;
          if (!g.boundingSphere) g.computeBoundingSphere();
          const bs = o.isInstancedMesh && o.boundingSphere ? o.boundingSphere : g.boundingSphere;
          const sph = bs.clone().applyMatrix4(o.matrixWorld);
          if (o.frustumCulled && !inBox(sph.center, sph.radius)) return;
          const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
          byTop[key] = byTop[key] || { tris: 0, draws: 0 };
          byTop[key].tris += n;
          byTop[key].draws++;
        });
      });
      out.casters = Object.entries(byTop).sort((a, b) => b[1].tris - a[1].tris).slice(0, 10).map(([k, v]) => `${k}: ${Math.round(v.tris / 1000)}k tris ${v.draws} draws`);
      sun.shadow.autoUpdate = false;
      out.noShadowUpdate = await measure();
      sun.shadow.autoUpdate = true;
    }
    // each lamp shadow's casters: triangles of castShadow meshes whose bounding sphere reaches within 22 m of the lamp (a sphere test, as the spot frustum's culling is close to)
    {
      const ls = window.__lampShadows;
      const per = [];
      const meshes = [];
      sc.traverseVisible((o) => { if (o.isMesh && o.castShadow && o.geometry && !o.isSkinnedMesh) meshes.push(o); });
      for (const l of ls.lights) {
        let tris = 0, n = 0; const by = {};
        for (const o of meshes) {
          const g = o.geometry;
          if (!g.boundingSphere) g.computeBoundingSphere();
          const bs = o.isInstancedMesh && o.boundingSphere ? o.boundingSphere : g.boundingSphere;
          const c = bs.center.clone().applyMatrix4(o.matrixWorld);
          const r = bs.radius * Math.max(o.matrixWorld.getMaxScaleOnAxis(), 1);
          const d = Math.hypot(c.x - l.position.x, c.z - l.position.z);
          if (d - r > 22) continue;
          const t = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
          tris += t; n++;
          let p = o; while (p.parent && p.parent !== sc) p = p.parent;
          const key = (p.name || p.type) + '/' + (o.parent && o.parent !== p ? (o.parent.name || o.parent.type) : '') ;
          by[key] = (by[key] || 0) + t;
        }
        per.push({ on: l.intensity > 0, tris: Math.round(tris / 1000) + 'k', meshes: n, top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + Math.round(v / 1000) + 'k').join('; ') });
      }
      out.lamps = per;
    }
    out.baseEnd = await measure();
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
