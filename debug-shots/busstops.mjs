// Every bus stop, photographed from out in the road before it (district/stops.ts chose where each stands and what
// kind it is: a shelter, a pole and bench, or the pole alone).
//   node debug-shots/busstops.mjs [out dir] [which] [query]
// which: all (default), a line's id (kaburo), or indices (0,3,12); with `bus` after it (kaburo:bus) each shot waits for
// the line's bus to pull in. A sheet of what it found (the kinds, anything a line asked for and couldn't have) is
// printed. One page load; each stop is a teleport and a wait for its chunks.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/busstops';
const [which, withBus] = (process.argv[3] ?? 'all').split(':');
const query = process.argv[4] ?? 'clock=10:00&weather=clear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&res=100&${query}&cam=3335,6,1300,0,-10`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__stops && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  // (The debug map opens over the view on some starts: shut it.)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => /MAP \+ FAST TRAVEL/.test(document.body.innerText))) await page.keyboard.press('KeyM');
  const list = await page.evaluate(() => window.__stops.list());
  const problems = await page.evaluate(() => window.__stops.problems());
  const pick = list.map((s, i) => ({ ...s, i })).filter((s) => which === 'all' || s.line === which || which.split(',').includes(String(s.i)));
  console.log(`${list.length} stops: ${['shelter', 'bench', 'pole', 'jeep'].map((k) => `${list.filter((s) => s.kind === k).length} ${k}`).join(', ')}; ${problems.length} problems`);
  for (const p of problems) console.log('  ', p);
  for (const s of pick) {
    await page.evaluate((i) => window.__stops.go(i), s.i);
    // The chunks round it stream in; then a still.
    await page.waitForTimeout(6500);
    if (withBus === 'bus') {
      await page.evaluate((i) => window.__stops.send(i), s.i);
      await page.waitForTimeout(11000);
    }
    const name = `${String(s.i).padStart(2, '0')}-${s.line}-${s.kind}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name, s.name, `${s.x},${s.z}`, `pavement ${s.pavement} m, clear ${s.depth} m${s.forced ? ' FORCED' : ''}`);
  }
} finally {
  await browser.close();
  await server.close();
}
