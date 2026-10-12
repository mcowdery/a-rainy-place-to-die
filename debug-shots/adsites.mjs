// The city's billboards and posters, each photographed from where it's meant to be seen (real/adSites.ts placed them;
// district/adSitesDebug.ts is the page's `__ads`).
//   node debug-shots/adsites.mjs [out dir] [which] [query]
// which: `sample` (default: a spread across the districts, the kinds and who each is for), `all`, a viewer
// (`expressway`, `rail`, `street`, `wait`), or indices (0,3,12). Add `adsites=1` to the query to outline every ad
// through the buildings. It prints how many there are of each. One page load; each ad is a teleport and a wait for
// its chunks.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/adsites';
const which = process.argv[3] ?? 'sample';
const query = process.argv[4] ?? 'clock=20:30&weather=clear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&res=100&${query}&cam=3335,6,1300,0,-10`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__ads && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => /MAP \+ FAST TRAVEL/.test(document.body.innerText))) await page.keyboard.press('KeyM');
  const list = await page.evaluate(() => window.__ads.all());
  const count = (key) => [...list.reduce((m, s) => m.set(key(s), (m.get(key(s)) ?? 0) + 1), new Map())].map(([k, n]) => `${n} ${k}`).join(', ');
  console.log(`${list.length} ads: ${count((s) => s.kind)}; for: ${count((s) => s.view)}`);
  let pick;
  if (which === 'all') pick = list;
  else if (['expressway', 'rail', 'street', 'wait'].includes(which)) pick = list.filter((s) => s.view === which);
  else if (which === 'sample') {
    // Two of each kind and viewer from each district, spread through the list.
    pick = [];
    for (const d of [...new Set(list.map((s) => s.district))]) {
      for (const k of [...new Set(list.map((s) => `${s.kind}/${s.view}`))]) {
        const of = list.filter((s) => s.district === d && `${s.kind}/${s.view}` === k);
        for (const j of [0.2, 0.7]) if (of.length) pick.push(of[Math.floor(of.length * j)]);
      }
    }
    pick = [...new Set(pick)];
  } else pick = list.filter((s) => which.split(',').includes(String(s.i)));
  for (const s of pick) {
    await page.evaluate((i) => window.__ads.go(i), s.i);
    await page.waitForTimeout(6000);
    const name = `${String(s.i).padStart(3, '0')}-${s.district}-${s.kind}-${s.view}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name, `${s.x},${s.z}`, `score ${s.score}`, s.brand);
  }
} finally {
  await browser.close();
  await server.close();
}
