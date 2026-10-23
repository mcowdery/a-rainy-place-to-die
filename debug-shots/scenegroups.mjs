// What each of the scene's top-level groups is, and the geometry it holds on the CPU (typed arrays three keeps after the
// upload): its index, children, triangles, MB, whether it's the district's root, and the names found inside it.
//   node debug-shots/scenegroups.mjs [extra query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const extra = process.argv[2] ? `&${process.argv[2]}` : '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 2413, height: 922 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&perflog=0&time=night&weather=clear&cam=3842,2,1534,-71,0${extra}`, { timeout: 300000 });
await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 400000, polling: 1000 });
await page.evaluate(() => (document.getElementById('overlay').hidden = true));
await page.waitForTimeout(8000);
const rows = await page.evaluate(() => {
  const out = [];
  window.__scene.children.forEach((top, idx) => {
    const seen = new Set();
    let bytes = 0;
    let tris = 0;
    let meshes = 0;
    let skinned = 0;
    let instanced = 0;
    const names = new Map();
    top.traverse((o) => {
      if (o.name) names.set(o.name, (names.get(o.name) ?? 0) + 1);
      const g = o.geometry;
      if (!g) return;
      meshes++;
      if (o.isSkinnedMesh) skinned++;
      if (o.isInstancedMesh) instanced++;
      for (const a of [...Object.values(g.attributes), g.index]) {
        const arr = a?.array ?? a?.data?.array;
        if (arr?.buffer && !seen.has(arr.buffer)) {
          seen.add(arr.buffer);
          bytes += arr.buffer.byteLength;
        }
      }
      tris += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    });
    out.push({
      idx,
      type: top.type,
      name: top.name,
      children: top.children.length,
      root: top === window.__district.root,
      mb: Math.round(bytes / 1048576),
      ktris: Math.round(tris / 1000),
      meshes,
      skinned,
      instanced,
      names: [...names].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, c]) => `${n}${c > 1 ? '×' + c : ''}`).join(', '),
      ud: Object.keys(top.userData ?? {}).slice(0, 5).join(','),
      first: top.children.slice(0, 3).map((c) => `${c.type}${c.name ? ':' + c.name : ''}`).join(' '),
    });
  });
  return out.sort((a, b) => b.mb - a.mb);
});
for (const r of rows.filter((r) => r.mb > 0)) console.log(`#${r.idx} ${r.type}${r.name ? ' ' + r.name : ''}(${r.children})${r.root ? ' DISTRICT ROOT' : ''}  ${r.mb} MB  ${r.ktris}k tris  ${r.meshes} meshes (${r.skinned} skinned, ${r.instanced} instanced)  ud[${r.ud}]  first: ${r.first}  names: ${r.names}`);
await browser.close();
await server.close();
