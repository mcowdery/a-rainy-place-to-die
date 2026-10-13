// The city in another year (district/era.ts), side by side: the same views in each era.
// node debug-shots/era.mjs [out dir] [eras e.g. 1992,1977] [views e.g. crossing,over,street]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/era';
const eras = (process.argv[3] ?? '1992,1977').split(',');
const want = (process.argv[4] ?? 'crossing,over,street').split(',');
mkdirSync(out, { recursive: true });
// Each view: the page's query, and (flying) where the camera stands and what it looks at.
const VIEWS = {
  // Where the game starts: the crossing at night.
  crossing: { query: 'spawn=kaburo_crossing.view&start=street&clock=21:00&weather=clear' },
  // Above the neon district at dusk, looking west to the towers.
  over: { query: 'fly=1&cam=4150,150,1500,0,0&clock=17:40&weather=clear', at: [4150, 150, 1500], look: [2700, 20, 1380] },
  // Down a street of the neon district by day.
  street: { query: 'fly=1&cam=3900,14,1480,0,0&clock=13:00&weather=clear', at: [3900, 14, 1480], look: [3500, 12, 1480] },
};
const server = await shotServer({ server: { port: 0 }, logLevel: 'silent' });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console', m.text().slice(0, 300)); });
  for (const era of eras) {
    for (const name of want) {
      const v = VIEWS[name];
      if (!v) continue;
      await page.goto(`${base}?debug=1&diag=1&era=${era}&${v.query}`);
      await page.waitForFunction(() => window.__district && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240_000, polling: 500 });
      await page.evaluate(() => { document.getElementById('overlay').hidden = true; document.getElementById('hud').style.display = 'none'; });
      if (v.at) {
        await page.evaluate(({ at, look }) => {
          const c = window.__camera;
          c.position.set(at[0], at[1], at[2]);
          c.lookAt(look[0], look[1], look[2]);
        }, v);
      }
      // (Long enough for the chunks in view to come in at full detail.)
      await page.waitForTimeout(12000);
      if (v.at) await page.evaluate(({ at, look }) => { const c = window.__camera; c.position.set(at[0], at[1], at[2]); c.lookAt(look[0], look[1], look[2]); }, v);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/${name}-${era}.png` });
      console.log(era, name);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
