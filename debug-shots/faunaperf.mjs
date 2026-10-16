// Frame cost of the animals in the street: the same spot with and without `fauna=1`, median CPU and GPU ms over 20 s.
//   node debug-shots/faunaperf.mjs "<query>"      (e.g. "spawn=kaburo_crossing.view&clock=21:00")
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const q = process.argv[2] ?? 'spawn=kaburo_crossing.view&clock=21:00';
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const f of ['0', '1']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&weather=clear&${q}&fauna=${f}`, { timeout: 300000 });
  for (let i = 0; i < 200; i++) {
    const st = await page.evaluate(() => ({ d: !!window.__district, o: document.getElementById('overlay')?.textContent?.slice(0, 80) }));
    if (st.d && st.o === 'click to walk') break;
    await page.waitForTimeout(5000);
  }
  await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
  await page.waitForTimeout(30000);
  const r = await page.evaluate(() => {
    const p = window.__perf;
    const d = typeof p === 'function' ? p() : p;
    const med = (a) => { const b = a.filter((x) => x > 0).sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    return { keys: Object.keys(d ?? {}), cpu: d?.cpu ? med(d.cpu) : null, gpu: d?.gpu ? med(d.gpu) : null, n: window.__fauna?.agents?.length ?? 0, calls: window.__renderer?.info?.render?.calls };
  });
  console.log('fauna=' + f, JSON.stringify(r));
  await page.close();
}
await browser.close();
await server.close();
