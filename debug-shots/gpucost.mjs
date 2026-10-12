// What each part of the scene costs the GPU at the places the frame recorder found slow: mean GPU ms (180 frames) with
// everything, then with each named group hidden in turn. node debug-shots/gpucost.mjs [x,y,z,yaw,pitch ...]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const spots = (process.argv.length > 2 ? process.argv.slice(2) : ['4511,5,2709,70,0', '4509,5,2297,-89,0', '4929,7,2441,-125,0']).map((s) => s.split(',').map(Number));
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' }, { gpu: 'exclusive' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
const mean = async (page) => {
  await page.waitForTimeout(2500);
  return page.evaluate(() => { const a = window.__perf.gpu.slice(-180); return a.reduce((s, v) => s + v, 0) / Math.max(1, a.length); });
};
let listed = false;
for (const at of spots) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&res=100&perflog=0&time=day&cam=${at.join(',')}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__perf && window.__scene, null, { timeout: 240000, polling: 300 });
  await page.waitForTimeout(9000);
  // The groups with the most meshes under them, by name or by parent chain.
  const groups = await page.evaluate(() => {
    const out = [];
    window.__scene.children.forEach((c, i) => { let n = 0; c.traverse((o) => { if (o.isMesh) n++; }); out.push([i, c.name || c.type, n]); });
    return out.filter((x) => x[2] >= 15);
  });
  if (!listed) { listed = true; console.log('scene children with >=15 meshes: ' + groups.map((g) => g.join(':')).join(' ')); }
  const base = await mean(page);
  const out = ['base ' + base.toFixed(1)];
  for (const [i, name, n] of groups) {
    await page.evaluate((i) => (window.__scene.children[i].visible = false), i);
    out.push('-' + name + '#' + i + '(' + n + ') ' + (await mean(page)).toFixed(1));
    await page.evaluate((i) => (window.__scene.children[i].visible = true), i);
  }
  // Named parts anywhere.
  for (const g of ['passengers', 'crowd']) {
    const n = await page.evaluate((g) => { let c = 0; window.__scene.traverse((o) => { if (o.name === g) { o.visible = false; c++; } }); return c; }, g);
    out.push('-' + g + '(' + n + ') ' + (await mean(page)).toFixed(1));
    await page.evaluate((g) => window.__scene.traverse((o) => { if (o.name === g) o.visible = true; }), g);
  }
  console.log(at.join(','), '=>', out.join(' | '));
  await page.close();
}
await browser.close(); await server.close();
