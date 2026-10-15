// The city's shop signs, photographed from where they're read (real/signSites.ts placed them): a face-on sign from
// across its street, a blade from along it.
//   node debug-shots/signs.mjs [out dir] [which] [query]
// which: `sample` (default: two of each form and look from each district), `all`, or indices (0,3,12). It prints how
// many there are of each form. One page load; each sign is a teleport and a wait for its chunks.
import { mkdirSync } from 'node:fs';
import { launchBrowser } from '../scripts/launchBrowser.mjs';
import { shotServer } from '../scripts/shotServer.mjs';
const out = process.argv[2] ?? 'debug-shots/signs';
const which = process.argv[3] ?? 'sample';
const query = process.argv[4] ?? 'clock=21:30&weather=clear';
mkdirSync(out, { recursive: true });
const server = await shotServer({ server: { port: 0, hmr: false }, logLevel: 'silent' });
await server.listen();
const browser = await launchBrowser({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('CONSOLE', m.text().slice(0, 240)); });
  await page.goto(`${server.resolvedUrls.local[0]}?debug=1&diag=1&fly=1&res=100&${query}&cam=3335,6,1300,0,-10`, { timeout: 240000 });
  await page.waitForFunction(() => window.__district && window.__signs && document.getElementById('overlay')?.textContent === 'click to walk', null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => {
    document.getElementById('overlay').hidden = true;
    for (const el of document.querySelectorAll('#hud, #info')) el.style.display = 'none';
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => /MAP \+ FAST TRAVEL/.test(document.body.innerText))) await page.keyboard.press('KeyM');
  const list = (await page.evaluate(() => window.__signs.all())).map((s, i) => ({ ...s, i }));
  console.log(`${list.length} signs: ${['blade', 'fascia', 'channel'].map((k) => `${list.filter((s) => s.form === k).length} ${k}`).join(', ')}`);
  let pick;
  if (which === 'all') pick = list;
  else if (which === 'sample') {
    pick = [];
    for (const d of [...new Set(list.map((s) => s.district))]) {
      for (const f of ['blade', 'fascia', 'channel']) {
        const of = list.filter((s) => s.district === d && s.form === f);
        const looks = [...new Set(of.map((s) => s.look))];
        for (const l of looks.slice(0, 2)) {
          const ofl = of.filter((s) => s.look === l);
          pick.push(ofl[Math.floor(ofl.length * 0.37)]);
        }
      }
    }
  } else pick = list.filter((s) => which.split(',').includes(String(s.i)));
  for (const s of pick) {
    await page.evaluate((i) => window.__signs.go(i), s.i);
    await page.waitForTimeout(6000);
    const name = `${String(s.i).padStart(4, '0')}-${s.district}-${s.form}-${s.look || 'hash'}`;
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(name, `${s.x},${s.z}`, s.text);
  }
} finally {
  await browser.close();
  await server.close();
}
