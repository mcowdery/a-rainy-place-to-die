// Looks at the city's animals: boots the city, waits for them to settle, reports how many of each there are and
// takes a close shot of one of each kind found.
//   node debug-shots/faunashots.mjs <out dir> [query] [kinds,...]     (query e.g. "city=manila&clock=22:00&season=autumn")
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
import { mkdirSync } from 'fs';
const out = process.argv[2] ?? 'debug-shots/fauna';
mkdirSync(out, { recursive: true });
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const want = process.argv[4]?.split(',');
const server = await shotServer({ server: { port: 0, hmr: false, watch: null }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e.stack ?? e).slice(0, 600)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 400)); });
const q = new URLSearchParams(extra.slice(1));
const city = q.get('city') === 'manila' ? 'manila' : 'toto';
await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1${q.has('clock') ? '' : '&clock=14:00'}${q.has('weather') ? '' : '&weather=clear'}${q.has('season') ? '' : '&season=summer'}${extra}`, { timeout: 300000 });
for (let i = 0; i < 200; i++) {
  const st = await page.evaluate(() => ({ d: !!window.__district, o: document.getElementById('overlay')?.textContent?.slice(0, 80) }));
  if (st.d && st.o === 'click to walk') break;
  await page.waitForTimeout(5000);
}
await page.evaluate(() => { document.getElementById('overlay').hidden = true; });
await page.waitForTimeout(25000);
await page.evaluate(() => { window.__fauna.startleScale = 0; });
const counts = await page.evaluate(() => window.__fauna.counts());
console.log('counts', JSON.stringify(counts));
await page.screenshot({ path: `${out}/overview.png` });
const kinds = want ?? Object.keys(counts);
for (const k of kinds) {
  const ok = await page.evaluate((k) => {
    const f = window.__fauna;
    const a = f.agents.find((a) => a.kind === k && !a.retire && a.fade > 0.9);
    if (!a) return false;
    const cam = window.__camera;
    const d = k === 'butterfly' || k === 'dragonfly' || k === 'moth' || k === 'firefly' ? 1.2 : k === 'dog' || k === 'egret' ? 3 : k === 'cat' || k === 'chicken' ? 2.2 : 1.6;
    const ang = a.hd + 0.7;
    cam.position.set(a.x + Math.sin(ang) * d, a.y + 0.4 + (a.mode === 'orbit' ? 0 : 0), a.z + Math.cos(ang) * d);
    cam.lookAt(a.x, a.y + 0.1, a.z);
    return true;
  }, k);
  if (!ok) { console.log('none of', k); continue; }
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${k}.png` });
  console.log('shot', k);
}
await browser.close();
await server.close();
