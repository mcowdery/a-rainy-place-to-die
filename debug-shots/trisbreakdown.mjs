// What the main camera draws at the places the frame recorder found slow: triangles and draws by object (name chain, material),
// from a camera set with ?cam. node debug-shots/trisbreakdown.mjs [x,y,z,yaw ...]   (default: the dips of 2026-10-10)
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const defaults = ['4511,5,2709,70', '4472,4,2548,-64', '4509,5,2297,-89', '4706,6,2312,-15', '4929,7,2441,-125'];
const spots = process.argv.length > 2 ? process.argv.slice(2) : defaults;
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const spot of spots) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0&time=day&cam=${spot.split(',').join(',')},0`, { timeout: 180000 });
  await page.waitForFunction(() => window.__district && window.__scene, null, { timeout: 240000, polling: 200 });
  await page.waitForTimeout(6000);
  const res = await page.evaluate(async () => {
    const groups = new Map();
    const cams = new Map();
    const r = window.__renderer;
    const hooked = [];
    let before = 0;
    window.__scene.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints)) return;
      const pb = o.onBeforeRender, pa = o.onAfterRender;
      hooked.push([o, pb, pa]);
      o.onBeforeRender = function (rr, sc, cam, geo, mat, grp) { before = r.info.render.triangles; return pb.call(this, rr, sc, cam, geo, mat, grp); };
      o.onAfterRender = function (rr, sc, cam, geo, mat, grp) {
        const tris = r.info.render.triangles - before;
        const ck = cam.type + '/' + cam.fov + '/' + cam.far + (cam.isOrthographicCamera ? '/ortho' : '');
        const ce = cams.get(ck) ?? { tris: 0, draws: 0 }; ce.tris += tris; ce.draws++; cams.set(ck, ce);
        if (cam.isPerspectiveCamera && cam.far === 1200 && cam.fov === 68) {
          const chain = [];
          for (let q = o, i = 0; q && q.type !== 'Scene' && i < 3; q = q.parent, i++) chain.push(q.name || q.type);
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          const key = chain.join(' < ') + ' | ' + m.type + (m.transparent ? ',t' : '') + (o.isInstancedMesh ? ',inst' : '');
          const e = groups.get(key) ?? { tris: 0, draws: 0 };
          e.tris += tris; e.draws += 1;
          groups.set(key, e);
        }
        return pa.call(this, rr, sc, cam, geo, mat, grp);
      };
    });
    r.info.autoReset = false; r.info.reset();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const info = { tris: r.info.render.triangles, calls: r.info.render.calls };
    r.info.autoReset = true;
    for (const [o, pb, pa] of hooked) { o.onBeforeRender = pb; o.onAfterRender = pa; }
    const list = [...groups].sort((a, b) => b[1].tris - a[1].tris).slice(0, 14).map(([k, v]) => (v.tris / 1000).toFixed(0).padStart(6) + 'k ' + String(v.draws).padStart(4) + 'x  ' + k);
    list.push('cameras: ' + [...cams].map(([k, v]) => k + ' ' + (v.tris / 1000).toFixed(0) + 'k/' + v.draws).join(' ; '));
    const mainTris = [...groups.values()].reduce((a, v) => a + v.tris, 0);
    return { info, mainTris, list };
  });
  console.log(`\n== ${spot}: info over 2 frames ${(res.info.tris / 1000).toFixed(0)}k tris, ${res.info.calls} calls; main camera (2 frames) ${(res.mainTris / 1000).toFixed(0)}k`);
  console.log(res.list.join('\n'));
  await page.close();
}
await browser.close(); await server.close();
