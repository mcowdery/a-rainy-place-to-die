// What each top-level group adds to a whole frame's triangles and draws (shadow passes and mirror included, as the frame recorder
// counts them): hides each in turn and reads the renderer's totals. node debug-shots/trisframe.mjs [x,y,z,yaw,pitch ...]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const spots = process.argv.length > 2 ? process.argv.slice(2) : ['4511,5,2709,70,0', '4509,5,2297,-89,0', '4706,6,2312,-15,0'];
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const at of spots) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0&time=day&cam=${at}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__scene, null, { timeout: 240000, polling: 300 });
  await page.waitForTimeout(9000);
  const res = await page.evaluate(async () => {
    const r = window.__renderer;
    const med = () => new Promise((res) => {
      const a = [], c = [];
      const f = () => { a.push(r.info.render.triangles); c.push(r.info.render.calls); if (a.length < 12) requestAnimationFrame(f); else { a.sort((x, y) => x - y); c.sort((x, y) => x - y); res([a[6], c[6]]); } };
      requestAnimationFrame(f);
    });
    const [base, baseCalls] = await med();
    const out = [];
    const kids = window.__scene.children.slice();
    for (const k of kids) {
      let n = 0; k.traverse((o) => { if (o.isMesh) n++; });
      if (!n || !k.visible) continue;
      k.visible = false;
      const [t, c] = await med();
      k.visible = true;
      if (base - t > 20000 || baseCalls - c > 15) out.push({ name: (k.name || k.type) + '(' + k.children.length + ',' + n + ' meshes)', dTris: base - t, dCalls: baseCalls - c });
    }
    out.sort((a, b) => b.dTris - a.dTris);
    return { base, baseCalls, out: out.slice(0, 12) };
  });
  console.log(`\n== ${at}: frame ${(res.base / 1000).toFixed(0)}k tris, ${res.baseCalls} calls`);
  for (const o of res.out) console.log(`${String((o.dTris / 1000).toFixed(0)).padStart(6)}k tris ${String(o.dCalls).padStart(5)} calls  ${o.name}`);
  await page.close();
}
await browser.close(); await server.close();
