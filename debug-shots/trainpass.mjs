// Ride a leg and log whenever another (visible) train comes within 8 m of yours: node debug-shots/trainpass.mjs [from,to] [line]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const leg = process.argv[2] ?? 'airport_station,mono_kasumicho_station';
const line = process.argv[3] ?? 'monorail';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: false, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}?debug=1&diag=1&clock=12:00&ride=${leg}`);
  await page.waitForFunction(() => !!window.__trains, null, { timeout: 180000 });
  await page.evaluate((line) => {
    const t = window.__trains.get(line);
    window.__hits = [];
    const V = t.rideTrain.position.constructor;
    const a = new V();
    const b = new V();
    setInterval(() => {
      if (!t.rideTrain.visible) return;
      let best = 1e9, who = '';
      for (const [i, tr] of t.trains.entries()) {
        if (!tr.cars.visible) continue;
        for (const rc of t.rideTrain.children) for (const oc of tr.cars.children) {
          rc.getWorldPosition(a); oc.getWorldPosition(b);
          const d = a.distanceTo(b);
          if (d < best) { best = d; who = `train ${i} dir ${tr.dir} (ride dir ${t.ride2?.timeline.dir})`; }
        }
      }
      if (best < 8) window.__hits.push(`${Math.round(performance.now() / 100) / 10}s ${best.toFixed(1)} m ${who} s=${t.ride2?.timeline.state().s.toFixed(0)}`);
    }, 250);
  }, line);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate((line) => ({ riding: window.__trains.get(line).riding, hits: window.__hits.length }), line);
    if (i > 3 && !s.riding) break;
  }
  const hits = await page.evaluate(() => window.__hits);
  const ds = hits.map((h) => parseFloat(h.split(' ')[1]));
  console.log(hits.length ? `closest ${Math.min(...ds)} m of ${hits.length} samples within 8 m; under 3.8 m: ${hits.filter((h) => parseFloat(h.split(' ')[1]) < 3.8).join(' / ') || 'none'}` : 'no train came within 8 m');
} finally {
  await browser.close();
  await server.close();
}
