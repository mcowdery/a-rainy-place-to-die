// The dead hours must never show a vehicle appearing or vanishing: stand at the crossing, run the clock through the
// hours the traffic leaves and returns, and count vehicles within 280 m that arrive or disappear (a car can only
// cross the 320 m draw edge unseen). node debug-shots/deadvanish.mjs [windows e.g. 01:00-02:30,05:30-07:00] [extra query]
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const windows = (process.argv[2] ?? '01:00-02:30,05:30-07:00').split(',');
const extra = process.argv[3] ?? '';
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  for (const w of windows) {
    const [from, to] = w.split('-');
    await page.goto(`${base}?debug=1&diag=1&spawn=kaburo_crossing.view&start=street&clock=${from}&weather=clear${extra ? '&' + extra : ''}`);
    await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240_000, polling: 500 });
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
    await page.waitForTimeout(6000);
    const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const steps = mins(to) - mins(from);
    let prev = new Map();
    let vanished = 0, appeared = 0, seenMax = 0, seenMin = 1e9;
    for (let k = 0; k < steps; k++) {
      await page.evaluate(() => window.__clock.advance(1));
      await page.waitForTimeout(500);
      const now = await page.evaluate(() => {
        const c = window.__camera.position;
        return window.__traffic.movingNear(c, 330).map((m) => [m.key.uuid ?? m.obj.uuid, Math.hypot(m.x - c.x, m.z - c.z)]);
      });
      const cur = new Map(now);
      if (k > 0) {
        for (const [id, d] of prev) if (!cur.has(id) && d < 280) { vanished++; console.log('vanished', id.slice(0, 6), d.toFixed(0)); }
        for (const [id, d] of cur) if (!prev.has(id) && d < 280) { appeared++; console.log('appeared', id.slice(0, 6), d.toFixed(0)); }
      }
      seenMax = Math.max(seenMax, cur.size); seenMin = Math.min(seenMin, cur.size);
      prev = cur;
    }
    console.log(w, JSON.stringify({ vanished, appeared, most: seenMax, fewest: seenMin }));
  }
} finally {
  await browser.close();
  await server.close();
}
