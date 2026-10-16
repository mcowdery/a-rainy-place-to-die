// The dead hours (02:00 to 06:00): the crossing before, during and after, with who and what is on the street.
// node debug-shots/deadhours.mjs [out dir] [times] [extra query]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/deadhours';
const times = (process.argv[3] ?? '23:30,01:30,03:00,06:20,08:00').split(',');
const extra = process.argv[4] ?? '';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console', m.text().slice(0, 400)); });
  for (const t of times) {
    for (let tries = 0; tries < 2; tries++) {
      await page.goto(`${base}?debug=1&diag=1&spawn=kaburo_crossing.view&start=street&clock=${t}&weather=clear${extra ? '&' + extra : ''}`);
      try {
        await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240_000, polling: 500 });
        break;
      } catch { console.log('retry', t); }
    }
    await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
    // (Long enough for the chunks round the crossing to come in and the traffic to have run a while.)
    await page.waitForTimeout(9000);
    const seen = await page.evaluate(() => {
      const c = window.__camera.position;
      const hour = window.__ghost.uniforms.uHour.value;
      const standing = window.__district.crowd?.standingNear(c.x, c.z, 120, hour).length ?? -1;
      const cars = window.__traffic.movingNear(c, 320).length;
      return { hour: +hour.toFixed(2), standing, cars, sounding: window.__traffic.nearest(c, 3).length, quiet: +window.__traffic.quiet.toFixed(2) };
    });
    console.log(t, JSON.stringify(seen));
    await page.screenshot({ path: `${out}/crossing-${t.replace(':', '')}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
